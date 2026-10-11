import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import type { PoolClient } from 'pg';
import { pool } from '@/lib/db';
import { hashPassword } from '@/lib/admin-auth';
import { ensurePasswordResetSchema, resetIdentifierHash } from '@/lib/admin-password-reset';
import { sendAdminPasswordChangedEmail } from '@/lib/notifications';

export async function POST(request: NextRequest) {
  let client: PoolClient | null = null;
  try {
    const body = await request.json();
    const token = typeof body?.token === 'string' ? body.token : '';
    const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : '';
    const confirmPassword = typeof body?.confirmPassword === 'string' ? body.confirmPassword : '';
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return NextResponse.json({ error: 'This reset link is invalid or has expired. Request another link.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
    if (newPassword.length < 12 || newPassword.length > 256) return NextResponse.json({ error: 'Use a password with at least 12 characters.' }, { status: 400 });
    if (newPassword !== confirmPassword) return NextResponse.json({ error: 'The passwords do not match.' }, { status: 400 });

    await ensurePasswordResetSchema();
    const clientIp = (request.headers.get('x-real-ip') || 'unknown-client').trim().slice(0, 100);
    const ipHash = resetIdentifierHash(`ip:${clientIp}`);
    const tokenHash = createHash('sha256').update(token).digest('hex');
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query("DELETE FROM admin_password_reset_attempts WHERE created_at<NOW()-INTERVAL '1 day'");
    await client.query("INSERT INTO admin_password_reset_attempts(purpose,email_hash,ip_hash) VALUES('confirm',$1,$2)", [resetIdentifierHash('confirm'), ipHash]);
    const attempts = await client.query("SELECT COUNT(*)::int AS count FROM admin_password_reset_attempts WHERE purpose='confirm' AND ip_hash=$1 AND created_at>NOW()-INTERVAL '1 hour'", [ipHash]);
    if (attempts.rows[0].count > 30) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Too many reset attempts. Request a new link and try again later.' }, { status: 429, headers: { 'Cache-Control': 'no-store' } });
    }

    const reset = await client.query('SELECT email,expires_at,consumed_at FROM admin_password_reset_tokens WHERE token_hash=$1 FOR UPDATE', [tokenHash]);
    const record = reset.rows[0];
    if (!record || record.consumed_at || new Date(record.expires_at).getTime() <= Date.now()) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'This reset link is invalid or has expired. Request another link.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
    }
    const account = await client.query('SELECT email FROM admin_users WHERE LOWER(email)=LOWER($1) FOR UPDATE', [record.email]);
    if (!account.rowCount) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'This reset link is invalid or has expired. Request another link.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
    }
    const email = String(account.rows[0].email);
    const passwordHash = await hashPassword(newPassword);
    await client.query('UPDATE admin_users SET password_hash=$1 WHERE LOWER(email)=LOWER($2)', [passwordHash, email]);
    await client.query('UPDATE admin_password_reset_tokens SET consumed_at=NOW() WHERE LOWER(email)=LOWER($1) AND consumed_at IS NULL', [email]);
    await client.query('COMMIT');
    client.release(); client = null;
    await sendAdminPasswordChangedEmail(email).catch(() => console.error('Password change confirmation email delivery failed.'));
    return NextResponse.json({ changed: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    if (client) await client.query('ROLLBACK').catch(() => undefined);
    return NextResponse.json({ error: 'Could not reset the password. Request a new link and try again.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  } finally { client?.release(); }
}
