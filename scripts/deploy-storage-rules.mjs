#!/usr/bin/env node
// Release storage.rules to the live project — with a way back.
//
// WHY THIS EXISTS
// `scripts/deploy-rules.mjs` releases the FIRESTORE rules and nothing else, so
// there was no way to release `storage.rules` from this repo at all — the last
// release, from 2026-08-17, had been made by hand somewhere else.
//
// READ THIS BEFORE YOU PANIC ABOUT THE LINE COUNT. The dry run reports 36 live
// lines against 55 in the repo, and that gap is COMMENTS ONLY. The live rules
// were fetched and compared on 2026-09-12: every function, every match block and
// every condition is identical, isAdmin() included. Releasing this changes no
// behaviour whatsoever. It exists so the next real edit has a tested way out.
//
// Releasing storage rules can lock real people out of their own files, so this
// does it in the careful order, the same one deploy-rules.mjs uses:
//   1. read what is released now and WRITE IT TO .backups/ ;
//   2. create the new ruleset — the API compiles it, so a syntax error fails
//      here, before anything is live;
//   3. release it;
//   4. print the exact command that puts the old one back.
//
//   node scripts/deploy-storage-rules.mjs                      # dry run: diff only
//   node scripts/deploy-storage-rules.mjs --apply              # release storage.rules
//   node scripts/deploy-storage-rules.mjs --rollback <ruleset> # re-release an old one

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert } from 'firebase-admin/app';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sa = JSON.parse(readFileSync(join(ROOT, 'service-account.json'), 'utf8'));
const cfg = JSON.parse(readFileSync(join(ROOT, 'firebase-applet-config.json'), 'utf8'));
const PROJECT = sa.project_id;
const BUCKET = cfg.storageBucket;

const app = initializeApp({ credential: cert(sa), projectId: PROJECT });
const token = (await app.options.credential.getAccessToken()).access_token;
const API = 'https://firebaserules.googleapis.com/v1';
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

// Storage releases are named per BUCKET, not per database.
const RELEASE = `projects/${PROJECT}/releases/firebase.storage/${BUCKET}`;

const APPLY = process.argv.includes('--apply');
const rbIdx = process.argv.indexOf('--rollback');
const ROLLBACK_TO = rbIdx !== -1 ? process.argv[rbIdx + 1] : null;

async function api(path, init) {
  const r = await fetch(`${API}/${path}`, { headers, ...init });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${path}\n${t.slice(0, 600)}`);
  return t ? JSON.parse(t) : {};
}

const { releases = [] } = await api(`projects/${PROJECT}/releases`);
const current = releases.find((r) => r.name === RELEASE) ?? null;

console.log(`Project:  ${PROJECT}`);
console.log(`Bucket:   ${BUCKET}`);
if (!current) {
  console.log('Live now: NOTHING — storage rules have never been released for this bucket.');
} else {
  console.log(`Live now: ${current.rulesetName}  (released ${current.updateTime})`);
}

const local = readFileSync(join(ROOT, 'storage.rules'), 'utf8');

// Cheap, and it costs nothing to be sure of the file this whole script is about.
if (!/^\s*service\s+firebase\.storage\b/m.test(local)) {
  console.error('\n❌ storage.rules does not declare `service firebase.storage`. Refusing to release it.');
  process.exit(1);
}

if (ROLLBACK_TO) {
  // A ruleset id typed by hand is the most dangerous argument this script takes.
  // The first version of this block took whatever it was given, PATCHed with it,
  // and on ANY failure retried blindly with a POST — so a mistyped id produced a
  // confusing second error, and a real one was hidden behind it. On 2026-09-12
  // the owner double-clicked the revert launcher by accident and typed a single
  // Arabic letter at this prompt. Nothing broke, but only by luck.
  //
  // So: resolve the id against the project FIRST, show what it contains, and
  // refuse anything that does not exist.
  const full = ROLLBACK_TO.startsWith('projects/')
    ? ROLLBACK_TO
    : `projects/${PROJECT}/rulesets/${ROLLBACK_TO}`;

  if (!/^projects\/[A-Za-z0-9_-]+\/rulesets\/[A-Za-z0-9_-]+$/.test(full)) {
    console.error(`\n❌ "${ROLLBACK_TO}" is not a ruleset id. Nothing was changed.`);
    console.error('   It looks like aa07a4e3-9f19-48dc-b3c9-a1d62f9ef4a1');
    process.exit(1);
  }

  let target;
  try {
    target = await api(full);
  } catch {
    console.error(`\n❌ This project has no ruleset "${ROLLBACK_TO}". Nothing was changed.`);
    try {
      const { rulesets = [] } = await api(`projects/${PROJECT}/rulesets?pageSize=25`);
      if (rulesets.length) {
        console.error('\n   The ones that do exist (newest first):');
        for (const rs of rulesets.slice(0, 10)) {
          const id = rs.name.split('/').pop();
          console.error(`     ${id}   ${rs.createTime}${current && current.rulesetName === rs.name ? '   ← live now' : ''}`);
        }
      }
    } catch { /* listing is a convenience; its failure must not mask the real one */ }
    process.exit(1);
  }

  const targetSource = (((target.source || {}).files || [])[0] || {}).content || '';

  // Rulesets are listed PER PROJECT, not per service — the list above mixes this
  // bucket's storage rulesets with every Firestore ruleset deploy-rules.mjs has
  // ever created, and the newest entries are Firestore ones. Releasing a Firestore
  // ruleset under the storage release name would put `service cloud.firestore`
  // rules in charge of the bucket. Existence is not enough; check what it IS.
  if (!/^\s*service\s+firebase\.storage\b/m.test(targetSource)) {
    const svc = (targetSource.match(/^\s*service\s+([^\s{]+)/m) || [])[1] || 'unknown';
    console.error(`\n❌ ${ROLLBACK_TO} is a "${svc}" ruleset, not a storage one. Nothing was changed.`);
    console.error('   The list of rulesets covers the whole project, Firestore included.');
    console.error('   A storage ruleset starts with: service firebase.storage');
    process.exit(1);
  }

  console.log(`\nRolling back to ${full}`);
  console.log(`  created ${target.createTime} · ${targetSource.split('\n').length} lines`);
  console.log(
    `  its rules are ${rulesOnly(targetSource) === rulesOnly(local) ? 'IDENTICAL to' : 'DIFFERENT from'} storage.rules in this repo`,
  );
  if (current && current.rulesetName === full) {
    console.log('\n  That is already what is live. Nothing to do.');
    process.exit(0);
  }

  if (!APPLY) { console.log('\nDry run. Add --apply to release it.'); process.exit(0); }

  try {
    await api(RELEASE, {
      method: 'PATCH',
      body: JSON.stringify({ release: { name: RELEASE, rulesetName: full } }),
    });
  } catch (patchErr) {
    // The only failure a POST legitimately fixes is "no release exists yet".
    // Anything else is real, and both errors get shown rather than one hiding
    // the other.
    try {
      await api(`projects/${PROJECT}/releases`, {
        method: 'POST',
        body: JSON.stringify({ name: RELEASE, rulesetName: full }),
      });
    } catch (postErr) {
      console.error('\n❌ Rollback failed. Nothing was changed.');
      console.error(`   update: ${patchErr.message}`);
      console.error(`   create: ${postErr.message}`);
      process.exit(1);
    }
  }

  await confirmLive(full, 'ROLLED BACK');
  process.exit(0);
}

// Never trust a 200 on a release call — read the project back and say what is
// actually live now. A release that reports success and did not take is the
// worst possible outcome here, because everything downstream assumes it did.
async function confirmLive(expected, verb) {
  const { releases: after = [] } = await api(`projects/${PROJECT}/releases`);
  const now = after.find((r) => r.name === RELEASE) ?? null;
  if (now && now.rulesetName === expected) {
    console.log(`\n✅ ${verb}. ${RELEASE}\n   → ${expected}`);
    return true;
  }
  console.error(`\n❌ The API accepted it but the live release is ${now ? now.rulesetName : 'still NOTHING'}.`);
  console.error('   Treat the rules as UNCHANGED and run this again.');
  process.exit(1);
}

let liveSource = '';
if (current) {
  const rs = await api(current.rulesetName);
  liveSource = (((rs.source || {}).files || [])[0] || {}).content || '';
}

if (liveSource.trim() === local.trim()) {
  console.log('\nstorage.rules is already what is live. Nothing to do.');
  process.exit(0);
}
// A line count is a terrible way to judge a rules file: comments make it move and
// change nothing. Strip them — quote-aware, so a `https://` inside a string is not
// mistaken for one — and say plainly whether any RULE actually differs. Reading
// "36 vs 55" and assuming the shop was unprotected is exactly the wrong call, and
// on 2026-09-12 it was the wrong call.
function rulesOnly(src) {
  return src
    .split('\n')
    .map((line) => {
      let out = '';
      let quote = null;
      for (let i = 0; i < line.length; i += 1) {
        const c = line[i];
        if (quote) {
          out += c;
          if (c === quote && line[i - 1] !== '\\') quote = null;
          continue;
        }
        if (c === '"' || c === "'") { quote = c; out += c; continue; }
        if (c === '/' && line[i + 1] === '/') break;
        out += c;
      }
      return out.trim().replace(/\s+/g, ' ');
    })
    .filter(Boolean)
    .join('\n');
}

const sameRules = rulesOnly(liveSource) === rulesOnly(local);
console.log(
  `\nstorage.rules differs from what is live: ${liveSource.split('\n').length} live lines vs ${local.split('\n').length} in the repo.`,
);
console.log(
  sameRules
    ? '  …but the RULES are identical — the difference is comments only. Releasing changes no behaviour.'
    : '  …and the RULES themselves differ. Read the diff before releasing; this one can lock people out.',
);

if (!APPLY) {
  console.log('\nDry run. Add --apply to release it.');
  process.exit(0);
}

// 1 — keep the old one on disk before anything changes.
const dir = join(ROOT, '.backups');
mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = join(dir, `storage-rules-live-${stamp}.rules`);
writeFileSync(backup, liveSource || '// nothing was released\n');
console.log(`Saved the live rules to ${backup}`);

// 2 — the API compiles it, so a syntax error fails here, not in production.
const created = await api(`projects/${PROJECT}/rulesets`, {
  method: 'POST',
  body: JSON.stringify({ source: { files: [{ name: 'storage.rules', content: local }] } }),
});
console.log(`Compiled and stored as ${created.name}`);

// 3 — release it. A release is updated once it exists, created the first time.
if (current) {
  await api(RELEASE, { method: 'PATCH', body: JSON.stringify({ release: { name: RELEASE, rulesetName: created.name } }) });
} else {
  await api(`projects/${PROJECT}/releases`, { method: 'POST', body: JSON.stringify({ name: RELEASE, rulesetName: created.name }) });
}

// 4 — read it back. Saying "RELEASED" on the strength of a 200 alone is how a
// rules deploy silently does nothing.
await confirmLive(created.name, 'RELEASED');

if (current) {
  console.log('\nTo undo:');
  console.log(`  node scripts/deploy-storage-rules.mjs --rollback ${current.rulesetName} --apply`);
}
