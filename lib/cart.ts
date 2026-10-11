import { CartItem, MenuItem } from '@/types';

const CART_KEY = 'restaurant_cart';

export function getCart(): CartItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const data = localStorage.getItem(CART_KEY);
    if (!data) return [];
    const parsed: unknown = JSON.parse(data);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is CartItem =>
      item && Number.isInteger(item.id) && typeof item.name === 'string' &&
      Number.isInteger(item.price_kobo) && item.price_kobo >= 0 &&
      Number.isInteger(item.quantity) && item.quantity > 0 &&
      (item.specialRequest === undefined || (typeof item.specialRequest === 'string' && item.specialRequest.length <= 250))
    );
  } catch {
    return [];
  }
}

export function refreshCart(menu: MenuItem[]): { cart: CartItem[]; removed: number } {
  const current = getCart();
  const currentById = new Map(current.map((item) => [item.id, item]));
  const availableById = new Map(menu.filter((item) => item.available && (item.stock_quantity === null || item.stock_quantity === undefined || item.stock_quantity > 0)).map((item) => [item.id, item]));
  let removed = 0;
  const cart = current.flatMap((item) => {
    const latest = availableById.get(item.id);
    if (!latest) {
      removed += 1;
      return [];
    }
    const saved = currentById.get(item.id)!;
    const stockLimit = latest.stock_quantity ?? 99;
    return [{ ...latest, quantity: Math.max(1, Math.min(saved.quantity, stockLimit, 99)), specialRequest: saved.specialRequest || '' }];
  });
  saveCart(cart);
  return { cart, removed };
}

export function saveCart(cart: CartItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    window.dispatchEvent(new Event('cart_updated'));
  } catch (e) {
    console.error('Failed to save cart:', e);
  }
}

export function addToCart(item: MenuItem): CartItem[] {
  const current = getCart();
  const existingIndex = current.findIndex((i) => i.id === item.id);
  let updated: CartItem[];
  if (existingIndex > -1) {
    const stockLimit = item.stock_quantity ?? 99;
    updated = current.map((i, idx) =>
      idx === existingIndex ? { ...i, quantity: Math.min(i.quantity + 1, stockLimit, 99) } : i
    );
  } else {
    updated = [...current, { ...item, quantity: 1 }];
  }
  saveCart(updated);
  return updated;
}

export function updateSpecialRequest(id: number, specialRequest: string): CartItem[] {
  const request = specialRequest.slice(0, 250);
  const updated = getCart().map((item) => item.id === id ? { ...item, specialRequest: request } : item);
  saveCart(updated);
  return updated;
}

export function updateQuantity(id: number, quantity: number): CartItem[] {
  const current = getCart();
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return removeFromCart(id);
  }
  const updated = current.map((item) =>
    item.id === id ? { ...item, quantity: Math.min(quantity, 99) } : item
  );
  saveCart(updated);
  return updated;
}

export function removeFromCart(id: number): CartItem[] {
  const current = getCart();
  const updated = current.filter((item) => item.id !== id);
  saveCart(updated);
  return updated;
}

export function clearCart(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(CART_KEY);
    window.dispatchEvent(new Event('cart_updated'));
  } catch (e) {
    console.error('Failed to clear cart:', e);
  }
}
