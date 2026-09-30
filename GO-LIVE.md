# MidFood — going live

Everything is built and tested. This is what's left to switch it on.

---

## 1. Put the new code on GitHub

Your live backend redeploys automatically whenever `g8sipho/midfood-backend`
changes, so this is the step that makes everything else happen.

Connect GitHub to Claude (**Settings → Connectors → GitHub**) and I'll push it
for you. Or do it yourself with the bundle I sent:

```bash
cd path/to/your/midfood-backend
git pull /path/to/midfood-update.bundle HEAD
git push origin main
```

Render picks it up within a few minutes and runs the new database migration by
itself. Check https://midfood-backend.onrender.com/health afterwards.

## 2. Point midfood.co.za at it

In Render → **midfood-backend** → **Settings → Custom Domains**, add
`midfood.co.za` and `www.midfood.co.za`. Render shows you the DNS records to
create at whoever hosts your domain. Once they resolve, Render issues the HTTPS
certificate on its own.

Then these all live on your own domain:

| Address | Who uses it |
|---|---|
| `midfood.co.za` | Customers — the public site |
| `midfood.co.za/portal/` | Restaurants — order board and menu |
| `midfood.co.za/driver/` | Drivers — deliveries and earnings |
| `midfood.co.za/portal/admin.html` | You — approvals and live stats |

Your admin key is in Render → **Environment** → `ADMIN_KEY`. Keep it private:
it's the only thing protecting the admin page.

## 3. Switch PayFast to live

Right now payments run in PayFast's sandbox — the flow works end to end but no
real money moves.

When your PayFast merchant account is approved, in Render → **Environment**
replace `PAYFAST_MERCHANT_ID`, `PAYFAST_MERCHANT_KEY` and `PAYFAST_PASSPHRASE`
with your real values and set `PAYFAST_MODE` to `live`. Nothing else changes.

In your PayFast dashboard, set the ITN (notify) URL to:
`https://midfood.co.za/api/payments/payfast/notify`

## 4. Build the customer app

The app is configured for the stores (`za.co.midfood.app`, MidFood branding,
notification permissions). To build it:

```bash
cd mobile
npm install
npx eas login          # free Expo account
npx eas build:configure # once, links the project and enables push
npm run build:apk      # test APK you can install on your own phone
npm run build:android  # Play Store bundle
npm run build:ios      # App Store build (needs an Apple Developer account)
```

Before the Play Store will accept it you need a privacy policy URL, a store
listing with screenshots, and a Google Play developer account (about $25 once).
Apple's is about $99 a year.

**You don't have to wait for the stores.** The restaurant portal and driver app
are web pages — they work the moment step 1 and 2 are done. Restaurants and
drivers add them to their home screen and they behave like apps.

## 5. First restaurants and drivers

1. Open the admin page and delete the four demo restaurants (Braai House,
   Mama Thandi's, Sushi Yama, Pizza Nonna).
2. Send restaurants to `midfood.co.za/portal/` to apply, or add them yourself
   on the admin page. Approve them, then give them their login.
3. Send drivers to `midfood.co.za/driver/` to apply. Approve them the same way.
4. Nothing you haven't approved is visible to customers.

---

## How the money and the orders flow

1. Customer orders and pays by card. Until PayFast confirms payment, the
   restaurant never sees the order — so an abandoned checkout costs nobody
   anything.
2. The kitchen's board chimes. They accept, start preparing, then mark it ready.
3. Ready orders appear to every online driver with the delivery fee shown. The
   first to accept gets it; the rest see it disappear.
4. The driver collects, taps picked up, and the customer starts seeing their
   location. The customer gets a push notification at each step.
5. The driver taps delivered. It lands in the restaurant's day total and the
   driver's earnings.

Money currently lands in the PayFast account you configure, in full. Paying
restaurants and drivers out is manual for now — the admin page gives you the
figures you need. Automatic splits are the natural next build.

## What I'd build next

- **Payouts** — weekly statements per restaurant and driver, so you're not
  working it out by hand.
- **Your commission** — take a percentage per order automatically instead of
  reconciling afterwards.
- **A live map** — the customer sees a moving pin rather than a map link.
- **Scheduled orders** and **promo codes** — both are straightforward now that
  the order flow is real.
