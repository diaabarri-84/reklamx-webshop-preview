#!/usr/bin/env node
// Do firestore.rules and storage.rules actually COMPILE?
//
// WHY IT EXISTS
// A syntax error in a rules file is not a failed deploy — it is a shop where
// every read is denied, and it is discovered by a customer. The Firebase Rules
// API compiles a ruleset when it is CREATED, which happens before any release,
// so the compiler can be asked without touching what is live.
//
// Nothing here releases anything. It creates a ruleset, reads the errors, and
// leaves it unreferenced.
//
//   node scripts/check-rules-compile.mjs

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert } from 'firebase-admin/app';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
if (!existsSync(join(ROOT, 'service-account.json'))) {
  console.error('service-account.json not found — cannot reach the rules compiler.');
  process.exit(1);
}
const sa = JSON.parse(readFileSync(join(ROOT, 'service-account.json'), 'utf8'));
const app = initializeApp({ credential: cert(sa), projectId: sa.project_id });
const token = (await app.options.credential.getAccessToken()).access_token;

let failed = 0;
for (const file of ['firestore.rules', 'storage.rules']) {
  const path = join(ROOT, file);
  if (!existsSync(path)) { console.log(`  ⓘ  ${file} not present`); continue; }
  const content = readFileSync(path, 'utf8');
  const res = await fetch(`https://firebaserules.googleapis.com/v1/projects/${sa.project_id}/rulesets`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: { files: [{ name: file, content }] } }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.ok) {
    console.log(`  ✅ ${file} compiles (${content.split('\n').length} lines) — ruleset ${String(body.name).split('/').pop()}`);
    continue;
  }
  failed += 1;
  console.error(`  ❌ ${file} DOES NOT COMPILE`);
  // The API reports the line and column, which is the whole point of asking it.
  const issues = body?.error?.details?.[0]?.issues ?? [];
  if (issues.length) {
    for (const i of issues) {
      console.error(`       ${file}:${i.sourcePosition?.line ?? '?'}:${i.sourcePosition?.column ?? '?'}  ${i.description}`);
    }
  } else {
    console.error(`       ${JSON.stringify(body).slice(0, 400)}`);
  }
}

console.log(failed === 0 ? '\nBoth rules files compile.' : `\n${failed} file(s) would deny every request if released.`);
process.exit(failed === 0 ? 0 : 1);
