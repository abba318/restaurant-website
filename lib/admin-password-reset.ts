import { createHmac } from 'crypto';
import { pool } from '@/lib/db';

let schemaReady: Promise<void> | null = null;

export function ensurePasswordResetSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await pool.query(`CREATE TABLE IF NOT EXISTS admin_password_reset_tokens (
        id BIGSERIAL PRIMARY KEY,
        email TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        consumed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      await pool.query('CREATE INDEX IF NOT EXISTS admin_password_reset_email_idx ON admin_password_reset_tokens(LOWER(email),created_at DESC)');
      await pool.query(`CREATE TABLE IF NOT EXISTS admin_password_reset_attempts (
        id BIGSERIAL PRIMARY KEY,
        purpose TEXT NOT NULL,
        email_hash TEXT NOT NULL,
        ip_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      await pool.query('CREATE INDEX IF NOT EXISTS admin_password_reset_attempts_email_idx ON admin_password_reset_attempts(purpose,email_hash,created_at DESC)');
      await pool.query('CREATE INDEX IF NOT EXISTS admin_password_reset_attempts_ip_idx ON admin_password_reset_attempts(purpose,ip_hash,created_at DESC)');
    })().catch((error) => { schemaReady = null; throw error; });
  }
  return schemaReady;
}

export function resetIdentifierHash(value: string) {
  const secret = process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD || 'restaurant-password-reset';
  return createHmac('sha256', secret).update(value).digest('hex');
}
