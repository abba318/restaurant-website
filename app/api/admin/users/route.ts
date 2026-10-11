import { NextRequest, NextResponse } from 'next/server';
import { hashPassword, isOwner, sessionEmail } from '@/lib/admin-auth';
import { pool } from '@/lib/db';

export async function GET(request: NextRequest) {
  if (!isOwner(request)) return NextResponse.json({ error: 'Owner access required' }, { status: 403 });
  try {
    const result = await pool.query('SELECT id,email,role,created_at FROM admin_users ORDER BY created_at,id');
    return NextResponse.json(result.rows, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return NextResponse.json({ error: 'Unable to load staff accounts.' }, { status: 503 }); }
}

export async function POST(request: NextRequest) {
  if (!isOwner(request)) return NextResponse.json({ error: 'Owner access required' }, { status: 403 });
  try {
    const body = await request.json();
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    const role = body?.role === 'owner' || body?.role === 'kitchen' ? body.role : 'staff';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return NextResponse.json({ error: 'Enter a valid staff email.' }, { status: 400 });
    if (password.length < 12 || password.length > 256) return NextResponse.json({ error: 'Use a password with at least 12 characters.' }, { status: 400 });
    const result = await pool.query('INSERT INTO admin_users(email,password_hash,role) VALUES($1,$2,$3) RETURNING id,email,role,created_at', [email, await hashPassword(password), role]);
    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (error) {
    if ((error as { code?: string })?.code === '23505') return NextResponse.json({ error: 'An account already uses that email.' }, { status: 409 });
    return NextResponse.json({ error: 'Unable to create this staff account.' }, { status: 503 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!isOwner(request)) return NextResponse.json({ error: 'Owner access required' }, { status: 403 });
  try {
    const { searchParams } = new URL(request.url);
    const id = Number(searchParams.get('id'));
    if (!Number.isSafeInteger(id) || id < 1) return NextResponse.json({ error: 'Invalid staff account.' }, { status: 400 });
    const target = await pool.query('SELECT id,email,role FROM admin_users WHERE id=$1', [id]);
    if (!target.rowCount) return NextResponse.json({ error: 'Staff account not found.' }, { status: 404 });
    if (target.rows[0].email === sessionEmail(request)) return NextResponse.json({ error: 'You cannot remove your own account.' }, { status: 409 });
    if (target.rows[0].role === 'owner') {
      const owners = await pool.query("SELECT COUNT(*)::int AS count FROM admin_users WHERE role='owner'");
      if (owners.rows[0].count <= 1) return NextResponse.json({ error: 'The last owner account cannot be removed.' }, { status: 409 });
    }
    await pool.query('DELETE FROM admin_users WHERE id=$1', [id]);
    return NextResponse.json({ deleted: true });
  } catch { return NextResponse.json({ error: 'Unable to remove this staff account.' }, { status: 503 }); }
}
