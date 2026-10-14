#!/usr/bin/env node
// Is this machine ready to serve the shop to real customers?
//
// Run it on the SERVER, after uploading the code and setting the environment,
// and it will tell you what is still wrong before a customer finds out. Run it
// locally too — it will simply say that a few production-only settings are not
// set here, which is correct.
//
//   node scripts/preflight.mjs             # check everything it can offline
//   node scripts/preflight.mjs --online    # also call Firebase and the live domain
//
// Exit code 0 = safe to open the shop. 1 = at least one blocker.
//
// WHY THIS EXISTS
// Every item below is something that fails SILENTLY. The shop starts, the home
// page loads, and the thing that is broken is discovered by a paying customer:
// a payment that never confirms because the webhook could not reach the server,
// an order email nobody receives, a server bound to localhost that the world
// cannot see. None of that shows up in a build log.

import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ONLINE = process.argv.includes('--online');

// The server reads .env itself, so read it the same way for an honest picture.
for (const file of ['.env.production', '.env']) {
  const path = join(ROOT, file);
  if (!existsSync(path)) continue;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_0-9]+)\s*=\s*(.*)$/);
    if (!m) continue;
    const [, key, raw] = m;
    if (process.env[key] === undefined) {
      process.env[key] = raw.trim().replace(/^["']|["']$/g, '');
    }
  }
  break;
}

const rows = [];
const pass = (area, what, detail = '') => rows.push({ level: 'ok', area, what, detail });
const warn = (area, what, detail = '') => rows.push({ level: 'warn', area, what, detail });
const fail = (area, what, detail = '') => rows.push({ level: 'fail', area, what, detail });

const env = (name) => (process.env[name] ?? '').trim();
const isProd = env('NODE_ENV') === 'production';

// ───────────────────────────── the build ─────────────────────────────
{
  const client = join(ROOT, 'dist', 'index.html');
  const server = join(ROOT, 'dist', 'server.cjs');

  existsSync(client) && existsSync(server)
    ? pass('build', 'dist/ is built', 'index.html + server.cjs')
    : fail('build', 'dist/ is missing', 'run `npm run build` before starting the server');

  if (existsSync(server)) {
    // A dist older than the source is the classic "I deployed and nothing
    // changed" — the server is happily serving last week's code.
    const built = statSync(server).mtimeMs;
    let newest = 0;
    const walk = (dir) => {
      for (const entry of readFileSync ? execSync(`find ${JSON.stringify(dir)} -type f -name '*.ts*'`, { encoding: 'utf8' }).trim().split('\n') : []) {
        if (!entry) continue;
        const m = statSync(entry).mtimeMs;
        if (m > newest) newest = m;
      }
    };
    try {
      walk(join(ROOT, 'src'));
      const serverTs = statSync(join(ROOT, 'server.ts')).mtimeMs;
      if (serverTs > newest) newest = serverTs;
      newest > built
        ? fail('build', 'dist/ is older than the source', 'run `npm run build` again — the server would serve stale code')
        : pass('build', 'dist/ is newer than the source');
    } catch {
      warn('build', 'could not compare dist/ against the source');
    }
  }
}

// ───────────────────────────── the network address ─────────────────────────────
{
  const host = env('HOST');
  const port = env('PORT') || '3000 (default)';
  pass('server', 'port', port);

  if (!host) {
    pass('server', 'HOST is unset', 'binds 0.0.0.0 — reachable from outside, which is what a host needs');
  } else if (host === '0.0.0.0') {
    pass('server', 'HOST=0.0.0.0', 'reachable from outside');
  } else if (isProd) {
    fail(
      'server',
      `HOST=${host} in production`,
      'the shop will only answer on the machine itself. This is the local development setting; ' +
        'remove HOST from the server\'s .env unless a reverse proxy on the SAME machine forwards to it',
    );
  } else {
    pass('server', `HOST=${host}`, 'loopback only — correct for local development');
  }

  isProd
    ? pass('server', 'NODE_ENV=production')
    : warn('server', `NODE_ENV=${env('NODE_ENV') || '(unset)'}`, 'set NODE_ENV=production on the server');

  const proxy = env('TRUST_PROXY');
  if (isProd && proxy !== '1' && proxy !== 'true') {
    warn(
      'server',
      'TRUST_PROXY is not set',
      'set TRUST_PROXY=1 when nginx / Caddy / a platform router sits in front, or rate limiting sees ' +
        'one IP for every customer and the shop throttles itself',
    );
  } else if (proxy) {
    pass('server', `TRUST_PROXY=${proxy}`);
  }
}

// ───────────────────────────── the public address ─────────────────────────────
{
  const url = env('PUBLIC_URL');
  if (!url) {
    isProd
      ? fail(
          'domain',
          'PUBLIC_URL is not set',
          'Mollie is given no webhook address, so a paid order is never confirmed automatically, and the ' +
            '"view your order" link in the confirmation email points nowhere. Set it to https://your-domain',
        )
      : warn('domain', 'PUBLIC_URL is not set', 'correct locally — Mollie cannot reach a laptop');
  } else if (!/^https:\/\//i.test(url)) {
    fail('domain', `PUBLIC_URL is not https (${url})`, 'Mollie will not call a plain-http webhook');
  } else if (/localhost|127\.0\.0\.1/.test(url)) {
    fail('domain', `PUBLIC_URL points at this machine (${url})`, 'it must be the public domain');
  } else if (url.endsWith('/')) {
    warn('domain', `PUBLIC_URL has a trailing slash (${url})`, 'harmless — the code strips it — but tidy it up');
  } else {
    pass('domain', 'PUBLIC_URL', url);
  }
}

// ───────────────────────────── payments ─────────────────────────────
{
  const key = env('MOLLIE_API_KEY');
  if (!key) {
    fail('payments', 'MOLLIE_API_KEY is missing', 'checkout cannot take money at all');
  } else if (key.startsWith('test_')) {
    isProd
      ? fail('payments', 'Mollie is on a TEST key', 'no real payment can be taken. Swap in the live_ key')
      : pass('payments', 'Mollie test key', 'correct for a non-production run');
  } else if (key.startsWith('live_')) {
    pass('payments', 'Mollie LIVE key', 'real money will move');
  } else {
    fail('payments', 'MOLLIE_API_KEY does not look like a Mollie key', 'expected it to start with test_ or live_');
  }
}

// ───────────────────────────── email ─────────────────────────────
{
  const need = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD'];
  const missing = need.filter((n) => !env(n));
  if (missing.length) {
    fail(
      'email',
      `SMTP is not configured (${missing.join(', ')})`,
      'no order confirmation reaches the customer and no notification reaches the shop. The order itself ' +
        'still completes, so this failure is invisible',
    );
  } else {
    pass('email', 'SMTP configured', `${env('SMTP_HOST')}:${env('SMTP_PORT') || '465'} as ${env('SMTP_USER')}`);
    const from = env('SMTP_FROM') || env('SMTP_USER');
    /@gmail\.com$/i.test(from)
      ? warn(
          'email',
          `customers will see ${from} as the sender`,
          'a shop on its own domain should send from it — a gmail.com sender for a reklamx.se shop looks ' +
            'like phishing to both customers and spam filters',
        )
      : pass('email', 'sender address', from);
    env('SHOP_ORDER_INBOX')
      ? pass('email', 'shop inbox', env('SHOP_ORDER_INBOX'))
      : warn('email', 'SHOP_ORDER_INBOX is unset', 'order notifications go to SMTP_USER instead');
  }
}

// ───────────────────────────── Firebase ─────────────────────────────
{
  const inline = env('FIREBASE_SERVICE_ACCOUNT');
  const path = env('GOOGLE_APPLICATION_CREDENTIALS');
  const local = join(ROOT, 'service-account.json');

  if (inline) {
    try {
      const parsed = JSON.parse(inline);
      parsed.project_id
        ? pass('firebase', 'admin credentials from FIREBASE_SERVICE_ACCOUNT', parsed.project_id)
        : fail('firebase', 'FIREBASE_SERVICE_ACCOUNT has no project_id');
    } catch {
      fail('firebase', 'FIREBASE_SERVICE_ACCOUNT is not valid JSON');
    }
  } else if (path && existsSync(path)) {
    pass('firebase', 'admin credentials from GOOGLE_APPLICATION_CREDENTIALS', path);
  } else if (existsSync(local)) {
    isProd
      ? warn(
          'firebase',
          'admin credentials come from service-account.json on disk',
          'it works, but the file must never be in git and must not be world-readable. Prefer ' +
            'FIREBASE_SERVICE_ACCOUNT as an environment variable on the host',
        )
      : pass('firebase', 'admin credentials from service-account.json');
  } else {
    fail(
      'firebase',
      'no Firebase admin credentials',
      'the shop still shows products and quotes prices, but NO ORDER CAN BE CREATED',
    );
  }

  const cfgPath = join(ROOT, 'firebase-applet-config.json');
  if (existsSync(cfgPath)) {
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    cfg.projectId && cfg.apiKey
      ? pass('firebase', 'browser config', `${cfg.projectId} · db ${cfg.firestoreDatabaseId || '(default)'}`)
      : fail('firebase', 'firebase-applet-config.json is incomplete');
  } else {
    fail('firebase', 'firebase-applet-config.json is missing', 'the browser cannot reach Firebase at all');
  }
}

// ───────────────────────────── secrets in git ─────────────────────────────
{
  try {
    const tracked = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).split('\n');
    const leaked = tracked.filter((f) => /service[-_]?account|^\.env$|\.env\.(local|production)$/i.test(f));
    leaked.length === 0
      ? pass('secrets', 'no credentials tracked by git')
      : fail('secrets', 'credentials are committed', leaked.join(', '));
  } catch {
    warn('secrets', 'not a git repository here — could not check for committed credentials');
  }
}

// ───────────────────────────── live checks ─────────────────────────────
if (ONLINE) {
  const url = env('PUBLIC_URL');
  if (url && /^https:\/\//i.test(url) && !/localhost/.test(url)) {
    try {
      const r = await fetch(`${url.replace(/\/+$/, '')}/api/health`, { signal: AbortSignal.timeout(15000) });
      const body = await r.json().catch(() => ({}));
      r.ok && body?.status === 'ok'
        ? pass('live', 'the domain answers /api/health', url)
        : fail('live', `the domain answered ${r.status}`, "Mollie's webhook would fail the same way");
    } catch (err) {
      fail('live', 'the domain did not answer', String(err?.message ?? err).slice(0, 90));
    }
  } else {
    warn('live', 'skipped the domain check', 'PUBLIC_URL is not a public https address');
  }

  // Are the deployed security rules the ones in this repo?
  try {
    const out = execSync('node scripts/rules-status.mjs', { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
    /LIVE === REPO/.test(out)
      ? pass('live', 'security rules match firestore.rules')
      : fail('live', 'the deployed security rules differ from firestore.rules', 'run scripts/deploy-rules.mjs');
  } catch (err) {
    warn('live', 'could not check the security rules', String(err?.message ?? err).slice(0, 90));
  }
}

// ───────────────────────────── report ─────────────────────────────
const icon = { ok: '  ✅', warn: '  ⚠️ ', fail: '  ❌' };
let area = '';
console.log('');
for (const r of rows) {
  if (r.area !== area) {
    area = r.area;
    console.log(`\n${area.toUpperCase()}`);
  }
  console.log(`${icon[r.level]} ${r.what}${r.detail ? `\n        ${r.detail}` : ''}`);
}

const fails = rows.filter((r) => r.level === 'fail').length;
const warns = rows.filter((r) => r.level === 'warn').length;
console.log(
  `\n${rows.length - fails - warns} ok · ${warns} to look at · ${fails} blocking\n` +
    (fails === 0
      ? '✅ Nothing is blocking. Read the warnings, then open the shop.'
      : '❌ Fix the blocking items above before letting customers in.'),
);
if (!ONLINE) console.log('   (add --online to also call the live domain and check the security rules)');
process.exit(fails === 0 ? 0 : 1);
