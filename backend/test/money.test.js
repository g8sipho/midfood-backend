// The arithmetic behind every payout, tested on its own: rounding, the free
// period, and which commission rate applies. No database needed.
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://unused/unused_test';

const test = require('node:test');
const assert = require('node:assert/strict');
const money = require('../src/money');

const settings = { commissionRate: 0.15, deliveryCutRate: 0.2, freeMonths: 3 };
// A moment in Middelburg, written in South African time.
const sast = (iso) => new Date(`${iso}+02:00`);

test('money() rounds to cents, half away from zero', () => {
  assert.equal(money.money(1.005), 1.01);
  assert.equal(money.money(0.125), 0.13);
  assert.equal(money.money(26.999), 27);
  assert.equal(money.money(0.1 + 0.2), 0.3);
  assert.equal(money.money('45.50'), 45.5);
});

test('a percentage of an amount is exact to the cent, including exact halves', () => {
  assert.equal(money.share(33.3, 0.15), 5); // R4.995 -> R5.00 (plain floats give R4.99)
  assert.equal(money.share(89.9, 0.15), 13.49); // R13.485 -> R13.49
  assert.equal(money.share(45, 0.15), 6.75);
  assert.equal(money.share(30, 0.2), 6);
  assert.equal(money.share(25, 0.2), 5);
  assert.equal(money.share(22.5, 0.125), 2.81); // R2.8125
  assert.equal(money.share(199.99, 0), 0);
  assert.equal(money.share(199.99, 1), 199.99);
});

test('commission and payout always add back up to the food total', () => {
  for (const subtotal of [33.3, 89.9, 45, 0.05, 1234.56, 67.85, 19.99]) {
    for (const rate of [0, 0.1, 0.125, 0.15, 0.2]) {
      const commission = money.share(subtotal, rate);
      const payout = money.money(subtotal - commission);
      assert.equal(money.money(commission + payout), subtotal, `${subtotal} at ${rate}`);
    }
  }
});

test('a restaurant inside its free period pays nothing', () => {
  const r = { freeUntil: '2027-01-08', commissionRate: null };
  assert.equal(money.rateFor(r, settings, sast('2026-10-08T12:00:00')), 0);
});

test('the free period includes its last day, right up to midnight in Middelburg', () => {
  const r = { freeUntil: '2027-01-08', commissionRate: null };
  assert.equal(money.rateFor(r, settings, sast('2027-01-08T00:00:01')), 0);
  assert.equal(money.rateFor(r, settings, sast('2027-01-08T23:59:59')), 0);
  // One second into the 9th, commission starts.
  assert.equal(money.rateFor(r, settings, sast('2027-01-09T00:00:01')), 0.15);
});

test('the free period is judged on South African time, not the server clock (UTC)', () => {
  const r = { freeUntil: '2027-01-08', commissionRate: null };
  // 23:30 UTC on the 8th is already 01:30 on the 9th in Middelburg.
  assert.equal(money.rateFor(r, settings, new Date('2027-01-08T23:30:00Z')), 0.15);
  // 22:30 UTC on the 7th is 00:30 on the 8th in Middelburg: still free.
  assert.equal(money.rateFor(r, settings, new Date('2027-01-07T22:30:00Z')), 0);
});

test('free_until is read correctly whether Postgres returns text or a Date', () => {
  assert.equal(money.dateString('2027-01-08'), '2027-01-08');
  assert.equal(money.dateString(new Date(2027, 0, 8)), '2027-01-08');
  assert.equal(money.dateString(null), null);
  assert.equal(money.inFreePeriod(new Date(2027, 0, 8), sast('2027-01-08T15:00:00')), true);
});

test('no free period means the platform rate applies', () => {
  assert.equal(money.rateFor({ freeUntil: null, commissionRate: null }, settings), 0.15);
});

test("a restaurant's own rate beats the platform rate, but not its free period", () => {
  assert.equal(money.rateFor({ freeUntil: null, commissionRate: 0.1 }, settings), 0.1);
  assert.equal(money.rateFor({ freeUntil: null, commissionRate: 0 }, settings), 0);
  const free = { freeUntil: '2027-01-08', commissionRate: 0.1 };
  assert.equal(money.rateFor(free, settings, sast('2026-12-01T12:00:00')), 0);
  assert.equal(money.rateFor(free, settings, sast('2027-02-01T12:00:00')), 0.1);
});
