#!/usr/bin/env node
// Restart ONLY the local test shop's server (127.0.0.1:3100), keeping the
// emulators and everything in them — the imported supplier catalogue, orders,
// accounts. For a change to server.ts, which the dev server does not reload by
// itself. start-windows.mjs, by contrast, re-seeds the emulator from scratch.
//
//   node scripts/local-e2e/restart-shop.mjs
import { copyFileSync, openSync, rmSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const WORK = join(tmpdir(), 'reklamx-local-e2e');
const APP = join(WORK, 'app');
const PORT = 3100;
const EMU = { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8085', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199', GCLOUD_PROJECT: 'demo-reklamx' };

try { await fetch('http://127.0.0.1:8085', { signal: AbortSignal.timeout(3000) }); } catch {
  console.error('✗ the emulators are not running — use start-windows.mjs');
  process.exit(1);
}
// The copy's server files, refreshed from the project.
for (const f of ['server.ts', 'server-seo.ts']) copyFileSync(join(REPO, f), join(APP, f));
// The server's last-known-good lists: a restarted server serves them first, and
// they were written by the OLD code — a field it newly reads would be missing.
for (const f of ['categories.json', 'catalogue.json']) rmSync(join(APP, '.cache', f), { force: true });

spawnSync('powershell', ['-NoProfile', '-Command',
  `Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }`]);
const out = openSync(join(WORK, 'app-server.log'), 'w');
spawn(process.execPath, [join(REPO, 'node_modules/tsx/dist/cli.mjs'), 'server.ts'], {
  cwd: APP, detached: true, stdio: ['ignore', out, out], windowsHide: true,
  env: {
    ...process.env, ...EMU, PORT: String(PORT), HOST: '127.0.0.1', VITE_FIREBASE_EMULATOR: '1', AUTO_STAGE_SWEEP: 'off',
    SMTP_HOST: '127.0.0.1', SMTP_PORT: '2525', SMTP_USER: 'info@reklamx.test', SMTP_PASSWORD: 'sink',
    SHOP_ORDER_INBOX: 'order@reklamx.test', SHOP_CONTACT_INBOX: 'info@reklamx.test',
  },
}).unref();

for (let i = 0; i < 120; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  try {
    if ((await fetch(`http://127.0.0.1:${PORT}/api/health`, { signal: AbortSignal.timeout(3000) })).status === 200) {
      console.log(`✓ shop restarted — http://localhost:8080 (data kept)`);
      process.exit(0);
    }
  } catch { /* starting */ }
}
console.error(`✗ the shop did not start — see ${join(WORK, 'app-server.log')}`);
process.exit(1);
