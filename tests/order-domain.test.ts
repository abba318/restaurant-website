import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateOrderTotal, isOrderStatus } from '../lib/order-domain.ts';

test('order total combines immutable item prices and delivery fee', () => {
  assert.equal(calculateOrderTotal([{ price_kobo: 350000, quantity: 2 }, { price_kobo: 100000, quantity: 1 }], 25000), 825000);
});

test('invalid money and quantity values are rejected', () => {
  assert.throws(() => calculateOrderTotal([{ price_kobo: 100, quantity: 0 }], 0), RangeError);
  assert.throws(() => calculateOrderTotal([], -1), RangeError);
});

test('status validation accepts the fulfillment lifecycle and rejects arbitrary values', () => {
  for (const status of ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered']) assert.equal(isOrderStatus(status), true);
  assert.equal(isOrderStatus('admin'), false);
});
