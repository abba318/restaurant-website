import { NextRequest, NextResponse } from 'next/server';
import { adminCookie, createSession, hashPassword, isAdmin, sessionEmail, sessionRole, verifyPassword } from '@/lib/admin-auth';
import { pool } from '@/lib/db';

export async function POST(request: NextRequest) {
  if (!isAdmin(request)) return NextResponse.json({ error: 'Admin authentication required' }, { status: 401 });
  try {
    const body = await request.json();
    const currentPassword = typeof body?.currentPassword === 'string' ? body.currentPassword : '';
    const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : '';
    if (newPassword.length < 12 || newPassword.length > 256) return NextResponse.json({ error: 'Use a new password with at least 12 characters.' }, { status: 400 });
    const email = sessionEmail(request);
    const result = await pool.query('SELECT password_hash,role FROM admin_users WHERE email=$1', [email]);
    if (!result.rowCount || !(await verifyPassword(currentPassword, result.rows[0].password_hash))) return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 401 });
    const role = result.rows[0].role;
    await pool.query('UPDATE admin_users SET password_hash=$1 WHERE email=$2', [await hashPassword(newPassword), email]);
    const response = NextResponse.json({ changed: true });
    response.cookies.set(adminCookie.name, createSession(email, role), adminCookie);
    return response;
  } catch {
    return NextResponse.json({ error: 'Could not update the password.' }, { status: 503 });
  }
}
