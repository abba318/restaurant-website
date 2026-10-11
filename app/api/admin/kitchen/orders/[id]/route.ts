import { NextRequest, NextResponse } from 'next/server';
import { isKitchen, sessionEmail, unauthorized } from '@/lib/admin-auth';
import { pool } from '@/lib/db';

const validUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isKitchen(request)) return unauthorized();
  const { id } = await params;
  if (!validUuid.test(id)) return NextResponse.json({ error: 'Invalid order ID.' }, { status: 400 });
  try {
    const body = await request.json();
    const status = typeof body?.status === 'string' ? body.status : '';
    if (!['preparing', 'ready'].includes(status)) return NextResponse.json({ error: 'Kitchen can set an order to preparing or ready.' }, { status: 400 });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const prior = await client.query('SELECT status,payment_status FROM orders WHERE id=$1 FOR UPDATE', [id]);
      if (!prior.rowCount) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
      }
      if (prior.rows[0].payment_status !== 'paid' || !['pending', 'confirmed', 'preparing', 'ready'].includes(prior.rows[0].status)) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'This order is no longer in the kitchen queue.' }, { status: 409 });
      }
      const updated = await client.query('UPDATE orders SET status=$1,updated_at=NOW() WHERE id=$2 RETURNING id,status', [status, id]);
      if (prior.rows[0].status !== status) await client.query('INSERT INTO order_status_history(order_id,status,changed_by) VALUES($1,$2,$3)', [id, status, sessionEmail(request)]);
      await client.query('COMMIT');
      return NextResponse.json(updated.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  } catch {
    return NextResponse.json({ error: 'Unable to update this kitchen order.' }, { status: 503 });
  }
}
