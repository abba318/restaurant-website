import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual, timingSafeEqual as safeEqual } from 'crypto';
import { promisify } from 'util';
import { NextRequest, NextResponse } from 'next/server';

const scrypt = promisify(scryptCallback);

const COOKIE = 'restaurant_admin_session';
const maxAge = 60 * 60 * 8;
function secret() { return process.env.ADMIN_SESSION_SECRET || (process.env.NODE_ENV === 'production' ? '' : process.env.ADMIN_PASSWORD || ''); }
function signature(payload: string) { return createHmac('sha256', secret()).update(payload).digest('base64url'); }
export function createSession(email: string, role = 'owner') { const payload = Buffer.from(JSON.stringify({ email, role, exp: Date.now() + maxAge * 1000 })).toString('base64url'); return `${payload}.${signature(payload)}`; }
export function validSession(token: string | undefined) { try { if (!token || !secret()) return false; const [payload, sig] = token.split('.'); const expected = signature(payload); if (!sig || sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false; return JSON.parse(Buffer.from(payload, 'base64url').toString()).exp > Date.now(); } catch { return false; } }
export function isAuthenticated(request: NextRequest) { return validSession(request.cookies.get(COOKIE)?.value); }
export function isAdmin(request: NextRequest) { return isAuthenticated(request) && sessionRole(request) !== 'kitchen'; }
export function isKitchen(request: NextRequest) { return isAuthenticated(request) && sessionRole(request) === 'kitchen'; }
export function sessionEmail(request: NextRequest) { try { const token = request.cookies.get(COOKIE)?.value; if (!validSession(token) || !token) return 'admin'; return String(JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString()).email || 'admin'); } catch { return 'admin'; } }
export function sessionRole(request: NextRequest) { try { const token = request.cookies.get(COOKIE)?.value; if (!validSession(token) || !token) return ''; return String(JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString()).role || 'owner'); } catch { return ''; } }
export function isOwner(request: NextRequest) { return isAdmin(request) && sessionRole(request) === 'owner'; }
export async function hashPassword(password: string) { const salt = randomBytes(16).toString('hex'); const key = await scrypt(password, salt, 64) as Buffer; return `${salt}:${key.toString('hex')}`; }
export async function verifyPassword(password: string, stored: string) { try { const [salt, digest] = stored.split(':'); if (!salt || !digest) return false; const key = await scrypt(password, salt, 64) as Buffer; const expected = Buffer.from(digest, 'hex'); return key.length === expected.length && safeEqual(key, expected); } catch { return false; } }
export function unauthorized() { return NextResponse.json({ error: 'Admin authentication required' }, { status: 401 }); }
export const adminCookie = { name: COOKIE, maxAge, httpOnly: true, sameSite: 'strict' as const, secure: process.env.NODE_ENV === 'production', path: '/' };
