import { NextRequest, NextResponse } from 'next/server';
import type { PoolClient } from 'pg';
import { pool } from '@/lib/db';
import { initialize } from '@/lib/paystack';
import { ensureReservationPaymentSchema, queueReservationNotification } from '@/lib/reservation-payments';

export async function GET() {
  try {
    const result = await pool.query('SELECT settings FROM restaurant_settings WHERE id=1');
    const settings = result.rows[0]?.settings || {};
    const reservationFree = settings.reservationFree !== false;
    const reservationFeeKobo = reservationFree ? 0 : Number(settings.reservationFeeKobo || 0);
    if (!Number.isSafeInteger(reservationFeeKobo) || reservationFeeKobo < 0) return NextResponse.json({ error: 'Reservation pricing is temporarily unavailable.' }, { status: 503 });
    return NextResponse.json({ reservationFree, reservationFeeKobo }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Reservation pricing is temporarily unavailable.' }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  let client: PoolClient | null = null;
  try {
    const body = await request.json();
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const email = typeof body?.email === 'string' ? body.email.trim() : '';
    const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';
    const reservationDate = typeof body?.date === 'string' ? body.date : '';
    const reservationTime = typeof body?.time === 'string' ? body.time : '';
    const partySize = Number(body?.partySize);
    const notes = typeof body?.notes === 'string' ? body.notes.trim() : '';
    const dateParts = reservationDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const dateValue = dateParts ? new Date(Date.UTC(Number(dateParts[1]), Number(dateParts[2]) - 1, Number(dateParts[3]))) : null;
    const dateValid = Boolean(dateValue && dateValue.toISOString().slice(0, 10) === reservationDate);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date());
    const latestDate = new Date(`${today}T00:00:00Z`); latestDate.setUTCDate(latestDate.getUTCDate() + 180);
    const latestAllowed = latestDate.toISOString().slice(0, 10);
    if (!name || name.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return NextResponse.json({ error: 'Enter a valid name and email address.' }, { status: 400 });
    }
    if (!/^\+?[0-9().\s-]{7,32}$/.test(phone) || phone.replace(/\D/g, '').length < 7 || phone.replace(/\D/g, '').length > 15) {
      return NextResponse.json({ error: 'Enter a valid phone number.' }, { status: 400 });
    }
    if (!dateValid || reservationDate < today || reservationDate > latestAllowed || !/^([01]\d|2[0-3]):[0-5]\d$/.test(reservationTime)) {
      return NextResponse.json({ error: 'Choose a valid date within the next six months and a valid time.' }, { status: 400 });
    }
    if (!Number.isSafeInteger(partySize) || partySize < 1 || partySize > 20 || notes.length > 500) {
      return NextResponse.json({ error: 'Party size must be 1–20 and notes must be 500 characters or fewer.' }, { status: 400 });
    }
    await ensureReservationPaymentSchema();
    client = await pool.connect();
    await client.query('BEGIN');
    const settingResult = await client.query('SELECT settings FROM restaurant_settings WHERE id=1');
    const settings = settingResult.rows[0]?.settings || {};
    const reservationFree = settings.reservationFree !== false;
    const fee = reservationFree ? 0 : Number(settings.reservationFeeKobo || 0);
    if (!Number.isSafeInteger(fee) || fee < 0 || fee > 100_000_000) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Reservation pricing is temporarily unavailable.' }, { status: 503 });
    }
    const paymentStatus = fee > 0 ? 'unpaid' : 'not_required';
    const result = await client.query(
      'INSERT INTO reservations(customer_name,customer_email,customer_phone,reservation_date,reservation_time,party_size,notes,reservation_fee_kobo,payment_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
      [name, email, phone, reservationDate, reservationTime, partySize, notes, fee, paymentStatus],
    );
    const reservationId = result.rows[0].id;
    await client.query('COMMIT');
    client.release(); client = null;
    if (fee > 0) {
      const appUrl = process.env.NODE_ENV === 'production' ? process.env.NEXT_PUBLIC_APP_URL : request.headers.get('origin') || request.nextUrl.origin;
      if (!appUrl) {
        await pool.query("DELETE FROM reservations WHERE id=$1 AND payment_status='unpaid'", [reservationId]);
        return NextResponse.json({ error: 'Secure payment return URL is not configured.' }, { status: 503 });
      }
      try {
        const origin = new URL(appUrl);
        if (process.env.NODE_ENV === 'production' && origin.protocol !== 'https:') throw new Error('Secure payment callback is not configured.');
        const reference = `RESERVATION-${reservationId}`;
        await pool.query('UPDATE reservations SET payment_reference=$1 WHERE id=$2 AND payment_status=\'unpaid\'', [reference, reservationId]);
        const payment = await initialize(email, fee, reference, new URL('/payment/callback', origin).toString());
        if (payment.reference !== reference || typeof payment.authorization_url !== 'string') throw new Error('Paystack returned an invalid payment response.');
        return NextResponse.json({ id: reservationId, reservationFeeKobo: fee, authorization_url: payment.authorization_url, message: 'Continue to Paystack to pay the reservation fee and submit your booking.' }, { status: 201 });
      } catch {
        await pool.query("DELETE FROM reservations WHERE id=$1 AND payment_status='unpaid'", [reservationId]).catch(() => undefined);
        return NextResponse.json({ error: 'Reservation payment could not be started. Please try again.' }, { status: 502 });
      }
    }
    await queueReservationNotification(Number(reservationId)).catch(() => undefined);
    return NextResponse.json({ id: reservationId, reservationFeeKobo: fee, message: 'Reservation request received. The restaurant will contact you to confirm.' }, { status: 201 });
  } catch {
    if (client) await client.query('ROLLBACK').catch(() => undefined);
    return NextResponse.json({ error: 'We could not submit your reservation. Please try again.' }, { status: 503 });
  } finally {
    client?.release();
  }
}
