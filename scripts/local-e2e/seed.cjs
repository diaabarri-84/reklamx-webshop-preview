// Seed the LOCAL Firebase emulators (demo project) with the shop's catalogue
// from the local backup, plus one test admin. Refuses to run unless every
// Firebase target is an emulator on 127.0.0.1 — it can never reach the real
// project.
//
//   node seed-emulator.cjs <backupDir>
const path = require('path');
const fs = require('fs');

for (const v of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
  if (!String(process.env[v] || '').startsWith('127.0.0.1:')) {
    console.error(`refusing: ${v} must point at a local emulator`);
    process.exit(2);
  }
}

const appDir = process.cwd();
const req = (m) => require(require.resolve(m, { paths: [appDir] }));
const { initializeApp } = req('firebase-admin/app');
const { getFirestore } = req('firebase-admin/firestore');
const { getAuth } = req('firebase-admin/auth');

const PROJECT = 'demo-reklamx';
const app = initializeApp({ projectId: PROJECT }, 'seed');
const db = getFirestore(app);
const auth = getAuth(app);

const backupDir = process.argv[2];
const load = (f) => JSON.parse(fs.readFileSync(path.join(backupDir, f), 'utf8'));

(async () => {
  let n = 0;
  for (const [file, coll] of [['categories.json', 'categories'], ['products.json', 'products'], ['settings.json', 'settings']]) {
    const data = load(file);
    const ids = Object.keys(data);
    for (let i = 0; i < ids.length; i += 400) {
      const batch = db.batch();
      for (const id of ids.slice(i, i + 400)) {
        const { id: _drop, ...doc } = data[id] || {};
        batch.set(db.collection(coll).doc(id), doc);
        n += 1;
      }
      await batch.commit();
    }
    console.log(`  ${coll}: ${ids.length}`);
  }

  const users = [
    { email: 'admin@emulator.test', password: 'emulator-admin-1', role: 'admin', name: 'Emulator Admin' },
    { email: 'staff@emulator.test', password: 'emulator-staff-1', role: 'staff', name: 'Emulator Staff' },
    // A second admin for clicking through by hand, so the suites' admin stays untouched.
    { email: 'owner@reklamx.test', password: 'ReklamX-local-1', role: 'admin', name: 'Local Owner' },
    // A customer allowed to pay on delivery: with no Mollie key in test mode, the
    // only way a customer's order goes all the way through checkout.
    { email: 'customer@reklamx.test', password: 'ReklamX-kund-1', role: 'client', name: 'Test Customer', payOnDelivery: true },
  ];
  for (const u of users) {
    let rec;
    try { rec = await auth.getUserByEmail(u.email); } catch { rec = await auth.createUser({ email: u.email, password: u.password, displayName: u.name, emailVerified: true }); }
    // storage.rules lets only a token carrying admin: true write public/ (product,
    // category and site pictures) — without it every admin upload is refused.
    await auth.setCustomUserClaims(rec.uid, u.role === 'admin' ? { admin: true } : null);
    await db.collection('users').doc(rec.uid).set({
      uid: rec.uid, email: u.email, displayName: u.name, role: u.role, createdAt: new Date().toISOString(),
    });
    if (u.payOnDelivery) {
      await db.collection('customerTerms').doc(rec.uid).set({ payOnDelivery: true, updatedAt: new Date().toISOString(), updatedBy: 'seed' });
    }
    console.log(`  user ${u.email} (${u.role}) uid=${rec.uid}`);
  }
  console.log(`seeded ${n} documents into the LOCAL emulator (project ${PROJECT})`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
