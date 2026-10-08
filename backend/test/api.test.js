// End-to-end tests of the MidFood API against a real Postgres.
//
// Each block follows one thing that has to be true for MidFood to be trusted
// with real money: an order only reaches a kitchen once it is paid for, the
// money splits correctly, nobody is paid twice, and a refund cannot be lost.
//
// Run with `npm test` (see test/helpers.js for the database it needs).
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

const { ADMIN, api } = h;

before(h.start);
after(h.stop);

// Dates in Middelburg, as the server works them out.
const saDate = (offsetDays = 0) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' }).format(Date.now() + offsetDays * 86400000);

describe('who can get in', () => {
  it('the server is up', async () => {
    const r = await api('GET', '/health');
    assert.equal(r.status, 200);
    assert.equal(r.data.ok, true);
  });

  it('admin routes are closed without the admin key', async () => {
    for (const path of ['/api/admin/restaurants', '/api/admin/drivers', '/api/admin/orders', '/api/payouts/owing', '/api/payouts/settings']) {
      assert.equal((await api('GET', path)).status, 401, path);
      assert.equal((await api('GET', path, { admin: 'wrong-key' })).status, 401, path);
    }
    assert.equal((await api('GET', '/api/admin/restaurants', ADMIN)).status, 200);
  });

  it('each kind of login only opens its own doors', async () => {
    const cust = await h.customer();
    const resto = await h.restaurant();
    const drv = await h.driver();

    assert.equal((await api('GET', '/api/portal/orders', { token: cust.token })).status, 403);
    assert.equal((await api('GET', '/api/driver/orders/mine', { token: cust.token })).status, 403);
    assert.equal((await api('GET', '/api/orders', { token: resto.token })).status, 403);
    assert.equal((await api('GET', '/api/driver/orders/mine', { token: resto.token })).status, 403);
    assert.equal((await api('GET', '/api/orders', { token: drv.token })).status, 403);
    assert.equal((await api('GET', '/api/portal/orders', { token: drv.token })).status, 403);
    // And none of them is an admin.
    assert.equal((await api('GET', '/api/admin/orders', { token: cust.token })).status, 401);
  });

  it('a restaurant that signs itself up is hidden and locked out until approved', async () => {
    const username = h.unique('selfsign');
    const signup = await api('POST', '/api/restaurant-auth/register', {
      body: { name: 'Self Signup Grill', cuisine: 'Grills', phone: '0715550000', address: '1 Test Rd', username, password: 'secret123' },
    });
    assert.equal(signup.status, 201);

    const list = await api('GET', '/api/restaurants');
    assert.ok(!list.data.restaurants.some((r) => r.name === 'Self Signup Grill'), 'must not be visible to customers');
    assert.equal((await api('POST', '/api/restaurant-auth/login', { body: { username, password: 'secret123' } })).status, 403);

    const all = await api('GET', '/api/admin/restaurants', ADMIN);
    const mine = all.data.restaurants.find((r) => r.username === username);
    assert.equal(mine.approved, false);
    // It gets the launch offer automatically: three calendar months, counting
    // today as day one, so it ends the day before the same date three months on.
    const [y, m, d] = saDate(0).split('-').map(Number);
    const end = new Date(Date.UTC(y, m - 1 + 3, d));
    if (end.getUTCDate() !== d) end.setUTCDate(0); // e.g. 30 Nov + 3 months -> end of Feb
    end.setUTCDate(end.getUTCDate() - 1);
    assert.equal(mine.freeUntil, end.toISOString().slice(0, 10));

    await api('POST', `/api/admin/restaurants/${mine.id}/approve`, ADMIN);
    assert.equal((await api('POST', '/api/restaurant-auth/login', { body: { username, password: 'secret123' } })).status, 200);
    const after = await api('GET', '/api/restaurants');
    assert.ok(after.data.restaurants.some((r) => r.name === 'Self Signup Grill'));
  });

  it('a driver who signs themselves up cannot log in until approved', async () => {
    const username = h.unique('selfdrv');
    const signup = await api('POST', '/api/driver-auth/register', {
      body: { name: 'New Driver', phone: '0825550000', username, password: 'secret123' },
    });
    assert.equal(signup.status, 201);
    assert.equal((await api('POST', '/api/driver-auth/login', { body: { username, password: 'secret123' } })).status, 403);

    const all = await api('GET', '/api/admin/drivers', ADMIN);
    const mine = all.data.drivers.find((d) => d.username === username);
    await api('POST', `/api/admin/drivers/${mine.id}/approve`, ADMIN);
    assert.equal((await api('POST', '/api/driver-auth/login', { body: { username, password: 'secret123' } })).status, 200);
  });

  it('suspending a driver or restaurant cuts off a login they already have', async () => {
    const drv = await h.driver('Soon Suspended');
    const resto = await h.restaurant({ name: 'Soon Suspended Kitchen' });
    assert.equal((await api('GET', '/api/driver/orders/available', { token: drv.token })).status, 200);
    assert.equal((await api('GET', '/api/portal/orders', { token: resto.token })).status, 200);

    await api('POST', `/api/admin/drivers/${drv.id}/suspend`, ADMIN);
    await api('POST', `/api/admin/restaurants/${resto.id}/suspend`, ADMIN);
    for (const path of ['/api/driver/orders/available', '/api/driver/orders/mine', '/api/driver/earnings']) {
      assert.equal((await api('GET', path, { token: drv.token })).status, 403, path);
    }
    assert.equal((await api('POST', '/api/driver/location', { token: drv.token, body: { lat: -25.7, lng: 29.4 } })).status, 403);
    assert.equal((await api('GET', '/api/portal/orders', { token: resto.token })).status, 403);
    assert.equal((await api('GET', '/api/portal/earnings', { token: resto.token })).status, 403);

    // Approving again restores access with the same login.
    await api('POST', `/api/admin/drivers/${drv.id}/approve`, ADMIN);
    assert.equal((await api('GET', '/api/driver/orders/available', { token: drv.token })).status, 200);
  });

  it('a phone number has to be a phone number', async () => {
    // These are shown to other people as tap-to-call links.
    const evil = '082" onmouseover="alert(1)';
    const d = await api('POST', '/api/driver-auth/register', { body: { name: 'X', phone: evil, username: h.unique('x'), password: 'secret123' } });
    assert.equal(d.status, 400);
    const r = await api('POST', '/api/restaurant-auth/register', {
      body: { name: 'X', cuisine: 'X', phone: evil, address: '1 Rd', username: h.unique('x'), password: 'secret123' },
    });
    assert.equal(r.status, 400);
    const a = await api('POST', '/api/admin/drivers', { ...ADMIN, body: { name: 'X', phone: evil, username: h.unique('x'), password: 'secret123' } });
    assert.equal(a.status, 400);
    for (const fine of ['082 615 2028', '0826152028', '+27 82 615 2028', '(013) 243-1234']) {
      const ok = await api('POST', '/api/driver-auth/register', { body: { name: 'Fine', phone: fine, username: h.unique('ok'), password: 'secret123' } });
      assert.equal(ok.status, 201, fine);
    }
  });

  it('ten wrong passwords lock that one account, and nobody else', async () => {
    const victim = await h.customer();
    const bystander = await h.customer();
    for (let i = 0; i < 10; i += 1) {
      const r = await api('POST', '/api/auth/login', { body: { email: victim.email, password: 'wrong-guess' } });
      assert.equal(r.status, 401);
    }
    // Even the right password is refused now: the account is being attacked.
    assert.equal((await api('POST', '/api/auth/login', { body: { email: victim.email, password: 'secret123' } })).status, 429);
    assert.equal((await api('POST', '/api/auth/login', { body: { email: bystander.email, password: 'secret123' } })).status, 200);
  });
});

describe('placing an order', () => {
  let cust, resto;
  before(async () => {
    cust = await h.customer();
    resto = await h.restaurant({ deliveryFee: 30, menu: [['Kota', 45], ['Chips', 25]] });
  });

  it('prices come from the menu, never from the request', async () => {
    const r = await api('POST', '/api/orders', {
      token: cust.token,
      body: {
        restaurantId: resto.id,
        // A tampered request claiming the kota costs R1 and delivery is free.
        items: [{ menuItemId: resto.items[0].id, quantity: 2, price: 1 }],
        deliveryAddress: '41 Turquoise St',
        deliveryFee: 0,
        total: 1,
      },
    });
    assert.equal(r.status, 201);
    assert.equal(r.data.order.subtotal, 90);
    assert.equal(r.data.order.deliveryFee, 30);
    assert.equal(r.data.order.total, 120);
    assert.equal(r.data.order.paymentStatus, 'pending');
    assert.match(r.data.paymentUrl, /^https:\/\/sandbox\.payfast\.co\.za\/eng\/process\?/);
    assert.match(r.data.paymentUrl, /amount=120\.00/);
  });

  it('refuses an order with no address, no items, or an item from another menu', async () => {
    const other = await h.restaurant({ name: 'Other Kitchen' });
    assert.equal((await h.placeOrder(cust, resto, [[resto.items[0], 1]], { deliveryAddress: '  ' })).status, 400);
    assert.equal((await h.placeOrder(cust, resto, [])).status, 400);
    assert.equal((await h.placeOrder(cust, resto, [[other.items[0], 1]])).status, 400);
    assert.equal((await api('POST', '/api/orders', { body: {} })).status, 401);
  });

  it('refuses an order from a closed restaurant', async () => {
    await api('PATCH', '/api/portal/open', { token: resto.token, body: { open: false } });
    const r = await h.placeOrder(cust, resto, [[resto.items[0], 1]]);
    assert.equal(r.status, 409);
    assert.match(r.data.error, /closed/);
    await api('PATCH', '/api/portal/open', { token: resto.token, body: { open: true } });
  });

  it('refuses an item the kitchen has just marked sold out', async () => {
    const chips = resto.items[1];
    await api('PATCH', `/api/portal/menu/${chips.id}/availability`, { token: resto.token, body: { available: false } });
    const r = await h.placeOrder(cust, resto, [[resto.items[0], 1], [chips, 1]]);
    assert.equal(r.status, 409);
    assert.match(r.data.error, /Chips has just sold out/);
    assert.equal(r.data.soldOutItemId, chips.id, 'so the page can take it out of the basket');
    await api('PATCH', `/api/portal/menu/${chips.id}/availability`, { token: resto.token, body: { available: true } });
    assert.equal((await h.placeOrder(cust, resto, [[chips, 1]])).status, 201);
  });

  it('never charges a total the customer was not shown', async () => {
    // The page showed R75 (R45 + R30). Meanwhile the kitchen put the kota up.
    const kota = resto.items[0];
    await api('PUT', `/api/portal/menu/${kota.id}`, { token: resto.token, body: { name: 'Kota', description: 'Tasty', price: 50 } });
    const stale = await h.placeOrder(cust, resto, [[kota, 1]], { expectedTotal: 75 });
    assert.equal(stale.status, 409);
    assert.equal(stale.data.priceChanged, true);
    assert.equal(stale.data.total, 80);
    // Same if the owner changes the delivery fee.
    await api('PATCH', `/api/admin/restaurants/${resto.id}`, { ...ADMIN, body: { deliveryFee: 35 } });
    assert.equal((await h.placeOrder(cust, resto, [[kota, 1]], { expectedTotal: 80 })).status, 409);
    // Once the page shows the right total, the order goes through at it.
    const ok = await h.placeOrder(cust, resto, [[kota, 1]], { expectedTotal: 85 });
    assert.equal(ok.status, 201);
    assert.equal(ok.data.order.total, 85);
    // Put things back for the tests that follow.
    await api('PUT', `/api/portal/menu/${kota.id}`, { token: resto.token, body: { name: 'Kota', description: 'Tasty', price: 45 } });
    await api('PATCH', `/api/admin/restaurants/${resto.id}`, { ...ADMIN, body: { deliveryFee: 30 } });
  });

  it('keeps a delivery pin in Middelburg and drops one that is nonsense', async () => {
    const near = await h.placeOrder(cust, resto, [[resto.items[0], 1]], { deliveryLat: -25.7801, deliveryLng: 29.4702 });
    assert.equal(near.data.order.deliveryLat, -25.7801);
    assert.equal(near.data.order.deliveryLng, 29.4702);

    // A phone reporting Cape Town must not send a driver 1,400 km away.
    const far = await h.placeOrder(cust, resto, [[resto.items[0], 1]], { deliveryLat: -33.9249, deliveryLng: 18.4241 });
    assert.equal(far.status, 201);
    assert.equal(far.data.order.deliveryLat, null);
    assert.equal(far.data.order.deliveryLng, null);

    for (const bad of [{ deliveryLat: 'abc', deliveryLng: 29.47 }, { deliveryLat: -25.78 }, { deliveryLat: 999, deliveryLng: 999 }]) {
      const r = await h.placeOrder(cust, resto, [[resto.items[0], 1]], bad);
      assert.equal(r.status, 201, 'a bad pin never blocks an order');
      assert.equal(r.data.order.deliveryLat, null);
    }
  });

  it("a customer can only see their own orders", async () => {
    const mine = (await h.placeOrder(cust, resto, [[resto.items[0], 1]])).data.order;
    const stranger = await h.customer('Nosy Stranger');
    assert.equal((await api('GET', `/api/orders/${mine.id}`, { token: stranger.token })).status, 404);
    assert.equal((await api('GET', `/api/orders/${mine.id}/tracking`, { token: stranger.token })).status, 404);
    assert.equal((await api('POST', `/api/orders/${mine.id}/payfast-checkout`, { token: stranger.token })).status, 404);
    assert.equal((await api('GET', `/api/orders/${mine.id}`, { token: cust.token })).status, 200);
  });
});

describe('payment', () => {
  let cust, resto;
  before(async () => {
    cust = await h.customer();
    resto = await h.restaurant({ deliveryFee: 30 });
  });

  const board = async () => (await api('GET', '/api/portal/orders', { token: resto.token })).data.orders;

  it('the kitchen cannot see or accept an order until it is paid', async () => {
    const order = (await h.placeOrder(cust, resto, [[resto.items[0], 1]])).data.order;
    assert.ok(!(await board()).some((o) => o.id === order.id));
    assert.equal((await api('POST', `/api/portal/orders/${order.id}/accept`, { token: resto.token })).status, 400);

    await h.pay(order);
    assert.ok((await board()).some((o) => o.id === order.id));
    assert.equal((await api('POST', `/api/portal/orders/${order.id}/accept`, { token: resto.token })).status, 200);
  });

  it('a notification with a forged signature is ignored', async () => {
    const order = (await h.placeOrder(cust, resto, [[resto.items[0], 1]])).data.order;
    const r = await h.notify(order, { signature: 'deadbeefdeadbeefdeadbeefdeadbeef' });
    assert.equal(r.status, 200); // PayFast always gets a 200; the order is just left alone
    await h.sleep(150);
    assert.equal(await h.paymentStatus(order.id), 'pending');
  });

  it('paying the wrong amount does not buy the order', async () => {
    const order = (await h.placeOrder(cust, resto, [[resto.items[0], 2]])).data.order; // R120
    await h.notify(order, { amount_gross: '1.00' });
    await h.sleep(150);
    assert.equal(await h.paymentStatus(order.id), 'failed');
    assert.ok(!(await board()).some((o) => o.id === order.id));
  });

  it('a notification for another PayFast merchant is ignored', async () => {
    const order = (await h.placeOrder(cust, resto, [[resto.items[0], 1]])).data.order;
    await h.notify(order, { merchant_id: '99999999' });
    await h.sleep(150);
    assert.equal(await h.paymentStatus(order.id), 'pending');
  });

  it('a payment that did not complete leaves the order unpaid, and the customer can retry', async () => {
    const order = (await h.placeOrder(cust, resto, [[resto.items[0], 1]])).data.order;
    await h.notify(order, { payment_status: 'CANCELLED' });
    await h.sleep(150);
    assert.equal(await h.paymentStatus(order.id), 'failed');

    const retry = await api('POST', `/api/orders/${order.id}/payfast-checkout`, { token: cust.token });
    assert.equal(retry.status, 200);
    assert.match(retry.data.paymentUrl, /payfast/);
    await h.pay(order);
    assert.equal(await h.paymentStatus(order.id), 'paid');
    assert.equal((await api('POST', `/api/orders/${order.id}/payfast-checkout`, { token: cust.token })).status, 400);
  });

  it('once paid, an order stays paid whatever arrives later', async () => {
    const order = (await h.placeOrder(cust, resto, [[resto.items[0], 1]])).data.order;
    await h.pay(order);
    await h.notify(order, { payment_status: 'CANCELLED' });
    await h.notify(order, { amount_gross: '1.00' });
    await h.sleep(200);
    assert.equal(await h.paymentStatus(order.id), 'paid');
  });

  it('a customer who pays twice is owed the second payment back', async () => {
    const order = (await h.placeOrder(cust, resto, [[resto.items[0], 1]])).data.order; // R75
    const first = await h.pay(order);
    await h.notify(order, { pf_payment_id: '5550001' });
    await h.notify(order, { pf_payment_id: '5550001' }); // PayFast repeating itself
    await h.sleep(200);

    const { rows } = await h.db().query('SELECT payment_reference FROM orders WHERE id = $1', [order.id]);
    assert.equal(rows[0].payment_reference, first, 'the order keeps the payment that actually bought it');

    const a = (await api('GET', '/api/admin/orders', ADMIN)).data;
    const due = a.refundsDue.filter((x) => x.orderId === order.id);
    assert.equal(due.length, 1, 'recorded once, however often PayFast repeats it');
    assert.equal(due[0].kind, 'duplicate');
    assert.equal(due[0].total, 75);
    assert.equal(due[0].paymentReference, '5550001');
    assert.ok(a.stats.refundsDue >= 75);

    assert.equal((await api('POST', '/api/admin/extra-payments/5550001/refunded', { body: {} })).status, 401);
    assert.equal((await api('POST', '/api/admin/extra-payments/5550001/refunded', { ...ADMIN, body: { reference: 'R-1' } })).status, 200);
    assert.equal((await api('POST', '/api/admin/extra-payments/5550001/refunded', { ...ADMIN, body: {} })).status, 400);
    const after = (await api('GET', '/api/admin/orders', ADMIN)).data;
    assert.ok(!after.refundsDue.some((x) => x.orderId === order.id));
    // The order itself is untouched: still paid, still on the kitchen's board.
    assert.equal(await h.paymentStatus(order.id), 'paid');
  });

  it('a payment is not lost when PayFast is briefly unreachable', async () => {
    const order = (await h.placeOrder(cust, resto, [[resto.items[0], 1]])).data.order;
    let asked = 0;
    const restore = h.payfastAnswers(async () => { asked += 1; return asked < 3 ? null : true; });
    try {
      await h.pay(order);
    } finally {
      restore();
    }
    assert.equal(asked, 3, 'asked again until PayFast answered');
    assert.equal(await h.paymentStatus(order.id), 'paid');
  });

  it('a notification PayFast itself disowns never pays an order', async () => {
    const order = (await h.placeOrder(cust, resto, [[resto.items[0], 1]])).data.order;
    let asked = 0;
    const restore = h.payfastAnswers(async () => { asked += 1; return false; });
    try {
      await h.notify(order);
      await h.sleep(200);
    } finally {
      restore();
    }
    assert.equal(asked, 1, 'a clear "no" is not retried');
    assert.equal(await h.paymentStatus(order.id), 'pending');
  });

  it('PayFast is told to report back to this server', async () => {
    const r = await h.placeOrder(cust, resto, [[resto.items[0], 1]]);
    const url = new URL(r.data.paymentUrl);
    assert.match(url.searchParams.get('notify_url'), /\/api\/payments\/payfast\/notify$/);
    assert.match(url.searchParams.get('return_url'), new RegExp(`/api/payments/payfast/return\\?order=${r.data.order.id}$`));
    assert.equal(url.searchParams.get('m_payment_id'), r.data.order.id);
    assert.equal(url.searchParams.get('signature').length, 32);
  });

  it('the page PayFast returns the customer to lands on their order', async () => {
    const order = (await h.placeOrder(cust, resto, [[resto.items[0], 1]])).data.order;
    const back = await api('GET', `/api/payments/payfast/return?order=${order.id}`);
    assert.equal(back.status, 302);
    assert.equal(back.headers.get('location'), `/order/#order/${order.id}`);
    // Anything that is not an order id goes to the order list, never elsewhere.
    const odd = await api('GET', '/api/payments/payfast/return?order=https://evil.example');
    assert.equal(odd.headers.get('location'), '/order/#orders');
  });
});

describe('kitchen to door', () => {
  let cust, resto, drv, rival, order;
  before(async () => {
    await h.settings({ commissionRate: 0.15, deliveryCutRate: 0.2 });
    cust = await h.customer('Sipho Customer');
    resto = await h.restaurant({ deliveryFee: 30 });
    drv = await h.driver('Lucky');
    rival = await h.driver('Second Driver');
    order = (await h.placeOrder(cust, resto, [[resto.items[0], 2]], { deliveryLat: -25.7801, deliveryLng: 29.4702, notes: 'no chilli' })).data.order;
    await h.pay(order);
  });

  const available = async (d) => (await api('GET', '/api/driver/orders/available', { token: d.token })).data.orders;
  const tracking = async () => (await api('GET', `/api/orders/${order.id}/tracking`, { token: cust.token })).data.tracking;

  it('steps cannot be skipped', async () => {
    assert.equal((await api('POST', `/api/portal/orders/${order.id}/preparing`, { token: resto.token })).status, 400);
    assert.equal((await api('POST', `/api/portal/orders/${order.id}/ready`, { token: resto.token })).status, 400);
    assert.equal((await api('POST', `/api/driver/orders/${order.id}/accept`, { token: drv.token })).status, 409);
  });

  it("another restaurant cannot touch this kitchen's order", async () => {
    const other = await h.restaurant({ name: 'Other Kitchen' });
    assert.equal((await api('POST', `/api/portal/orders/${order.id}/accept`, { token: other.token })).status, 400);
    assert.equal((await api('POST', `/api/portal/orders/${order.id}/reject`, { token: other.token, body: {} })).status, 400);
  });

  it('the kitchen accepts, cooks, and calls for a driver', async () => {
    assert.equal((await api('POST', `/api/portal/orders/${order.id}/accept`, { token: resto.token })).status, 200);
    assert.equal((await tracking()).status, 'confirmed');
    assert.ok(!(await available(drv)).some((o) => o.id === order.id), 'not offered to drivers before it is ready');

    assert.equal((await api('POST', `/api/portal/orders/${order.id}/preparing`, { token: resto.token })).status, 200);
    assert.equal((await api('POST', `/api/portal/orders/${order.id}/ready`, { token: resto.token })).status, 200);
    assert.equal((await api('POST', `/api/portal/orders/${order.id}/ready`, { token: resto.token })).status, 400);
  });

  it('drivers are offered the job at what they will actually earn', async () => {
    const offer = (await available(drv)).find((o) => o.id === order.id);
    assert.ok(offer);
    assert.equal(offer.deliveryFee, 30); // what the customer paid
    assert.equal(offer.driverPayout, 24); // what the driver keeps after MidFood's 20%
    assert.equal(offer.notes, 'no chilli');
    assert.deepEqual(offer.items, [{ name: 'Kota', quantity: 2 }]);
  });

  it("an open offer does not give away the customer's number or exact pin", async () => {
    const offer = (await available(rival)).find((o) => o.id === order.id);
    assert.equal(offer.hasPin, true, 'drivers are told a pin exists');
    assert.equal(offer.deliveryLat, null);
    assert.equal(offer.deliveryLng, null);
    assert.equal(offer.customerPhone, null);
    assert.ok(offer.deliveryAddress, 'the address is still shown, to judge the trip');
  });

  it('the first driver to accept gets it; the second is told it has gone', async () => {
    assert.equal((await api('POST', `/api/driver/orders/${order.id}/accept`, { token: drv.token })).status, 200);
    const second = await api('POST', `/api/driver/orders/${order.id}/accept`, { token: rival.token });
    assert.equal(second.status, 409);
    assert.ok(!(await available(rival)).some((o) => o.id === order.id));
    // And the losing driver cannot pick it up or deliver it.
    assert.equal((await api('POST', `/api/driver/orders/${order.id}/pickup`, { token: rival.token })).status, 400);
    // The driver who has the job gets what they need to find and call the customer.
    const mine = (await api('GET', '/api/driver/orders/mine', { token: drv.token })).data.orders.find((o) => o.id === order.id);
    assert.equal(mine.deliveryLat, -25.7801);
    assert.equal(mine.deliveryLng, 29.4702);
    assert.equal(mine.customerPhone, '0821234567');
  });

  it('the customer watches the driver come to their pin', async () => {
    assert.equal((await api('POST', `/api/driver/orders/${order.id}/deliver`, { token: drv.token })).status, 400);
    assert.equal((await api('POST', `/api/driver/orders/${order.id}/pickup`, { token: drv.token })).status, 200);
    assert.equal((await api('POST', '/api/driver/location', { token: drv.token, body: { lat: -25.77, lng: 29.46 } })).status, 200);
    assert.equal((await api('POST', '/api/driver/location', { token: drv.token, body: { lat: 'x' } })).status, 400);

    const t = await tracking();
    assert.equal(t.status, 'out_for_delivery');
    assert.equal(t.driverName, 'Lucky');
    assert.equal(t.driverLat, -25.77);
    assert.equal(t.driverLng, 29.46);
    assert.equal(t.deliveryLat, -25.7801);
    assert.equal(t.deliveryLng, 29.4702);
    assert.ok(t.driverSeenAt);
  });

  it('delivered orders land in the driver and restaurant totals', async () => {
    assert.equal((await api('POST', `/api/driver/orders/${order.id}/deliver`, { token: drv.token })).status, 200);
    assert.equal((await tracking()).status, 'delivered');

    const hist = (await api('GET', '/api/driver/orders/history', { token: drv.token })).data;
    assert.equal(hist.earnings, 24);
    assert.equal(hist.earningsToday, 24);
    assert.equal(hist.orders[0].driverPayout, 24);
    assert.equal(hist.orders[0].deliveryLat, null, 'the pin is not kept in the driver\'s history');
    assert.equal(hist.orders[0].customerPhone, null);

    // Once the food has arrived, the customer no longer sees where the driver is.
    const t = await tracking();
    assert.equal(t.driverName, 'Lucky');
    assert.equal(t.driverLat, null);
    assert.equal(t.driverLng, null);
    assert.equal(t.driverPhone, null);

    const day = (await api('GET', '/api/portal/orders/history', { token: resto.token })).data;
    assert.equal(day.todayCount, 1);
    assert.equal(day.todayTakings, 90);
    assert.equal((await api('GET', '/api/portal/orders', { token: resto.token })).data.orders.length, 0);
  });
});

describe('how the money splits', () => {
  let cust, drv;
  before(async () => {
    await h.settings({ commissionRate: 0.15, deliveryCutRate: 0.2, freeMonths: 3 });
    cust = await h.customer();
    drv = await h.driver('Money Driver');
  });

  const split = async (orderId) => {
    const { rows } = await h.db().query(
      `SELECT commission::float8 AS commission, commission_rate::float8 AS rate,
              restaurant_payout::float8 AS "restaurantPayout", delivery_cut::float8 AS "deliveryCut",
              driver_payout::float8 AS "driverPayout" FROM orders WHERE id = $1`,
      [orderId]
    );
    return rows[0];
  };
  const setTerms = (resto, body) => api('PATCH', `/api/admin/restaurants/${resto.id}`, { ...ADMIN, body });

  it('a new restaurant pays no commission during its free months', async () => {
    const resto = await h.restaurant({ deliveryFee: 30, menu: [['Kota', 45]] });
    const order = (await h.placeOrder(cust, resto, [[resto.items[0], 2]])).data.order;
    await h.pay(order);
    assert.deepEqual(await split(order.id), { commission: 0, rate: 0, restaurantPayout: 90, deliveryCut: 6, driverPayout: 24 });
  });

  it('after the free period it is 15% of the food, and never of the delivery fee', async () => {
    const resto = await h.restaurant({ deliveryFee: 30, menu: [['Kota', 45]] });
    await setTerms(resto, { freeUntil: saDate(-1) });
    const order = (await h.placeOrder(cust, resto, [[resto.items[0], 2]])).data.order;
    await h.pay(order);
    assert.deepEqual(await split(order.id), { commission: 13.5, rate: 0.15, restaurantPayout: 76.5, deliveryCut: 6, driverPayout: 24 });
  });

  it('the last day of the free period is still free', async () => {
    const resto = await h.restaurant({ menu: [['Kota', 45]] });
    await setTerms(resto, { freeUntil: saDate(0) });
    const order = (await h.placeOrder(cust, resto, [[resto.items[0], 1]])).data.order;
    await h.pay(order);
    assert.equal((await split(order.id)).commission, 0);
  });

  it('every cent is accounted for, on an awkward total', async () => {
    const resto = await h.restaurant({ deliveryFee: 27.5, menu: [['Platter', 33.3]] });
    await setTerms(resto, { freeUntil: null });
    const order = (await h.placeOrder(cust, resto, [[resto.items[0], 1]])).data.order;
    await h.pay(order);
    const s = await split(order.id);
    assert.equal(s.commission, 5); // 15% of R33.30 is R4.995 -> R5.00
    assert.equal(s.restaurantPayout, 28.3);
    assert.equal(s.deliveryCut, 5.5);
    assert.equal(s.driverPayout, 22);
    // What the customer paid = what everyone gets.
    assert.equal(Math.round((s.commission + s.restaurantPayout + s.deliveryCut + s.driverPayout) * 100), Math.round(order.total * 100));
  });

  it("a restaurant's special rate applies to it alone", async () => {
    const special = await h.restaurant({ menu: [['Kota', 100]] });
    const normal = await h.restaurant({ menu: [['Kota', 100]] });
    await setTerms(special, { freeUntil: null, commissionRate: 0.1 });
    await setTerms(normal, { freeUntil: null });
    const a = (await h.placeOrder(cust, special, [[special.items[0], 1]])).data.order;
    const b = (await h.placeOrder(cust, normal, [[normal.items[0], 1]])).data.order;
    await h.pay(a);
    await h.pay(b);
    assert.equal((await split(a.id)).commission, 10);
    assert.equal((await split(b.id)).commission, 15);
  });

  it('changing the rates never rewrites an order that is already paid', async () => {
    const resto = await h.restaurant({ deliveryFee: 30, menu: [['Kota', 100]] });
    await setTerms(resto, { freeUntil: null });
    const before = (await h.placeOrder(cust, resto, [[resto.items[0], 1]])).data.order;
    const pfPaymentId = await h.pay(before);

    await h.settings({ commissionRate: 0.25, deliveryCutRate: 0.5 });
    const afterChange = (await h.placeOrder(cust, resto, [[resto.items[0], 1]])).data.order;
    await h.pay(afterChange);
    // PayFast repeating its notification must not recalculate the first order.
    await h.notify(before, { pf_payment_id: pfPaymentId });
    await h.sleep(150);

    assert.deepEqual(await split(before.id), { commission: 15, rate: 0.15, restaurantPayout: 85, deliveryCut: 6, driverPayout: 24 });
    assert.deepEqual(await split(afterChange.id), { commission: 25, rate: 0.25, restaurantPayout: 75, deliveryCut: 15, driverPayout: 15 });
    await h.settings({ commissionRate: 0.15, deliveryCutRate: 0.2 });
  });

  it('with the free months set to zero, a new restaurant pays from its first order', async () => {
    await h.settings({ freeMonths: 0 });
    const resto = await h.restaurant({ menu: [['Kota', 100]] });
    const row = (await api('GET', '/api/admin/restaurants', ADMIN)).data.restaurants.find((r) => r.id === resto.id);
    assert.equal(row.freeUntil, null);
    assert.equal((await api('GET', '/api/portal/earnings', { token: resto.token })).data.terms.inFreePeriod, false);
    const order = (await h.placeOrder(cust, resto, [[resto.items[0], 1]])).data.order;
    await h.pay(order);
    assert.equal((await split(order.id)).commission, 15);
    await h.settings({ freeMonths: 3 });
  });

  it('an unpaid order has no split at all', async () => {
    const resto = await h.restaurant();
    const order = (await h.placeOrder(cust, resto, [[resto.items[0], 1]])).data.order;
    assert.deepEqual(await split(order.id), { commission: null, rate: null, restaurantPayout: null, deliveryCut: null, driverPayout: null });
  });

  it('rates and the payout day are validated', async () => {
    const put = (body) => api('PUT', '/api/payouts/settings', { ...ADMIN, body });
    assert.equal((await put({ commissionRate: 15 })).status, 400); // 15 would be 1500%
    assert.equal((await put({ deliveryCutRate: -0.1 })).status, 400);
    assert.equal((await put({ freeMonths: 2.5 })).status, 400);
    assert.equal((await put({ payoutDay: 'Someday' })).status, 400);
    assert.equal((await put({})).status, 400);
    const ok = await put({ payoutDay: 'Friday' });
    assert.equal(ok.data.settings.payoutDay, 'Friday');
    assert.equal((await put({ payoutDay: 'Tuesday' })).data.settings.payoutDay, 'Tuesday');
    assert.deepEqual((await api('GET', '/api/payouts/settings', ADMIN)).data.settings, {
      commissionRate: 0.15, deliveryCutRate: 0.2, freeMonths: 3, payoutDay: 'Tuesday',
    });
  });

  it("a restaurant's terms can be edited, and bad values are refused", async () => {
    const resto = await h.restaurant({ deliveryFee: 100 });
    const ok = await setTerms(resto, { deliveryFee: 35, etaMinutes: 40, freeUntil: '2027-01-08', commissionRate: 0.12 });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.data.restaurant, {
      id: resto.id, name: 'Test Kitchen', deliveryFee: 35, etaMinutes: 40, freeUntil: '2027-01-08', commissionRate: 0.12,
    });
    // Customers see the new fee straight away, and are charged it.
    const pub = await api('GET', `/api/restaurants/${resto.id}`);
    assert.equal(pub.data.restaurant.deliveryFee, 35);
    assert.equal((await h.placeOrder(cust, resto, [[resto.items[0], 1]])).data.order.deliveryFee, 35);

    // Clearing the special rate and the free period.
    const cleared = await setTerms(resto, { commissionRate: null, freeUntil: null });
    assert.equal(cleared.data.restaurant.commissionRate, null);
    assert.equal(cleared.data.restaurant.freeUntil, null);

    for (const bad of [{ deliveryFee: -5 }, { deliveryFee: 5000 }, { deliveryFee: 'lots' }, { deliveryFee: null }, { etaMinutes: 0 },
      { freeUntil: 'next month' }, { freeUntil: '2027-13-45' }, { freeUntil: '2027-02-30' }, { commissionRate: 15 }, {}]) {
      assert.equal((await setTerms(resto, bad)).status, 400, JSON.stringify(bad));
    }
    assert.equal((await api('PATCH', `/api/admin/restaurants/${resto.id}`, { body: { deliveryFee: 1 } })).status, 401);
    assert.equal((await api('PATCH', '/api/admin/restaurants/00000000-0000-4000-8000-000000000000', { ...ADMIN, body: { deliveryFee: 1 } })).status, 404);
  });

  it('the kitchen is shown its terms and the payout day', async () => {
    const resto = await h.restaurant();
    const free = (await api('GET', '/api/portal/earnings', { token: resto.token })).data.terms;
    assert.equal(free.inFreePeriod, true);
    assert.equal(free.rate, 0);
    assert.equal(free.rateAfterFree, 0.15);
    assert.equal(free.payoutDay, 'Tuesday');

    await setTerms(resto, { freeUntil: saDate(-1) });
    const paying = (await api('GET', '/api/portal/earnings', { token: resto.token })).data.terms;
    assert.equal(paying.inFreePeriod, false);
    assert.equal(paying.rate, 0.15);

    const d = (await api('GET', '/api/driver/earnings', { token: drv.token })).data;
    assert.equal(d.payoutDay, 'Tuesday');
    assert.equal(d.deliveryCutRate, 0.2);
  });
});

describe('payouts', () => {
  let cust, resto, drv, orders;
  before(async () => {
    await h.settings({ commissionRate: 0.15, deliveryCutRate: 0.2 });
    cust = await h.customer('Paying Customer');
    resto = await h.restaurant({ name: 'Payout Kitchen', deliveryFee: 30, menu: [['Kota', 45], ['Chips', 25]] });
    await api('PATCH', `/api/admin/restaurants/${resto.id}`, { ...ADMIN, body: { freeUntil: null } });
    drv = await h.driver('Payout Driver');
    orders = [
      await h.deliver(cust, resto, drv, [[resto.items[0], 2]]), // R90 food
      await h.deliver(cust, resto, drv, [[resto.items[1], 1]]), // R25 food
    ];
  });

  const owing = async () => (await api('GET', '/api/payouts/owing', ADMIN)).data;

  it('shows exactly what each restaurant and driver is owed', async () => {
    const o = await owing();
    const r = o.restaurants.find((x) => x.id === resto.id);
    assert.equal(r.orderCount, 2);
    assert.equal(r.gross, 115);
    assert.equal(r.deductions, 17.25);
    assert.equal(r.amount, 97.75);
    const d = o.drivers.find((x) => x.id === drv.id);
    assert.equal(d.orderCount, 2);
    assert.equal(d.gross, 60);
    assert.equal(d.deductions, 12);
    assert.equal(d.amount, 48);
  });

  it('only delivered orders are owed', async () => {
    const extra = (await h.placeOrder(cust, resto, [[resto.items[0], 1]])).data.order;
    await h.pay(extra);
    await api('POST', `/api/portal/orders/${extra.id}/accept`, { token: resto.token });
    const r = (await owing()).restaurants.find((x) => x.id === resto.id);
    assert.equal(r.orderCount, 2, 'an order still in the kitchen is not owed yet');
    // Finish it off so it does not leak into the tests below.
    await api('POST', `/api/admin/orders/${extra.id}/cancel`, { ...ADMIN, body: { reason: 'test tidy-up' } });
    await api('POST', `/api/admin/orders/${extra.id}/refunded`, { ...ADMIN, body: {} });
  });

  it('the restaurant and the driver can each check their own statement, order by order', async () => {
    const r = (await api('GET', '/api/portal/statement', { token: resto.token })).data.orders;
    assert.equal(r.length, 2);
    assert.deepEqual(r.map((o) => [o.gross, o.deduction, o.amount]), [[90, 13.5, 76.5], [25, 3.75, 21.25]]);
    assert.equal(r[0].customerName, 'Paying Customer');

    const d = (await api('GET', '/api/driver/statement', { token: drv.token })).data.orders;
    assert.deepEqual(d.map((o) => [o.gross, o.deduction, o.amount]), [[30, 6, 24], [30, 6, 24]]);

    // Nobody else's statement is reachable.
    const other = await h.restaurant({ name: 'Nosy Kitchen' });
    assert.equal((await api('GET', '/api/portal/statement', { token: other.token })).data.orders.length, 0);
    assert.equal((await api('GET', '/api/portal/statement', { token: drv.token })).status, 403);
    assert.equal((await api('GET', '/api/portal/statement?payout=not-an-id', { token: resto.token })).status, 400);
    assert.equal((await api('GET', `/api/portal/statement?payout=${'-'.repeat(36)}`, { token: resto.token })).status, 400);
    assert.equal((await api('GET', `/api/driver/statement?payout=${'-'.repeat(36)}`, { token: drv.token })).status, 400);
  });

  it('recording a payout settles those orders, and a second press pays nothing', async () => {
    const paid = await api('POST', `/api/payouts/restaurant/${resto.id}`, { ...ADMIN, body: { reference: 'EFT-001' } });
    assert.equal(paid.status, 201);
    assert.equal(paid.data.payout.amount, 97.75);
    assert.equal(paid.data.payout.orderCount, 2);

    const again = await api('POST', `/api/payouts/restaurant/${resto.id}`, { ...ADMIN, body: {} });
    assert.equal(again.status, 400);
    assert.ok(!(await owing()).restaurants.some((x) => x.id === resto.id));

    // The driver is still owed: the two payouts are independent.
    assert.equal((await owing()).drivers.find((x) => x.id === drv.id).amount, 48);
  });

  it('two presses at the same moment still pay once', async () => {
    const [a, b] = await Promise.all([
      api('POST', `/api/payouts/driver/${drv.id}`, { ...ADMIN, body: { reference: 'EFT-002' } }),
      api('POST', `/api/payouts/driver/${drv.id}`, { ...ADMIN, body: { reference: 'EFT-002' } }),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [201, 400]);
    const { rows } = await h.db().query('SELECT COUNT(*)::int AS n, SUM(amount)::float8 AS total FROM payouts WHERE driver_id = $1', [drv.id]);
    assert.deepEqual(rows[0], { n: 1, total: 48 });
  });

  it('the payment shows up for the restaurant and driver, with its statement', async () => {
    const e = (await api('GET', '/api/portal/earnings', { token: resto.token })).data;
    assert.equal(e.pending.orderCount, 0);
    assert.equal(e.payouts.length, 1);
    assert.equal(e.payouts[0].amount, 97.75);
    assert.equal(e.payouts[0].reference, 'EFT-001');

    const lines = (await api('GET', `/api/portal/statement?payout=${e.payouts[0].id}`, { token: resto.token })).data.orders;
    assert.equal(lines.length, 2);
    assert.equal(lines.reduce((s, o) => s + o.amount, 0), 97.75);
    assert.equal((await api('GET', '/api/portal/statement', { token: resto.token })).data.orders.length, 0);

    // A different restaurant cannot read this payout's statement by guessing its id.
    const other = await h.restaurant({ name: 'Another Kitchen' });
    assert.equal((await api('GET', `/api/portal/statement?payout=${e.payouts[0].id}`, { token: other.token })).data.orders.length, 0);

    const d = (await api('GET', '/api/driver/earnings', { token: drv.token })).data;
    assert.equal(d.pending.amount, 0);
    assert.equal(d.payouts[0].amount, 48);
    assert.equal((await api('GET', `/api/driver/statement?payout=${d.payouts[0].id}`, { token: drv.token })).data.orders.length, 2);
  });

  it('new orders after a payout start a fresh balance', async () => {
    await h.deliver(cust, resto, drv, [[resto.items[0], 1]]);
    const r = (await owing()).restaurants.find((x) => x.id === resto.id);
    assert.equal(r.orderCount, 1);
    assert.equal(r.amount, 38.25);
    const hist = (await api('GET', '/api/payouts/history', ADMIN)).data.payouts;
    assert.ok(hist.some((p) => p.payeeName === 'Payout Kitchen' && p.amount === 97.75));
    assert.ok(hist.some((p) => p.payeeName === 'Payout Driver' && p.amount === 48));
  });

  it('bank details can be saved for a payee', async () => {
    const r = await api('PUT', `/api/payouts/bank/restaurant/${resto.id}`, {
      ...ADMIN, body: { bankName: 'Capitec', bankAccountName: 'Payout Kitchen', bankAccountNumber: '1234567890' },
    });
    assert.equal(r.status, 200);
    const o = (await owing()).restaurants.find((x) => x.id === resto.id);
    assert.equal(o.bankName, 'Capitec');
    assert.equal((await api('PUT', `/api/payouts/bank/restaurant/${resto.id}`, { body: {} })).status, 401);
  });
});

describe('refunds and cancelled orders', () => {
  let cust, resto, drv;
  before(async () => {
    cust = await h.customer('Refund Customer');
    resto = await h.restaurant({ name: 'Refund Kitchen', deliveryFee: 30 });
    drv = await h.driver('Refund Driver');
  });

  const adminOrders = async () => (await api('GET', '/api/admin/orders', ADMIN)).data;
  const paidOrder = async () => {
    const order = (await h.placeOrder(cust, resto, [[resto.items[0], 1]])).data.order; // R75
    await h.pay(order);
    return order;
  };

  it('a paid order the kitchen declines becomes a refund the owner cannot miss', async () => {
    const order = await paidOrder();
    const before = (await adminOrders()).stats;
    await api('POST', `/api/portal/orders/${order.id}/reject`, { token: resto.token, body: { reason: 'Out of bread' } });

    const a = await adminOrders();
    const due = a.refundsDue.find((o) => o.id === order.id);
    assert.ok(due, 'listed under refunds due');
    assert.equal(due.total, 75);
    assert.equal(due.cancelledBy, 'restaurant');
    assert.equal(due.rejectedReason, 'Out of bread');
    assert.ok(due.paymentReference, 'carries the PayFast payment id needed to refund it');
    assert.equal(a.stats.refundsDue, before.refundsDue + 75);
    assert.equal(a.stats.gmv, before.gmv - 75, 'a refunded order is not a sale');

    const t = (await api('GET', `/api/orders/${order.id}/tracking`, { token: cust.token })).data.tracking;
    assert.equal(t.status, 'rejected');
    assert.equal(t.refundedAt, null);
  });

  it('recording the refund clears it, once', async () => {
    const order = await paidOrder();
    await api('POST', `/api/portal/orders/${order.id}/reject`, { token: resto.token, body: {} });

    assert.equal((await api('POST', `/api/admin/orders/${order.id}/refunded`, { body: {} })).status, 401);
    const done = await api('POST', `/api/admin/orders/${order.id}/refunded`, { ...ADMIN, body: { reference: 'PF-REFUND-9' } });
    assert.equal(done.status, 200);
    assert.ok(!(await adminOrders()).refundsDue.some((o) => o.id === order.id));
    assert.equal((await api('POST', `/api/admin/orders/${order.id}/refunded`, { ...ADMIN, body: {} })).status, 400);

    const t = (await api('GET', `/api/orders/${order.id}/tracking`, { token: cust.token })).data.tracking;
    assert.ok(t.refundedAt, 'the customer is shown that the refund was sent');
  });

  it('an order that was never paid, or was delivered, has nothing to refund', async () => {
    const unpaid = (await h.placeOrder(cust, resto, [[resto.items[0], 1]])).data.order;
    assert.equal((await api('POST', `/api/admin/orders/${unpaid.id}/refunded`, { ...ADMIN, body: {} })).status, 400);
    const delivered = await h.deliver(cust, resto, drv, [[resto.items[0], 1]]);
    assert.equal((await api('POST', `/api/admin/orders/${delivered.id}/refunded`, { ...ADMIN, body: {} })).status, 400);
    assert.ok(!(await adminOrders()).refundsDue.some((o) => o.id === unpaid.id || o.id === delivered.id));
  });

  it('the owner can cancel an order that is going nowhere, and it becomes a refund', async () => {
    const order = await paidOrder();
    const live = (await adminOrders()).live.find((o) => o.id === order.id);
    assert.ok(live, 'shown under orders in progress');
    assert.equal(live.stuck, false, 'a brand new order is not flagged yet');

    assert.equal((await api('POST', `/api/admin/orders/${order.id}/cancel`, { body: {} })).status, 401);
    const c = await api('POST', `/api/admin/orders/${order.id}/cancel`, { ...ADMIN, body: { reason: 'Restaurant not answering' } });
    assert.equal(c.status, 200);
    assert.equal(c.data.refundDue, true);

    const a = await adminOrders();
    assert.ok(!a.live.some((o) => o.id === order.id));
    const due = a.refundsDue.find((o) => o.id === order.id);
    assert.equal(due.cancelledBy, 'admin');
    assert.equal(due.rejectedReason, 'Restaurant not answering');
    // The kitchen can no longer accept it, and it is off their board.
    assert.equal((await api('POST', `/api/portal/orders/${order.id}/accept`, { token: resto.token })).status, 400);
    assert.ok(!(await api('GET', '/api/portal/orders', { token: resto.token })).data.orders.some((o) => o.id === order.id));
    assert.equal((await api('POST', `/api/admin/orders/${order.id}/cancel`, { ...ADMIN, body: {} })).status, 400);
  });

  it('a kitchen that has not answered for ten minutes is flagged', async () => {
    const order = await paidOrder();
    await h.db().query("UPDATE orders SET paid_at = now() - interval '12 minutes' WHERE id = $1", [order.id]);
    const live = (await adminOrders()).live.find((o) => o.id === order.id);
    assert.equal(live.stuck, true);
    assert.equal(live.waitingMinutes, 12);
    // Once the kitchen accepts, it is no longer stuck.
    await api('POST', `/api/portal/orders/${order.id}/accept`, { token: resto.token });
    assert.equal((await adminOrders()).live.find((o) => o.id === order.id).stuck, false);
    await api('POST', `/api/admin/orders/${order.id}/cancel`, { ...ADMIN, body: {} });
  });

  it('the wait is counted from payment, not from when the order was started', async () => {
    // A customer who came back 45 minutes later and tapped "Pay now": the
    // kitchen has only just seen it, so it must not be flagged as ignored.
    const order = (await h.placeOrder(cust, resto, [[resto.items[0], 1]])).data.order;
    await h.db().query("UPDATE orders SET created_at = now() - interval '45 minutes' WHERE id = $1", [order.id]);
    await h.pay(order);
    const live = (await adminOrders()).live.find((o) => o.id === order.id);
    assert.equal(live.stuck, false);
    assert.equal(live.waitingMinutes, 0);
    await api('POST', `/api/admin/orders/${order.id}/cancel`, { ...ADMIN, body: {} });
  });

  it('cancelling after a driver has accepted takes the job off their list', async () => {
    const order = await paidOrder();
    await api('POST', `/api/portal/orders/${order.id}/accept`, { token: resto.token });
    await api('POST', `/api/portal/orders/${order.id}/ready`, { token: resto.token });
    await api('POST', `/api/driver/orders/${order.id}/accept`, { token: drv.token });
    const mine = async () => (await api('GET', '/api/driver/orders/mine', { token: drv.token })).data.orders;
    assert.ok((await mine()).some((o) => o.id === order.id));

    await api('POST', `/api/admin/orders/${order.id}/cancel`, { ...ADMIN, body: {} });
    assert.ok(!(await mine()).some((o) => o.id === order.id));
    assert.equal((await api('POST', `/api/driver/orders/${order.id}/pickup`, { token: drv.token })).status, 400);
    assert.ok(!(await api('GET', '/api/portal/orders', { token: resto.token })).data.orders.some((o) => o.id === order.id));
  });

  it('an order already on the road or delivered cannot be cancelled', async () => {
    const order = await paidOrder();
    await api('POST', `/api/portal/orders/${order.id}/accept`, { token: resto.token });
    await api('POST', `/api/portal/orders/${order.id}/ready`, { token: resto.token });
    await api('POST', `/api/driver/orders/${order.id}/accept`, { token: drv.token });
    await api('POST', `/api/driver/orders/${order.id}/pickup`, { token: drv.token });
    assert.equal((await api('POST', `/api/admin/orders/${order.id}/cancel`, { ...ADMIN, body: {} })).status, 400);
    await api('POST', `/api/driver/orders/${order.id}/deliver`, { token: drv.token });
    assert.equal((await api('POST', `/api/admin/orders/${order.id}/cancel`, { ...ADMIN, body: {} })).status, 400);
  });

  it('a cancelled order is never paid out to the restaurant or driver', async () => {
    const owing = (await api('GET', '/api/payouts/owing', ADMIN)).data;
    const r = owing.restaurants.find((x) => x.id === resto.id);
    // Two orders in this block were delivered (R45 food each, free period): R90.
    assert.equal(r.orderCount, 2);
    assert.equal(r.amount, 90);
  });
});

describe("loading a restaurant's menu from the admin page", () => {
  let resto, cust;
  before(async () => {
    cust = await h.customer();
    resto = await h.restaurant({ name: 'Menu Kitchen', menu: [] });
  });

  const menu = async () => (await api('GET', `/api/admin/restaurants/${resto.id}/menu`, ADMIN)).data.menu;
  const add = (items, opts = ADMIN) => api('POST', `/api/admin/restaurants/${resto.id}/menu`, { ...opts, body: { items } });

  it('is closed to everyone but the owner', async () => {
    assert.equal((await api('GET', `/api/admin/restaurants/${resto.id}/menu`)).status, 401);
    assert.equal((await add([{ name: 'Kota', price: 45 }], {})).status, 401);
    assert.equal((await add([{ name: 'Kota', price: 45 }], { token: resto.token })).status, 401);
    assert.equal((await api('PATCH', '/api/admin/menu/00000000-0000-4000-8000-000000000000', { body: { price: 1 } })).status, 401);
    assert.equal((await api('DELETE', '/api/admin/menu/00000000-0000-4000-8000-000000000000')).status, 401);
  });

  it('adds a whole menu in one go, and customers can order from it straight away', async () => {
    const r = await add([
      { name: 'Large Meat Platter', price: 850 },
      { name: '  Fruit Platter ', description: ' Seasonal fruit ', price: '600' },
      { name: 'Kota', price: 45.5 },
    ]);
    assert.equal(r.status, 201);
    assert.equal(r.data.added.length, 3);
    assert.deepEqual((await menu()).map((d) => [d.name, d.description, d.price, d.available]), [
      ['Fruit Platter', 'Seasonal fruit', 600, true],
      ['Kota', '', 45.5, true],
      ['Large Meat Platter', '', 850, true],
    ]);
    const pub = (await api('GET', `/api/restaurants/${resto.id}`)).data.restaurant.menu;
    assert.equal(pub.length, 3);
    const kota = pub.find((d) => d.name === 'Kota');
    const order = await h.placeOrder(cust, resto, [[kota, 2]]);
    assert.equal(order.status, 201);
    assert.equal(order.data.order.subtotal, 91);
    // The restaurant sees the same menu in its own portal.
    assert.equal((await api('GET', '/api/portal/menu', { token: resto.token })).data.menu.length, 3);
  });

  it('pasting the same list twice does not double the menu', async () => {
    const r = await add([{ name: 'kota', price: 50 }, { name: 'Chips', price: 25 }, { name: 'CHIPS', price: 30 }]);
    assert.equal(r.status, 201);
    assert.deepEqual(r.data.added.map((d) => d.name), ['Chips']);
    assert.deepEqual(r.data.skipped, ['kota', 'CHIPS']);
    const m = await menu();
    assert.equal(m.length, 4);
    assert.equal(m.find((d) => d.name === 'Kota').price, 45.5, 'the dish already there is left as it was');
  });

  it('one bad line stops the whole batch, so a half-loaded menu never goes live', async () => {
    for (const bad of [
      [{ name: 'Wings', price: 60 }, { name: '', price: 20 }],
      [{ name: 'Wings', price: 60 }, { name: 'Ribs' }],
      [{ name: 'Wings', price: 60 }, { name: 'Ribs', price: -5 }],
      [{ name: 'Wings', price: 60 }, { name: 'Ribs', price: 'lots' }],
      [{ name: 'W'.repeat(121), price: 60 }],
    ]) {
      assert.equal((await add(bad)).status, 400, JSON.stringify(bad).slice(0, 60));
    }
    assert.equal((await add([])).status, 400);
    assert.equal((await api('POST', `/api/admin/restaurants/${resto.id}/menu`, { ...ADMIN, body: {} })).status, 400);
    assert.equal((await menu()).length, 4, 'nothing from the failed batches was added');
    assert.equal((await api('POST', '/api/admin/restaurants/00000000-0000-4000-8000-000000000000/menu', { ...ADMIN, body: { items: [{ name: 'X', price: 1 }] } })).status, 404);
    assert.equal((await api('GET', '/api/admin/restaurants/not-an-id/menu', ADMIN)).status, 404);
  });

  it('a dish can be repriced, renamed, marked sold out and removed', async () => {
    const kota = (await menu()).find((d) => d.name === 'Kota');
    const patch = (body) => api('PATCH', `/api/admin/menu/${kota.id}`, { ...ADMIN, body });

    const priced = await patch({ price: 50 });
    assert.equal(priced.data.item.price, 50);
    assert.equal(priced.data.item.name, 'Kota', 'only what was sent is changed');
    assert.equal((await patch({ name: 'Full House Kota', description: 'Polony, russian, egg' })).data.item.name, 'Full House Kota');
    assert.equal((await patch({ price: -1 })).status, 400);
    assert.equal((await patch({ name: '' })).status, 400);
    assert.equal((await patch({ available: 'no' })).status, 400);

    // Sold out: hidden from customers and cannot be ordered, still on the owner's list.
    assert.equal((await patch({ available: false })).data.item.available, false);
    const pub = (await api('GET', `/api/restaurants/${resto.id}`)).data.restaurant.menu;
    assert.ok(!pub.some((d) => d.id === kota.id));
    assert.equal((await h.placeOrder(cust, resto, [[kota, 1]])).status, 409);
    assert.equal((await menu()).length, 4);
    await patch({ available: true });

    // Removing a dish leaves past orders intact.
    const order = (await h.placeOrder(cust, resto, [[kota, 1]])).data.order;
    assert.equal((await api('DELETE', `/api/admin/menu/${kota.id}`, ADMIN)).status, 204);
    assert.equal((await api('DELETE', `/api/admin/menu/${kota.id}`, ADMIN)).status, 404);
    assert.equal((await menu()).length, 3);
    const kept = (await api('GET', `/api/orders/${order.id}`, { token: cust.token })).data.order;
    assert.deepEqual(kept.items.map((i) => [i.name, i.price]), [['Full House Kota', 50]]);
  });

  it('the restaurant list shows how many dishes each has', async () => {
    const empty = await h.restaurant({ name: 'Empty Kitchen', menu: [] });
    const list = (await api('GET', '/api/admin/restaurants', ADMIN)).data.restaurants;
    assert.equal(list.find((r) => r.id === resto.id).menuCount, 3);
    assert.equal(list.find((r) => r.id === empty.id).menuCount, 0);
  });
});

describe('the pages themselves', () => {
  it('every front door is served', async () => {
    for (const path of ['/', '/order/', '/portal/', '/driver/', '/portal/admin.html', '/privacy/']) {
      const r = await fetch(h.BASE + path);
      assert.equal(r.status, 200, path);
      assert.match(r.headers.get('content-type'), /text\/html/, path);
    }
  });

  it('the map code is served from this site, and only map images come from outside', async () => {
    for (const path of ['/vendor/leaflet/leaflet.js', '/vendor/leaflet/leaflet.css']) {
      assert.equal((await fetch(h.BASE + path)).status, 200, path);
    }
    const csp = (await fetch(`${h.BASE}/order/`)).headers.get('content-security-policy');
    assert.match(csp, /script-src 'self' 'unsafe-inline';/);
    assert.match(csp, /img-src 'self' data: https:\/\/tile\.openstreetmap\.org;/);
    assert.match(csp, /connect-src 'self';/);
  });

  it('every page tells people how to reach MidFood', async () => {
    for (const path of ['/', '/order/', '/portal/', '/driver/', '/privacy/']) {
      const html = await (await fetch(h.BASE + path)).text();
      assert.match(html, /href="tel:0726437784"/, path);
      assert.match(html, /072 643 7784/, path);
    }
  });

  it('unknown API paths answer 404 in JSON', async () => {
    const r = await api('GET', '/api/nope');
    assert.equal(r.status, 404);
    assert.equal(r.data.error, 'Not found');
  });
});
