// Which collections does the LIVE ruleset actually mention? Anything it does not
// mention is denied by default — safe, but silently so.
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
const sa = JSON.parse(readFileSync('./service-account.json', 'utf8'));
const app = initializeApp({ credential: cert(sa), projectId: sa.project_id });
const token = (await app.options.credential.getAccessToken()).access_token;
const base = 'https://firebaserules.googleapis.com/v1';
const auth = { headers: { Authorization: `Bearer ${token}` } };
const rel = await fetch(`${base}/projects/${sa.project_id}/releases`, auth).then(r => r.json());
const cfg = JSON.parse(readFileSync('./firebase-applet-config.json', 'utf8'));
const db = cfg.firestoreDatabaseId || '(default)';
const mine = (rel.releases || []).filter(r => r.name.includes('firestore') && r.name.includes(db));
const chosen = mine[0] || (rel.releases || []).find(r => r.name.includes('firestore'));
const rs = await fetch(`${base}/${chosen.rulesetName}`, auth).then(r => r.json());
const src = rs.source.files.map(f => f.content).join('\n');
const want = ['productCosts','orderCosts','coupons','couponRedemptions','couponAudit','couponStats','creditNotes','suppliers','supplierIndex','pointsLedger','secrets','users','orders'];
console.log(`\nالقواعد الحية: ${chosen.rulesetName.split('/').pop()}\n`);
for (const c of want) {
  const has = new RegExp(`match /${c}[/{ ]`).test(src) || new RegExp(`/${c}/`).test(src);
  console.log(`  ${has ? '✅ مذكور' : '⚠️ غير مذكور (مرفوض افتراضياً)'}  ${c}`);
}
console.log('\nlifetimeSpend مثبّت؟ ', /lifetimeSpend/.test(src) ? '✅ أيوه' : '❌ لأ — ثغرة مفتوحة');
console.log('loyaltyTier مثبّت؟  ', /loyaltyTier/.test(src) ? '✅ أيوه' : '❌ لأ');
console.log('loyaltyPoints مثبّت؟', /loyaltyPoints/.test(src) ? '✅ أيوه' : '❌ لأ');
