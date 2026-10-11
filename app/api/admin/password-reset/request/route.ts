import { createHash, randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import type { PoolClient } from 'pg';
import { pool } from '@/lib/db';
import { ensurePasswordResetSchema, resetIdentifierHash } from '@/lib/admin-password-reset';
import { sendAdminPasswordResetEmail } from '@/lib/notifications';

const genericMessage = 'If that email belongs to a staff account, a password reset link will be sent shortly.';

function response() {
  return NextResponse.json({ message: genericMessage }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  let client: PoolClient | null = null;
  try {
    const body = await request.json().catch(() => ({}));
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase().slice(0, 254) : '';
    const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    const clientIp = (request.headers.get('x-real-ip') || 'unknown-client').trim().slice(0, 100);
    const emailHash = resetIdentifierHash(`request:${email}`);
    const ipHash = resetIdentifierHash(`ip:${clientIp}`);
    await ensurePasswordResetSchema();
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query("DELETE FROM admin_password_reset_attempts WHERE created_at<NOW()-INTERVAL '1 day'");
    await client.query("DELETE FROM admin_password_reset_tokens WHERE expires_at<NOW()-INTERVAL '1 day' OR consumed_at<NOW()-INTERVAL '1 day'");
    await client.query("INSERT INTO admin_password_reset_attempts(purpose,email_hash,ip_hash) VALUES('request',$1,$2)", [emailHash, ipHash]);
    const [ipAttempts, emailAttempts] = await Promise.all([
      client.query("SELECT COUNT(*)::int AS count FROM admin_password_reset_attempts WHERE purpose='request' AND ip_hash=$1 AND created_at>NOW()-INTERVAL '1 hour'", [ipHash]),
      client.query("SELECT COUNT(*)::int AS count FROM admin_password_reset_attempts WHERE purpose='request' AND email_hash=$1 AND created_at>NOW()-INTERVAL '1 hour'", [emailHash]),
    ]);
    if (ipAttempts.rows[0].count > 10 || emailAttempts.rows[0].count > 3 || !validEmail) {
      await client.query('COMMIT');
      return response();
    }

    const account = await client.query('SELECT email FROM admin_users WHERE LOWER(email)=LOWER($1) LIMIT 1', [email]);
    if (!account.rowCount) {
      await client.query('COMMIT');
      return response();
    }
    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const storedEmail = String(account.rows[0].email);
    await client.query('DELETE FROM admin_password_reset_tokens WHERE LOWER(email)=LOWER($1) AND consumed_at IS NULL', [storedEmail]);
    await client.query("INSERT INTO admin_password_reset_tokens(email,token_hash,expires_at) VALUES($1,$2,NOW()+INTERVAL '30 minutes')", [storedEmail, tokenHash]);
    await client.query('COMMIT');
    client.release(); client = null;

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (!baseUrl) {
      await pool.query('DELETE FROM admin_password_reset_tokens WHERE token_hash=$1', [tokenHash]);
      console.error('Password reset link URL is not configured.');
      return response();
    }
    let resetUrl: URL;
    try { resetUrl = new URL('/admin/reset-password', baseUrl); }
    catch {
      await pool.query('DELETE FROM admin_password_reset_tokens WHERE token_hash=$1', [tokenHash]);
      console.error('Password reset link URL is invalid.');
      return response();
    }
    if (process.env.NODE_ENV === 'production' && resetUrl.protocol !== 'https:') {
      await pool.query('DELETE FROM admin_password_reset_tokens WHERE token_hash=$1', [tokenHash]);
      console.error('Password reset requires an HTTPS application URL.');
      return response();
    }
    resetUrl.searchParams.set('token', token);
    try {
      await sendAdminPasswordResetEmail(storedEmail, resetUrl.toString());
    } catch {
      await pool.query('DELETE FROM admin_password_reset_tokens WHERE token_hash=$1', [tokenHash]).catch(() => undefined);
      console.error('Password reset email delivery failed.');
    }
    return response();
  } catch {
    if (client) await client.query('ROLLBACK').catch(() => undefined);
    return response();
  } finally { client?.release(); }
}
