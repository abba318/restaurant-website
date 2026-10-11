import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { verify } from '@/lib/paystack';
import { queuePaidOrderNotification } from '@/lib/notifications';
import { isAdmin, unauthorized } from '@/lib/admin-auth';

const validUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAdmin(request)) return unauthorized();
  const { id } = await params;
  if (!validUuid.test(id)) return NextResponse.json({ error: 'Invalid order ID.' }, { status: 400 });

  try {
    const result = await pool.query(
      'SELECT id,total_kobo,payment_status,payment_reference FROM orders WHERE id=$1',
      [id],
    );
    if (!result.rowCount) return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
    const order = result.rows[0];
    if (order.payment_status === 'paid') {
      await queuePaidOrderNotification(id);
      const current = await pool.query('SELECT * FROM orders WHERE id=$1', [id]);
      return NextResponse.json({ confirmed: true, order: current.rows[0] });
    }
    if (!order.payment_reference) return NextResponse.json({ error: 'This order has no Paystack reference to verify.' }, { status: 409 });

    const payment = await verify(order.payment_reference);
    const confirmed = payment.status === 'success'
      && payment.reference === order.payment_reference
      && payment.currency === 'NGN'
      && payment.amount === Number(order.total_kobo);
    if (!confirmed) return NextResponse.json({ confirmed: false, paymentStatus: payment.status });

    await pool.query(
      "UPDATE orders SET payment_status='paid',status=CASE WHEN status='cancelled' THEN status ELSE 'confirmed' END WHERE id=$1 AND payment_reference=$2 AND payment_status<>'paid'",
      [id, order.payment_reference],
    );
    await queuePaidOrderNotification(id);
    const updated = await pool.query('SELECT * FROM orders WHERE id=$1', [id]);
    return NextResponse.json({ confirmed: true, order: updated.rows[0] });
  } catch {
    return NextResponse.json({ error: 'Unable to verify this payment with Paystack right now.' }, { status: 502 });
  }
}
