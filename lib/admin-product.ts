export type AdminProductInput = {
  name: string;
  description: string;
  priceKobo: number;
  categoryId: number | null;
  imageUrl: string;
  available: boolean;
  stockQuantity: number | null;
};

export function parseAdminProduct(value: unknown): { data?: AdminProductInput; error?: string } {
  if (!value || typeof value !== 'object') return { error: 'Enter valid product details.' };
  const input = value as Record<string, unknown>;
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  const imageUrl = typeof input.imageUrl === 'string' ? input.imageUrl.trim() : '';
  const price = typeof input.price === 'number' || typeof input.price === 'string' ? Number(input.price) : Number.NaN;
  const priceKobo = Math.round(price * 100);
  const categoryId = input.categoryId === '' || input.categoryId === null || input.categoryId === undefined
    ? null
    : Number(input.categoryId);
  const rawStock = input.stockQuantity;
  const stockQuantity = rawStock === undefined || rawStock === null || rawStock === '' ? null : Number(rawStock);

  if (!name || name.length > 120) return { error: 'Product name must be between 1 and 120 characters.' };
  if (description.length > 500) return { error: 'Description must be 500 characters or fewer.' };
  if (!Number.isFinite(price) || price <= 0 || !Number.isSafeInteger(priceKobo) || Math.abs(price * 100 - priceKobo) > 1e-7 || priceKobo > 2_147_483_647) {
    return { error: 'Enter a valid price with up to two decimal places.' };
  }
  if (categoryId !== null && (!Number.isSafeInteger(categoryId) || categoryId < 1)) return { error: 'Choose a valid category.' };
  if (input.available !== undefined && typeof input.available !== 'boolean') return { error: 'Availability must be true or false.' };
  if (stockQuantity !== null && (!Number.isSafeInteger(stockQuantity) || stockQuantity < 0 || stockQuantity > 1_000_000)) return { error: 'Stock must be a whole number from 0 to 1,000,000, or blank to leave it untracked.' };
  if (imageUrl.length > 2048) return { error: 'Photo URL is too long.' };
  if (imageUrl && !/^\/uploads\/menu\/[0-9a-f-]+\.(?:jpg|png|webp)$/i.test(imageUrl)) {
    try {
      if (new URL(imageUrl).protocol !== 'https:') return { error: 'Photo URL must use HTTPS.' };
    } catch {
      return { error: 'Enter a valid HTTPS photo URL.' };
    }
  }

  return { data: { name, description, priceKobo, categoryId, imageUrl, available: input.available !== false, stockQuantity } };
}
