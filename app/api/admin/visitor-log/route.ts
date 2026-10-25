import { NextRequest, NextResponse } from "next/server";
import { isOwner } from "@/lib/admin-auth";
import { readVisitorLog } from "@/lib/visitor-log-reader";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;

export async function GET(request: NextRequest) {
  if (!isOwner(request)) {
    return NextResponse.json(
      { error: "Owner authentication required" },
      { status: 401, headers: { "Cache-Control": "no-store, private, max-age=0" } },
    );
  }

  const params = request.nextUrl.searchParams;
  const rawOffset = params.get("offset");
  const rawLimit = params.get("limit");
  const offset = rawOffset === null ? 0 : /^(0|[1-9]\d{0,8})$/.test(rawOffset) ? Number(rawOffset) : Number.NaN;
  const limit = rawLimit === null ? DEFAULT_LIMIT : /^(0|[1-9]\d{0,2})$/.test(rawLimit) ? Number(rawLimit) : Number.NaN;
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return NextResponse.json(
      { error: "Invalid pagination values" },
      { status: 400, headers: { "Cache-Control": "no-store, private, max-age=0" } },
    );
  }

  try {
    const allEntries = await readVisitorLog();
    const total = allEntries.length;
    const end = Math.max(0, total - offset);
    const start = Math.max(0, end - limit);
    const entries = allEntries.slice(start, end).reverse();
    const uniqueIps = new Set(allEntries.flatMap((entry) => entry.ip ? [entry.ip] : [])).size;

    return NextResponse.json(
      { entries, total, uniqueIps, offset, limit },
      { headers: { "Cache-Control": "no-store, private, max-age=0" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Unable to read the visitor log" },
      { status: 500, headers: { "Cache-Control": "no-store, private, max-age=0" } },
    );
  }
}
