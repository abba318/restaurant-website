import { createHash, timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { dispatchNotifications } from '@/lib/notifications';

export async function POST(request: NextRequest) {
  const expected = process.env.NOTIFICATION_DISPATCH_TOKEN || '';
  const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  if (!expected || !supplied || !timingSafeEqual(createHash('sha256').update(expected).digest(), createHash('sha256').update(supplied).digest())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { return NextResponse.json({ results: await dispatchNotifications() }, { headers: { 'Cache-Control': 'no-store' } }); }
  catch { return NextResponse.json({ error: 'Notification dispatch failed.' }, { status: 503 }); }
}
