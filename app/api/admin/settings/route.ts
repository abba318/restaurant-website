import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { isAdmin, unauthorized } from '@/lib/admin-auth';

export async function GET(request: NextRequest) {
  if (!isAdmin(request)) return unauthorized();
  try { const result = await pool.query('SELECT settings FROM restaurant_settings WHERE id=1'); return NextResponse.json(result.rows[0]?.settings || {}); }
  catch { return NextResponse.json({ error: 'Unable to load restaurant settings.' }, { status: 503 }); }
}

export async function PUT(request: NextRequest) {
  if (!isAdmin(request)) return unauthorized();
  try {
    const value = await request.json();
    const textFields = ['name','address','phone','email','logoUrl','openingHours','receiptFooter'] as const;
    const settings: Record<string, unknown> = {};
    for (const key of textFields) {
      if (typeof value?.[key] !== 'string' || value[key].length > (key === 'openingHours' ? 1000 : 500)) return NextResponse.json({ error: `Enter valid ${key} details.` }, { status: 400 });
      settings[key] = value[key].trim();
    }
    if (!settings.name || (settings.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(settings.email)))) return NextResponse.json({ error: 'A restaurant name and valid contact email are required.' }, { status: 400 });
    if (settings.logoUrl && !/^https:\/\//i.test(String(settings.logoUrl))) return NextResponse.json({ error: 'Logo URL must use HTTPS.' }, { status: 400 });
    for (const key of ['deliveryEnabled','pickupEnabled'] as const) { if (typeof value?.[key] !== 'boolean') return NextResponse.json({ error: 'Choose delivery and pickup availability.' }, { status: 400 }); settings[key] = value[key]; }
    const fee = Number(value?.deliveryFeeKobo);
    if (!Number.isSafeInteger(fee) || fee < 0 || fee > 100_000_000) return NextResponse.json({ error: 'Enter a valid delivery fee.' }, { status: 400 });
    settings.deliveryFeeKobo = fee;
    if (typeof value?.reservationFree !== 'boolean') return NextResponse.json({ error: 'Choose whether table reservations are free.' }, { status: 400 });
    const reservationFee = Number(value?.reservationFeeKobo);
    if (!Number.isSafeInteger(reservationFee) || reservationFee < 0 || reservationFee > 100_000_000 || (!value.reservationFree && reservationFee < 1)) return NextResponse.json({ error: 'Enter a reservation fee above ₦0.00 for paid bookings.' }, { status: 400 });
    settings.reservationFree = value.reservationFree;
    settings.reservationFeeKobo = reservationFee;
    const result = await pool.query("INSERT INTO restaurant_settings(id,settings,updated_at) VALUES(1,$1,NOW()) ON CONFLICT(id) DO UPDATE SET settings=EXCLUDED.settings,updated_at=NOW() RETURNING settings", [JSON.stringify(settings)]);
    return NextResponse.json(result.rows[0].settings);
  } catch { return NextResponse.json({ error: 'Unable to save restaurant settings.' }, { status: 503 }); }
}
