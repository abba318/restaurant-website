import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [categories, items, settings] = await Promise.all([
      pool.query('SELECT id,name FROM categories ORDER BY name'),
      pool.query('SELECT id,category_id,name,description,price_kobo,image_url,available,stock_quantity FROM menu_items WHERE available=true ORDER BY id'),
      pool.query('SELECT settings FROM restaurant_settings WHERE id=1'),
    ]);
    return NextResponse.json(
      { categories: categories.rows, items: items.rows, restaurant: settings.rows[0]?.settings || {} },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } },
    );
  } catch {
    return NextResponse.json({ error: 'The menu is temporarily unavailable.' }, { status: 503 });
  }
}
