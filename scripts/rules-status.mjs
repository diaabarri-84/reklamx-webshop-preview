#!/usr/bin/env node
// Are the security rules in this repo the ones actually running?
//
// WHY THIS EXISTS
// firestore.rules is a file in git; what protects the customers' data is
// whatever ruleset was last RELEASED to the project. Those two drift silently,
// and nothing in the app can tell you — a rule you wrote, reviewed and committed
// simply has no effect. Run this before assuming a rule is in force.
//
// Read-only. It releases nothing.
//
//   node scripts/rules-status.mjs
import { readFileSync } from 'node:fs';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getApp } from 'firebase-admin/app';

const sa = JSON.parse(readFileSync('./service-account.json', 'utf8'));
const app = initializeApp({ credential: cert(sa), projectId: sa.project_id });
const token = (await app.options.credential.getAccessToken()).access_token;

const base = 'https://firebaserules.googleapis.com/v1';
const auth = { headers: { Authorization: `Bearer ${token}` } };

const rel = await fetch(`${base}/projects/${sa.project_id}/releases`, auth).then((r) => r.json());
// This project uses a NAMED database, so the release is
// releases/cloud.firestore/<databaseId>, not releases/cloud.firestore.
const DB = 'ai-studio-67b3d2fe-143f-469d-b3a4-49dcbdfef939';
const fsRelease = (rel.releases ?? []).find((r) => r.name.endsWith(`/cloud.firestore/${DB}`));
if (!fsRelease) {
  console.log('No cloud.firestore release found.');
  console.log(JSON.stringify(rel).slice(0, 400));
  process.exit(0);
}
console.log('Live ruleset:', fsRelease.rulesetName, '| updated', fsRelease.updateTime);

const rs = await fetch(`${base}/${fsRelease.rulesetName}`, auth).then((r) => r.json());
const liveSource = (rs.source?.files ?? []).map((f) => f.content).join('\n');
const repoSource = readFileSync('./firestore.rules', 'utf8');

const norm = (s) => s.replace(/\r\n/g, '\n').trimEnd();
if (norm(liveSource) === norm(repoSource)) {
  console.log('\nLIVE === REPO (identical).');
} else {
  const l = norm(liveSource).split('\n');
  const r = norm(repoSource).split('\n');
  console.log(`\nDIFFERENT — live ${l.length} lines, repo ${r.length} lines.`);
  // Line-set difference is enough to see whether anything but our change moved.
  const setL = new Set(l.map((x) => x.trim()));
  const setR = new Set(r.map((x) => x.trim()));
  const onlyLive = l.filter((x) => x.trim() && !setR.has(x.trim()));
  const onlyRepo = r.filter((x) => x.trim() && !setL.has(x.trim()));
  console.log(`\nONLY IN LIVE (${onlyLive.length}):`);
  onlyLive.slice(0, 40).forEach((x) => console.log('  -', x.trim().slice(0, 150)));
  console.log(`\nONLY IN REPO (${onlyRepo.length}):`);
  onlyRepo.slice(0, 40).forEach((x) => console.log('  +', x.trim().slice(0, 150)));
}
process.exit(0);
