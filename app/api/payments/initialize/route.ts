import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { initialize } from '@/lib/paystack';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const orderId = typeof body?.orderId === 'string' ? body.orderId : '';
    if (!uuidPattern.test(orderId)) return NextResponse.json({ error: 'Invalid order.' }, { status: 400 });

    const result = await pool.query(
      'SELECT customer_email,total_kobo,payment_status,payment_reference,status FROM orders WHERE id=$1',
      [orderId],
    );
    if (!result.rowCount) return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
    const order = result.rows[0];
    if (order.payment_status === 'paid') return NextResponse.json({ error: 'This order has already been paid.' }, { status: 409 });
    if (order.status === 'cancelled') return NextResponse.json({ error: 'This order has been cancelled. Please create a new order.' }, { status: 409 });

    const amount = Number(order.total_kobo);
    if (!Number.isSafeInteger(amount) || amount < 1) return NextResponse.json({ error: 'Invalid order total.' }, { status: 400 });
    const reference = `ORDER-${orderId}`;
    // In local development, use the origin of the active browser session. This
    // matters in hosted workspaces where the public URL is not localhost.
    const appUrl = process.env.NODE_ENV === 'production'
      ? process.env.NEXT_PUBLIC_APP_URL
      : request.headers.get('origin') || request.nextUrl.origin;
    if (!appUrl) return NextResponse.json({ error: 'The secure payment return URL is not configured.' }, { status: 503 });
    const applicationOrigin = new URL(appUrl);
    if (process.env.NODE_ENV === 'production' && applicationOrigin.protocol !== 'https:') {
      return NextResponse.json({ error: 'Secure payment callbacks are not configured.' }, { status: 503 });
    }
    const callbackUrl = new URL('/payment/callback', applicationOrigin).toString();
    if (order.payment_reference && order.payment_reference !== reference) return NextResponse.json({ error: 'This order has an unexpected payment reference. Contact the restaurant.' }, { status: 409 });
    await pool.query("UPDATE orders SET payment_reference=$1 WHERE id=$2 AND payment_status<>'paid' AND (payment_reference IS NULL OR payment_reference=$1)", [reference, orderId]);
    const payment = await initialize(order.customer_email, amount, reference, callbackUrl);
    return NextResponse.json({ authorization_url: payment.authorization_url, reference: payment.reference });
  } catch {
    return NextResponse.json({ error: 'Secure payment could not be started. Please try again.' }, { status: 502 });
  }
}
