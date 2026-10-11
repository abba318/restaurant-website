import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

const token = process.env.TELEGRAM_BOT_TOKEN;
const appUrl = process.env.NEXT_PUBLIC_APP_URL;
const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
if (!token) throw new Error('Set TELEGRAM_BOT_TOKEN in .env.local first.');
if (!appUrl || !appUrl.startsWith('https://')) throw new Error('NEXT_PUBLIC_APP_URL must be the public HTTPS website URL.');
if (!webhookSecret || webhookSecret.length < 32) throw new Error('Set a random TELEGRAM_WEBHOOK_SECRET with at least 32 characters.');

async function telegram(method, body) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok !== true) throw new Error(`Telegram ${method} failed (HTTP ${response.status}).`);
}

await telegram('setWebhook', {
  url: `${appUrl.replace(/\/$/, '')}/api/telegram/webhook`,
  secret_token: webhookSecret,
  allowed_updates: ['message', 'callback_query'],
});
await telegram('setChatMenuButton', { menu_button: { type: 'commands' } });
await telegram('setMyCommands', { commands: [
  { command: 'start', description: 'Open the restaurant dashboard' },
  { command: 'dashboard', description: 'Show orders and management actions' },
  { command: 'help', description: 'How to use the dashboard bot' },
] });
console.log(`Telegram webhook connected to ${appUrl.replace(/\/$/, '')}/api/telegram/webhook`);
