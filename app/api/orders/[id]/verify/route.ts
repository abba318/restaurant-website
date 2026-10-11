import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.test(id)) return NextResponse.json({ error: 'Invalid order number.' }, { status: 400 });
  try {
    const result = await pool.query('SELECT id,created_at,total_kobo,status,payment_status FROM orders WHERE id=$1', [id]);
    if (!result.rowCount) return NextResponse.json({ valid: false, error: 'Order not found.' }, { status: 404 });
    const order = result.rows[0];
    return NextResponse.json({ valid: true, orderNumber: order.id.slice(0, 8).toUpperCase(), createdAt: order.created_at, totalKobo: order.total_kobo, status: order.status, paymentStatus: order.payment_status }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return NextResponse.json({ error: 'Unable to verify this order.' }, { status: 503 }); }
}
