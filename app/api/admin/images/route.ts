import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { isAdmin, unauthorized } from '@/lib/admin-auth';

export const runtime = 'nodejs';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = {
  'image/jpeg': { extension: 'jpg', matches: (bytes: Buffer) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  'image/png': { extension: 'png', matches: (bytes: Buffer) => bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/webp': { extension: 'webp', matches: (bytes: Buffer) => bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' },
} as const;

export async function POST(request: NextRequest) {
  if (!isAdmin(request)) return unauthorized();

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_IMAGE_BYTES + 64 * 1024) {
    return NextResponse.json({ error: 'Choose an image smaller than 5 MB.' }, { status: 413 });
  }

  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Choose a photo to upload.' }, { status: 400 });
    }
    if (file.size === 0 || file.size > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: 'Choose a non-empty image smaller than 5 MB.' }, { status: 413 });
    }

    const type = IMAGE_TYPES[file.type as keyof typeof IMAGE_TYPES];
    if (!type) {
      return NextResponse.json({ error: 'Use a JPG, PNG, or WebP image.' }, { status: 415 });
    }

    const image = Buffer.from(await file.arrayBuffer());
    if (!type.matches(image)) {
      return NextResponse.json({ error: 'The selected file does not match its image type.' }, { status: 415 });
    }

    const filename = `${randomUUID()}.${type.extension}`;
    const uploadDirectory = join(process.cwd(), 'public', 'uploads', 'menu');
    await mkdir(uploadDirectory, { recursive: true });
    await writeFile(join(uploadDirectory, filename), image, { flag: 'wx', mode: 0o644 });

    return NextResponse.json(
      { imageUrl: `/uploads/menu/${filename}` },
      { status: 201, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return NextResponse.json({ error: 'Unable to upload this photo right now.' }, { status: 500 });
  }
}
