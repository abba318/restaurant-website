import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import type { PoolClient } from 'pg';
import { pool } from '@/lib/db';
import { calculateOrderTotal } from '@/lib/order-domain';

type RequestedItem = { id: number; quantity: number; specialRequest?: string };
const deviceCookie = 'restaurant_device';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const deviceId = request.cookies.get(deviceCookie)?.value;
  if (!deviceId || !uuidPattern.test(deviceId)) return NextResponse.json({ orders: [] }, { headers: { 'Cache-Control': 'no-store' } });
  try {
    const result = await pool.query('SELECT id,created_at,status,payment_status,total_kobo,items,fulfillment_type FROM orders WHERE device_id=$1 ORDER BY created_at DESC LIMIT 50', [deviceId]);
    return NextResponse.json({ orders: result.rows }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Unable to load your saved orders.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}

export async function POST(request: NextRequest) {
  let client: PoolClient | null = null;
  try {
    const body = await request.json();
    const customer = body?.customer;
    const name = typeof customer?.name === 'string' ? customer.name.trim() : '';
    const email = typeof customer?.email === 'string' ? customer.email.trim() : '';
    const phone = typeof customer?.phone === 'string' ? customer.phone.trim() : '';
    const address = typeof customer?.address === 'string' ? customer.address.trim() : '';
    const instructions = typeof customer?.instructions === 'string' ? customer.instructions.trim() : '';
    const rawLocation = body?.location;
    const latitude = rawLocation === null || rawLocation === undefined ? null : rawLocation.latitude;
    const longitude = rawLocation === null || rawLocation === undefined ? null : rawLocation.longitude;
    if ((latitude === null) !== (longitude === null) || (latitude !== null && (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90)) || (longitude !== null && (typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180))) {
      return NextResponse.json({ error: 'The shared map location is invalid. Please share it again or remove it.' }, { status: 400 });
    }
    const fulfillment = body?.fulfillment === 'pickup' ? 'pickup' : 'delivery';
    const phoneDigits = phone.replace(/\D/g, '').length;
    const items = body?.items as RequestedItem[];

    if (!name || name.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return NextResponse.json({ error: 'Enter a valid name and email address.' }, { status: 400 });
    }
    if (!/^\+?[0-9().\s-]{7,32}$/.test(phone) || phoneDigits < 7 || phoneDigits > 15 || (fulfillment === 'delivery' && (address.length < 8 || address.length > 500)) || address.length > 500 || instructions.length > 500) {
      return NextResponse.json({ error: 'Enter a valid phone number and delivery address.' }, { status: 400 });
    }
    if (!Array.isArray(items) || !items.length || items.length > 40) {
      return NextResponse.json({ error: 'Add at least one menu item to your order.' }, { status: 400 });
    }
    if (items.some((item) => !item || !Number.isSafeInteger(item.id) || item.id < 1 || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 99 || (item.specialRequest !== undefined && (typeof item.specialRequest !== 'string' || item.specialRequest.length > 250)))) {
      return NextResponse.json({ error: 'One or more order items or special requests are invalid.' }, { status: 400 });
    }

    const ids = [...new Set(items.map((item) => item.id))];
    if (ids.length !== items.length) return NextResponse.json({ error: 'Duplicate menu items are not allowed.' }, { status: 400 });

    const quantities = new Map(items.map((item) => [item.id, item.quantity]));
    const requests = new Map(items.map((item) => [item.id, item.specialRequest?.trim() || '']));
    client = await pool.connect();
    await client.query('BEGIN');
    const menu = await client.query('SELECT id,name,price_kobo,stock_quantity FROM menu_items WHERE available=true AND (stock_quantity IS NULL OR stock_quantity>0) AND id=ANY($1::int[]) FOR UPDATE', [ids]);
    if (menu.rowCount !== ids.length) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'One or more items are no longer available. Refresh the menu and try again.' }, { status: 409 });
    }
    const soldOut = menu.rows.find((item) => item.stock_quantity !== null && item.stock_quantity < quantities.get(item.id)!);
    if (soldOut) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: `Only ${soldOut.stock_quantity} ${soldOut.name} ${soldOut.stock_quantity === 1 ? 'portion is' : 'portions are'} left. Update your cart and try again.` }, { status: 409 });
    }

    const orderItems = menu.rows.map((item) => ({ id: item.id, name: item.name, price_kobo: item.price_kobo, quantity: quantities.get(item.id)!, special_request: requests.get(item.id)! }));
    const settingResult = await client.query('SELECT settings FROM restaurant_settings WHERE id=1');
    const settings = settingResult.rows[0]?.settings || {};
    if (fulfillment === 'delivery' && settings.deliveryEnabled === false) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Delivery is currently unavailable. Please choose pickup.' }, { status: 409 });
    }
    if (fulfillment === 'pickup' && settings.pickupEnabled === false) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Pickup is currently unavailable.' }, { status: 409 });
    }
    const fee = fulfillment === 'delivery' ? Number(settings.deliveryFeeKobo || 0) : 0;
    if (!Number.isSafeInteger(fee) || fee < 0 || fee > 2_147_483_647) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Restaurant delivery settings are invalid.' }, { status: 503 });
    }
    let total: number;
    try { total = calculateOrderTotal(orderItems, fee); } catch {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'This order total is outside the supported range.' }, { status: 400 });
    }
    if (total < 1) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'This order total is outside the supported range.' }, { status: 400 });
    }

    const id = randomUUID();
    const cookieDeviceId = request.cookies.get(deviceCookie)?.value;
    const deviceId = cookieDeviceId && uuidPattern.test(cookieDeviceId) ? cookieDeviceId : randomUUID();
    await client.query(
      'INSERT INTO orders(id,customer_name,customer_email,customer_phone,delivery_address,items,total_kobo,fulfillment_type,delivery_fee_kobo,delivery_instructions,location_latitude,location_longitude,device_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
      [id, name, email, phone, fulfillment === 'pickup' ? '' : address, JSON.stringify(orderItems), total, fulfillment, fee, instructions, fulfillment === 'delivery' ? latitude : null, fulfillment === 'delivery' ? longitude : null, deviceId],
    );
    for (const item of menu.rows) {
      if (item.stock_quantity !== null) await client.query('UPDATE menu_items SET stock_quantity=stock_quantity-$1 WHERE id=$2 AND stock_quantity >= $1', [quantities.get(item.id), item.id]);
    }
    await client.query("INSERT INTO order_status_history(order_id,status,changed_by) VALUES($1,'pending','customer')", [id]);
    await client.query('COMMIT');

    const response = NextResponse.json({ id, total, deliveryFee: fee, fulfillment }, { status: 201 });
    response.cookies.set(deviceCookie, deviceId, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 365 });
    return response;
  } catch {
    if (client) await client.query('ROLLBACK').catch(() => undefined);
    return NextResponse.json({ error: 'We could not create your order. Please try again.' }, { status: 500 });
  } finally {
    client?.release();
  }
}
