#!/usr/bin/env node
// A LOCAL MariaDB for the MySQL version of the shop — Windows, this machine only.
//
//   node scripts/local-mysql.mjs start     start it (creates the database and tables the first time)
//   node scripts/local-mysql.mjs stop
//   node scripts/local-mysql.mjs reset     drop every table and recreate them from migration/schema.sql
//
// MariaDB 10.6 — the version cPanel hosts commonly run; the data layer is tested
// on it (npm run test:db). Binaries in %LOCALAPPDATA%\reklamx-local\mariadb, the
// data in ...\mariadb-data, so it survives restarts. Listens on 127.0.0.1:3307
// only, root without a password: never reachable from outside this machine.
//
// The shop connects with:
//   MYSQL_URL=mysql://root@127.0.0.1:3307/reklamx
import { existsSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TOOLS = join(process.env.LOCALAPPDATA ?? '', 'reklamx-local');
const BIN = join(TOOLS, 'mariadb', 'bin');
const DATA = join(TOOLS, 'mariadb-data');
const PORT = 3307;
export const LOCAL_MYSQL_URL = `mysql://root@127.0.0.1:${PORT}/reklamx`;

const cmd = process.argv[2] ?? 'start';
const fail = (m) => { console.error(`✗ ${m}`); process.exit(1); };
if (!existsSync(join(BIN, 'mariadbd.exe'))) fail(`MariaDB is not at ${BIN}`);

async function connect(database) {
  const mysql = await import('mysql2/promise');
  return mysql.createConnection({ host: '127.0.0.1', port: PORT, user: 'root', database, multipleStatements: true, charset: 'utf8mb4' });
}
async function up() {
  try { const c = await connect(); await c.end(); return true; } catch { return false; }
}
async function applySchema(conn) {
  await conn.query(readFileSync(join(ROOT, 'migration', 'schema.sql'), 'utf8'));
}

if (cmd === 'stop') {
  spawnSync(join(BIN, 'mariadb-admin.exe'), ['-uroot', `--port=${PORT}`, '--host=127.0.0.1', 'shutdown']);
  spawnSync('powershell', ['-NoProfile', '-Command',
    `Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }`]);
  console.log('stopped');
  process.exit(0);
}

if (!(await up())) {
  if (!existsSync(join(DATA, 'mysql'))) {
    mkdirSync(DATA, { recursive: true });
    const init = spawnSync(join(BIN, 'mariadb-install-db.exe'), [`--datadir=${DATA}`, `--port=${PORT}`], { encoding: 'utf8' });
    if (init.status !== 0) fail(`could not create the data folder:\n${init.stderr || init.stdout}`);
  }
  const log = openSync(join(TOOLS, 'mariadb.log'), 'a');
  spawn(join(BIN, 'mariadbd.exe'), [
    `--datadir=${DATA}`, `--port=${PORT}`, '--bind-address=127.0.0.1', '--character-set-server=utf8mb4',
    '--collation-server=utf8mb4_bin', '--max-allowed-packet=64M', '--innodb-buffer-pool-size=256M',
  ], { detached: true, stdio: ['ignore', log, log], windowsHide: true }).unref();
  for (let i = 0; i < 60 && !(await up()); i++) await new Promise((r) => setTimeout(r, 500));
  if (!(await up())) fail(`MariaDB did not start — see ${join(TOOLS, 'mariadb.log')}`);
}

const conn = await connect();
await conn.query('CREATE DATABASE IF NOT EXISTS reklamx CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
await conn.query('USE reklamx');
const [tables] = await conn.query('SHOW TABLES');
if (cmd === 'reset') {
  await conn.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const row of tables) await conn.query(`DROP TABLE \`${Object.values(row)[0]}\``);
  await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  await applySchema(conn);
  console.log('✓ tables recreated from migration/schema.sql');
} else if (!tables.length) {
  await applySchema(conn);
  console.log('✓ tables created from migration/schema.sql');
}
const [[{ v }]] = await conn.query('SELECT VERSION() AS v');
const [now] = await conn.query('SHOW TABLES');
await conn.end();
console.log(`✓ MariaDB ${v} on 127.0.0.1:${PORT}, database reklamx, ${now.length} tables`);
console.log(`  MYSQL_URL=${LOCAL_MYSQL_URL}`);
process.exit(0);
