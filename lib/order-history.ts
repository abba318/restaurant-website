const ORDER_HISTORY_KEY = 'restaurant_order_history';
const MAX_SAVED_ORDERS = 50;

export function getSavedOrderIds(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const value: unknown = JSON.parse(localStorage.getItem(ORDER_HISTORY_KEY) || '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((id): id is string => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id));
  } catch { return []; }
}

export function rememberOrder(id: string): void {
  if (typeof window === 'undefined' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return;
  try {
    const ids = getSavedOrderIds().filter((saved) => saved !== id);
    localStorage.setItem(ORDER_HISTORY_KEY, JSON.stringify([id, ...ids].slice(0, MAX_SAVED_ORDERS)));
  } catch { /* Server-side order storage remains authoritative. */ }
}
