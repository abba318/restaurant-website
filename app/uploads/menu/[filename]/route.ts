import { readFile } from 'fs/promises';
import { join } from 'path';
import { NextRequest, NextResponse } from 'next/server';

const IMAGE_EXTENSIONS = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
} as const;

export async function GET(_request: NextRequest, { params }: { params: Promise<{ filename: string }> }) {
  const { filename } = await params;
  const match = /^([0-9a-f-]{36})\.(jpg|png|webp)$/i.exec(filename);
  if (!match) return NextResponse.json({ error: 'Photo not found.' }, { status: 404 });

  try {
    const image = await readFile(join(process.cwd(), 'public', 'uploads', 'menu', filename));
    return new NextResponse(image, {
      headers: {
        'Content-Type': IMAGE_EXTENSIONS[match[2] as keyof typeof IMAGE_EXTENSIONS],
        'Content-Length': String(image.byteLength),
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Photo not found.' }, { status: 404 });
  }
}
