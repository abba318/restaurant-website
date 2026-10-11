import { NextRequest, NextResponse } from 'next/server';
import { parseAdminProduct } from '@/lib/admin-product';
import { pool } from '@/lib/db';
import { isAdmin, unauthorized } from '@/lib/admin-auth';

export async function GET(request: NextRequest) {
  if (!isAdmin(request)) return unauthorized();
  try {
    const result = await pool.query('SELECT * FROM menu_items ORDER BY id DESC');
    return NextResponse.json(result.rows, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Unable to load products.' }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  if (!isAdmin(request)) return unauthorized();
  try {
    const parsed = parseAdminProduct(await request.json());
    if (!parsed.data) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const { name, description, priceKobo, categoryId, imageUrl, available, stockQuantity } = parsed.data;
    if (categoryId !== null) {
      const category = await pool.query('SELECT 1 FROM categories WHERE id=$1', [categoryId]);
      if (!category.rowCount) return NextResponse.json({ error: 'Choose a category that exists.' }, { status: 400 });
    }
    const result = await pool.query(
      'INSERT INTO menu_items(category_id,name,description,price_kobo,image_url,available,stock_quantity) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [categoryId, name, description, priceKobo, imageUrl, available, stockQuantity],
    );
    return NextResponse.json(result.rows[0], { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Unable to create product right now.' }, { status: 503 });
  }
}
