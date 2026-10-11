import { pool } from '@/lib/db';

let schemaReady: Promise<void> | null = null;

export function ensureReservationPaymentSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await pool.query(`ALTER TABLE reservations
        ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'unpaid',
        ADD COLUMN IF NOT EXISTS payment_reference TEXT,
        ADD COLUMN IF NOT EXISTS notification_queued_at TIMESTAMPTZ`);
      await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS reservations_payment_reference_idx ON reservations(payment_reference) WHERE payment_reference IS NOT NULL');
    })().catch((error) => { schemaReady = null; throw error; });
  }
  return schemaReady;
}

/** Queue a free booking or a successfully paid booking for the linked admin Telegram accounts, once. */
export async function queueReservationNotification(reservationId: number) {
  await ensureReservationPaymentSchema();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`SELECT id,customer_name,customer_email,customer_phone,reservation_date,reservation_time,party_size,notes,status,reservation_fee_kobo,payment_status,notification_queued_at
      FROM reservations WHERE id=$1 FOR UPDATE`, [reservationId]);
    if (!result.rowCount) { await client.query('COMMIT'); return; }
    const booking = result.rows[0];
    const fee = Number(booking.reservation_fee_kobo) || 0;
    const eligible = fee > 0 ? booking.payment_status === 'paid' : booking.payment_status === 'not_required';
    if (!eligible || booking.notification_queued_at) { await client.query('COMMIT'); return; }
    const admins = await client.query('SELECT telegram_user_id FROM admin_users WHERE telegram_user_id IS NOT NULL');
    const payload = JSON.stringify({
      event: 'new_reservation', reservationId, customerName: booking.customer_name, customerEmail: booking.customer_email,
      customerPhone: booking.customer_phone, reservationDate: booking.reservation_date, reservationTime: booking.reservation_time,
      partySize: booking.party_size, notes: booking.notes, reservationFeeKobo: fee, paymentStatus: booking.payment_status,
    });
    for (const admin of admins.rows) {
      await client.query("INSERT INTO notification_outbox(order_id,reservation_id,channel,destination,payload) VALUES(NULL,$1,'telegram',$2,$3)", [reservationId, admin.telegram_user_id, payload]);
    }
    await client.query('UPDATE reservations SET notification_queued_at=NOW() WHERE id=$1', [reservationId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
