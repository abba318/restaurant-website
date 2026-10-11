import "dotenv/config";
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const token = process.env.NOTIFICATION_DISPATCH_TOKEN;
if (!token) {
  console.error("NOTIFICATION_DISPATCH_TOKEN is not configured");
  process.exit(1);
}
try {
  const response = await fetch("http://127.0.0.1:3000/api/internal/notifications", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20000),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`Dispatcher returned HTTP ${response.status}`);
  console.log(`${new Date().toISOString()} dispatched ${body.results?.length ?? 0} notifications`);
} catch (error) {
  console.error(`${new Date().toISOString()} notification dispatch failed:`, error.message);
  process.exitCode = 1;
}
