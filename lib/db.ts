import { Pool } from 'pg';

const globalForPostgres = globalThis as typeof globalThis & { restaurantPool?: Pool };

const isLocal = !process.env.DATABASE_URL || process.env.DATABASE_URL.includes('localhost') || process.env.DATABASE_URL.includes('127.0.0.1');

export const pool = globalForPostgres.restaurantPool ?? new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 8,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  ssl: process.env.NODE_ENV === 'production' && !isLocal ? { rejectUnauthorized: true } : undefined,
});

if (process.env.NODE_ENV !== 'production') globalForPostgres.restaurantPool = pool;
