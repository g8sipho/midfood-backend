// Build 3 (Oct 2026): promo codes, driver tips, orders for later, saved
// addresses, favourites, written reviews and deleting an account.
//
// Same database and server as api.test.js (see test/helpers.js); run with
// `npm test`.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

const { ADMIN, api } = h;

before(h.start);
after(h.stop);

async function makePromo(body) {
  const r = await api('POST', '/api/admin/promos', { ...ADMIN, body });
  if (r.status !== 201) throw new Error(`promo create failed: ${JSON.stringify(r.data)}`);
  return r.data.promo;
}

describe('promo codes', () => {
  it('the admin page can make, list, change and switch off codes', async () => {
    const made = await makePromo({ code: ' welcome 50 ', kind: 'fixed', value: 50, note: 'Flyer launch' });
    assert.equal(made.code, 'WELCOME50');
    assert.equal(made.description, 'R50 off');
    assert.equal(made.active, true);
    assert.equal(made.oncePerCustomer, true);

    const again = await api('POST', '/api/admin/promos', { ...ADMIN, body: { code: 'welcome50', kind: 'fixed', value: 10 } });
    assert.equal(again.status, 409);

    const bad = await api('POST', '/api/admin/promos', { ...ADMIN, body: { code: 'OOPS', kind: 'percent', value: 150 } });
    assert.equal(bad.status, 400);

    const list = await api('GET', '/api/admin/promos', ADMIN);
    assert.equal(list.status, 200);
    assert.ok(list.data.promos.some((p) => p.code === 'WELCOME50' && p.uses === 0));

    const off = await api('PATCH', `/api/admin/promos/${made.id}`, { ...ADMIN, body: { active: false } });
    assert.equal(off.status, 200);
    assert.equal(off.data.promo.active, false);

    // Never used, so it can go entirely.
    const gone = await api('DELETE', `/api/admin/promos/${made.id}`, ADMIN);
    assert.equal(gone.data.deleted, true);
    assert.equal((await api('GET', '/api/admin/promos', ADMIN)).data.promos.some((p) => p.code === 'WELCOME50'), false);

    // Customers never see the admin side.
    const cust = await h.customer();
    assert.equal((await api('GET', '/api/admin/promos', { token: cust.token })).status, 401);
  });

  it('a fixed code comes off the food, and the kitchen is still paid in full', async () => {
    await h.settings({ freeMonths: 0 }); // so the 15% commission applies to this new kitchen
    await makePromo({ code: 'TENOFF', kind: 'fixed', value: 10 });
    const cust = await h.customer();
    const resto = await h.restaurant({ deliveryFee: 30, menu: [['Kota', 45]] });

    const check = await api('POST', '/api/orders/promo-check', {
      token: cust.token, body: { code: 'tenoff', restaurantId: resto.id, subtotal: 45 },
    });
    assert.equal(check.status, 200);
    assert.equal(check.data.discount, 10);
    assert.equal(check.data.description, 'R10 off');

    const placed = await h.placeOrder(cust, resto, [[resto.items[0], 1]], { promoCode: 'tenoff', expectedTotal: 65 });
    assert.equal(placed.status, 201, JSON.stringify(placed.data));
    const order = placed.data.order;
    assert.equal(order.subtotal, 45);
    assert.equal(order.discount, 10);
    assert.equal(order.promoCode, 'TENOFF');
    assert.equal(order.total, 65); // 45 - 10 + 30

    await h.pay(order);
    const { rows } = await h.db().query(
      'SELECT restaurant_payout::float8 AS rp, driver_payout::float8 AS dp, commission::float8 AS c FROM orders WHERE id = $1',
      [order.id]
    );
    // 15% of the FULL R45 of food, not of R35; the driver gets the full fee.
    assert.equal(rows[0].c, 6.75);
    assert.equal(rows[0].rp, 38.25);
    assert.equal(rows[0].dp, 30);

    const list = await api('GET', '/api/admin/promos', ADMIN);
    const p = list.data.promos.find((x) => x.code === 'TENOFF');
    assert.equal(p.uses, 1);
    assert.equal(p.givenAway, 10);
    // Used once, so deleting it only switches it off.
    const del = await api('DELETE', `/api/admin/promos/${p.id}`, ADMIN);
    assert.equal(del.data.deactivated, true);
  });

  it('percent codes are capped, free delivery takes off the fee, and the page is told the right total', async () => {
    await makePromo({ code: 'HALF', kind: 'percent', value: 50, maxDiscount: 20, oncePerCustomer: false });
    await makePromo({ code: 'NOFEE', kind: 'free_delivery', oncePerCustomer: false });
    const cust = await h.customer();
    const resto = await h.restaurant({ deliveryFee: 35, menu: [['Platter', 120]] });

    const half = await h.placeOrder(cust, resto, [[resto.items[0], 1]], { promoCode: 'HALF' });
    assert.equal(half.status, 201);
    assert.equal(half.data.order.discount, 20); // 50% of 120 is 60, capped at 20
    assert.equal(half.data.order.total, 135);

    const free = await h.placeOrder(cust, resto, [[resto.items[0], 1]], { promoCode: 'NOFEE' });
    assert.equal(free.data.order.discount, 35);
    assert.equal(free.data.order.total, 120);

    // The page showed a total without the code; the server says what it really is.
    const stale = await h.placeOrder(cust, resto, [[resto.items[0], 1]], { promoCode: 'HALF', expectedTotal: 155 });
    assert.equal(stale.status, 409);
    assert.equal(stale.data.total, 135);
  });

  it('the rules: once per customer, first order only, a kitchen of its own, dates and limits', async () => {
    const resto = await h.restaurant({ deliveryFee: 30, menu: [['Kota', 45]] });
    const other = await h.restaurant({ name: 'Other Kitchen', deliveryFee: 30, menu: [['Chips', 25]] });
    const drv = await h.driver();
    await makePromo({ code: 'ONCE', kind: 'fixed', value: 5 });
    await makePromo({ code: 'FIRST', kind: 'fixed', value: 5, firstOrderOnly: true, oncePerCustomer: false });
    await makePromo({ code: 'ONLYHERE', kind: 'fixed', value: 5, restaurantId: resto.id });
    await makePromo({ code: 'LATER', kind: 'fixed', value: 5, startsAt: new Date(Date.now() + 86400000).toISOString() });
    await makePromo({ code: 'OLD', kind: 'fixed', value: 5, expiresAt: new Date(Date.now() - 1000).toISOString() });
    await makePromo({ code: 'BIGONLY', kind: 'fixed', value: 5, minSubtotal: 100 });
    await makePromo({ code: 'TWOUSES', kind: 'fixed', value: 5, maxUses: 1, oncePerCustomer: false });

    const cust = await h.customer();
    const check = (code, r = resto, subtotal = 45) =>
      api('POST', '/api/orders/promo-check', { token: cust.token, body: { code, restaurantId: r.id, subtotal } });

    assert.equal((await check('LATER')).data.error, 'That promo code is not active yet.');
    assert.equal((await check('OLD')).data.error, 'That promo code has expired.');
    assert.equal((await check('BIGONLY')).status, 400);
    assert.equal((await check('ONLYHERE')).status, 200);
    assert.equal((await check('ONLYHERE', other)).data.error, 'That promo code is for a different restaurant.');
    assert.equal((await check('NOPE')).data.error, 'That promo code is not valid.');
    assert.equal((await check('ONCE')).status, 200);
    assert.equal((await check('FIRST')).status, 200);

    // An unpaid order with the code does not burn it...
    await h.placeOrder(cust, resto, [[resto.items[0], 1]], { promoCode: 'ONCE' });
    assert.equal((await check('ONCE')).status, 200);
    // ...a paid one does.
    await h.deliver(cust, resto, drv, [[resto.items[0], 1]], { promoCode: 'ONCE' });
    assert.equal((await check('ONCE')).data.error, "You've already used that promo code.");
    assert.equal((await check('FIRST')).data.error, 'That promo code is for first orders only.');
    const refused = await h.placeOrder(cust, resto, [[resto.items[0], 1]], { promoCode: 'ONCE' });
    assert.equal(refused.status, 400);
    assert.equal(refused.data.promoRejected, true);

    // A limit across everyone.
    await h.deliver(cust, resto, drv, [[resto.items[0], 1]], { promoCode: 'TWOUSES' });
    const second = await h.customer();
    const r = await api('POST', '/api/orders/promo-check', { token: second.token, body: { code: 'TWOUSES', restaurantId: resto.id, subtotal: 45 } });
    assert.equal(r.data.error, 'That promo code has all been used up.');
  });
});

describe('tipping the driver', () => {
  it('the tip is added to the total and goes to the driver in full', async () => {
    const cust = await h.customer();
    const resto = await h.restaurant({ deliveryFee: 30, menu: [['Kota', 45]] });
    const drv = await h.driver();
    await h.settings({ deliveryCutRate: 0.2 });

    const placed = await h.placeOrder(cust, resto, [[resto.items[0], 1]], { tip: 10 });
    assert.equal(placed.status, 201);
    assert.equal(placed.data.order.tip, 10);
    assert.equal(placed.data.order.total, 85);

    const order = placed.data.order;
    await h.pay(order);
    await api('POST', `/api/portal/orders/${order.id}/accept`, { token: resto.token });
    await api('POST', `/api/portal/orders/${order.id}/ready`, { token: resto.token });

    // The driver sees the tip in what the job pays before taking it.
    const offers = await api('GET', '/api/driver/orders/available', { token: drv.token });
    const offer = offers.data.orders.find((o) => o.id === order.id);
    assert.equal(offer.tip, 10);
    assert.equal(offer.driverPayout, 34); // 30 - 20% + 10

    await api('POST', `/api/driver/orders/${order.id}/accept`, { token: drv.token });
    await api('POST', `/api/driver/orders/${order.id}/pickup`, { token: drv.token });
    await api('POST', `/api/driver/orders/${order.id}/deliver`, { token: drv.token });

    const earnings = await api('GET', '/api/driver/earnings', { token: drv.token });
    assert.equal(earnings.data.pending.gross, 40);
    assert.equal(earnings.data.pending.tips, 10);
    assert.equal(earnings.data.pending.deductions, 6);
    assert.equal(earnings.data.pending.amount, 34);

    const statement = await api('GET', '/api/driver/statement', { token: drv.token });
    assert.equal(statement.data.orders[0].tip, 10);
    assert.equal(statement.data.orders[0].amount, 34);

    const owing = await api('GET', '/api/payouts/owing', ADMIN);
    const d = owing.data.drivers.find((x) => x.id === drv.id);
    assert.equal(d.gross, 40);
    assert.equal(d.amount, 34);

    const paid = await api('POST', `/api/payouts/driver/${drv.id}`, { ...ADMIN, body: { reference: 'EFT' } });
    assert.equal(paid.status, 201);
    assert.equal(paid.data.payout.gross, 40);
    assert.equal(paid.data.payout.amount, 34);
    await h.settings({ deliveryCutRate: 0 });
  });

  it('a silly tip is refused', async () => {
    const cust = await h.customer();
    const resto = await h.restaurant();
    assert.equal((await h.placeOrder(cust, resto, [[resto.items[0], 1]], { tip: -5 })).status, 400);
    assert.equal((await h.placeOrder(cust, resto, [[resto.items[0], 1]], { tip: 5000 })).status, 400);
    assert.equal((await h.placeOrder(cust, resto, [[resto.items[0], 1]], { tip: 'ten' })).status, 400);
  });
});

describe('ordering for later', () => {
  it('a time within the window is kept and shown to the kitchen in order', async () => {
    const cust = await h.customer();
    const resto = await h.restaurant();
    const inTwoHours = new Date(Date.now() + 2 * 3600000);
    const placed = await h.placeOrder(cust, resto, [[resto.items[0], 1]], { scheduledFor: inTwoHours.toISOString() });
    assert.equal(placed.status, 201, JSON.stringify(placed.data));
    assert.equal(new Date(placed.data.order.scheduledFor).getTime(), inTwoHours.getTime());
    await h.pay(placed.data.order);

    // An order for now, placed afterwards, sorts first on the kitchen board.
    const now = await h.placeOrder(cust, resto, [[resto.items[0], 1]]);
    await h.pay(now.data.order);
    const board = await api('GET', '/api/portal/orders', { token: resto.token });
    assert.deepEqual(board.data.orders.map((o) => o.id), [now.data.order.id, placed.data.order.id]);
    assert.ok(board.data.orders[1].scheduledFor);

    const tracking = await api('GET', `/api/orders/${placed.data.order.id}/tracking`, { token: cust.token });
    assert.ok(tracking.data.tracking.scheduledFor);

    // Not flagged as stuck on the admin page: it isn't due yet.
    const admin = await api('GET', '/api/admin/orders', ADMIN);
    const live = admin.data.live.find((o) => o.id === placed.data.order.id);
    assert.equal(live.stuck, false);
  });

  it('too soon, too far ahead or not a time at all is refused', async () => {
    const cust = await h.customer();
    const resto = await h.restaurant();
    const soon = await h.placeOrder(cust, resto, [[resto.items[0], 1]], { scheduledFor: new Date(Date.now() + 10 * 60000).toISOString() });
    assert.equal(soon.status, 400);
    const far = await h.placeOrder(cust, resto, [[resto.items[0], 1]], { scheduledFor: new Date(Date.now() + 10 * 86400000).toISOString() });
    assert.equal(far.status, 400);
    const junk = await h.placeOrder(cust, resto, [[resto.items[0], 1]], { scheduledFor: 'teatime' });
    assert.equal(junk.status, 400);
    // Empty means "now".
    const asap = await h.placeOrder(cust, resto, [[resto.items[0], 1]], { scheduledFor: '' });
    assert.equal(asap.status, 201);
    assert.equal(asap.data.order.scheduledFor, null);
  });
});

describe('saved addresses', () => {
  it('a customer keeps a few addresses and the one they use moves to the top', async () => {
    const cust = await h.customer();
    const other = await h.customer();
    const resto = await h.restaurant();

    const home = await api('POST', '/api/customer/addresses', { token: cust.token, body: { label: 'Home', line: '41 Turquoise St, Mineralia', lat: -25.77, lng: 29.46 } });
    assert.equal(home.status, 201);
    const work = await api('POST', '/api/customer/addresses', { token: cust.token, body: { label: 'Work', line: '12 Walter Sisulu St' } });
    assert.equal(work.status, 201);
    assert.equal(work.data.address.lat, null);

    // Saving "home" again updates the one that is there.
    const homeAgain = await api('POST', '/api/customer/addresses', { token: cust.token, body: { label: 'home', line: '41 Turquoise Street, Mineralia' } });
    assert.equal(homeAgain.status, 200);
    assert.equal(homeAgain.data.address.id, home.data.address.id);
    assert.equal(homeAgain.data.address.label, 'home'); // written the way they typed it last

    let list = await api('GET', '/api/customer/addresses', { token: cust.token });
    assert.equal(list.data.addresses.length, 2);
    assert.equal(list.data.addresses[0].label, 'home');

    // Using Work for an order brings it to the top.
    const placed = await h.placeOrder(cust, resto, [[resto.items[0], 1]], { addressId: work.data.address.id, deliveryAddress: '12 Walter Sisulu St' });
    assert.equal(placed.status, 201);
    list = await api('GET', '/api/customer/addresses', { token: cust.token });
    assert.equal(list.data.addresses[0].label, 'Work');

    // Nobody else can see or change them.
    assert.equal((await api('GET', '/api/customer/addresses', { token: other.token })).data.addresses.length, 0);
    assert.equal((await api('DELETE', `/api/customer/addresses/${home.data.address.id}`, { token: other.token })).status, 404);

    const edit = await api('PUT', `/api/customer/addresses/${home.data.address.id}`, { token: cust.token, body: { label: 'Home', line: '41 Turquoise St, Mineralia, Middelburg' } });
    assert.equal(edit.status, 200);
    assert.equal((await api('DELETE', `/api/customer/addresses/${home.data.address.id}`, { token: cust.token })).status, 200);
    assert.equal((await api('GET', '/api/customer/addresses', { token: cust.token })).data.addresses.length, 1);

    assert.equal((await api('POST', '/api/customer/addresses', { token: cust.token, body: { label: '', line: 'x' } })).status, 400);
    assert.equal((await api('GET', '/api/customer/addresses')).status, 401);
  });
});

describe('favourite restaurants', () => {
  it('hearting is idempotent, private, and only for live restaurants', async () => {
    const cust = await h.customer();
    const other = await h.customer();
    const resto = await h.restaurant();

    assert.equal((await api('PUT', `/api/customer/favourites/${resto.id}`, { token: cust.token })).status, 200);
    assert.equal((await api('PUT', `/api/customer/favourites/${resto.id}`, { token: cust.token })).status, 200);
    assert.deepEqual((await api('GET', '/api/customer/favourites', { token: cust.token })).data.restaurantIds, [resto.id]);
    assert.deepEqual((await api('GET', '/api/customer/favourites', { token: other.token })).data.restaurantIds, []);
    assert.equal((await api('PUT', '/api/customer/favourites/00000000-0000-0000-0000-000000000000', { token: cust.token })).status, 404);

    // A suspended restaurant drops out of the list without being forgotten.
    await api('POST', `/api/admin/restaurants/${resto.id}/suspend`, ADMIN);
    assert.deepEqual((await api('GET', '/api/customer/favourites', { token: cust.token })).data.restaurantIds, []);
    await api('POST', `/api/admin/restaurants/${resto.id}/approve`, ADMIN);
    assert.deepEqual((await api('GET', '/api/customer/favourites', { token: cust.token })).data.restaurantIds, [resto.id]);

    assert.equal((await api('DELETE', `/api/customer/favourites/${resto.id}`, { token: cust.token })).status, 200);
    assert.deepEqual((await api('GET', '/api/customer/favourites', { token: cust.token })).data.restaurantIds, []);
  });
});

describe('written reviews', () => {
  it('words go with the stars and show on the restaurant page with a first name', async () => {
    const cust = await h.customer('Thandi Nkosi');
    const resto = await h.restaurant({ menu: [['Kota', 45]] });
    const drv = await h.driver();
    const order = await h.deliver(cust, resto, drv, [[resto.items[0], 2]]);

    const rated = await api('POST', `/api/orders/${order.id}/rating`, { token: cust.token, body: { rating: 5, review: '  Best   kota in town!  ' } });
    assert.equal(rated.status, 200);
    assert.equal(rated.data.review, 'Best kota in town!');

    const reviews = await api('GET', `/api/restaurants/${resto.id}/reviews`);
    assert.equal(reviews.status, 200);
    assert.equal(reviews.data.count, 1);
    assert.equal(reviews.data.withWords, 1);
    assert.equal(reviews.data.average, null); // fewer than three ratings: still "New"
    assert.equal(reviews.data.reviews[0].customerName, 'Thandi');
    assert.equal(reviews.data.reviews[0].review, 'Best kota in town!');
    assert.deepEqual(reviews.data.reviews[0].dishes, ['Kota']);

    // Stars without words are allowed, and the words can be removed again.
    const starsOnly = await api('POST', `/api/orders/${order.id}/rating`, { token: cust.token, body: { rating: 4 } });
    assert.equal(starsOnly.data.review, null);
    assert.equal((await api('POST', `/api/orders/${order.id}/rating`, { token: cust.token, body: { rating: 4, review: 42 } })).status, 400);

    const mine = await api('GET', `/api/orders/${order.id}`, { token: cust.token });
    assert.equal(mine.data.order.rating, 4);
  });
});

describe('deleting an account', () => {
  it('wipes the person but keeps the books, and the old login stops working', async () => {
    await h.settings({ freeMonths: 0 });
    const cust = await h.customer('Sello Mokoena');
    const resto = await h.restaurant({ menu: [['Kota', 45]] });
    const drv = await h.driver();
    const order = await h.deliver(cust, resto, drv, [[resto.items[0], 1]]);
    await api('POST', `/api/orders/${order.id}/rating`, { token: cust.token, body: { rating: 5, review: 'Lekker' } });
    await api('POST', '/api/customer/addresses', { token: cust.token, body: { label: 'Home', line: '41 Turquoise St' } });
    await api('PUT', `/api/customer/favourites/${resto.id}`, { token: cust.token });
    await api('POST', '/api/chat/conversations', { token: cust.token, body: { restaurantId: resto.id } });

    // The confirmation and the password are both checked.
    assert.equal((await api('DELETE', '/api/auth/account', { token: cust.token, body: { password: 'secret123' } })).status, 400);
    assert.equal((await api('DELETE', '/api/auth/account', { token: cust.token, body: { password: 'wrong', confirm: 'DELETE' } })).status, 400);

    const gone = await api('DELETE', '/api/auth/account', { token: cust.token, body: { password: 'secret123', confirm: 'delete' } });
    assert.equal(gone.status, 200, JSON.stringify(gone.data));

    // The token is dead at once, and the email and password no longer log in.
    assert.equal((await api('GET', '/api/auth/me', { token: cust.token })).status, 401);
    assert.equal((await api('GET', '/api/orders', { token: cust.token })).status, 401);
    assert.equal((await api('POST', '/api/auth/login', { body: { identifier: cust.email, password: 'secret123' } })).status, 401);

    // The order is still there for the kitchen's statement, minus the person.
    const { rows } = await h.db().query(
      `SELECT u.name, u.email, u.phone, u.password_hash AS hash, u.deleted_at AS deleted,
              o.customer_phone AS phone2, o.delivery_address AS address, o.restaurant_payout::float8 AS rp, o.rating
       FROM users u JOIN orders o ON o.user_id = u.id WHERE u.id = $1`,
      [cust.id]
    );
    assert.equal(rows[0].name, 'Deleted account');
    assert.notEqual(rows[0].email, cust.email);
    assert.equal(rows[0].phone, null);
    assert.equal(rows[0].hash, null);
    assert.ok(rows[0].deleted);
    assert.equal(rows[0].phone2, null);
    assert.equal(rows[0].address, 'Deleted account');
    assert.equal(rows[0].rp, 38.25);
    assert.equal(rows[0].rating, 5);
    const leftovers = await h.db().query(
      `SELECT (SELECT COUNT(*)::int FROM addresses WHERE user_id = $1) AS a,
              (SELECT COUNT(*)::int FROM favourites WHERE user_id = $1) AS f,
              (SELECT COUNT(*)::int FROM conversations WHERE user_id = $1) AS c`,
      [cust.id]
    );
    assert.deepEqual(leftovers.rows[0], { a: 0, f: 0, c: 0 });

    // The review stays but no longer carries a name.
    const reviews = await api('GET', `/api/restaurants/${resto.id}/reviews`);
    assert.equal(reviews.data.reviews[0].customerName, 'MidFood customer');

    // The kitchen's statement still adds up, with no name to show.
    const statement = await api('GET', `/api/payouts/statement/restaurant/${resto.id}`, ADMIN);
    assert.equal(statement.data.totals.amount, 38.25);
    assert.equal(statement.data.orders[0].customerName, 'Deleted account');

    // The same email can sign up again, fresh.
    const again = await api('POST', '/api/auth/register', { body: { name: 'Sello Again', email: cust.email, password: 'secret123' } });
    assert.equal(again.status, 201);
    assert.notEqual(again.data.user.id, cust.id);
  });

  it('is refused while an order is on its way', async () => {
    const cust = await h.customer();
    const resto = await h.restaurant();
    const placed = await h.placeOrder(cust, resto, [[resto.items[0], 1]]);
    await h.pay(placed.data.order);
    const r = await api('DELETE', '/api/auth/account', { token: cust.token, body: { password: 'secret123', confirm: 'DELETE' } });
    assert.equal(r.status, 409);
    // An unpaid, abandoned order is no reason to keep someone.
    await api('POST', `/api/admin/orders/${placed.data.order.id}/cancel`, { ...ADMIN, body: { reason: 'test' } });
    const ok = await api('DELETE', '/api/auth/account', { token: cust.token, body: { password: 'secret123', confirm: 'DELETE' } });
    assert.equal(ok.status, 200);
  });

  it('an account made with Google has no password to type, so DELETE alone confirms', async () => {
    const cust = await h.customer();
    await h.db().query("UPDATE users SET password_hash = NULL, google_id = 'g-123' WHERE id = $1", [cust.id]);
    const r = await api('DELETE', '/api/auth/account', { token: cust.token, body: { confirm: 'DELETE' } });
    assert.equal(r.status, 200);
  });
});
