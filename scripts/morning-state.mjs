#!/usr/bin/env node
// What the morning run actually left behind — read-only, and it writes nothing.
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
const sa = JSON.parse(readFileSync('./service-account.json', 'utf8'));
const cfg = JSON.parse(readFileSync('./firebase-applet-config.json', 'utf8'));
initializeApp({ credential: cert(sa), projectId: sa.project_id });
const db = getFirestore(cfg.firestoreDatabaseId || '(default)');

console.log('\n──── ١ — الحصة ────');
try {
  const t0 = Date.now();
  const c = await db.collection('categories').select('name').get();
  console.log(`  ✅ رجعت — قرأ ${c.size} تصنيف في ${Date.now() - t0}ms`);
} catch (e) {
  console.log(`  🔴 لسه مقفولة — ${String(e.message).slice(0, 90)}`);
  process.exit(1);
}

console.log('\n──── ٢ — اسم المورد على المنتجات (الـbackfill) ────');
const prods = await db.collection('products').select('supplierName', 'supplierOfferId', 'name').get();
let withName = 0, without = 0;
const missing = [];
for (const d of prods.docs) {
  if (String(d.data().supplierName ?? '').trim()) withName += 1;
  else { without += 1; if (missing.length < 5) missing.push(d.data().name ?? d.id); }
}
console.log(`  إجمالي المنتجات: ${prods.size}`);
console.log(`  ${withName} عليهم اسم مورد · ${without} من غير`);
if (without) console.log(`  (من غير اسم — دول غالباً منتجاته اليدوية: ${missing.join(' · ')}${without > 5 ? ' …' : ''})`);

console.log('\n──── ٣ — كوبون TEST100 ────');
const coupons = await db.collection('coupons').get();
console.log(`  عدد الكوبونات: ${coupons.size}`);
const test100 = coupons.docs.find((d) => String(d.data().code ?? d.id).toUpperCase() === 'TEST100');
if (!test100) console.log('  ✅ TEST100 مش موجود خالص');
else {
  const t = test100.data();
  const live = t.active !== false;
  console.log(`  ${live ? '🔴 لسه فعّال' : '✅ موقوف'} — ${t.percent}% · استُخدم ${t.usedCount ?? 0} مرة`);
}
for (const d of coupons.docs) {
  const c = d.data();
  console.log(`    · ${String(c.code ?? d.id).padEnd(14)} ${String(c.percent ?? '?').padStart(3)}%  ${c.active === false ? 'موقوف' : 'فعّال'}  سقف=${c.maxDiscountAmount ?? '—'}  استُخدم=${c.usedCount ?? 0}`);
}

console.log('\n──── ٤ — فهرس الموردين (اللي شاشة الاختيار بتقرا منه) ────');
const idx = await db.collection('supplierIndex').select('supplier', 'gone').get();
const bySupplier = {};
for (const d of idx.docs) {
  const s = String(d.data().supplier ?? '?');
  bySupplier[s] = bySupplier[s] ?? { total: 0, gone: 0 };
  bySupplier[s].total += 1;
  if (d.data().gone === true) bySupplier[s].gone += 1;
}
if (!idx.size) console.log('  ⚠️ الفهرس فاضي — شاشة الاختيار هتبقى فاضية');
for (const [s, v] of Object.entries(bySupplier)) {
  console.log(`  ${s.padEnd(14)} ${v.total} صف${v.gone ? ` (${v.gone} اختفوا من الفيد)` : ''}`);
}

console.log('\n──── ٥ — الحاجات الجديدة: فيها بيانات؟ ────');
for (const [label, coll] of [
  ['سجل تغييرات الكوبونات', 'couponAudit'],
  ['أداء الأكواد', 'couponStats'],
  ['تكلفة الطلبات', 'orderCosts'],
  ['الفواتير الدائنة', 'creditNotes'],
  ['الموردين', 'suppliers'],
]) {
  const snap = await db.collection(coll).limit(3).get();
  console.log(`  ${label.padEnd(24)} ${snap.size === 0 ? 'فاضي (طبيعي — لسه ما حصلش)' : `${snap.size}+ مستند`}`);
}
process.exit(0);
