import { NextRequest, NextResponse } from 'next/server';
import { isKitchen, unauthorized } from '@/lib/admin-auth';
import { pool } from '@/lib/db';

export async function GET(request: NextRequest) {
  if (!isKitchen(request)) return unauthorized();
  try {
    const result = await pool.query(
      "SELECT id,customer_name,customer_phone,fulfillment_type,items,status,created_at FROM orders WHERE payment_status='paid' AND status IN ('pending','confirmed','preparing','ready') ORDER BY created_at,id LIMIT 100",
    );
    return NextResponse.json({ orders: result.rows }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Unable to load kitchen orders.' }, { status: 503 });
  }
}
