import { chmod, mkdir, open } from "node:fs/promises";
import { isIP } from "node:net";
import { join } from "node:path";

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;
const MAX_PATH_LENGTH = 2048;

function clientIpFrom(headers: Headers): string | null {
  // Nginx overwrites X-Real-IP with $remote_addr. Avoid X-Forwarded-For,
  // which is configured with $proxy_add_x_forwarded_for and may contain
  // client-supplied values before the proxy's address.
  const rawIp = headers.get("x-real-ip");
  if (!rawIp || rawIp.length > 64) return null;

  const ip = rawIp.trim();
  return isIP(ip) ? ip : null;
}

function safeHeaderValue(value: string | null, maxLength: number): string | null {
  if (!value) return null;

  const cleaned = value.replace(CONTROL_CHARACTERS, " ").trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

function safeReferrer(headers: Headers): string | null {
  const rawReferrer = headers.get("referer");
  if (!rawReferrer || rawReferrer.length > MAX_PATH_LENGTH) return null;

  try {
    const referrer = new URL(rawReferrer);
    if (referrer.protocol !== "http:" && referrer.protocol !== "https:") {
      return null;
    }

    // Keep the referring page while dropping query strings and fragments,
    // which can contain tokens or other sensitive values.
    return `${referrer.origin}${referrer.pathname}`.slice(0, MAX_PATH_LENGTH);
  } catch {
    return null;
  }
}

export async function writeVisitorLog(headers: Headers, requestedPath: string): Promise<void> {
  const entry = {
    timestamp: new Date().toISOString(),
    ip: clientIpFrom(headers),
    page: requestedPath.startsWith("/")
      ? requestedPath.replace(CONTROL_CHARACTERS, " ").slice(0, MAX_PATH_LENGTH)
      : "/",
    userAgent: safeHeaderValue(headers.get("user-agent"), 512),
    referrer: safeReferrer(headers),
  };

  const logDirectory = join(process.cwd(), ".private");
  const logFile = join(logDirectory, "visitor-access.jsonl");

  await mkdir(logDirectory, { recursive: true, mode: 0o700 });
  await chmod(logDirectory, 0o700);

  const file = await open(logFile, "a", 0o600);
  try {
    await file.chmod(0o600);
    await file.writeFile(`${JSON.stringify(entry)}\n`, "utf8");
  } finally {
    await file.close();
  }
}
