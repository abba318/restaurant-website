import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated, sessionEmail, sessionRole, unauthorized } from '@/lib/admin-auth';
import { pool } from '@/lib/db';

const validUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let messageSchemaReady: Promise<void> | null = null;

async function ensureMessagesTable() {
  if (!messageSchemaReady) {
    messageSchemaReady = (async () => {
      await pool.query(`CREATE TABLE IF NOT EXISTS staff_messages (
        id BIGSERIAL PRIMARY KEY,
        sender_email TEXT NOT NULL,
        sender_role TEXT NOT NULL,
        body TEXT NOT NULL,
        order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      await pool.query('CREATE INDEX IF NOT EXISTS staff_messages_created_idx ON staff_messages(created_at DESC,id DESC)');
    })().catch((error) => { messageSchemaReady = null; throw error; });
  }
  await messageSchemaReady;
}

export async function GET(request: NextRequest) {
  if (!isAuthenticated(request)) return unauthorized();
  try {
    await ensureMessagesTable();
    const result = await pool.query(`SELECT m.id,m.sender_email,m.sender_role,m.body,m.order_id,m.created_at,o.customer_name AS order_customer_name
      FROM staff_messages m LEFT JOIN orders o ON o.id=m.order_id
      ORDER BY m.created_at DESC,m.id DESC LIMIT 100`);
    return NextResponse.json({ messages: result.rows.reverse() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Unable to load staff messages.' }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  if (!isAuthenticated(request)) return unauthorized();
  const role = sessionRole(request);
  if (!['owner', 'staff', 'kitchen'].includes(role)) return unauthorized();
  try {
    const body = await request.json();
    const message = typeof body?.message === 'string' ? body.message.trim() : '';
    const rawOrderId = typeof body?.orderId === 'string' ? body.orderId.trim() : '';
    if (!message || message.length > 1000) return NextResponse.json({ error: 'Write a message of 1–1000 characters.' }, { status: 400 });
    if (rawOrderId && !validUuid.test(rawOrderId)) return NextResponse.json({ error: 'Choose a valid order to share.' }, { status: 400 });
    await ensureMessagesTable();
    if (rawOrderId) {
      const order = await pool.query('SELECT 1 FROM orders WHERE id=$1', [rawOrderId]);
      if (!order.rowCount) return NextResponse.json({ error: 'The selected order is no longer available.' }, { status: 404 });
    }
    const result = await pool.query(`INSERT INTO staff_messages(sender_email,sender_role,body,order_id)
      VALUES($1,$2,$3,$4) RETURNING id,sender_email,sender_role,body,order_id,created_at`, [sessionEmail(request), role, message, rawOrderId || null]);
    return NextResponse.json(result.rows[0], { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Unable to send staff message.' }, { status: 503 });
  }
}
