export const ORDER_STATUSES = ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled'] as const;
export type OrderStatus = typeof ORDER_STATUSES[number];

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === 'string' && (ORDER_STATUSES as readonly string[]).includes(value);
}

export function calculateOrderTotal(items: readonly { price_kobo: number; quantity: number }[], deliveryFeeKobo: number) {
  if (!Number.isSafeInteger(deliveryFeeKobo) || deliveryFeeKobo < 0) throw new RangeError('Invalid delivery fee');
  const subtotal = items.reduce((sum, item) => {
    if (!Number.isSafeInteger(item.price_kobo) || item.price_kobo < 0 || !Number.isSafeInteger(item.quantity) || item.quantity < 1) throw new RangeError('Invalid order item');
    return sum + item.price_kobo * item.quantity;
  }, 0);
  const total = subtotal + deliveryFeeKobo;
  if (!Number.isSafeInteger(total) || total > 2_147_483_647) throw new RangeError('Order total is outside the supported range');
  return total;
}
