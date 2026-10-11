import { NextRequest, NextResponse } from 'next/server';
import { parseAdminProduct } from '@/lib/admin-product';
import { pool } from '@/lib/db';
import { isAdmin, unauthorized } from '@/lib/admin-auth';

function validId(value: string) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAdmin(request)) return unauthorized();
  const { id: paramId } = await params;
  const id = validId(paramId);
  if (!id) return NextResponse.json({ error: 'Invalid product ID.' }, { status: 400 });
  try {
    const parsed = parseAdminProduct(await request.json());
    if (!parsed.data) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const { name, description, priceKobo, categoryId, imageUrl, available, stockQuantity } = parsed.data;
    if (categoryId !== null) {
      const category = await pool.query('SELECT 1 FROM categories WHERE id=$1', [categoryId]);
      if (!category.rowCount) return NextResponse.json({ error: 'Choose a category that exists.' }, { status: 400 });
    }
    const result = await pool.query(
      'UPDATE menu_items SET category_id=$1,name=$2,description=$3,price_kobo=$4,image_url=$5,available=$6,stock_quantity=$7 WHERE id=$8 RETURNING *',
      [categoryId, name, description, priceKobo, imageUrl, available, stockQuantity, id],
    );
    return result.rowCount ? NextResponse.json(result.rows[0]) : NextResponse.json({ error: 'Product not found.' }, { status: 404 });
  } catch {
    return NextResponse.json({ error: 'Unable to update product right now.' }, { status: 503 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAdmin(request)) return unauthorized();
  const { id: paramId } = await params;
  const id = validId(paramId);
  if (!id) return NextResponse.json({ error: 'Invalid product ID.' }, { status: 400 });
  try {
    const result = await pool.query('DELETE FROM menu_items WHERE id=$1 RETURNING id', [id]);
    return result.rowCount ? NextResponse.json({ id }) : NextResponse.json({ error: 'Product not found.' }, { status: 404 });
  } catch {
    return NextResponse.json({ error: 'Unable to remove product right now.' }, { status: 503 });
  }
}
