import { createHash, timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { adminCookie, createSession, hashPassword, isAuthenticated, sessionRole, verifyPassword } from '@/lib/admin-auth';
import { createHmac } from 'crypto';
import { pool } from '@/lib/db';

const LOGIN_LIMIT = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

function matchesConfiguredValue(candidate: string, configured: string) {
  const candidateDigest = createHash('sha256').update(candidate).digest();
  const configuredDigest = createHash('sha256').update(configured).digest();
  return timingSafeEqual(candidateDigest, configuredDigest);
}

export async function GET(request: NextRequest) {
  const authenticated = isAuthenticated(request);
  return NextResponse.json({ authenticated, role: authenticated ? sessionRole(request) : '' }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    const configuredEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase() || '';
    const configuredPassword = process.env.ADMIN_PASSWORD || '';
    const sessionSecret = process.env.ADMIN_SESSION_SECRET || (process.env.NODE_ENV === 'production' ? '' : configuredPassword);

    if (!sessionSecret || (process.env.NODE_ENV === 'production' && sessionSecret.length < 32)) {
      return NextResponse.json({ error: 'Admin access is not securely configured. Set a unique email, a strong password, and a session secret.' }, { status: 503 });
    }
    if (!email || !password || email.length > 254 || password.length > 256) {
      return NextResponse.json({ error: 'Enter a valid email and password.' }, { status: 400 });
    }

    // x-real-ip is set by common reverse proxies. Never trust arbitrary X-Forwarded-For input here.
    const clientIp = request.headers.get('x-real-ip')?.trim() || 'unknown-client';
    const key = createHmac('sha256', sessionSecret).update(clientIp).digest('hex');
    const attempts = await pool.query(
      `INSERT INTO admin_login_attempts(ip_hash,attempts,window_started_at) VALUES($1,1,NOW())
       ON CONFLICT(ip_hash) DO UPDATE SET
         attempts=CASE WHEN admin_login_attempts.window_started_at < NOW() - INTERVAL '15 minutes' THEN 1 ELSE admin_login_attempts.attempts + 1 END,
         window_started_at=CASE WHEN admin_login_attempts.window_started_at < NOW() - INTERVAL '15 minutes' THEN NOW() ELSE admin_login_attempts.window_started_at END
       RETURNING attempts,window_started_at`, [key]);
    if (attempts.rows[0].attempts > LOGIN_LIMIT) {
      const retryAfter = Math.max(1, Math.ceil((new Date(attempts.rows[0].window_started_at).getTime() + LOGIN_WINDOW_MS - Date.now()) / 1000));
      return NextResponse.json({ error: 'Too many sign-in attempts. Try again later.' }, { status: 429, headers: { 'Retry-After': String(retryAfter), 'Cache-Control': 'no-store' } });
    }

    let user = (await pool.query('SELECT email,password_hash,role FROM admin_users WHERE email=$1', [email])).rows[0];
    if (!user) {
      const count = await pool.query('SELECT COUNT(*)::int AS count FROM admin_users');
      const configuredIsUsable = configuredEmail && configuredEmail !== 'admin@example.com' && configuredPassword.length >= 12 && configuredPassword !== 'CHANGE_ME';
      if (count.rows[0].count === 0 && configuredIsUsable && matchesConfiguredValue(email, configuredEmail) && matchesConfiguredValue(password, configuredPassword)) {
        const inserted = await pool.query('INSERT INTO admin_users(email,password_hash,role) VALUES($1,$2,\'owner\') RETURNING email,password_hash,role', [configuredEmail, await hashPassword(configuredPassword)]);
        user = inserted.rows[0];
      }
    }
    if (!user || !(await verifyPassword(password, user.password_hash))) return NextResponse.json({ error: 'Email or password is incorrect.' }, { status: 401 });

    await pool.query('DELETE FROM admin_login_attempts WHERE ip_hash=$1', [key]);

    const response = NextResponse.json({ authenticated: true, role: user.role }, { headers: { 'Cache-Control': 'no-store' } });
    response.cookies.set(adminCookie.name, createSession(user.email, user.role), adminCookie);
    return response;
  } catch {
    return NextResponse.json({ error: 'Invalid sign-in request.' }, { status: 400 });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ authenticated: false }, { headers: { 'Cache-Control': 'no-store' } });
  response.cookies.set(adminCookie.name, '', { ...adminCookie, maxAge: 0 });
  return response;
}
