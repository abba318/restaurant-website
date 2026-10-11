import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { handleTelegramUpdate } from '@/lib/telegram-bot';

function validSecret(supplied: string | null, expected: string) {
  if (!supplied || supplied.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

export async function POST(request: NextRequest) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET || '';
  if (!secret || !validSecret(request.headers.get('x-telegram-bot-api-secret-token'), secret)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  try {
    await handleTelegramUpdate(await request.json());
  } catch (error) {
    console.error('Telegram update failed:', error instanceof Error ? error.message : 'unknown error');
  }
  return NextResponse.json({ ok: true });
}
