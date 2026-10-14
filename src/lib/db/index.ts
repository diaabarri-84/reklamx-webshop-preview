// The shop's MySQL connection — the replacement for getAdminDb()'s Firestore.
//
// Configured from the environment (cPanel: Setup Node.js App → environment variables):
//   MYSQL_URL         mysql://user:password@host:3306/database   (or the five below)
//   MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE
//   DB_SECRETS_KEY    32 random bytes, base64 — encrypts the `secrets` table.
//                     Generate once:  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
//                     Losing it means re-entering the shop's API keys in the dashboard.
//
// Returns null when no database is configured, like getAdminDb() does without a
// service account, so the shop can still start and say what is missing.

import mysql, { type Pool } from 'mysql2/promise';
import { DocStore } from './docStore';

let cached: { pool: Pool; store: DocStore } | null = null;

export function getDocStore(): DocStore | null {
  if (cached) return cached.store;
  const url = process.env.MYSQL_URL?.trim();
  const host = process.env.MYSQL_HOST?.trim();
  if (!url && !host) return null;

  const pool = mysql.createPool({
    ...(url ? { uri: url } : {
      host,
      port: Number(process.env.MYSQL_PORT) || 3306,
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
    }),
    charset: 'utf8mb4',
    connectionLimit: Number(process.env.MYSQL_POOL_SIZE) || 10,
    enableKeepAlive: true,
  });
  // Strict mode on every connection, whatever the host's default: a value that
  // does not fit must be an error, never silently truncated.
  pool.on('connection', (conn) => {
    conn.query("SET SESSION sql_mode = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'");
  });

  const rawKey = process.env.DB_SECRETS_KEY?.trim();
  const secretsKey = rawKey ? Buffer.from(rawKey, 'base64') : null;
  cached = { pool, store: new DocStore(pool, { secretsKey }) };
  return cached.store;
}

export { DocStore, FieldValue, FieldPath, DocStoreError } from './docStore';
