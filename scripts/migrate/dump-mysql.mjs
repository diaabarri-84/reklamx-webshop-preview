#!/usr/bin/env node
// ONE .sql FILE OF THE SHOP'S DATABASE — the tables (migration/schema.sql) and
// every row — for phpMyAdmin's Import on a host where nothing else is allowed.
// No mysqldump needed.
//
//   MYSQL_URL=mysql://root@127.0.0.1:3307/reklamx node scripts/migrate/dump-mysql.mjs release/reklamx.sql
//
// Rows go out in batches of INSERTs small enough for a shared host's
// max_allowed_packet; the file sets utf8mb4 and turns foreign-key checks off
// while it loads, so tables can arrive in any order.
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import mysql from 'mysql2/promise';

const out = process.argv[2] ?? 'release/reklamx.sql';
const url = process.env.MYSQL_URL;
if (!url) { console.error('MYSQL_URL is not set.'); process.exit(1); }
const conn = await mysql.createConnection({ uri: url, charset: 'utf8mb4' });
mkdirSync(dirname(out), { recursive: true });

writeFileSync(out, [
  '-- ReklamX shop database — tables and data.',
  `-- Exported ${new Date().toISOString()} from ${new URL(url).host}.`,
  '-- Import into an EMPTY database (phpMyAdmin → Import).',
  'SET NAMES utf8mb4;',
  'SET FOREIGN_KEY_CHECKS = 0;',
  '',
  readFileSync(new URL('../../migration/schema.sql', import.meta.url), 'utf8'),
  '',
].join('\n'));

const [tables] = await conn.query('SHOW TABLES');
const MAX = 512 * 1024;   // per INSERT statement
let total = 0;
for (const t of tables.map((r) => Object.values(r)[0])) {
  const [rows] = await conn.query(`SELECT * FROM \`${t}\``);
  if (!rows.length) continue;
  const cols = Object.keys(rows[0]);
  const head = `INSERT INTO \`${t}\` (${cols.map((c) => `\`${c}\``).join(', ')}) VALUES\n`;
  let batch = [];
  let size = 0;
  const flush = () => {
    if (!batch.length) return;
    appendFileSync(out, `${head}${batch.join(',\n')};\n`);
    batch = []; size = 0;
  };
  for (const r of rows) {
    const values = `(${cols.map((c) => conn.escape(r[c])).join(', ')})`;
    if (size + values.length > MAX) flush();
    batch.push(values);
    size += values.length;
  }
  flush();
  total += rows.length;
  console.log(`${String(rows.length).padStart(6)}  ${t}`);
}
appendFileSync(out, '\nSET FOREIGN_KEY_CHECKS = 1;\n');
await conn.end();
console.log(`✓ ${total} rows → ${out}`);
