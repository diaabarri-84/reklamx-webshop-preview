#!/usr/bin/env node
// Release firestore.rules to the live project — with a way back.
//
// WHY THIS EXISTS
// There is no Firebase CLI on this machine, and `firestore.rules` had drifted
// 114 lines away from the ruleset actually protecting the customers' data: the
// released one dated from 2026-08-13 and still said orders were readable by
// admins only, so every hardening written since had no effect at all.
//
// Releasing rules is the one operation here that can lock real customers out of
// a live shop, so this does it in the careful order:
//   1. read what is released now and WRITE IT TO .backups/ ;
//   2. create the new ruleset — the API compiles it, so a syntax error fails
//      here, before anything is live;
//   3. release it;
//   4. print the exact command that puts the old one back.
//
// Requires service-account.json in the project root (gitignored).
//
//   node scripts/deploy-rules.mjs                      # dry run: diff only
//   node scripts/deploy-rules.mjs --apply              # release firestore.rules
//   node scripts/deploy-rules.mjs --rollback <ruleset> # re-release an old one

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert } from 'firebase-admin/app';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sa = JSON.parse(readFileSync(join(ROOT, 'service-account.json'), 'utf8'));
const appConfig = JSON.parse(readFileSync(join(ROOT, 'firebase-applet-config.json'), 'utf8'));
const DB = appConfig.firestoreDatabaseId || '(default)';
const PROJECT = sa.project_id;

const app = initializeApp({ credential: cert(sa), projectId: PROJECT });
const token = (await app.options.credential.getAccessToken()).access_token;

const API = 'https://firebaserules.googleapis.com/v1';
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
// The release is named per DATABASE on a project with a named Firestore.
const RELEASE = `projects/${PROJECT}/releases/cloud.firestore/${DB}`;

const APPLY = process.argv.includes('--apply');
const rollbackIdx = process.argv.indexOf('--rollback');
const ROLLBACK_TO = rollbackIdx !== -1 ? process.argv[rollbackIdx + 1] : null;

async function api(path, init) {
  const resp = await fetch(`${API}/${path}`, { headers, ...init });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`${resp.status} ${path}\n${text.slice(0, 600)}`);
  return text ? JSON.parse(text) : {};
}

async function currentRelease() {
  const { releases = [] } = await api(`projects/${PROJECT}/releases`);
  return releases.find((r) => r.name === RELEASE) ?? null;
}

async function release(rulesetName) {
  // A release is updated, not created, once it exists.
  return api(`${RELEASE}?updateMask=rulesetName`, {
    method: 'PATCH',
    body: JSON.stringify({ release: { name: RELEASE, rulesetName } }),
  });
}

console.log(`Project:  ${PROJECT}`);
console.log(`Database: ${DB}`);

const live = await currentRelease();
if (!live) {
  console.error(`No release found at ${RELEASE}. Refusing to guess.`);
  process.exit(1);
}
console.log(`Live now: ${live.rulesetName}  (released ${live.updateTime})`);

if (ROLLBACK_TO) {
  if (!APPLY) {
    console.log(`\nDry run. Would re-release ${ROLLBACK_TO}.`);
    process.exit(0);
  }
  await release(ROLLBACK_TO);
  console.log(`\nRolled back to ${ROLLBACK_TO}.`);
  process.exit(0);
}

// What is live, verbatim, so it can be restored even if the ruleset were deleted.
const liveRuleset = await api(live.rulesetName);
const liveSource = (liveRuleset.source?.files ?? []).map((f) => f.content).join('\n');
const repoSource = readFileSync(join(ROOT, 'firestore.rules'), 'utf8');

const norm = (s) => s.replace(/\r\n/g, '\n').trimEnd();
if (norm(liveSource) === norm(repoSource)) {
  console.log('\nLive rules already match firestore.rules. Nothing to do.');
  process.exit(0);
}

console.log(`\nfirestore.rules differs from what is live (${norm(liveSource).split('\n').length} live lines vs ${norm(repoSource).split('\n').length} in the repo).`);

if (!APPLY) {
  console.log('\nDry run — nothing was released. Re-run with --apply.');
  process.exit(0);
}

mkdirSync(join(ROOT, '.backups'), { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = join(ROOT, '.backups', `firestore-rules-live-${stamp}.rules`);
writeFileSync(backup, liveSource, 'utf8');
writeFileSync(
  join(ROOT, '.backups', `firestore-rules-release-${stamp}.json`),
  JSON.stringify({ release: RELEASE, previousRulesetName: live.rulesetName, updateTime: live.updateTime }, null, 2),
  'utf8',
);
console.log(`\nSaved the live rules to ${backup}`);

// Creating the ruleset compiles it. A syntax error stops here, still safe.
const created = await api(`projects/${PROJECT}/rulesets`, {
  method: 'POST',
  body: JSON.stringify({
    source: { files: [{ name: 'firestore.rules', content: repoSource }] },
  }),
});
console.log(`Compiled and stored as ${created.name}`);

await release(created.name);
console.log(`RELEASED. ${RELEASE} → ${created.name}`);
console.log(`\nTo undo:\n  node scripts/deploy-rules.mjs --rollback ${live.rulesetName} --apply`);
process.exit(0);
