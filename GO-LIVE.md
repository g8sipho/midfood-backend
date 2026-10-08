# MidFood — running it day to day

MidFood is built, live on midfood.co.za, and tested. This page is the routine:
what to do each day, each Tuesday, and when something goes wrong. Everything
here happens on the admin page: **midfood.co.za/portal/admin.html**.

Your admin key is in Render → midfood-backend → **Environment** → `ADMIN_KEY`.
Keep it private. It is the only thing protecting the admin page.

---

## Every day

Open the admin page and look at the top of **Operations**.

| If you see | It means | Do this |
|---|---|---|
| **Refunds you owe** (red card) | A customer paid and the order was then declined or cancelled, or they paid twice | Refund it in PayFast, then record it here. See below. |
| **Orders in progress**, with a red "Not accepted … minutes after payment" | A kitchen has been sitting on a paid order for 10 minutes | Phone the restaurant. If they cannot do it, press **Cancel order**. |
| **Waiting for your approval** | A restaurant or driver has signed themselves up | Phone them, then **Approve**. Nothing is visible to customers until you do. |

The page refreshes itself every 15 seconds. Leave it open on a screen.

## Refunding a customer

MidFood never refunds a card on its own. You do it, so nothing leaves your
account without you seeing it.

1. On the admin page, under **Refunds you owe**, note the **PayFast payment ID**.
2. In your PayFast dashboard: **Transactions** → find that payment → **Refund**.
3. Back on the admin page, type the refund reference if you have one and press
   **I have refunded R…**, then **Yes, record it**.

The customer's order page then tells them the refund is on its way. Recording
it cannot be undone, which is why it asks twice.

## Every Tuesday: paying restaurants and drivers

Payouts cover the week before (Monday to Sunday). On the admin page, open
**Payouts**.

1. Each restaurant and driver you owe is listed with the amount. Press
   **See every order** to check it.
2. Add their bank details the first time (**Add bank details**).
3. Pay them by EFT from your bank.
4. Press **Mark R… as paid** and enter your EFT reference.

Those orders are then settled and can never be paid a second time. The
restaurant and the driver each see the payment, and can open the statement
behind it (every order, what was deducted, what they got) in their own app.

**The numbers:**

- A restaurant pays **nothing for its first 3 months**, then **15% of the
  food total**. Never anything on the delivery fee.
- The customer pays the delivery fee on top. **MidFood keeps 20% of it**; the
  driver gets the rest. Drivers are shown what they will earn before they
  accept a delivery.
- PayFast takes its own card fee (about 3.2% + R2 per payment) out of what
  lands in your account. That is your cost, not the restaurant's.

Change any of these under **Payouts → Your rates**. A change only affects
orders placed afterwards; nothing already paid is ever recalculated.

## A restaurant's own terms

Under **Operations → Restaurants**, press **Edit terms** on a restaurant to
change its delivery fee, delivery time, free period or a special commission
rate. "Free until" includes that date.

## Adding restaurants and drivers

- Send restaurants to **midfood.co.za/portal** and drivers to
  **midfood.co.za/driver** to apply. They appear under *Waiting for your
  approval*.
- Or add them yourself on the admin page.
- **Suspend** takes one offline at once. Their login stops working the moment
  you press it.

## PayFast

Payments run on the four `PAYFAST_…` values in Render → Environment:

| Value | What it is |
|---|---|
| `PAYFAST_MODE` | `live` for real money, `sandbox` for test cards |
| `PAYFAST_MERCHANT_ID`, `PAYFAST_MERCHANT_KEY` | From your PayFast dashboard → Settings |
| `PAYFAST_PASSPHRASE` | The security passphrase you set in PayFast. It must match **exactly**, or every payment fails. |

Nothing needs setting inside PayFast for notifications: MidFood tells PayFast
where to report each payment.

## If something looks wrong

- **Site down?** Check https://midfood.co.za/health, then Render →
  midfood-backend → Logs.
- **A customer paid but the order says "waiting for payment".** PayFast's
  confirmation has not arrived. It is retried automatically; give it a few
  minutes. If the customer pays again in the meantime, the second payment shows
  up under **Refunds you owe** as "Paid twice".
- **A change to the code.** Push to `main` on GitHub and Render redeploys in
  about two minutes. Run `npm test` in `backend/` first.

## Still to come

- **The phone app** in the app stores. See `mobile/README-BUILD.md`. The
  website at midfood.co.za/order does the same job today and installs to a
  home screen.
- **Scheduled orders** and **promo codes**.
