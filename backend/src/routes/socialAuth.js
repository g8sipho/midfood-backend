// "Continue with Google" and "Continue with Facebook" for customers.
//
// The phone app and the website never talk to Google or Facebook themselves.
// They open one MidFood URL (/api/auth/google/start) in the browser; this
// server sends the customer to the provider, takes the code the provider
// hands back, swaps it for the customer's name and email, finds or creates
// the MidFood account, and sends the customer back to the app
// (midfood://auth?token=...) or the website (/order/#social=...) signed in.
//
// Keeping the exchange here means the app secret never ships inside an APK,
// and adding a third provider is a few lines in PROVIDERS below.
//
// Env: GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET, FACEBOOK_APP_ID +
// FACEBOOK_APP_SECRET, PUBLIC_URL (https://midfood.co.za). A provider with no
// keys set simply isn't offered.
const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { pool, uuid } = require('../db');
const { JWT_SECRET } = require('../middleware/auth');

const router = express.Router();
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const STATE_TTL = '10m';
const APP_RETURN = 'midfood://auth';

function publicUrl() {
  return (process.env.PUBLIC_URL || 'https://midfood.co.za').replace(/\/+$/, '');
}

const PROVIDERS = {
  google: {
    label: 'Google',
    column: 'google_id',
    configured: () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    authorizeUrl(redirectUri, state) {
      const q = new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid email profile',
        state,
        prompt: 'select_account',
      });
      return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
    },
    // Code -> access token -> the OpenID userinfo document.
    async profile(code, redirectUri) {
      const token = await module.exports.http('POST', 'https://oauth2.googleapis.com/token', {
        form: {
          code,
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        },
      });
      if (!token || !token.access_token) throw new Error('Google did not accept the sign-in code');
      const me = await module.exports.http('GET', 'https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: `Bearer ${token.access_token}` },
      });
      if (!me || !me.sub) throw new Error('Google did not return a profile');
      return {
        id: String(me.sub),
        name: me.name || [me.given_name, me.family_name].filter(Boolean).join(' ') || null,
        email: me.email_verified === false ? null : me.email || null,
        avatar: me.picture || null,
      };
    },
  },
  facebook: {
    label: 'Facebook',
    column: 'facebook_id',
    configured: () => Boolean(process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET),
    authorizeUrl(redirectUri, state) {
      const q = new URLSearchParams({
        client_id: process.env.FACEBOOK_APP_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'email,public_profile',
        state,
      });
      return `https://www.facebook.com/v19.0/dialog/oauth?${q}`;
    },
    async profile(code, redirectUri) {
      const q = new URLSearchParams({
        client_id: process.env.FACEBOOK_APP_ID,
        client_secret: process.env.FACEBOOK_APP_SECRET,
        redirect_uri: redirectUri,
        code,
      });
      const token = await module.exports.http('GET', `https://graph.facebook.com/v19.0/oauth/access_token?${q}`);
      if (!token || !token.access_token) throw new Error('Facebook did not accept the sign-in code');
      const fields = new URLSearchParams({ fields: 'id,name,email,picture.type(large)', access_token: token.access_token });
      const me = await module.exports.http('GET', `https://graph.facebook.com/v19.0/me?${fields}`);
      if (!me || !me.id) throw new Error('Facebook did not return a profile');
      return {
        id: String(me.id),
        name: me.name || null,
        email: me.email || null,
        avatar: me.picture && me.picture.data ? me.picture.data.url || null : null,
      };
    },
  },
};

// One small HTTP helper, swapped out by the tests so no real call leaves.
async function http(method, url, { form, headers } = {}) {
  const init = { method, headers: { Accept: 'application/json', ...(headers || {}) } };
  if (form) {
    init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    init.body = new URLSearchParams(form).toString();
  }
  const res = await fetch(url, init);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
  if (!res.ok) {
    const detail = (data && (data.error_description || (data.error && (data.error.message || data.error)))) || res.status;
    throw new Error(`Sign-in provider answered ${detail}`);
  }
  return data;
}

function redirectUriFor(provider) {
  return `${publicUrl()}/api/auth/${provider}/callback`;
}

// Where the customer lands afterwards, signed in or with a reason they aren't.
function returnTo(platform, params) {
  const q = new URLSearchParams(params).toString();
  if (platform === 'app') return `${APP_RETURN}?${q}`;
  return `${publicUrl()}/order/#social=${encodeURIComponent(q)}`;
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function providerOr404(req, res) {
  const provider = PROVIDERS[req.params.provider];
  if (!provider) {
    res.status(404).json({ error: 'Unknown sign-in provider' });
    return null;
  }
  return provider;
}

// GET /api/auth/providers -> { google: true, facebook: false }
// The app only shows the buttons that will work.
router.get('/providers', (req, res) => {
  const out = {};
  for (const [key, p] of Object.entries(PROVIDERS)) out[key] = p.configured();
  res.json(out);
});

// GET /api/auth/:provider/start?platform=app|web
// Sends the browser to the provider. The signed `state` carries the platform
// and a nonce; on the web the nonce is also set as a cookie so a sign-in can
// only finish in the browser that started it.
router.get('/:provider/start', (req, res) => {
  const provider = providerOr404(req, res);
  if (!provider) return;
  const platform = req.query.platform === 'app' ? 'app' : 'web';
  if (!provider.configured()) {
    return res.redirect(returnTo(platform, { error: `Signing in with ${provider.label} is not switched on yet. Use your email instead.` }));
  }
  const nonce = crypto.randomBytes(16).toString('hex');
  const state = jwt.sign({ kind: 'oauth', provider: req.params.provider, platform, nonce }, JWT_SECRET, { expiresIn: STATE_TTL });
  if (platform === 'web') {
    const secure = publicUrl().startsWith('https://') ? '; Secure' : '';
    res.setHeader('Set-Cookie', `mf_oauth=${nonce}; Path=/api/auth; Max-Age=600; HttpOnly; SameSite=Lax${secure}`);
  }
  res.redirect(provider.authorizeUrl(redirectUriFor(req.params.provider), state));
});

// GET /api/auth/:provider/callback?code=...&state=...
router.get('/:provider/callback', async (req, res, next) => {
  const provider = providerOr404(req, res);
  if (!provider) return;
  const key = req.params.provider;

  let platform = 'web';
  let claims = null;
  try {
    claims = jwt.verify(String(req.query.state || ''), JWT_SECRET);
    if (claims.kind !== 'oauth' || claims.provider !== key) throw new Error('state mismatch');
    platform = claims.platform === 'app' ? 'app' : 'web';
  } catch (e) {
    return res.redirect(returnTo(platform, { error: 'That sign-in link has expired. Please try again.' }));
  }
  if (platform === 'web') {
    const cookies = parseCookies(req.headers.cookie);
    if (cookies.mf_oauth !== claims.nonce) {
      return res.redirect(returnTo(platform, { error: 'Please start the sign-in again from the MidFood website.' }));
    }
    res.setHeader('Set-Cookie', 'mf_oauth=; Path=/api/auth; Max-Age=0; HttpOnly; SameSite=Lax');
  }
  if (req.query.error || !req.query.code) {
    const why = req.query.error === 'access_denied' ? `You cancelled the ${provider.label} sign-in.` : `${provider.label} did not complete the sign-in.`;
    return res.redirect(returnTo(platform, { error: why }));
  }

  try {
    const me = await provider.profile(String(req.query.code), redirectUriFor(key));
    const email = me.email ? String(me.email).trim().toLowerCase() : null;

    const client = await pool.connect();
    let user;
    try {
      await client.query('BEGIN');
      // Already signed in this way before?
      let found = await client.query(`SELECT id, name, email, phone, created_at AS "createdAt" FROM users WHERE ${provider.column} = $1`, [me.id]);
      user = found.rows[0];
      // Same email as an existing MidFood account? Tie them together.
      if (!user && email) {
        found = await client.query('SELECT id, name, email, phone, created_at AS "createdAt" FROM users WHERE email = $1 ORDER BY created_at LIMIT 1', [email]);
        user = found.rows[0];
        if (user) {
          await client.query(`UPDATE users SET ${provider.column} = $1, avatar_url = COALESCE(avatar_url, $2) WHERE id = $3`, [me.id, me.avatar, user.id]);
        }
      }
      if (!user) {
        if (!email) {
          await client.query('ROLLBACK');
          return res.redirect(returnTo(platform, { error: `${provider.label} did not share an email address with MidFood. Please sign up with your email instead.` }));
        }
        const id = uuid();
        const createdAt = new Date().toISOString();
        const name = (me.name || email.split('@')[0]).trim().slice(0, 80);
        await client.query(
          `INSERT INTO users (id, name, email, phone, password_hash, created_at, ${provider.column}, avatar_url)
           VALUES ($1, $2, $3, NULL, NULL, $4, $5, $6)`,
          [id, name, email, createdAt, me.id, me.avatar]
        );
        user = { id, name, email, phone: null, createdAt };
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    const token = jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    res.redirect(returnTo(platform, { token, provider: key }));
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') console.error(`[social-auth] ${key}:`, err.message);
    res.redirect(returnTo(platform, { error: `Couldn't sign in with ${provider.label} right now. Please try again or use your email.` }));
  }
});

module.exports = { router, http, PROVIDERS, returnTo };
