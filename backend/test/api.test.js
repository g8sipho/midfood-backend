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

  it('a customer can log in with their email or their cellphone number', async () => {
    const email = `${h.unique('phoneuser')}@example.com`;
    const signup = await api('POST', '/api/auth/register', {
      body: { name: 'Lerato Phone', email, password: 'secret123', phone: '+27 82 555 0199' },
    });
    assert.equal(signup.status, 201);
    assert.equal(signup.data.user.phone, '0825550199'); // stored in the local ten-digit form

    // Email still works, written any which way.
    assert.equal((await api('POST', '/api/auth/login', { body: { identifier: email.toUpperCase(), password: 'secret123' } })).status, 200);
    // So does the number, with spaces, with the country code, or plain.
    for (const number of ['082 555 0199', '+27825550199', '0825550199']) {
      const r = await api('POST', '/api/auth/login', { body: { identifier: number, password: 'secret123' } });
      assert.equal(r.status, 200, `login with ${number}`);
      assert.equal(r.data.user.email, email);
    }
    // Wrong password with the number is still refused.
    assert.equal((await api('POST', '/api/auth/login', { body: { identifier: '0825550199', password: 'wrong' } })).status, 401);
    // The old field name keeps working for apps that have not updated.
    assert.equal((await api('POST', '/api/auth/login', { body: { email, password: 'secret123' } })).status, 200);

    // One number, one account.
    const again = await api('POST', '/api/auth/register', {
      body: { name: 'Someone Else', email: `${h.unique('other')}@example.com`, password: 'secret123', phone: '0825550199' },
    });
    assert.equal(again.status, 409);
    // And a number that is not a number is refused at sign-up.
    const bad = await api('POST', '/api/auth/register', {
      body: { name: 'Bad Phone', email: `${h.unique('bad')}@example.com`, password: 'secret123', phone: '12345' },
    });
    assert.equal(bad.status, 400);
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

  it('a customer who forgot their password gets a code by email and chooses a new one', async () => {
    const mailer = require('../src/mailer');
    const email = `${h.unique('forgot')}@example.com`;
    const signup = await api('POST', '/api/auth/register', {
      body: { name: 'Naledi Forgot', email, password: 'oldpass1', phone: '083 111 2233' },
    });
    assert.equal(signup.status, 201);

    // Asking with the cellphone number works, and the reply says where the
    // code went without giving the address away.
    mailer.outbox.length = 0;
    const asked = await api('POST', '/api/auth/forgot', { body: { identifier: '083 111 2233' } });
    assert.equal(asked.status, 200);
    assert.equal(asked.data.emailHint, `f${'*'.repeat(email.indexOf('@') - 2)}${email[email.indexOf('@') - 1]}@example.com`);
    assert.equal(mailer.outbox.length, 1);
    assert.equal(mailer.outbox[0].to, email);
    const code = mailer.outbox[0].subject.match(/^(\d{6}) /)[1];
    assert.ok(mailer.outbox[0].text.includes(code));

    // Asking again straight away does not send a second email (one a minute).
    await api('POST', '/api/auth/forgot', { body: { identifier: email } });
    assert.equal(mailer.outbox.length, 1);

    // An unknown address gets the same friendly answer and no email.
    const unknown = await api('POST', '/api/auth/forgot', { body: { identifier: 'nobody@example.com' } });
    assert.equal(unknown.status, 200);
    assert.equal(unknown.data.emailHint, undefined);
    assert.equal(mailer.outbox.length, 1);

    // A wrong code is refused and the password stays as it was.
    const wrong = await api('POST', '/api/auth/reset', { body: { identifier: email, code: '000000', password: 'newpass9' } });
    assert.equal(wrong.status, 400);
    assert.equal((await api('POST', '/api/auth/login', { body: { identifier: email, password: 'oldpass1' } })).status, 200);

    // The right code (typed with a space, as people do) sets the new password
    // and signs them in; the old password is gone and the code is spent.
    const reset = await api('POST', '/api/auth/reset', {
      body: { identifier: '0831112233', code: `${code.slice(0, 3)} ${code.slice(3)}`, password: 'newpass9' },
    });
    assert.equal(reset.status, 200, JSON.stringify(reset.data));
    assert.equal(reset.data.user.email, email);
    assert.ok(reset.data.token);
    assert.equal((await api('POST', '/api/auth/login', { body: { identifier: email, password: 'newpass9' } })).status, 200);
    assert.equal((await api('POST', '/api/auth/login', { body: { identifier: email, password: 'oldpass1' } })).status, 401);
    assert.equal((await api('POST', '/api/auth/reset', { body: { identifier: email, code, password: 'again123' } })).status, 400);

    // Five wrong guesses burn a code even if it is right the sixth time.
    await h.db().query('UPDATE users SET reset_sent_at = NULL WHERE email = $1', [email]);
    await api('POST', '/api/auth/forgot', { body: { identifier: email } });
    const second = mailer.outbox[mailer.outbox.length - 1].subject.match(/^(\d{6}) /)[1];
    for (let i = 0; i < 5; i += 1) {
      await api('POST', '/api/auth/reset', { body: { identifier: email, code: '111111', password: 'x'.repeat(8) } });
    }
    assert.equal((await api('POST', '/api/auth/reset', { body: { identifier: email, code: second, password: 'burnt123' } })).status, 400);
    assert.equal((await api('POST', '/api/auth/login', { body: { identifier: email, password: 'newpass9' } })).status, 200);
  });

  it('a signed-in customer can change their password, and support can hand out a temporary one', async () => {
    const c = await h.customer();
    // Wrong current password: refused.
    const bad = await api('PUT', '/api/auth/password', { token: c.token, body: { currentPassword: 'nope', newPassword: 'changed1' } });
    assert.equal(bad.status, 400); // not 401, which would log the customer out
    const ok = await api('PUT', '/api/auth/password', { token: c.token, body: { currentPassword: 'secret123', newPassword: 'changed1' } });
    assert.equal(ok.status, 200);
    assert.equal((await api('POST', '/api/auth/login', { body: { identifier: c.email, password: 'changed1' } })).status, 200);

    // Support (admin key) gives a temporary password to a customer who phoned in.
    const temp = await api('POST', '/api/admin/customers/temporary-password', { ...ADMIN, body: { identifier: c.email.toUpperCase() } });
    assert.equal(temp.status, 200);
    assert.match(temp.data.temporaryPassword, /^[A-Z2-9]{8}$/);
    assert.equal(temp.data.customer.email, c.email);
    assert.equal((await api('POST', '/api/auth/login', { body: { identifier: c.email, password: 'changed1' } })).status, 401);
    assert.equal((await api('POST', '/api/auth/login', { body: { identifier: c.email, password: temp.data.temporaryPassword } })).status, 200);
    assert.equal((await api('POST', '/api/admin/customers/temporary-password', { ...ADMIN, body: { identifier: 'nobody@example.com' } })).status, 404);
    // Not without the admin key.
    assert.equal((await api('POST', '/api/admin/customers/temporary-password', { body: { identifier: c.email } })).status, 401);
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

  it("a notification is checked the way PayFast signs it: every field, empty ones too, PHP-encoded", async () => {
    const payfast = require('../src/payments/payfast');
    const crypto = require('crypto');
    // What PayFast's own PHP sample computes for this ITN:
    //   m_payment_id=abc&pf_payment_id=1&payment_status=COMPLETE&item_name=It%27s+a+%28test%29&
    //   custom_str1=&name_last=&amount_gross=45.00&passphrase=payfast
    const php = crypto.createHash('md5').update(
      'm_payment_id=abc&pf_payment_id=1&payment_status=COMPLETE&item_name=It%27s+a+%28test%29'
      + '&custom_str1=&name_last=&amount_gross=45.00&passphrase=payfast'
    ).digest('hex');
    const body = {
      m_payment_id: 'abc', pf_payment_id: '1', payment_status: 'COMPLETE',
      item_name: "It's a (test)", custom_str1: '', name_last: '', amount_gross: '45.00',
      signature: php,
    };
    assert.equal(payfast.itnSignature(body, 'payfast'), php);
    assert.ok(payfast.isSignatureValid(body));
    // ...and the old recipe (empty fields dropped) must NOT be what we check against.
    assert.notEqual(payfast.buildSignature(body, 'payfast'), php);

    // An order paid for real: its ITN carries empty fields and is accepted.
    const order = (await h.placeOrder(cust, resto, [[resto.items[0], 1]])).data.order;
    await h.notify(order);
    await h.sleep(150);
    assert.equal(await h.paymentStatus(order.id), 'paid');
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
      categories: null,
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

describe('photos of dishes and restaurants', () => {
  // The server never decodes a picture; it checks what kind of file the first
  // bytes say it is. These are the smallest files that pass as each kind.
  const jpeg = (size = 2000, fill = 7) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(size - 4, fill)]);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 1)]);
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4, 9), Buffer.from('WEBP'), Buffer.alloc(200, 2)]);
  const NOBODY = '00000000-0000-4000-8000-000000000000';

  let resto, cake, platter;
  before(async () => {
    resto = await h.restaurant({ name: 'Photo Kitchen', menu: [['Spiderman Cake', 650], ['Meat Platter', 700]] });
    [cake, platter] = resto.items;
  });

  const put = (path, data, type = 'image/jpeg', opts = ADMIN) => api('PUT', path, { ...opts, raw: { type, data } });
  const publicMenu = async () => (await api('GET', `/api/restaurants/${resto.id}`)).data.restaurant.menu;

  it('only the owner can add or remove a photo', async () => {
    for (const path of [`/api/admin/menu/${cake.id}/image`, `/api/admin/menu/${cake.id}/image/thumb`, `/api/admin/restaurants/${resto.id}/image`, `/api/admin/restaurants/${resto.id}/image/thumb`]) {
      assert.equal((await put(path, jpeg(), 'image/jpeg', {})).status, 401, path);
      assert.equal((await put(path, jpeg(), 'image/jpeg', { token: resto.token })).status, 401, path);
      assert.equal((await put(path, jpeg(), 'image/jpeg', { admin: 'wrong-key' })).status, 401, path);
    }
    assert.equal((await api('DELETE', `/api/admin/menu/${cake.id}/image`)).status, 401);
    assert.equal((await api('DELETE', `/api/admin/restaurants/${resto.id}/image`, { token: resto.token })).status, 401);
    assert.equal((await publicMenu()).find((d) => d.id === cake.id).imageUrl, null);
  });

  it('a dish photo shows on the menu, and anyone can load it', async () => {
    const photo = jpeg(3000);
    const up = await put(`/api/admin/menu/${cake.id}/image`, photo);
    assert.equal(up.status, 200);
    assert.match(up.data.imageUrl, /^\/api\/images\/[0-9a-f-]{36}$/);
    assert.equal(up.data.thumbUrl, `${up.data.imageUrl}/thumb`);

    const onMenu = (await publicMenu()).find((d) => d.id === cake.id);
    assert.equal(onMenu.imageUrl, up.data.imageUrl);
    assert.equal(onMenu.thumbUrl, up.data.thumbUrl);
    assert.equal((await publicMenu()).find((d) => d.id === platter.id).imageUrl, null);

    const got = await api('GET', up.data.imageUrl);
    assert.equal(got.status, 200);
    assert.equal(got.headers.get('content-type'), 'image/jpeg');
    assert.match(got.headers.get('cache-control'), /immutable/);
    assert.ok(got.data.equals(photo), 'the picture comes back exactly as it was sent');

    // The owner's list and the restaurant's own portal show it too.
    const admin = (await api('GET', `/api/admin/restaurants/${resto.id}/menu`, ADMIN)).data.menu;
    assert.equal(admin.find((d) => d.id === cake.id).imageUrl, up.data.imageUrl);
    const portal = (await api('GET', '/api/portal/menu', { token: resto.token })).data.menu;
    assert.equal(portal.find((d) => d.id === cake.id).thumbUrl, up.data.thumbUrl);
    const list = (await api('GET', '/api/admin/restaurants', ADMIN)).data.restaurants.find((r) => r.id === resto.id);
    assert.equal(list.photoCount, 1);
    assert.equal(list.menuCount, 2);
  });

  it('the small copy for menu lists is served once it is sent, and the full photo until then', async () => {
    const { thumbUrl } = (await publicMenu()).find((d) => d.id === cake.id);
    const before = await api('GET', thumbUrl);
    assert.equal(before.status, 200);
    assert.equal(before.data.length, 3000, 'no small copy yet: the full photo stands in');
    assert.doesNotMatch(before.headers.get('cache-control'), /immutable/, 'and browsers are told not to keep the stand-in');

    const small = jpeg(500, 3);
    const up = await put(`/api/admin/menu/${cake.id}/image/thumb`, small);
    assert.equal(up.status, 200);
    assert.equal(up.data.thumbUrl, thumbUrl, 'adding the small copy does not move the photo');
    const after = await api('GET', thumbUrl);
    assert.ok(after.data.equals(small));
    assert.match(after.headers.get('cache-control'), /immutable/);
    assert.equal((await api('GET', thumbUrl.replace('/thumb', ''))).data.length, 3000, 'the full photo is untouched');

    assert.equal((await put(`/api/admin/menu/${platter.id}/image/thumb`, small)).status, 404, 'no photo to add a small copy to');
    assert.equal((await put(`/api/admin/menu/${cake.id}/image/thumb`, jpeg(121 * 1024))).status, 413);
    assert.ok((await api('GET', thumbUrl)).data.equals(small), 'a refused small copy leaves the one already there');
  });

  it('PNG and WebP pictures are accepted, and each kind is served as what it is', async () => {
    for (const [data, type] of [[png, 'image/png'], [webp, 'image/webp']]) {
      const up = await put(`/api/admin/menu/${platter.id}/image`, data, type);
      assert.equal(up.status, 200, type);
      assert.equal((await api('GET', up.data.imageUrl)).headers.get('content-type'), type);
    }
    // What the file is decides, not what the sender calls it.
    const mislabelled = await put(`/api/admin/menu/${platter.id}/image`, png, 'image/jpeg');
    assert.equal((await api('GET', mislabelled.data.imageUrl)).headers.get('content-type'), 'image/png');
  });

  it('anything that is not a picture is refused', async () => {
    const path = `/api/admin/menu/${platter.id}/image`;
    const before = (await publicMenu()).find((d) => d.id === platter.id).imageUrl;
    assert.equal((await put(path, Buffer.from('<script>alert(1)</script> this is not a photo'))).status, 400);
    assert.equal((await put(path, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'image/svg+xml')).status, 400);
    assert.equal((await api('PUT', path, { ...ADMIN, body: { image: 'abc' } })).status, 400);
    assert.equal((await api('PUT', path, ADMIN)).status, 400);
    assert.equal((await put(path, jpeg(700 * 1024))).status, 413, 'a photo that was not made menu-sized first');
    assert.equal((await put(`/api/admin/menu/${NOBODY}/image`, jpeg())).status, 404);
    assert.equal((await put('/api/admin/menu/not-an-id/image', jpeg())).status, 404);
    assert.equal((await put(`/api/admin/restaurants/${NOBODY}/image`, jpeg())).status, 404);
    assert.equal((await publicMenu()).find((d) => d.id === platter.id).imageUrl, before, 'the photo it had is still there');
    assert.equal((await api('GET', '/api/images/not-an-id')).status, 404);
    assert.equal((await api('GET', `/api/images/${NOBODY}`)).status, 404);
    assert.equal((await api('GET', `/api/images/${NOBODY}/thumb`)).status, 404);
  });

  it('a new photo replaces the old one at a new address, so nobody is shown a stale picture', async () => {
    const old = (await publicMenu()).find((d) => d.id === cake.id).imageUrl;
    const up = await put(`/api/admin/menu/${cake.id}/image`, jpeg(1500, 5));
    assert.notEqual(up.data.imageUrl, old);
    assert.equal((await api('GET', old)).status, 404);
    assert.equal((await api('GET', up.data.imageUrl)).data.length, 1500);
    // The old small copy went with the old photo.
    assert.equal((await api('GET', up.data.thumbUrl)).data.length, 1500);
  });

  it('a photo can be taken off, and goes when its dish goes', async () => {
    const dish = async (id) => (await publicMenu()).find((d) => d.id === id);
    const cakeUrl = (await dish(cake.id)).imageUrl;
    assert.equal((await api('DELETE', `/api/admin/menu/${cake.id}/image`, ADMIN)).status, 204);
    assert.equal((await dish(cake.id)).imageUrl, null);
    assert.equal((await dish(cake.id)).thumbUrl, null);
    assert.equal((await api('GET', cakeUrl)).status, 404);
    assert.equal((await api('DELETE', `/api/admin/menu/${cake.id}/image`, ADMIN)).status, 204, 'removing nothing is not an error');

    const platterUrl = (await dish(platter.id)).imageUrl;
    assert.equal((await api('DELETE', `/api/admin/menu/${platter.id}`, ADMIN)).status, 204);
    assert.equal((await api('GET', platterUrl)).status, 404);
  });

  it('a restaurant has a cover photo for its card and the top of its menu', async () => {
    const card = async () => (await api('GET', '/api/restaurants')).data.restaurants.find((r) => r.id === resto.id);
    assert.equal((await card()).imageUrl, null);
    const up = await put(`/api/admin/restaurants/${resto.id}/image`, jpeg(4000));
    assert.equal(up.status, 200);
    assert.equal((await card()).imageUrl, up.data.imageUrl);
    assert.equal((await api('GET', `/api/restaurants/${resto.id}`)).data.restaurant.imageUrl, up.data.imageUrl);
    assert.equal((await api('GET', '/api/admin/restaurants', ADMIN)).data.restaurants.find((r) => r.id === resto.id).imageUrl, up.data.imageUrl);
    assert.equal((await api('GET', up.data.imageUrl)).data.length, 4000);
    // A card-sized copy for the home page list, the same way as for a dish.
    assert.equal((await card()).thumbUrl, `${up.data.imageUrl}/thumb`);
    assert.equal((await put(`/api/admin/restaurants/${resto.id}/image/thumb`, jpeg(900, 2))).status, 200);
    assert.equal((await api('GET', (await card()).thumbUrl)).data.length, 900);
    // It is the restaurant's picture, not a dish's.
    assert.equal((await publicMenu()).find((d) => d.id === cake.id).imageUrl, null);
    assert.equal((await api('DELETE', `/api/admin/restaurants/${resto.id}/image`, ADMIN)).status, 204);
    assert.equal((await card()).imageUrl, null);
    assert.equal((await card()).thumbUrl, null);
    assert.equal((await put(`/api/admin/restaurants/${resto.id}/image/thumb`, jpeg(900))).status, 404, 'no cover photo to add a small copy to');
  });

  it('two photos sent for one dish at the same moment leave exactly one, and no error', async () => {
    const results = await Promise.all([1, 2, 3, 4].map((n) => put(`/api/admin/menu/${cake.id}/image`, jpeg(1000 + n, n))));
    assert.deepEqual(results.map((r) => r.status), [200, 200, 200, 200]);
    const { rows } = await h.db().query('SELECT COUNT(*)::int AS n FROM images WHERE menu_item_id = $1', [cake.id]);
    assert.equal(rows[0].n, 1);
    const shown = (await publicMenu()).find((d) => d.id === cake.id).imageUrl;
    assert.equal((await api('GET', shown)).status, 200);
  });
});

describe('menu sections and search', () => {
  let resto, other, hidden;
  const add = (id, items) => api('POST', `/api/admin/restaurants/${id}/menu`, { ...ADMIN, body: { items } });
  // Other blocks in this file have restaurants of their own; these tests are
  // about the three made here.
  const MINE = ['Section Bakery', 'Corner Grill', 'Suspended Bakery'];
  const names = (r) => r.data.restaurants.map((x) => x.name).filter((n) => MINE.includes(n));
  const search = (q) => api('GET', `/api/restaurants?q=${encodeURIComponent(q)}`);

  before(async () => {
    resto = await h.restaurant({ name: 'Section Bakery', menu: [] });
    other = await h.restaurant({ name: 'Corner Grill', menu: [] });
    hidden = await h.restaurant({ name: 'Suspended Bakery', menu: [] });
    await add(other.id, [{ name: 'Rump steak', price: 180, description: 'With pap and chakalaka' }, { name: '100% beef burger', price: 75 }]);
    await add(hidden.id, [{ name: 'Lemon cake', price: 300 }]);
    await api('POST', `/api/admin/restaurants/${hidden.id}/suspend`, ADMIN);
  });

  it('dishes are filed under sections, and the menu arrives in section order', async () => {
    const r = await add(resto.id, [
      { name: 'Garlic roll', price: 15 },
      { name: 'Spiderman Cake', price: 650, category: ' Cakes ' },
      { name: 'Meat Platter', price: 700, category: 'Platters' },
      { name: 'Frozen Cake', price: 650, category: 'Cakes' },
    ]);
    assert.equal(r.status, 201);
    const menu = (await api('GET', `/api/restaurants/${resto.id}`)).data.restaurant.menu;
    assert.deepEqual(menu.map((d) => [d.category, d.name]), [
      ['Cakes', 'Frozen Cake'], ['Cakes', 'Spiderman Cake'], ['Platters', 'Meat Platter'], [null, 'Garlic roll'],
    ]);
    assert.equal((await add(resto.id, [{ name: 'Tart', price: 20, category: 'x'.repeat(41) }])).status, 400);
  });

  it('a dish can be moved to another section or taken out of its section', async () => {
    const menu = (await api('GET', `/api/admin/restaurants/${resto.id}/menu`, ADMIN)).data.menu;
    const roll = menu.find((d) => d.name === 'Garlic roll');
    const patch = (body) => api('PATCH', `/api/admin/menu/${roll.id}`, { ...ADMIN, body });
    assert.equal((await patch({ category: 'Sides' })).data.item.category, 'Sides');
    assert.equal((await patch({ price: 18 })).data.item.category, 'Sides', 'changing the price leaves the section alone');
    assert.equal((await patch({ category: '' })).data.item.category, null);
    assert.equal((await patch({ category: 'y'.repeat(41) })).status, 400);
    // One spelling per section: a dish joins "Cakes" however it is typed.
    assert.equal((await patch({ category: 'cakes' })).data.item.category, 'Cakes');
    assert.equal((await patch({ category: 'SIDES' })).data.item.category, 'SIDES', 'a new section is spelt as typed');
    assert.equal((await patch({ category: 'Sides' })).data.item.category, 'Sides', 'and its only dish can respell it');
    await patch({ category: '' });
  });

  it('pasting a menu again with section headings files the dishes already there, and changes nothing else', async () => {
    const plain = await h.restaurant({ name: 'Plain List Kitchen', menu: [] });
    await add(plain.id, [{ name: 'Wors roll', price: 35, description: 'With chakalaka' }, { name: 'Pap', price: 15 }]);
    const again = await add(plain.id, [
      { name: 'wors roll', price: 99, category: 'Braai' },
      { name: 'Pap', price: 15, category: 'Sides' },
      { name: 'Chop', price: 60, category: 'braai' },
    ]);
    assert.equal(again.status, 201);
    assert.deepEqual(again.data.added.map((d) => [d.name, d.category]), [['Chop', 'Braai']]);
    assert.deepEqual(again.data.skipped, ['wors roll', 'Pap']);
    assert.deepEqual(again.data.moved, ['wors roll', 'Pap']);
    const menu = (await api('GET', `/api/admin/restaurants/${plain.id}/menu`, ADMIN)).data.menu;
    assert.deepEqual(menu.map((d) => [d.category, d.name, d.price, d.description]), [
      ['Braai', 'Chop', 60, ''], ['Braai', 'Wors roll', 35, 'With chakalaka'], ['Sides', 'Pap', 15, ''],
    ]);
    // A third paste has nothing left to do.
    const third = await add(plain.id, [{ name: 'Pap', price: 15, category: 'Sides' }, { name: 'Chop', price: 60 }]);
    assert.deepEqual([third.data.added.length, third.data.moved], [0, []]);
  });

  it('search finds restaurants by name, by kind of food and by what is on the menu', async () => {
    assert.deepEqual(names(await search('section')), ['Section Bakery']);
    assert.deepEqual(names(await search('TEST FOOD')), ['Corner Grill', 'Section Bakery']);

    const cake = await search('cake');
    assert.deepEqual(names(cake), ['Section Bakery'], 'a suspended restaurant is never found');
    const bakery = cake.data.restaurants.find((x) => x.name === 'Section Bakery');
    assert.deepEqual(bakery.matches, ['Frozen Cake', 'Spiderman Cake']);

    // By section name, and by a word in a dish's description.
    assert.deepEqual((await search('platters')).data.restaurants.find((x) => x.name === 'Section Bakery').matches, ['Meat Platter']);
    assert.deepEqual(names(await search('chakalaka')), ['Corner Grill']);
    assert.deepEqual(names(await search('  steak  ')), ['Corner Grill']);
    assert.deepEqual(names(await search('sushi')), []);
    // A found restaurant is the same card as on the home page.
    assert.equal(bakery.rating, null);
    assert.equal(bakery.deliveryFee, 30);
  });

  it('sold-out dishes are not found, and the customer\'s words are taken literally', async () => {
    const menu = (await api('GET', `/api/admin/restaurants/${other.id}/menu`, ADMIN)).data.menu;
    const steak = menu.find((d) => d.name === 'Rump steak');
    await api('PATCH', `/api/admin/menu/${steak.id}`, { ...ADMIN, body: { available: false } });
    assert.deepEqual(names(await search('steak')), []);
    await api('PATCH', `/api/admin/menu/${steak.id}`, { ...ADMIN, body: { available: true } });

    assert.deepEqual(names(await search('100%')), ['Corner Grill']);
    assert.deepEqual(names(await search('%')), ['Corner Grill'], 'a percent sign matches a percent sign, not everything');
    assert.equal((await search('_')).data.restaurants.length, 0, 'an underscore matches an underscore, not any letter');
    assert.equal((await search("'; DROP TABLE restaurants; --")).data.restaurants.length, 0);
    assert.deepEqual(names(await search('')), ['Corner Grill', 'Section Bakery'], 'an empty search is the whole list');
  });
});

describe('star ratings', () => {
  let resto, drv, custs, orders;
  const card = async () => (await api('GET', '/api/restaurants')).data.restaurants.find((r) => r.id === resto.id);
  const rate = (order, cust, rating) => api('POST', `/api/orders/${order.id}/rating`, { token: cust.token, body: { rating } });

  before(async () => {
    resto = await h.restaurant({ name: 'Rated Kitchen' });
    drv = await h.driver();
    custs = [await h.customer(), await h.customer(), await h.customer()];
    orders = [];
    for (const c of custs) orders.push(await h.deliver(c, resto, drv, [[resto.items[0], 1]]));
  });

  it('a restaurant nobody has rated says so, instead of showing a made-up score', async () => {
    const r = await card();
    assert.equal(r.rating, null);
    assert.equal(r.ratingCount, 0);
    assert.equal((await api('GET', `/api/restaurants/${resto.id}`)).data.restaurant.rating, null);
  });

  it('only the customer whose order was delivered can rate it', async () => {
    assert.equal((await api('POST', `/api/orders/${orders[0].id}/rating`, { body: { rating: 5 } })).status, 401);
    assert.equal((await rate(orders[0], custs[1], 5)).status, 400, "someone else's order");
    assert.equal((await api('POST', `/api/orders/${orders[0].id}/rating`, { token: resto.token, body: { rating: 5 } })).status, 403, 'a restaurant cannot rate itself');

    const waiting = (await h.placeOrder(custs[0], resto, [[resto.items[0], 1]])).data.order;
    assert.equal((await rate(waiting, custs[0], 5)).status, 400, 'not paid for');
    await h.pay(waiting);
    assert.equal((await rate(waiting, custs[0], 5)).status, 400, 'paid but not delivered');
    assert.equal((await rate({ id: 'not-an-id' }, custs[0], 5)).status, 404);

    for (const bad of [0, 6, 4.5, -1, '5 stars', '5', true, [4], null, undefined]) {
      assert.equal((await rate(orders[0], custs[0], bad)).status, 400, String(bad));
    }
  });

  it('a rating is saved on the order, and the stars only appear once three customers have rated', async () => {
    assert.equal((await rate(orders[0], custs[0], 5)).status, 200);
    const mine = (await api('GET', `/api/orders/${orders[0].id}`, { token: custs[0].token })).data.order;
    assert.equal(mine.rating, 5);
    assert.equal((await api('GET', `/api/orders/${orders[0].id}/tracking`, { token: custs[0].token })).data.tracking.rating, 5);
    assert.equal((await api('GET', '/api/orders', { token: custs[0].token })).data.orders.find((o) => o.id === orders[0].id).rating, 5);

    await rate(orders[1], custs[1], 4);
    assert.equal((await card()).rating, null, 'two ratings are too few to call');

    await rate(orders[2], custs[2], 4);
    const r = await card();
    assert.equal(r.rating, 4.3);
    assert.equal(r.ratingCount, 3);
    assert.equal((await api('GET', `/api/restaurants/${resto.id}`)).data.restaurant.rating, 4.3);
  });

  it('a customer can change their mind, and it is still one rating', async () => {
    assert.equal((await rate(orders[2], custs[2], 1)).data.rating, 1);
    const r = await card();
    assert.equal(r.rating, 3.3);
    assert.equal(r.ratingCount, 3);
  });

  it('one restaurant\'s ratings never count towards another\'s', async () => {
    const quiet = await h.restaurant({ name: 'Unrated Kitchen' });
    const list = (await api('GET', '/api/restaurants')).data.restaurants;
    assert.equal(list.find((x) => x.id === quiet.id).rating, null);
  });
});

describe("the admin page's pasted price list reader", () => {
  // The reader lives in the admin page itself (no build step), so it is lifted
  // out of the page's script and run here exactly as the browser runs it.
  const fs = require('fs');
  const path = require('path');
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'portal', 'admin.html'), 'utf8');
  const start = page.indexOf('function parseDishes(text) {');
  const end = page.indexOf('// --- photos ---');
  // eslint-disable-next-line no-new-func
  const parseDishes = new Function(`${page.slice(start, end)}; return parseDishes;`)();
  const read = (text) => parseDishes(text).dishes.map((d) => [d.name, d.description, d.price]);

  it('reads a name and a price', () => {
    assert.ok(start > 0 && end > start, 'the reader is still where this test expects it');
    assert.deepEqual(read('Kota 45'), [['Kota', '', 45]]);
    assert.deepEqual(read('Large chips R30'), [['Large chips', '', 30]]);
    assert.deepEqual(read('Kota: 25,50'), [['Kota', '', 25.5]]);
    assert.deepEqual(read('Wings - R 60.00'), [['Wings', '', 60]]);
  });

  it('never clips a name that ends in r', () => {
    // "Platter 850" was once read as "Platte" with the r taken for the rand sign.
    assert.deepEqual(read('Large Meat Platter 850\nFruit Platter R600\nBurger 55\nWors Roll, R35\nBeer batter 40'), [
      ['Large Meat Platter', '', 850], ['Fruit Platter', '', 600], ['Burger', '', 55], ['Wors Roll', '', 35], ['Beer batter', '', 40],
    ]);
  });

  it('keeps numbers that belong to the name', () => {
    assert.deepEqual(read('2 Piece chicken 45\n7 Colours plate 95\nSpiderman Cake (design 2) 650\nCoke 2L 28'), [
      ['2 Piece chicken', '', 45], ['7 Colours plate', '', 95], ['Spiderman Cake (design 2)', '', 650], ['Coke 2L', '', 28],
    ]);
  });

  it('splits off a description, and skips blank lines', () => {
    assert.deepEqual(read('Full House Kota - polony, russian, egg, cheese, chips - 45\n\n  \nFamily platter – wings, ribs – R320.50'), [
      ['Full House Kota', 'polony, russian, egg, cheese, chips', 45], ['Family platter', 'wings, ribs', 320.5],
    ]);
  });

  it('a line ending in a colon puts the dishes under it in that section', () => {
    const got = parseDishes('Garlic roll 15\nKotas:\nFull House Kota - polony, egg - 45\n\nPlatters & Cakes :\nFruit Platter R600').dishes;
    assert.deepEqual(got.map((d) => [d.name, d.category, d.price]), [
      ['Garlic roll', undefined, 15], ['Full House Kota', 'Kotas', 45], ['Fruit Platter', 'Platters & Cakes', 600],
    ]);
    assert.equal(got[1].description, 'polony, egg');
    // A price after a colon is still a price, not a heading.
    assert.deepEqual(read('Kota: 45'), [['Kota', '', 45]]);
    assert.match(parseDishes('Kotas:').error, /at least one dish/);
  });

  it('names the line it cannot read instead of guessing', () => {
    assert.match(parseDishes('Kota 45\nJust a name').error, /Line 2/);
    assert.match(parseDishes('45').error, /Line 1/);
    assert.match(parseDishes('Wings 6 pc').error, /Line 1/);
    assert.match(parseDishes('  \n ').error, /at least one dish/);
  });
});

describe('chatting with the kitchen', () => {
  let cust, resto, order, convo;
  before(async () => {
    cust = await h.customer('Naledi Chat');
    resto = await h.restaurant({ name: 'Chat Kitchen', deliveryFee: 25 });
    order = (await h.placeOrder(cust, resto, [[resto.items[0], 1]])).data.order;
    await h.pay(order);
  });

  const send = (text) => api('POST', `/api/chat/conversations/${convo.id}/messages`, { token: cust.token, body: { body: text } });

  it('opening a thread about an order greets the customer and points the thread at the order', async () => {
    const r = await api('POST', '/api/chat/conversations', { token: cust.token, body: { orderId: order.id } });
    assert.equal(r.status, 201);
    convo = r.data.conversation;
    assert.equal(convo.restaurantId, resto.id);
    assert.equal(convo.orderId, order.id);
    assert.equal(convo.title, 'Chat Kitchen');
    const msgs = (await api('GET', `/api/chat/conversations/${convo.id}/messages`, { token: cust.token })).data.messages;
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].sender, 'bot');
    assert.ok(msgs[0].quickReplies.includes('Where is my order?'));
    // Opening it again finds the same thread rather than a second one.
    const again = await api('POST', '/api/chat/conversations', { token: cust.token, body: { restaurantId: resto.id } });
    assert.equal(again.status, 200);
    assert.equal(again.data.conversation.id, convo.id);
  });

  it('the bot answers the plain questions from what it knows', async () => {
    let r = await send('Where is my order?');
    assert.equal(r.status, 201);
    assert.equal(r.data.message.sender, 'customer');
    assert.equal(r.data.reply.sender, 'bot');
    assert.match(r.data.reply.body, /waiting for the kitchen to accept/);

    await api('POST', `/api/portal/orders/${order.id}/accept`, { token: resto.token });
    r = await send('how long will my food take');
    assert.match(r.data.reply.body, /accepted your order/);

    r = await send('are you open?');
    assert.match(r.data.reply.body, /open and taking orders/);

    r = await send('how much is delivery');
    assert.match(r.data.reply.body, /R25/);

    r = await send(`do you have ${resto.items[0].name.split(' ')[0]}`);
    assert.match(r.data.reply.body, new RegExp(resto.items[0].name));
  });

  it('asking for a person flags the thread for the kitchen, who replies and clears it', async () => {
    const r = await send('I want to talk to the owner please');
    assert.match(r.data.reply.body, /A person will reply/);

    const list = (await api('GET', '/api/portal/chats', { token: resto.token })).data.conversations;
    const mine = list.find((c) => c.id === convo.id);
    assert.ok(mine, 'the kitchen sees the thread');
    assert.equal(mine.needsHuman, true);
    assert.ok(mine.unread >= 1);
    assert.equal(mine.customerName, 'Naledi Chat');
    const unread = (await api('GET', '/api/portal/chats/unread', { token: resto.token })).data;
    assert.ok(unread.unread >= 1 && unread.needsHuman >= 1);

    // Reading clears the unread count; replying clears the flag and reaches the customer.
    await api('GET', `/api/portal/chats/${convo.id}/messages`, { token: resto.token });
    const reply = await api('POST', `/api/portal/chats/${convo.id}/messages`, { token: resto.token, body: { body: 'Hi Naledi, Thabo here, your order is on the grill now.' } });
    assert.equal(reply.status, 201);
    const after = (await api('GET', '/api/portal/chats', { token: resto.token })).data.conversations.find((c) => c.id === convo.id);
    assert.equal(after.needsHuman, false);
    assert.equal(after.unread, 0);

    const forCustomer = (await api('GET', '/api/chat/conversations', { token: cust.token })).data.conversations[0];
    assert.equal(forCustomer.unread, 1);
    assert.equal(forCustomer.lastSender, 'restaurant');
    const msgs = (await api('GET', `/api/chat/conversations/${convo.id}/messages`, { token: cust.token })).data.messages;
    assert.equal(msgs[msgs.length - 1].body, 'Hi Naledi, Thabo here, your order is on the grill now.');

    // With a person active, the bot stays out of a free-text follow-up.
    const quiet = await send('ok thanks Thabo, please no onions');
    assert.equal(quiet.data.reply, null);
  });

  it('threads are private to their customer and kitchen', async () => {
    const other = await h.customer('Nosy Neighbour');
    assert.equal((await api('GET', `/api/chat/conversations/${convo.id}/messages`, { token: other.token })).status, 404);
    const rival = await h.restaurant({ name: 'Rival Kitchen' });
    assert.equal((await api('GET', `/api/portal/chats/${convo.id}/messages`, { token: rival.token })).status, 404);
    assert.equal((await api('POST', `/api/portal/chats/${convo.id}/messages`, { token: rival.token, body: { body: 'hi' } })).status, 404);
  });

  it('MidFood support is a thread of its own, answered from the admin page', async () => {
    const r = await api('POST', '/api/chat/conversations', { token: cust.token, body: {} });
    assert.equal(r.status, 201);
    const support = r.data.conversation;
    assert.equal(support.restaurantId, null);
    assert.equal(support.title, 'MidFood support');
    const asked = await api('POST', `/api/chat/conversations/${support.id}/messages`, { token: cust.token, body: { body: 'I was charged twice' } });
    assert.match(asked.data.reply.body, /Refunds/);
    const threads = (await api('GET', '/api/admin/chats', ADMIN)).data.conversations;
    assert.ok(threads.some((c) => c.id === support.id && c.needsHuman));
    const reply = await api('POST', `/api/admin/chats/${support.id}/messages`, { ...ADMIN, body: { body: 'Checking now, Naledi.' } });
    assert.equal(reply.status, 201);
    const msgs = (await api('GET', `/api/chat/conversations/${support.id}/messages`, { token: cust.token })).data.messages;
    assert.equal(msgs[msgs.length - 1].sender, 'admin');
  });
});

describe('home-screen categories', () => {
  it('stores are grouped by what they sell, and the admin can override it', async () => {
    const resto = await h.restaurant({ name: 'Highveld Pharmacy', cuisine: 'Pharmacy · Chemist', menu: [['Paracetamol 500mg', 35], ['Vitamin C', 60]] });
    const list = (await api('GET', '/api/restaurants')).data.restaurants;
    const mine = list.find((r) => r.id === resto.id);
    assert.deepEqual(mine.categories, ['pharmacy']);
    const tiles = (await api('GET', '/api/restaurants/categories')).data.categories;
    const tile = tiles.find((c) => c.key === 'pharmacy');
    assert.ok(tile && tile.count >= 1 && tile.icon === 'pill');

    const bad = await api('PATCH', `/api/admin/restaurants/${resto.id}`, { ...ADMIN, body: { categories: ['rockets'] } });
    assert.equal(bad.status, 400);
    const ok = await api('PATCH', `/api/admin/restaurants/${resto.id}`, { ...ADMIN, body: { categories: ['pharmacy', 'groceries'] } });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.data.restaurant.categories, ['pharmacy', 'groceries']);
    const after = (await api('GET', '/api/restaurants')).data.restaurants.find((r) => r.id === resto.id);
    assert.deepEqual(after.categories, ['pharmacy', 'groceries']);
  });
});

describe('signing in with Google or Facebook', () => {
  const social = require('../src/routes/socialAuth');
  const realHttp = social.http;
  // What the provider will say when asked. Set per test.
  let provider = {};
  let calls = [];
  before(() => {
    process.env.GOOGLE_CLIENT_ID = 'google-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'google-client-secret';
    process.env.FACEBOOK_APP_ID = 'fb-app-id';
    process.env.FACEBOOK_APP_SECRET = 'fb-app-secret';
    process.env.PUBLIC_URL = 'https://midfood.co.za';
    social.http = async (method, url, opts) => {
      calls.push({ method, url, opts });
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        if (opts.form.code !== 'good-code') throw new Error('Sign-in provider answered invalid_grant');
        return { access_token: 'g-access' };
      }
      if (url.startsWith('https://openidconnect.googleapis.com/v1/userinfo')) {
        assert.equal(opts.headers.Authorization, 'Bearer g-access');
        return provider.google;
      }
      if (url.startsWith('https://graph.facebook.com/v19.0/oauth/access_token')) return { access_token: 'fb-access' };
      if (url.startsWith('https://graph.facebook.com/v19.0/me')) return provider.facebook;
      throw new Error(`unexpected call ${url}`);
    };
  });
  after(() => {
    social.http = realHttp;
    delete process.env.FACEBOOK_APP_ID;
    delete process.env.FACEBOOK_APP_SECRET;
  });

  const stateFrom = (location) => new URL(location).searchParams.get('state');
  const landed = (location) => {
    // midfood://auth?token=... or https://midfood.co.za/order/#social=token%3D...
    if (location.startsWith('midfood://auth?')) return Object.fromEntries(new URLSearchParams(location.slice('midfood://auth?'.length)));
    const hash = new URL(location).hash;
    assert.ok(hash.startsWith('#social='), location);
    return Object.fromEntries(new URLSearchParams(decodeURIComponent(hash.slice('#social='.length))));
  };

  it('says which providers are switched on', async () => {
    const r = await api('GET', '/api/auth/providers');
    assert.equal(r.status, 200);
    assert.deepEqual(r.data, { google: true, facebook: true });
  });

  it('the app is sent to Google with a signed state and comes back signed in, with the account created', async () => {
    const start = await api('GET', '/api/auth/google/start?platform=app');
    assert.equal(start.status, 302);
    const to = new URL(start.headers.get('location'));
    assert.equal(to.origin + to.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.equal(to.searchParams.get('client_id'), 'google-client-id');
    assert.equal(to.searchParams.get('redirect_uri'), 'https://midfood.co.za/api/auth/google/callback');
    assert.ok(to.searchParams.get('scope').includes('email'));
    assert.equal(start.headers.get('set-cookie'), null, 'the app flow needs no cookie');

    const email = `${h.unique('goog')}@gmail.com`;
    provider.google = { sub: 'g-' + email, email, email_verified: true, name: 'Thabo Google', picture: 'https://lh3.example/p.jpg' };
    calls = [];
    const back = await api('GET', `/api/auth/google/callback?code=good-code&state=${stateFrom(start.headers.get('location'))}`);
    assert.equal(back.status, 302);
    const result = landed(back.headers.get('location'));
    assert.ok(back.headers.get('location').startsWith('midfood://auth?'), back.headers.get('location'));
    assert.ok(result.token);
    assert.equal(result.provider, 'google');
    // The secret went to Google, not into the app.
    assert.equal(calls[0].opts.form.client_secret, 'google-client-secret');
    assert.equal(calls[0].opts.form.redirect_uri, 'https://midfood.co.za/api/auth/google/callback');

    const me = await api('GET', '/api/auth/me', { token: result.token });
    assert.equal(me.status, 200);
    assert.equal(me.data.user.email, email);
    assert.equal(me.data.user.name, 'Thabo Google');
    assert.equal(me.data.user.hasPassword, false);
    assert.deepEqual(me.data.user.linked, { google: true, facebook: false });

    // Signing in again with the same Google account lands on the same MidFood account.
    const again = await api('GET', '/api/auth/google/start?platform=app');
    const back2 = await api('GET', `/api/auth/google/callback?code=good-code&state=${stateFrom(again.headers.get('location'))}`);
    const me2 = await api('GET', '/api/auth/me', { token: landed(back2.headers.get('location')).token });
    assert.equal(me2.data.user.id, me.data.user.id);

    // A password login on that account explains itself instead of a flat "invalid".
    const pw = await api('POST', '/api/auth/login', { body: { identifier: email, password: 'whatever1' } });
    assert.equal(pw.status, 401);
    assert.match(pw.data.error, /signs in with Google/);

    // ...and it can set its first password without knowing a current one.
    const set = await api('PUT', '/api/auth/password', { token: result.token, body: { newPassword: 'chosen123' } });
    assert.equal(set.status, 200);
    assert.equal((await api('POST', '/api/auth/login', { body: { identifier: email, password: 'chosen123' } })).status, 200);
    assert.equal((await api('GET', '/api/auth/me', { token: result.token })).data.user.hasPassword, true);
    // From now on the current password is required again.
    assert.equal((await api('PUT', '/api/auth/password', { token: result.token, body: { newPassword: 'other123' } })).status, 400);
  });

  it('a Facebook sign-in with the email of an existing account links to that account', async () => {
    const existing = await h.customer('Palesa Existing');
    provider.facebook = { id: 'fb-' + existing.email, name: 'Palesa FB', email: existing.email.toUpperCase(), picture: { data: { url: 'https://fb.example/p.jpg' } } };
    const start = await api('GET', '/api/auth/facebook/start?platform=app');
    assert.ok(start.headers.get('location').startsWith('https://www.facebook.com/'));
    const back = await api('GET', `/api/auth/facebook/callback?code=good-code&state=${stateFrom(start.headers.get('location'))}`);
    const me = await api('GET', '/api/auth/me', { token: landed(back.headers.get('location')).token });
    assert.equal(me.data.user.id, existing.id);
    assert.equal(me.data.user.name, 'Palesa Existing', 'the MidFood name is kept');
    assert.equal(me.data.user.hasPassword, true);
    assert.deepEqual(me.data.user.linked, { google: false, facebook: true });
    // The password still works as before.
    assert.equal((await api('POST', '/api/auth/login', { body: { identifier: existing.email, password: 'secret123' } })).status, 200);
  });

  it('a provider that shares no email cannot create an account', async () => {
    provider.facebook = { id: 'fb-noemail', name: 'No Email' };
    const start = await api('GET', '/api/auth/facebook/start?platform=app');
    const back = await api('GET', `/api/auth/facebook/callback?code=good-code&state=${stateFrom(start.headers.get('location'))}`);
    const result = landed(back.headers.get('location'));
    assert.equal(result.token, undefined);
    assert.match(result.error, /did not share an email/);
  });

  it('the web flow sets a cookie and only finishes in the browser that started it', async () => {
    const start = await api('GET', '/api/auth/google/start?platform=web');
    const cookie = start.headers.get('set-cookie');
    assert.match(cookie, /^mf_oauth=[0-9a-f]{32}; Path=\/api\/auth; Max-Age=600; HttpOnly; SameSite=Lax; Secure$/);
    const state = stateFrom(start.headers.get('location'));
    provider.google = { sub: 'g-web', email: `${h.unique('web')}@gmail.com`, email_verified: true, name: 'Web Person' };

    // Without the cookie (another browser) the sign-in is refused.
    const stranger = await api('GET', `/api/auth/google/callback?code=good-code&state=${state}`);
    assert.equal(stranger.status, 302);
    assert.ok(stranger.headers.get('location').startsWith('https://midfood.co.za/order/#social='));
    assert.match(landed(stranger.headers.get('location')).error, /start the sign-in again/);

    // With it, the customer lands on the website signed in.
    const nonce = cookie.match(/^mf_oauth=([0-9a-f]+)/)[1];
    const res = await fetch(`http://localhost:${process.env.PORT}/api/auth/google/callback?code=good-code&state=${state}`, {
      redirect: 'manual',
      headers: { Cookie: `mf_oauth=${nonce}` },
    });
    assert.equal(res.status, 302);
    const result = landed(res.headers.get('location'));
    assert.ok(result.token);
    assert.equal((await api('GET', '/api/auth/me', { token: result.token })).data.user.name, 'Web Person');
  });

  it('a cancelled, expired or tampered sign-in comes back with a plain reason', async () => {
    const start = await api('GET', '/api/auth/google/start?platform=app');
    const state = stateFrom(start.headers.get('location'));
    const cancelled = landed((await api('GET', `/api/auth/google/callback?error=access_denied&state=${state}`)).headers.get('location'));
    assert.match(cancelled.error, /cancelled/);

    const forged = landed((await api('GET', '/api/auth/google/callback?code=good-code&state=not-a-real-state')).headers.get('location'));
    assert.match(forged.error, /expired/);

    // A Facebook state cannot be replayed against Google.
    const fb = stateFrom((await api('GET', '/api/auth/facebook/start?platform=app')).headers.get('location'));
    const crossed = landed((await api('GET', `/api/auth/google/callback?code=good-code&state=${fb}`)).headers.get('location'));
    assert.match(crossed.error, /expired/);

    // Google rejecting the code is reported, not crashed on.
    const rejected = landed((await api('GET', `/api/auth/google/callback?code=bad-code&state=${state}`)).headers.get('location'));
    assert.match(rejected.error, /Couldn't sign in with Google/);

    assert.equal((await api('GET', '/api/auth/twitter/start')).status, 404);
  });

  it('a provider without keys is not offered and sends the customer back with a reason', async () => {
    delete process.env.FACEBOOK_APP_ID;
    assert.deepEqual((await api('GET', '/api/auth/providers')).data, { google: true, facebook: false });
    const r = await api('GET', '/api/auth/facebook/start?platform=app');
    assert.match(landed(r.headers.get('location')).error, /not switched on yet/);
    process.env.FACEBOOK_APP_ID = 'fb-app-id';
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
