import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.test(id)) return NextResponse.json({ error: 'Invalid order number.' }, { status: 400 });
  try {
    const [order, settings, history] = await Promise.all([
      pool.query('SELECT id,customer_name,customer_phone,delivery_address,delivery_instructions,fulfillment_type,items,total_kobo,delivery_fee_kobo,status,payment_status,created_at,payment_verified_at FROM orders WHERE id=$1', [id]),
      pool.query('SELECT settings FROM restaurant_settings WHERE id=1'),
      pool.query('SELECT status,changed_by,changed_at FROM order_status_history WHERE order_id=$1 ORDER BY changed_at,id', [id]),
    ]);
    if (!order.rowCount) return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
    return NextResponse.json({ order: order.rows[0], settings: settings.rows[0]?.settings || {}, history: history.rows }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return NextResponse.json({ error: 'Order details are temporarily unavailable.' }, { status: 503 }); }
}
