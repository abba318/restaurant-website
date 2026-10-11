import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { isAdmin, sessionEmail, unauthorized } from '@/lib/admin-auth';
import { sendOrderStatusEmail } from '@/lib/notifications';
import { isOrderStatus } from '@/lib/order-domain';

const validUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAdmin(request)) return unauthorized();
  const { id } = await params;
  if (!validUuid.test(id)) return NextResponse.json({ error: 'Invalid order ID.' }, { status: 400 });
  try {
    const body = await request.json();
    const status = typeof body?.status === 'string' ? body.status : '';
    if (!isOrderStatus(status) && status !== 'completed') return NextResponse.json({ error: 'Choose a valid order status.' }, { status: 400 });
    const client = await pool.connect();
    let result;
    let changed = false;
    let customer: { name: string; email: string; items: Array<{ name?: string; quantity?: number }> } | null = null;
    try {
      await client.query('BEGIN');
      const prior = await client.query('SELECT status,customer_name,customer_email,items FROM orders WHERE id=$1 FOR UPDATE', [id]);
      if (!prior.rowCount) { await client.query('ROLLBACK'); return NextResponse.json({ error: 'Order not found.' }, { status: 404 }); }
      changed = prior.rows[0].status !== status;
      customer = { name: prior.rows[0].customer_name, email: prior.rows[0].customer_email, items: prior.rows[0].items || [] };
      result = await client.query('UPDATE orders SET status=$1,updated_at=NOW() WHERE id=$2 RETURNING *', [status, id]);
      if (changed) await client.query('INSERT INTO order_status_history(order_id,status,changed_by) VALUES($1,$2,$3)', [id, status, sessionEmail(request)]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    let emailSent: boolean | null = null;
    let emailError: string | undefined;
    if (changed && result.rowCount && customer) {
      try {
        await sendOrderStatusEmail({ id, customerName: customer.name, customerEmail: customer.email, items: customer.items }, status);
        emailSent = true;
      } catch (error) {
        emailSent = false;
        emailError = error instanceof Error ? error.message : 'Gmail could not send the update.';
      }
    }
    return result.rowCount ? NextResponse.json({ ...result.rows[0], emailSent, emailError }) : NextResponse.json({ error: 'Order not found.' }, { status: 404 });
  } catch {
    return NextResponse.json({ error: 'Unable to update this order right now.' }, { status: 503 });
  }
}
