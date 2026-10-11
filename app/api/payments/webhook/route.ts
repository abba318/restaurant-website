import { createHmac, timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { queuePaidOrderNotification } from '@/lib/notifications';
import { ensureReservationPaymentSchema, queueReservationNotification } from '@/lib/reservation-payments';

const referencePattern = /^ORDER-([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const reservationReferencePattern = /^RESERVATION-([1-9][0-9]{0,9})$/;

export async function POST(request: NextRequest) {
    const secret = process.env.PAYSTACK_SECRET_KEY;
  const signature = request.headers.get('x-paystack-signature') || '';
  if (!secret || !/^[a-f0-9]{128}$/i.test(signature)) {
    return NextResponse.json({ error: 'Invalid webhook signature.' }, { status: 401 });
  }

  try {
    const rawBody = await request.text();
    if (rawBody.length > 1_000_000) return NextResponse.json({ error: 'Webhook payload is too large.' }, { status: 413 });
    const expected = createHmac('sha512', secret).update(rawBody).digest();
    const supplied = Buffer.from(signature, 'hex');
    if (!timingSafeEqual(expected, supplied)) return NextResponse.json({ error: 'Invalid webhook signature.' }, { status: 401 });

    const event = JSON.parse(rawBody);
    if (event?.event !== 'charge.success') return NextResponse.json({ received: true });

    const payment = event.data;
    const reference = typeof payment?.reference === 'string' ? payment.reference : '';
    const match = referencePattern.exec(reference);
    const reservationMatch = reservationReferencePattern.exec(reference);
    if ((!match && !reservationMatch) || payment.status !== 'success' || payment.currency !== 'NGN' || typeof payment.amount !== 'number' || !Number.isSafeInteger(payment.amount)) {
      return NextResponse.json({ error: 'Invalid payment event.' }, { status: 400 });
    }

    if (reservationMatch) {
      await ensureReservationPaymentSchema();
      const reservationId = Number(reservationMatch[1]);
      const reservationResult = await pool.query('SELECT reservation_fee_kobo,payment_reference,payment_status FROM reservations WHERE id=$1', [reservationId]);
      if (!reservationResult.rowCount) return NextResponse.json({ error: 'Reservation not found.' }, { status: 404 });
      const reservation = reservationResult.rows[0];
      if (reservation.payment_reference !== reference || Number(reservation.reservation_fee_kobo) !== payment.amount) {
        return NextResponse.json({ error: 'Payment does not match the reservation.' }, { status: 409 });
      }
      if (reservation.payment_status !== 'paid') {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query("UPDATE reservations SET payment_status='paid' WHERE id=$1 AND payment_reference=$2 AND payment_status='unpaid'", [reservationId, reference]);
          await client.query('COMMIT');
        } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
      }
      await queueReservationNotification(reservationId);
      return NextResponse.json({ received: true });
    }

    if (!match) return NextResponse.json({ error: 'Invalid payment event.' }, { status: 400 });
    const orderId = match[1];
    const orderResult = await pool.query(
      'SELECT total_kobo,payment_reference,status FROM orders WHERE id=$1',
      [orderId],
    );
    if (!orderResult.rowCount) return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
    const order = orderResult.rows[0];
    if (order.payment_reference !== reference || Number(order.total_kobo) !== payment.amount) {
      return NextResponse.json({ error: 'Payment does not match the order.' }, { status: 409 });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const prior = await client.query('SELECT status,payment_status FROM orders WHERE id=$1 FOR UPDATE', [orderId]);
      if (prior.rows[0].payment_status !== 'paid') {
        const updated = await client.query("UPDATE orders SET payment_status='paid',payment_verified_at=COALESCE(payment_verified_at,NOW()),status=CASE WHEN status='pending' THEN 'confirmed' ELSE status END,updated_at=NOW() WHERE id=$1 AND payment_reference=$2 RETURNING id,status", [orderId, reference]);
        if (updated.rowCount && updated.rows[0].status !== prior.rows[0].status) await client.query('INSERT INTO order_status_history(order_id,status,changed_by) VALUES($1,$2,\'paystack\')', [orderId, updated.rows[0].status]);
      }
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    await queuePaidOrderNotification(orderId);
    return NextResponse.json({ received: true });
  } catch {
    return NextResponse.json({ error: 'Webhook could not be processed.' }, { status: 503 });
  }
}
