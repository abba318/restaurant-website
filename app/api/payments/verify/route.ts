import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { verify } from '@/lib/paystack';
import { queuePaidOrderNotification } from '@/lib/notifications';
import { ensureReservationPaymentSchema, queueReservationNotification } from '@/lib/reservation-payments';

const referencePattern = /^ORDER-([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const reservationReferencePattern = /^RESERVATION-([1-9][0-9]{0,9})$/;

export async function GET(request: NextRequest) {
  const reference = request.nextUrl.searchParams.get('reference') || '';
  const match = referencePattern.exec(reference);
  const reservationMatch = reservationReferencePattern.exec(reference);
  if (!match && !reservationMatch) return NextResponse.json({ error: 'Invalid payment reference.' }, { status: 400 });

  try {
    if (reservationMatch) {
      await ensureReservationPaymentSchema();
      const reservationId = Number(reservationMatch[1]);
      const result = await pool.query('SELECT id,reservation_fee_kobo,payment_status,payment_reference FROM reservations WHERE id=$1', [reservationId]);
      if (!result.rowCount) return NextResponse.json({ error: 'Reservation not found.' }, { status: 404 });
      const reservation = result.rows[0];
      if (reservation.payment_reference !== reference) return NextResponse.json({ error: 'Payment reference does not match this reservation.' }, { status: 409 });
      if (reservation.payment_status === 'paid') {
        await queueReservationNotification(reservationId);
        return NextResponse.json({ status: 'success', reservationId });
      }
      const payment = await verify(reference);
      const fee = Number(reservation.reservation_fee_kobo);
      const confirmed = payment.status === 'success' && payment.reference === reference && payment.currency === 'NGN' && Number(payment.amount) === fee;
      if (!confirmed) return NextResponse.json({ status: payment.status === 'success' ? 'failed' : payment.status, reservationId });

      const client = await pool.connect();
      let paid = false;
      try {
        await client.query('BEGIN');
        const current = await client.query('SELECT payment_status FROM reservations WHERE id=$1 FOR UPDATE', [reservationId]);
        if (current.rows[0]?.payment_status !== 'paid') {
          const updated = await client.query("UPDATE reservations SET payment_status='paid' WHERE id=$1 AND payment_reference=$2 AND payment_status='unpaid' RETURNING id", [reservationId, reference]);
          paid = Boolean(updated.rowCount);
        } else paid = true;
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
      if (!paid) return NextResponse.json({ error: 'Reservation status changed before payment could be confirmed.' }, { status: 409 });
      await queueReservationNotification(reservationId);
      return NextResponse.json({ status: 'success', reservationId });
    }

    if (!match) return NextResponse.json({ error: 'Invalid payment reference.' }, { status: 400 });
    const orderId = match[1];
    const result = await pool.query(
      'SELECT id,total_kobo,payment_status,payment_reference,status FROM orders WHERE id=$1',
      [orderId],
    );
    if (!result.rowCount) return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
    const order = result.rows[0];
    if (order.payment_reference !== reference) return NextResponse.json({ error: 'Payment reference does not match this order.' }, { status: 409 });
    if (order.payment_status === 'paid') {
      await queuePaidOrderNotification(orderId);
      return NextResponse.json({ status: 'success', orderStatus: order.status, orderId });
    }

    const payment = await verify(reference);
    const amount = Number(order.total_kobo);
    const confirmed = payment.status === 'success' && payment.reference === reference && payment.currency === 'NGN' && Number(payment.amount) === amount;
    if (!confirmed) return NextResponse.json({ status: payment.status === 'success' ? 'failed' : payment.status, orderId });

    const client = await pool.connect();
    let transitioned = false;
    let finalStatus = order.status as string;
    try {
      await client.query('BEGIN');
      const current = await client.query('SELECT status,payment_status FROM orders WHERE id=$1 FOR UPDATE', [orderId]);
      if (current.rows[0]?.payment_status !== 'paid') {
        const updated = await client.query("UPDATE orders SET payment_status='paid',payment_verified_at=COALESCE(payment_verified_at,NOW()),status=CASE WHEN status='pending' THEN 'confirmed' ELSE status END,updated_at=NOW() WHERE id=$1 AND payment_reference=$2 RETURNING id,status", [orderId, reference]);
        if (updated.rowCount) { finalStatus = updated.rows[0].status; transitioned = current.rows[0].status !== finalStatus; }
        if (transitioned) await client.query("INSERT INTO order_status_history(order_id,status,changed_by) VALUES($1,$2,'paystack')", [orderId, finalStatus]);
      } else finalStatus = current.rows[0].status;
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    if (!transitioned && order.payment_status !== 'paid') {
      const current = await pool.query('SELECT payment_status FROM orders WHERE id=$1', [orderId]);
      if (current.rows[0]?.payment_status !== 'paid') return NextResponse.json({ error: 'Order status changed before payment could be confirmed.' }, { status: 409 });
    }
    await queuePaidOrderNotification(orderId);
    return NextResponse.json({ status: 'success', orderStatus: finalStatus, orderId });
  } catch {
    return NextResponse.json({ error: 'We could not verify this payment yet. Please try again shortly.' }, { status: 502 });
  }
}
