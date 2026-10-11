import { createHash, randomInt } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { isAdmin, sessionEmail, unauthorized } from '@/lib/admin-auth';
import { pool } from '@/lib/db';

export async function POST(request: NextRequest) {
  if (!isAdmin(request)) return unauthorized();
  const code = String(randomInt(10000000, 99999999));
  const codeHash = createHash('sha256').update(code).digest('hex');
  try {
    await pool.query('UPDATE admin_users SET telegram_link_code_hash=$1,telegram_link_expires_at=NOW()+INTERVAL \'10 minutes\' WHERE email=$2', [codeHash, sessionEmail(request)]);
    return NextResponse.json({ code, expiresInMinutes: 10 }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Could not create a Telegram link code.' }, { status: 503 });
  }
}
