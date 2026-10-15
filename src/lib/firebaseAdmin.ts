// Server-side Firebase, with security rules bypassed.
//
// The browser is deliberately not allowed to create orders any more: the rules
// reject it, because a client that can write an order can write its price. The
// server writes them instead, using a service-account credential that rules do
// not apply to. That credential must never reach the bundle — this module is
// imported only by server.ts.
//
// Credentials are read from, in order:
//   1. FIREBASE_SERVICE_ACCOUNT — the JSON itself, for hosts that inject secrets
//      as environment variables (Hostinger, Railway, Cloud Run).
//   2. GOOGLE_APPLICATION_CREDENTIALS — a path, the Google convention.
//   3. ./service-account.json — the local development file, gitignored.
//
// If none is present the shop still runs and still quotes prices; only order
// creation is unavailable, and it says so rather than failing silently.

import fs from 'fs';
import path from 'path';
import { initializeApp, cert, getApps, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore, FieldValue as FirestoreFieldValue, FieldPath as FirestoreFieldPath } from 'firebase-admin/firestore';
import type { Auth } from 'firebase-admin/auth';
import { getDocStore, FieldValue as DocStoreFieldValue, FieldPath as DocStoreFieldPath } from './db/index';
import { LocalAuth } from './db/localAuth';
import { FileStore } from './db/fileStore';

// ── THE SWITCH OFF FIREBASE (migration/PLAN.md) ──
//
// DATA_BACKEND=mysql: the three handles below come from the shop's own MySQL
// database (src/lib/db) instead of Google — getAdminDb() a Firestore-shaped
// DocStore, getAdminAuth() the shop's own logins, getAdminBucket() files on the
// server's disk. Every caller in server.ts is unchanged; that was the point of
// building the data layer in Firestore's shape. Unset, nothing here changes.
export const usingLocalBackend = (): boolean => process.env.DATA_BACKEND === 'mysql';

let localAuthHandle: LocalAuth | null = null;
let fileStoreHandle: FileStore | null = null;
/** The shop's own logins (DATA_BACKEND=mysql), or null without a database. */
export function getLocalAuth(): LocalAuth | null {
  const store = getDocStore();
  if (!store) return null;
  return (localAuthHandle ??= new LocalAuth(store.pool));
}
/** The server's own file store (DATA_BACKEND=mysql), or null without a database. */
export function getFileStore(): FileStore | null {
  const store = getDocStore();
  if (!store) return null;
  return (fileStoreHandle ??= new FileStore(store.pool));
}

/** FieldValue / FieldPath for whichever database is in use. server.ts imports these, not firebase-admin's. */
export const FieldValue = {
  delete: (): any => (usingLocalBackend() ? DocStoreFieldValue.delete() : FirestoreFieldValue.delete()),
  arrayUnion: (...elements: unknown[]): any => (usingLocalBackend() ? DocStoreFieldValue.arrayUnion(...elements) : FirestoreFieldValue.arrayUnion(...elements)),
};
export const FieldPath = {
  documentId: (): any => (usingLocalBackend() ? DocStoreFieldPath.documentId() : FirestoreFieldPath.documentId()),
};

let cached: { app: App; db: Firestore } | null = null;
let attempted = false;

function loadServiceAccount(): Record<string, any> | null {
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (inline) {
    try {
      return JSON.parse(inline);
    } catch {
      console.error('FIREBASE_SERVICE_ACCOUNT is set but is not valid JSON.');
      return null;
    }
  }

  const candidates = [
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    path.resolve(process.cwd(), 'service-account.json'),
  ].filter(Boolean) as string[];

  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch {
      console.error(`Could not read the service account at ${file}`);
    }
  }
  return null;
}

/**
 * Returns the admin Firestore handle, or null when no credential is configured.
 * Callers must handle null — that is the difference between "the shop cannot
 * take orders right now" and a crash.
 */
export function getAdminDb(): Firestore | null {
  if (usingLocalBackend()) return getDocStore() as unknown as Firestore | null;
  if (cached) return cached.db;
  if (attempted) return null;
  attempted = true;

  const serviceAccount = loadServiceAccount();
  if (!serviceAccount) {
    console.warn('No Firebase service account found — order creation is disabled.');
    return null;
  }

  try {
    const appConfigPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    const appConfig = fs.existsSync(appConfigPath)
      ? JSON.parse(fs.readFileSync(appConfigPath, 'utf-8'))
      : {};

    // The shop's data lives in a NAMED database. Defaulting to (default) reads an
    // empty database and looks exactly like the data having vanished.
    const databaseId: string =
      process.env.FIREBASE_DATABASE_ID || appConfig.firestoreDatabaseId || '(default)';

    const app =
      getApps().find((a) => a.name === 'admin') ??
      initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id }, 'admin');

    const db = getFirestore(app, databaseId);
    cached = { app, db };
    console.log(`Firebase Admin ready — project ${serviceAccount.project_id}, database ${databaseId}`);
    return db;
  } catch (err) {
    console.error('Firebase Admin failed to initialise:', err);
    return null;
  }
}

/**
 * The admin Auth handle, or null when no credential is configured.
 *
 * MUST be used instead of a bare `getAuth()` anywhere on the server. The app
 * above is initialised under the NAME 'admin' — there is no default app — and
 * `getAuth()` without an argument looks for the default one and throws
 * app/no-app. That throw was silently swallowed by the try/catch around every
 * call site, which meant: every signed-in buyer was treated as a guest, guest
 * orders never linked to their accounts by email, and every admin user-
 * management endpoint answered "Session expired". The bug shipped in five
 * places because each one imported getAuth() afresh; this is now the one door.
 */
export async function getAdminAuth(): Promise<Auth | null> {
  if (usingLocalBackend()) return getLocalAuth() as unknown as Auth | null;
  if (!getAdminDb()) return null;
  // Imported lazily, not at module top. firebase-admin/auth drags in jwks-rsa,
  // and a static import made loading THIS MODULE — and with it the whole
  // serverless function, /api/health included — depend on that chain resolving.
  // When jose arrived as an ESM-only build on a host whose loader cannot
  // require() ESM, the cold start itself died. Lazy, a broken auth chain costs
  // exactly the auth features, and the rest of the shop keeps trading.
  const { getAuth } = await import('firebase-admin/auth');
  return getAuth(cached!.app);
}

/**
 * The storage bucket, or null when no credential is configured.
 *
 * Lazy for the same reason getAdminAuth is: firebase-admin/storage pulls in the
 * Google Cloud Storage client, and a static import would make every cold start —
 * /api/health included — depend on that chain resolving.
 *
 * The bucket NAME must come from firebase-applet-config.json. The Admin SDK
 * derives a default of `<project>.appspot.com` when none is given, and this
 * project's bucket is `<project>.firebasestorage.app`; the derived name points
 * at a bucket that does not exist, and every call fails with a 404 that reads
 * like a permissions problem.
 */
export async function getAdminBucket(): Promise<import('@google-cloud/storage').Bucket | null> {
  if (usingLocalBackend()) return (getFileStore()?.bucket() ?? null) as unknown as import('@google-cloud/storage').Bucket | null;
  if (!getAdminDb()) return null;
  try {
    const appConfigPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    const appConfig = fs.existsSync(appConfigPath)
      ? JSON.parse(fs.readFileSync(appConfigPath, 'utf-8'))
      : {};
    const name: string = process.env.FIREBASE_STORAGE_BUCKET || appConfig.storageBucket || '';
    if (!name) {
      console.warn('No storageBucket configured — the media library is unavailable.');
      return null;
    }
    const { getStorage } = await import('firebase-admin/storage');
    return getStorage(cached!.app).bucket(name);
  } catch (err) {
    console.error('Firebase Storage failed to initialise:', err);
    return null;
  }
}

/** True when the server can write orders. */
export function canWriteOrders(): boolean {
  return getAdminDb() !== null;
}
