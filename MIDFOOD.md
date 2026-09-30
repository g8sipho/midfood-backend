# MidFood — project brief

*Hand this file to any new chat and Claude will be up to speed in one read.*

**Owner:** Sipho Masombuka · Middelburg, Mpumalanga, South Africa
**What it is:** A food delivery platform for Middelburg — customers order from
local restaurants, pay by card, and a MidFood driver delivers.

## Where everything lives

| What | Where |
|---|---|
| Source code (the truth) | `github.com/g8sipho/midfood-backend` |
| Live server | Render — service `midfood-backend`, managed Postgres `midfood-db` |
| Live URL | https://midfood-backend.onrender.com |
| Intended domain | midfood.co.za *(not pointed yet)* |
| Local copies | `Documents › G8 STUFF › MidFood` — `midfood-complete.zip`, `midfood-update.bundle`, `GO-LIVE.md`, this file |
| Payments | PayFast — **still in sandbox**, no real money moves yet |

## The four front doors

All served by the one backend, so there is nothing extra to host.

| Address | Who | What they do |
|---|---|---|
| `/` | Everyone | Public landing page |
| `/order/` | **Customers** | Browse, order, pay, track. Works in any browser. |
| `/portal/` | Restaurants | Live order board, menu, open/closed, day's takings |
| `/driver/` | Drivers | Go online, accept deliveries, navigate, mark delivered, earnings |
| `/portal/admin.html` | Sipho | Approve restaurants and drivers, live stats. Needs `ADMIN_KEY` (Render → Environment). |

There is also a React Native / Expo customer app in `mobile/`, configured for
the stores as `za.co.midfood.app`. **Not submitted yet.** The `/order/` web page
does the same job today, minus push notifications.

## How an order actually flows

1. Customer orders at `/order/` and is sent to PayFast to pay.
2. Order is created immediately as `payment_status = 'pending'` — the kitchen
   cannot see it. PayFast's server-to-server ITN flips it to `'paid'`.
3. Paid order appears on the restaurant's board with a chime. They **accept**
   (or decline with a reason), **start preparing**, then mark **food ready**.
4. Ready orders are offered to every online driver with the fee shown. First to
   accept wins; it vanishes for the rest.
5. Driver taps **picked up** → status `out_for_delivery`, and their live GPS
   starts reaching the customer. Then **delivered**.
6. Each step sends the customer a push notification (phone app only).

Statuses: `placed → confirmed → preparing → out_for_delivery → delivered`,
plus `rejected`. Payment is tracked separately: `pending / paid / failed`.

## Tech

- **Backend:** Node + Express + Postgres (`pg`), JWT auth, bcrypt.
  Migrations in `backend/src/migrations/` run automatically on boot and are
  all safe to re-run.
- **Roles:** customer tokens carry no role; restaurant tokens are
  `role: 'restaurant'`; driver tokens `role: 'driver'`. Each is rejected by the
  others' endpoints.
- **Front ends:** plain HTML/CSS/JS, one file each, no build step, no CDN.
- **Phone app:** Expo SDK 57, React Navigation, `expo-notifications`.
- **Deploy:** push to `main` → Render redeploys itself.

## Deliberate decisions

- **Approval gate.** Restaurants and drivers sign themselves up but stay
  invisible and unable to log in until Sipho approves them.
- **Pay before the kitchen sees it.** An abandoned checkout costs nobody
  anything, and no kitchen cooks for an unpaid order.
- **Prices always come from the server**, never from the client, so a tampered
  request can't change what's charged.
- **One restaurant per order.** Switching restaurants warns before clearing.
- **Web first, app second.** Restaurants and drivers were never going to wait
  for a store review, and neither should customers.

## Still to do

1. **Point midfood.co.za at Render** (Settings → Custom Domains).
2. **PayFast live credentials** — swap 3 env vars, set `PAYFAST_MODE=live`,
   set ITN URL to `/api/payments/payfast/notify`.
3. **Delete the 4 demo restaurants** (Braai House, Mama Thandi's, Sushi Yama,
   Pizza Nonna) before sending real customers.
4. **Submit the phone app** — needs a Google Play account and a privacy policy.
5. **Payouts and commission.** Money currently lands in Sipho's PayFast account
   in full; paying restaurants and drivers is manual. Taking a commission per
   order automatically is the obvious next build.

## Tests

- `backend` API suite: 40 checks over the whole flow.
- Browser suites drive the real portal, driver and ordering pages end to end.
- Both were passing when this was written.
