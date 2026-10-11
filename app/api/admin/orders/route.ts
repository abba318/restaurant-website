import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { isAdmin, unauthorized } from '@/lib/admin-auth';

export async function GET(request: NextRequest) {
  if (!isAdmin(request)) return unauthorized();
  try {
    const q = request.nextUrl.searchParams.get('q')?.trim().slice(0,120) || '';
    const status = request.nextUrl.searchParams.get('status') || '';
    const fulfillment = request.nextUrl.searchParams.get('fulfillment') || '';
    const result = await pool.query("SELECT o.*,COALESCE((SELECT json_agg(h ORDER BY h.changed_at) FROM order_status_history h WHERE h.order_id=o.id),'[]'::json) AS status_history FROM orders o WHERE ($1='' OR o.status=$1) AND ($2='' OR o.customer_name ILIKE '%'||$2||'%' OR o.customer_email ILIKE '%'||$2||'%' OR o.customer_phone ILIKE '%'||$2||'%' OR o.id::text ILIKE '%'||$2||'%') AND ($3='' OR o.fulfillment_type=$3) ORDER BY o.created_at DESC LIMIT 250", [status, q, ['delivery','pickup'].includes(fulfillment) ? fulfillment : '']);
    const [stats, popular] = await Promise.all([
      pool.query("SELECT COUNT(*)::int AS orders,COUNT(*) FILTER(WHERE payment_status='paid')::int AS paid_orders,COALESCE(SUM(total_kobo) FILTER(WHERE payment_status='paid'),0)::bigint AS revenue_kobo FROM orders WHERE created_at>=date_trunc('month',NOW())"),
      pool.query("SELECT item->>'name' AS name,SUM((item->>'quantity')::int)::int AS quantity FROM orders o CROSS JOIN LATERAL jsonb_array_elements(o.items) item WHERE o.payment_status='paid' GROUP BY item->>'name' ORDER BY quantity DESC LIMIT 5"),
    ]);
    return NextResponse.json({ orders: result.rows, stats: stats.rows[0], popularItems: popular.rows }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Unable to load orders right now.' }, { status: 503 });
  }
}
