import "server-only";
import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import { join } from "node:path";

export type VisitorLogEntry = {
  timestamp: string;
  ip: string | null;
  page: string;
  userAgent: string | null;
  deviceType: string;
  browser: string;
  operatingSystem: string;
  referrer: string | null;
};

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;
const MAX_ENTRY_LENGTH = 16_384;

function safeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(CONTROL_CHARACTERS, " ").trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

function safeReferrer(value: unknown): string | null {
  const raw = safeText(value, 2048);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return `${url.origin}${url.pathname}`.slice(0, 2048);
  } catch {
    return null;
  }
}

function describeUserAgent(userAgent: string | null) {
  if (!userAgent) {
    return { deviceType: "Unknown", browser: "Unknown", operatingSystem: "Unknown" };
  }

  const isBot = /bot|crawler|spider|slurp|headless/i.test(userAgent);
  const deviceType = isBot
    ? "Automated"
    : /iPad|Tablet|Kindle|Silk|Android(?!.*Mobile)|SM-T\d/i.test(userAgent)
      ? "Tablet"
      : /Mobile|iPhone|iPod|Windows Phone|Android.*Mobile/i.test(userAgent)
        ? "Phone"
        : "Desktop";

  let browser = "Unknown";
  if (isBot) browser = "Automated client";
  else if (/EdgA?\//i.test(userAgent) || /EdgiOS\//i.test(userAgent)) browser = "Microsoft Edge";
  else if (/SamsungBrowser\//i.test(userAgent)) browser = "Samsung Internet";
  else if (/OPR\//i.test(userAgent) || /Opera\//i.test(userAgent)) browser = "Opera";
  else if (/Vivaldi\//i.test(userAgent)) browser = "Vivaldi";
  else if (/UCBrowser\//i.test(userAgent)) browser = "UC Browser";
  else if (/FxiOS\//i.test(userAgent) || /Firefox\//i.test(userAgent)) browser = "Firefox";
  else if (/CriOS\//i.test(userAgent) || /Chrome\//i.test(userAgent)) browser = "Chrome";
  else if (/Chromium\//i.test(userAgent)) browser = "Chromium";
  else if (/Safari\//i.test(userAgent) && /Version\//i.test(userAgent)) browser = "Safari";
  else if (/MSIE\s|Trident\//i.test(userAgent)) browser = "Internet Explorer";

  let operatingSystem = "Unknown";
  if (/CrOS/i.test(userAgent)) operatingSystem = "ChromeOS";
  else if (/Windows NT|Windows Phone|Win(32|64)?/i.test(userAgent)) operatingSystem = "Windows";
  else if (/iPhone|iPad|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && /Mobile\//i.test(userAgent))) operatingSystem = "iOS / iPadOS";
  else if (/Android/i.test(userAgent)) operatingSystem = "Android";
  else if (/Mac OS X|Macintosh/i.test(userAgent)) operatingSystem = "macOS";
  else if (/Linux|X11/i.test(userAgent)) operatingSystem = "Linux";

  return { deviceType, browser, operatingSystem };
}

function parseEntry(line: string): VisitorLogEntry | null {
  if (!line || line.length > MAX_ENTRY_LENGTH) return null;
  try {
    const value: unknown = JSON.parse(line);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    const timestamp = safeText(row.timestamp, 64);
    if (!timestamp || !Number.isFinite(Date.parse(timestamp))) return null;

    const page = safeText(row.page, 2048);
    const rawIp = typeof row.ip === "string" && row.ip.length <= 64 ? row.ip.trim() : "";
    const userAgent = safeText(row.userAgent, 512);

    return {
      timestamp,
      ip: isIP(rawIp) ? rawIp : null,
      page: page?.startsWith("/") ? page : "/",
      userAgent,
      ...describeUserAgent(userAgent),
      referrer: safeReferrer(row.referrer),
    };
  } catch {
    return null;
  }
}

export async function readVisitorLog(): Promise<VisitorLogEntry[]> {
  const logFile = join(process.cwd(), ".private", "visitor-access.jsonl");
  let contents: string;
  try {
    contents = await readFile(logFile, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  return contents.split(/\r?\n/).map(parseEntry).filter((entry): entry is VisitorLogEntry => entry !== null);
}
