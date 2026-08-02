import 'server-only';
import { Pool } from 'pg';

/**
 * Единый пул соединений. Используется только в Server Components (нет в клиентском бандле).
 *
 * Настройки под serverless (Vercel): небольшой max, чтобы не исчерпать лимит
 * соединений внешней БД (Supabase/Neon), и короткий таймаут.
 * Для managed-провайдеров строка подключения обычно требует SSL:
 *   postgres://user:pass@host:5432/db?sslmode=require
 *   (Supabase pooled:  ...?sslmode=require&pgbouncer=true)
 */
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30_000,
});
