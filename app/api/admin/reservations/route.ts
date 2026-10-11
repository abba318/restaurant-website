import { NextRequest, NextResponse } from 'next/server';
import { isAdmin, unauthorized } from '@/lib/admin-auth';
import { pool } from '@/lib/db';
import { ensureReservationPaymentSchema } from '@/lib/reservation-payments';

const statuses = new Set(['pending', 'confirmed', 'cancelled', 'completed']);

export async function GET(request: NextRequest) {
  if (!isAdmin(request)) return unauthorized();
  try {
    await ensureReservationPaymentSchema();
    const result = await pool.query('SELECT id,customer_name,customer_email,customer_phone,reservation_date,reservation_time,party_size,notes,status,reservation_fee_kobo,payment_status,created_at FROM reservations ORDER BY reservation_date,reservation_time,id LIMIT 300');
    return NextResponse.json(result.rows, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Unable to load reservations.' }, { status: 503 });
  }
}

export async function PATCH(request: NextRequest) {
  if (!isAdmin(request)) return unauthorized();
  try {
    await ensureReservationPaymentSchema();
    const body = await request.json();
    const id = Number(body?.id);
    const status = typeof body?.status === 'string' ? body.status : '';
    if (!Number.isSafeInteger(id) || id < 1 || !statuses.has(status)) return NextResponse.json({ error: 'Choose a valid reservation and status.' }, { status: 400 });
    const result = await pool.query("UPDATE reservations SET status=$1 WHERE id=$2 AND ($1<>'confirmed' OR reservation_fee_kobo=0 OR payment_status='paid') RETURNING id,status,payment_status", [status, id]);
    if (result.rowCount) return NextResponse.json(result.rows[0]);
    const existing = await pool.query('SELECT id,payment_status,reservation_fee_kobo FROM reservations WHERE id=$1', [id]);
    if (!existing.rowCount) return NextResponse.json({ error: 'Reservation not found.' }, { status: 404 });
    if (existing.rows[0].reservation_fee_kobo > 0 && existing.rows[0].payment_status !== 'paid' && status === 'confirmed') return NextResponse.json({ error: 'This reservation cannot be confirmed until the Paystack fee is paid.' }, { status: 409 });
    return NextResponse.json({ error: 'Unable to update this reservation.' }, { status: 409 });
  } catch {
    return NextResponse.json({ error: 'Unable to update reservation.' }, { status: 503 });
  }
}
