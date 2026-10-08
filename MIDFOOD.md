# MidFood — project brief

*Hand this file to any new chat and Claude will be up to speed in one read.*

**Owner:** Sipho Masombuka · Middelburg, Mpumalanga, South Africa
**What it is:** A food delivery platform for Middelburg — customers order from
local restaurants, pay by card, and a MidFood driver delivers.
**Status (8 Oct 2026):** Live on midfood.co.za and fully built, but **not yet
taking real money**: it is waiting on a PayFast account of its own. See *Where
things stand*.

`GO-LIVE.md` beside this file is Sipho's day-to-day guide: daily checks,
refunds, the Tuesday payout run.

---

## Where everything lives

| What | Where |
|---|---|
| Source code (the truth) | `github.com/g8sipho/midfood-backend` |
| Live server | Render — service `midfood-backend` (root directory `backend`), managed Postgres 18 `midfood-db` |
| Live site | **https://midfood.co.za** |
| Domain + hosting | Axxess (ccp.axxess.co.za) · cPanel `cphost29.vpslocal.co.za` |
| DNS | Axxess client area → the midfood.co.za hosting service → DNS Zones |
| Local copies | `C:\Users\G8VIP\OneDrive\Documents\G8 MidFood` — this file, `GO-LIVE.md`, and dated code snapshots (`midfood-complete-2026-10-08.zip` is the go-live build; the undated zip is from before it) |
| Payments | PayFast. Mode and merchant details are four `PAYFAST_…` values in Render → Environment. **Test mode until MidFood has its own PayFast account** — see *Where things stand*. |
| Restaurant flyer | A Claude artifact, "MidFood — Restaurant Flyer" (A4 front/back + WhatsApp square). Finished: 072 643 7784, Tuesday payouts. |

## The front doors

All served by the one backend, so there is nothing extra to host.

| Address | Who | What they do |
|---|---|---|
| `midfood.co.za` | Everyone | Public landing page |
| `/order/` | **Customers** | Browse, order, pay, track on a live map. Any browser; installs to a home screen. |
| `/portal/` | Restaurants | Live order board, menu, open/closed, takings, statements. Also self-signup. |
| `/driver/` | Drivers | Go online, accept deliveries, navigate, mark delivered, earnings, statements. Also self-signup. |
| `/portal/admin.html` | Sipho | Approvals, orders in progress, refunds, restaurant terms, payouts. Needs `ADMIN_KEY`. |
| `/privacy/` | Everyone | Privacy policy (POPIA), required by both app stores |

The admin page has two tabs. **Operations:** refunds owed, orders in progress
(with a flag on any kitchen that has not accepted within 10 minutes of
payment, and a cancel button), approvals, drivers, restaurants with their
terms and their **menus** (Sipho can load or fix any restaurant's menu, one
dish at a time or by pasting a price list, without the restaurant's password). **Payouts:** who is owed, statements, rates and payout day, history.

There is also a React Native / Expo customer app in `mobile/`, configured for
the stores as `za.co.midfood.app`. **Not submitted, never yet run on a phone,
and it does not have the pin or the live map.** It still works against the
server. The `/order/` page is the real customer front end today.

## DNS, as currently set

Changed on 1 Oct 2026, in the Axxess client area, not cPanel directly.

| Record | Value | Why |
|---|---|---|
| `midfood.co.za` A | `216.24.57.1` | Render |
| `www` CNAME | `midfood-backend.onrender.com` | Render |
| `webmail` / `cpanel` / `ftp` CNAME | `cphost29.vpslocal.co.za` | Repointed at the host, because they used to follow `midfood.co.za` and would have broken |
| MX, SPF, `mail` A | untouched | Email on the domain still runs through Axxess |

## How an order actually flows

1. Customer orders at `/order/`. At checkout they can tap **Pin my location**
   (optional, only kept if the phone's fix is good to about 100 m). The page
   re-checks prices against the kitchen's menu, and the server refuses to
   charge any total the page did not show.
2. Order is created as `payment_status = 'pending'` — the kitchen cannot see
   it. PayFast's server-to-server ITN flips it to `'paid'`, stamps `paid_at`,
   and freezes the money split onto the order.
3. Paid order appears on the restaurant's board with a chime. They **accept**
   (or decline with a reason), **start preparing**, then mark **food ready**.
4. Ready orders are offered to every online driver, showing what the driver
   will earn. First to accept wins. Only that driver gets the customer's phone
   number and pin.
5. Driver taps **picked up** → `out_for_delivery`. The customer's page shows a
   live map with the driver, their own pin, and the distance. Then **delivered**.
6. Each step sends a push notification (phone app only).

Statuses: `placed → confirmed → preparing → out_for_delivery → delivered`,
plus `rejected` (declined by the kitchen, or cancelled by Sipho —
`cancelled_by` says which). Payment is tracked separately:
`pending / paid / failed`.

**Refunds.** A paid order that ends up `rejected` is a refund owed. It sits in
a red card on the admin page until Sipho refunds it in PayFast and records it
(`refunded_at`). A second payment on an already-paid order is stored in
`extra_payments` and listed the same way. MidFood never moves money back on
its own.

## Tech

- **Backend:** Node + Express + Postgres (`pg`), JWT auth, bcrypt.
  Migrations in `backend/src/migrations/` run automatically on every boot and
  are all safe to re-run.
- **Roles:** customer tokens carry no role; restaurant tokens are
  `role: 'restaurant'`; driver tokens `role: 'driver'`. Each is rejected by the
  others' endpoints, and a suspended restaurant's or driver's token stops
  working at once (checked against the database on every request).
- **Money:** `backend/src/money.js`. Percentages are worked in whole cents.
  A restaurant's free period runs up to and including `free_until`, judged on
  South African time.
- **Front ends:** plain HTML/CSS/JS, one file each, no build step, no CDN. The
  one library is Leaflet (the map), served from `backend/public/vendor/`; map
  images come from OpenStreetMap's public tile server, the only outside host
  the Content-Security-Policy allows.
- **Phone app:** Expo SDK 57, React Navigation, `expo-notifications`.
  Icons generated by `mobile/make-icons.py` — edit that, not the PNGs.
- **Brand:** terracotta `#d97757`, cream `#faf9f5`, ink `#191915`. The mark is
  a steaming bowl. Flyer uses Fraunces for display, Public Sans for text.
- **Deploy:** push to `main` → Render redeploys itself, ~2 minutes. Only
  changes under `backend/` trigger a deploy.

## Tests

In the repo: `cd backend && npm test`. Needs a local Postgres database whose
name contains "test" (see `backend/test/helpers.js`); it is wiped on each run.

- `test/money.test.js` — rounding, free period, which rate applies (9 checks).
- `test/api.test.js` — the whole platform against a real database: logins and
  roles, ordering, payment notifications, kitchen to door, the money split,
  payouts and double-payout prevention, refunds, cancellations (77 checks).
- `test/api.test.js` also covers the admin menu loader and the pasted
  price-list reader.
- All 86 passing as of 8 Oct 2026. The screens were also driven in a real
  browser (64 checks) before release; that script is not in the repo.

## Deliberate decisions

- **Approval gate.** Restaurants and drivers sign themselves up but stay
  invisible and unable to log in until Sipho approves them.
- **Pay before the kitchen sees it.** An abandoned checkout costs nobody
  anything, and no kitchen cooks for an unpaid order.
- **Prices always come from the server**, never from the client.
- **The split is frozen at payment.** Changing a rate never rewrites an order
  that has already been paid.
- **Refunds are done by hand in PayFast** and only recorded here, so no money
  leaves Sipho's account without him doing it.
- **One restaurant per order.** Switching restaurants warns before clearing.
- **Web first, app second.** Restaurants and drivers were never going to wait
  for a store review, and neither should customers.
- **No pop-up dialogs in new admin screens.** Confirmations are built into the
  page (two presses), partly so Claude can drive the page in a browser.

## Commercial — settled 8 Oct 2026

- **3 months free, then 15% of the food total.** New signups get the free
  period automatically.
- **MidFood keeps 20% of each delivery fee**; the driver gets 80%.
- **Payouts every Tuesday** by EFT, for the week before, with a statement.
- PayFast's card fee (about 3.2% + R2 per payment, plus VAT) comes out of
  MidFood's side. During a restaurant's free months the 20% delivery slice is
  the only income on its orders and does not fully cover that fee.

## Where things stand (8 Oct 2026)

**Done and live**

- The go-live build is deployed (commits `d5b3198` and `6a67b2d`): refunds,
  orders in progress, live map and pin, statements, restaurant terms, net
  driver pay, and the fixes from an independent pre-release review.
- Flyer finished.
- **Chef Lue** (restaurant, 1953 South 32, Rockdale · 071 528 6926 · login
  `cheflue1`) is approved and visible to customers. Its menu was loaded on
  8 Oct from its WhatsApp Business catalogue ("Chef Lue Cake"): 3 platters
  (R600–R850) and 10 themed cakes (R600–R700), 13 dishes. Two pairs of cakes
  share a name in the catalogue, so the second of each is "(design 2)". The
  catalogue has no kotas, chips or meals, although the listing says it sells
  them, and cakes are normally made to order while the site promises about 55
  minutes. Both need a word with Chef Lue.
- **Support number 072 643 7784** is on every page.
- **Email:** midfood.co.za had no mailboxes. `hello@midfood.co.za` and
  `privacy@midfood.co.za` now **forward to g8vipexclusive@gmail.com** (cPanel
  → Forwarders; routing is Local, MX is Axxess's mx1.tld-mx.com). Not yet
  proven with a test email.
- The demo restaurants are gone, except **Sushi Yama**, which is attached to
  an old unpaid test order and so is suspended rather than deleted.

**Applied on the admin page on 8 Oct 2026**

- Rates: 15% commission, **20% of the delivery fee**, 3 free months, payouts
  on **Tuesday**.
- **Chef Lue:** delivery fee R100 → **R35**, free until **7 January 2027**
  (then 15%).
- **Lucky** (driver, 082 615 2028, login `lucky`) approved.
- Nothing was owed, in progress, or awaiting a refund at that point: no paid
  orders have gone through yet.

**PayFast — still in test mode, by decision (8 Oct 2026)**

- The only live PayFast account Sipho has is **G8 VIP Exclusive's**, and
  g8vip.co.za takes castle payments through it. It is **not** to be used for
  MidFood: customers would see "G8 VIP Exclusive" when paying for food, the
  two businesses' money would share one balance, and the account cannot be
  given a passphrase, because g8vip.co.za sends PayFast unsigned payment forms
  and a passphrase would break its Pay Now buttons.
- Sipho is **opening a separate PayFast account for MidFood** himself
  (https://payfast.io/gateway-aggregator-selector/ — online payments,
  industry Marketplace or Food & Drink). PayFast asks for ID, proof of address
  no older than three months, and a bank confirmation letter (company papers
  too if registering a company), and says verification usually takes about two
  business days once valid documents are in. It will probably need an email
  address the G8 VIP account is not already using.
- Nothing was changed on the G8 VIP PayFast account. Sipho did switch on
  two-factor login for it (authenticator app on his phone) during this session.
- Render's `PAYFAST_…` values were not touched. As of 2 Oct they were
  PayFast's sandbox ones; this was not re-checked.
- **Until the MidFood account is live, customers cannot pay.** Chef Lue is
  visible on the site, but checkout goes to PayFast's test page, which takes
  no real cards. Hold off sending customers to the site until then.

**When the MidFood PayFast account is approved**

1. In the new account: Settings → Developer Settings. Set a **Security
   Passphrase** (Sipho types it and keeps it).
2. Render → midfood-backend → Environment → Edit. Sipho pastes the new
   account's Merchant ID, Merchant Key and that passphrase into
   `PAYFAST_MERCHANT_ID`, `PAYFAST_MERCHANT_KEY`, `PAYFAST_PASSPHRASE`; set
   `PAYFAST_MODE` to `live`; save and deploy.
3. Place one small real order end to end (order, pay, accept, deliver), check
   it lands on the admin page with the right split, then cancel/refund a
   second one to prove the refund path.

## Still to do, roughly in order

1. **Open the MidFood PayFast account** and switch payments to live (steps
   above). Nothing earns until this is done.
1. **Print the flyer** and sign up more restaurants. This can go ahead now;
   restaurants do not need payments to be live to sign up and load menus.
2. **Submit the phone app** — needs `npx eas login` / `eas init` / `npm run
   build:apk` on a machine that can reach Expo, a Google Play account (about
   $25 once), an Apple Developer account (about $99 a year), and screenshots
   with real restaurants in them. See `mobile/README-BUILD.md`. Bring the app
   level with the website first (pin, live map), and run it on a real phone.
3. **Send a test email** to hello@midfood.co.za and check it reaches the
   Gmail inbox (look in spam too: forwarded mail sometimes lands there).
4. **Chef Lue's real everyday menu** (kotas, chips, meals) and lead time for
   cakes. Load it from Operations → Restaurants → Menu.
5. **Scheduled orders** and **promo codes**.
6. If orders grow, move the map from OpenStreetMap's free public tiles (fine
   for a small service, no guarantee) to a paid tile provider.

## Working notes

- Sipho does not want to run commands or click around himself — he types
  logins, Claude drives the browser. He has granted browser access to
  dashboard.render.com, ccp.axxess.co.za and midfood.co.za.
- Claude does not type passwords, keys or other secrets into pages. Sipho
  pastes the `ADMIN_KEY` into the admin page and the PayFast values into
  Render himself; Claude does everything around that.
- Claude's container cannot reach Expo's build service or the Android SDK, so
  app builds have to run elsewhere.
- Use only g8vipexclusive@gmail.com for his business accounts and email.
- His WhatsApp Business runs in his own Chrome (web.whatsapp.com); it does not
  open in the Claude browser pane. Claude reads there when asked and never
  sends a message without being told to.
- A prospect list of about 20 Middelburg restaurants, takeaways and bakeries
  was put together on 8 Oct (in that chat, with a map); Jefferson's fast food,
  King Kota's and Papa's Shisanyama in Mhluzi were the suggested first calls.
