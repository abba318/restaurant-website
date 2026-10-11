import { randomBytes } from 'crypto';
import fs from 'fs';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error('Pass TELEGRAM_BOT_TOKEN in the environment.');
const path = '.env.local';
const lines = fs.readFileSync(path, 'utf8').split(/\r?\n/).filter((line) => !/^TELEGRAM_(BOT_TOKEN|WEBHOOK_SECRET)=/.test(line));
lines.push(`TELEGRAM_BOT_TOKEN=${token}`, `TELEGRAM_WEBHOOK_SECRET=${randomBytes(32).toString('hex')}`);
fs.writeFileSync(path, `${lines.filter(Boolean).join('\n')}\n`, { mode: 0o600 });
fs.chmodSync(path, 0o600);
console.log('Telegram bot credentials installed and webhook secret generated.');
