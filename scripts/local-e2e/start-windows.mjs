#!/usr/bin/env node
// LOCAL TEST MODE on Windows — the shop against the Firebase emulators.
// The Windows twin of start.sh: same copy, same parachutes, same seed, same
// ports, so the suites in this folder run against either.
//
//   node scripts/local-e2e/start-windows.mjs                    the test catalogue (test-data/)
//   node scripts/local-e2e/start-windows.mjs .backups/<dir>     or a backup of the real one
//   node scripts/local-e2e/stop-windows.mjs
//
// Then open http://127.0.0.1:3100 and sign in to /admin/login with
//   admin@emulator.test / emulator-admin-1      (exists only in the emulator)
//
// WHY IT CANNOT TOUCH THE LIVE SHOP (as start.sh — see README.md):
//   * it runs a COPY of the project without .env, .env.deploy or any service
//     account file, and refuses to start if one turns up in the copy;
//   * the copy uses the demo project id `demo-reklamx`, which real Firebase
//     answers only from local emulators, and a generated DUMMY service account;
//   * mail goes to a local sink (smtp-sink.mjs), never to a real mail server;
//   * nothing is ever written to the project folder itself.
//
// Needs Java for the Firestore emulator. If none is installed, a portable Java
// runtime (Eclipse Temurin 21 JRE, ~45 MB) is downloaded once into
// %LOCALAPPDATA%\reklamx-local\ — no installer, nothing system-wide.
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { cpSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const WORK = process.env.LOCAL_E2E_DIR || join(tmpdir(), 'reklamx-local-e2e');
const APP = join(WORK, 'app');
const DATA = resolve(process.argv[2] || join(REPO, 'scripts/local-e2e/test-data'));
const PORT = 3100;
const TOOLS = join(process.env.LOCALAPPDATA || tmpdir(), 'reklamx-local');
const step = (s) => console.log(`▸ ${s}`);
const fail = (s, code = 1) => { console.error(`✗ ${s}`); process.exit(code); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const f of ['products.json', 'categories.json', 'settings.json']) {
  if (!existsSync(join(DATA, f))) fail(`${DATA} has no ${f}. Make the test catalogue first: node scripts/local-e2e/make-test-data.mjs`);
}

// ── Java ──
function javaHome() {
  if (spawnSync('java', ['-version'], { shell: true }).status === 0) return null;   // on PATH already
  if (existsSync(TOOLS)) {
    const jre = readdirSync(TOOLS).find((d) => existsSync(join(TOOLS, d, 'bin', 'java.exe')));
    if (jre) return join(TOOLS, jre);
  }
  return undefined;
}
let JAVA_HOME = javaHome();
if (JAVA_HOME === undefined) {
  step('no Java found — downloading a portable Java 21 runtime (once, ~45 MB) into ' + TOOLS);
  mkdirSync(TOOLS, { recursive: true });
  const res = await fetch('https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jre/hotspot/normal/eclipse');
  if (!res.ok) fail(`Java download failed: HTTP ${res.status}`);
  const zip = join(TOOLS, 'jre.zip');
  writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  if (spawnSync('tar', ['-xf', zip, '-C', TOOLS], { stdio: 'inherit' }).status !== 0) fail('could not unpack the Java runtime');
  rmSync(zip, { force: true });
  JAVA_HOME = javaHome();
  if (!JAVA_HOME) fail('Java runtime unpacked but java.exe not found');
}
const javaEnv = JAVA_HOME ? { JAVA_HOME, PATH: `${join(JAVA_HOME, 'bin')};${process.env.PATH}` } : {};

// ── Ports ──
function killPort(port) {
  spawnSync('powershell', ['-NoProfile', '-Command',
    `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }`]);
}
async function answers(url) {
  try { await fetch(url, { signal: AbortSignal.timeout(3000) }); return true; } catch { return false; }
}
function startDetached(cmd, args, { cwd, env, log }) {
  const out = openSync(log, 'w');
  const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, detached: true, stdio: ['ignore', out, out], windowsHide: true, shell: cmd.endsWith('.cmd') });
  child.unref();
}

// ── The copy: everything except secrets, build output and dependencies ──
step(`copying the project to ${APP} (without .env, .env.deploy or any key file)`);
killPort(PORT);   // the old copy's server holds files open
// Emulators already running use files inside the copy (rules, their logs), so
// it is refreshed in place then, and only rebuilt from empty when they are off.
const emulatorsUp = await answers('http://127.0.0.1:8085');
if (!emulatorsUp) rmSync(APP, { recursive: true, force: true, maxRetries: 5 });
mkdirSync(WORK, { recursive: true });
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.cache', '.backups', 'release']);
const isSecret = (name) => /^\.env/i.test(name) || /service[-_]?account|adminsdk/i.test(name);
cpSync(REPO, APP, {
  recursive: true,
  filter: (src) => {
    const name = basename(src);
    if (src === REPO.replace(/[\\/]$/, '')) return true;
    return !SKIP_DIRS.has(name) && !isSecret(name);
  },
});
if (!existsSync(join(APP, 'node_modules'))) symlinkSync(join(REPO, 'node_modules'), join(APP, 'node_modules'), 'junction');

writeFileSync(join(APP, 'firebase-applet-config.json'), JSON.stringify({
  projectId: 'demo-reklamx', appId: '1:000000000000:web:0000000000000000000000', apiKey: 'demo-api-key',
  authDomain: 'demo-reklamx.firebaseapp.com', firestoreDatabaseId: '(default)', storageBucket: 'demo-reklamx.appspot.com',
  messagingSenderId: '000000000000',
}, null, 2));
writeFileSync(join(APP, 'firebase.json'), JSON.stringify({
  firestore: { rules: 'firestore.rules', indexes: 'firestore.indexes.json' },
  storage: { rules: 'storage.rules' },
  emulators: {
    firestore: { host: '127.0.0.1', port: 8085 }, auth: { host: '127.0.0.1', port: 9099 },
    storage: { host: '127.0.0.1', port: 9199 }, ui: { enabled: false }, singleProjectMode: true,
  },
}, null, 2));
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
writeFileSync(join(APP, 'service-account.json'), JSON.stringify({
  type: 'service_account', project_id: 'demo-reklamx', private_key_id: 'dummy',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  client_email: 'emulator@demo-reklamx.iam.gserviceaccount.com', client_id: '0', token_uri: 'http://127.0.0.1:9/token',
}, null, 2));

// The parachutes: nothing real may be in the copy.
const secretsInCopy = readdirSync(APP).filter((n) => /^\.env/i.test(n));
if (secretsInCopy.length) fail(`secret files in the test copy (${secretsInCopy.join(', ')}) — refusing`, 3);
if (JSON.parse(readFileSync(join(APP, 'service-account.json'), 'utf8')).project_id !== 'demo-reklamx') fail('service-account.json is not the dummy — refusing', 3);
if (JSON.parse(readFileSync(join(APP, 'firebase-applet-config.json'), 'utf8')).projectId !== 'demo-reklamx') fail('the copy is not on the demo project — refusing', 3);

const EMU = { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8085', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199', GCLOUD_PROJECT: 'demo-reklamx' };

// ── Emulators ──
if (!emulatorsUp) {
  step('starting the Firebase emulators (the first run downloads them — a few minutes)');
  const log = join(WORK, 'emulators.log');
  // On Windows a detached `npx.cmd` opens its OWN console window and writes
  // there, not to the log — so readiness is the three emulators answering,
  // never a line in a file. Closing that window stops the emulators.
  startDetached('npx.cmd', ['-y', 'firebase-tools@15', 'emulators:start', '--only', 'firestore,auth,storage', '--project', 'demo-reklamx'], { cwd: APP, env: javaEnv, log });
  const ports = ['http://127.0.0.1:8085', 'http://127.0.0.1:9099', 'http://127.0.0.1:9199'];
  let ready = false;
  for (let i = 0; i < 600 && !ready; i++) {
    await sleep(1000);
    ready = (await Promise.all(ports.map(answers))).every(Boolean);
  }
  if (!ready) fail(`the emulators did not start — see their console window, or ${log}`);
}

step(`resetting and seeding the emulator from ${DATA}`);
await fetch('http://127.0.0.1:8085/emulator/v1/projects/demo-reklamx/databases/(default)/documents', { method: 'DELETE' });
const seeded = spawnSync(process.execPath, [join(REPO, 'scripts/local-e2e/seed.cjs'), DATA], { cwd: APP, env: { ...process.env, ...EMU }, stdio: 'inherit' });
if (seeded.status !== 0) fail('seeding failed');

// ── Mail sink ──
const MAIL_LOG = process.env.MAIL_LOG || join(tmpdir(), 'reklamx-local-e2e-mail.jsonl');
killPort(2525);
writeFileSync(MAIL_LOG, '');
startDetached(process.execPath, [join(REPO, 'scripts/local-e2e/smtp-sink.mjs')], { cwd: APP, env: { SINK_LOG: MAIL_LOG }, log: join(WORK, 'smtp-sink.log') });

// ── The shop ──
step(`starting the shop on http://127.0.0.1:${PORT}`);
startDetached(process.execPath, [join(REPO, 'node_modules/tsx/dist/cli.mjs'), 'server.ts'], {
  cwd: APP,
  log: join(WORK, 'app-server.log'),
  env: {
    ...EMU, PORT: String(PORT), HOST: '127.0.0.1', VITE_FIREBASE_EMULATOR: '1', AUTO_STAGE_SWEEP: 'off',
    SMTP_HOST: '127.0.0.1', SMTP_PORT: '2525', SMTP_USER: 'info@reklamx.test', SMTP_PASSWORD: 'sink',
    SHOP_ORDER_INBOX: 'order@reklamx.test', SHOP_CONTACT_INBOX: 'info@reklamx.test',
  },
});
let healthy = false;
for (let i = 0; i < 120 && !healthy; i++) {
  await sleep(1000);
  try { healthy = (await fetch(`http://127.0.0.1:${PORT}/api/health`, { signal: AbortSignal.timeout(3000) })).status === 200; } catch { /* starting */ }
}
if (!healthy) fail(`the shop did not start — see ${join(WORK, 'app-server.log')}`);

// ── The developer's usual address: localhost:8080 forwards to the shop ──
const DEV_PORT = 8080;
killPort(DEV_PORT);
startDetached(process.execPath, [join(REPO, 'scripts/local-e2e/forward.mjs'), String(DEV_PORT), String(PORT)], { cwd: REPO, log: join(WORK, 'forward.log') });

console.log(`
✓ ready — http://localhost:${DEV_PORT}  (also http://127.0.0.1:${PORT})
  admin:  admin@emulator.test / emulator-admin-1   (sign in at /admin/login)
  staff:  staff@emulator.test / emulator-staff-1
  customers: register any address — it exists only in the emulator
  e-mails the shop sends: ${MAIL_LOG}
  stop:   node scripts/local-e2e/stop-windows.mjs`);
process.exit(0);
