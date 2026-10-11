import { NextRequest, NextResponse } from 'next/server';
import { isKitchen, unauthorized } from '@/lib/admin-auth';
import { pool } from '@/lib/db';

export async function GET(request: NextRequest) {
  if (!isKitchen(request)) return unauthorized();
  try {
    const result = await pool.query('SELECT id,name,available,stock_quantity FROM menu_items ORDER BY name,id');
    return NextResponse.json({ items: result.rows }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Unable to load kitchen stock.' }, { status: 503 });
  }
}

export async function PATCH(request: NextRequest) {
  if (!isKitchen(request)) return unauthorized();
  try {
    const body = await request.json();
    const id = Number(body?.id);
    const quantity = body?.stockQuantity;
    if (!Number.isSafeInteger(id) || id < 1 || (quantity !== null && (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > 1_000_000))) {
      return NextResponse.json({ error: 'Enter a valid item and stock quantity.' }, { status: 400 });
    }
    const result = await pool.query('UPDATE menu_items SET stock_quantity=$1 WHERE id=$2 RETURNING id,name,available,stock_quantity', [quantity, id]);
    return result.rowCount ? NextResponse.json(result.rows[0]) : NextResponse.json({ error: 'Menu item not found.' }, { status: 404 });
  } catch {
    return NextResponse.json({ error: 'Unable to update item stock.' }, { status: 503 });
  }
}
