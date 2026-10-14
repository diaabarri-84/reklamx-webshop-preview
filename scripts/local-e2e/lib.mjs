// Shared helpers for the LOCAL browser suites — the emulator-backed copy of the
// shop that start.sh runs on :3100 (see README.md). Nothing here can reach the
// real Firebase project: the Admin SDK below refuses anything but a local
// emulator, and the copy itself runs under the demo project id.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO = process.env.REPO || fileURLToPath(new URL('../..', import.meta.url));
const require = createRequire(`${REPO}/package.json`);
export const { chromium } = require('playwright');
const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

export const BASE = 'http://127.0.0.1:3100';
export const SHOTS = process.env.SHOTS || join(tmpdir(), 'reklamx-local-e2e-shots');
/** What the shop's e-mails said, one JSON line each — written by smtp-sink.mjs (start.sh). */
export const MAIL_LOG = process.env.MAIL_LOG || join(tmpdir(), 'reklamx-local-e2e-mail.jsonl');
mkdirSync(SHOTS, { recursive: true });

// Admin SDK straight at the EMULATOR (refuses anything else) — to read what a
// screen actually saved, which is the only thing a test should believe.
if (!String(process.env.FIRESTORE_EMULATOR_HOST || '').startsWith('127.0.0.1:')) {
  throw new Error('FIRESTORE_EMULATOR_HOST must point at the local emulator');
}
const app = getApps().find((a) => a.name === 'e2e') ?? initializeApp({ projectId: 'demo-reklamx' }, 'e2e');
export const db = getFirestore(app);

let failed = 0;
let passed = 0;
export function check(name, ok, detail = '') {
  if (ok) { passed += 1; console.log(`  ✅ ${name}`); }
  else { failed += 1; console.log(`  ❌ ${name}${detail ? `\n       ${detail}` : ''}`); }
}
export function summary() {
  console.log(`\n${failed ? '❌' : '✅'} ${passed} passed, ${failed} failed`);
  return failed;
}

export async function launch({ mobile = false } = {}) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext(
    mobile
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
      : { viewport: { width: 1440, height: 1000 } },
  );
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e?.message ?? e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  return { browser, context, page, errors };
}

export async function loginAdmin(page, email = 'admin@emulator.test', password = 'emulator-admin-1') {
  await page.goto(`${BASE}/admin/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await page.locator('input[type="password"]').first().press('Enter');
  await page.waitForURL((u) => !u.pathname.startsWith('/admin/login'), { timeout: 20000 }).catch(() => {});
}

/** Drag a dnd-kit grip to a target element's centre, in small pointer steps. */
export async function dragTo(page, grip, target, { offsetY = 0 } = {}) {
  // Both ends must be on screen — a list inside a scrolling box reports a
  // position outside the viewport otherwise, and the "drag" never lands.
  await target.scrollIntoViewIfNeeded();
  await grip.scrollIntoViewIfNeeded();
  const a = await grip.boundingBox();
  const b = await target.boundingBox();
  if (!a || !b) throw new Error('drag: element not visible');
  const sx = a.x + a.width / 2;
  const sy = a.y + a.height / 2;
  const tx = b.x + b.width / 2;
  const ty = b.y + b.height / 2 + offsetY;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx, sy + 6, { steps: 3 });
  await page.mouse.move(tx, ty, { steps: 18 });
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(250);
}
