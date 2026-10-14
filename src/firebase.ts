import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

/**
 * WHICH DOMAIN GOOGLE SIGN-IN RUNS ON.
 *
 * `authDomain` decides the OAuth redirect_uri — @firebase/auth builds it as
 * `https://<authDomain>/__/auth/handler` — and Google's account chooser shows
 * the HOST of that URI. With the default it reads "continue to
 * gen-lang-client-0018052971.firebaseapp.com", which the client saw in front of
 * his own customers and asked never to appear. The project id is immutable, so
 * the domain is the only thing that can change.
 *
 * server.ts proxies `/__/auth/*` to the real Firebase handler, so
 * shop.reklamx.se can serve it. What is left is pointing the SDK at it — and
 * that is deliberately an ENVIRONMENT VARIABLE rather than an edit to the JSON,
 * because the switch is dangerous in one specific way:
 *
 *   Google validates redirect_uri against the OAuth client's registered list.
 *   Set this to a domain that is NOT registered there and EVERY Google sign-in
 *   fails with redirect_uri_mismatch — for every customer, immediately.
 *
 * So the order is: register `https://shop.reklamx.se/__/auth/handler` under the
 * Web client's Authorized redirect URIs in Google Cloud Console (keeping the
 * firebaseapp.com one), THEN set VITE_FIREBASE_AUTH_DOMAIN=shop.reklamx.se and
 * rebuild. Unset, it stays exactly as it is today.
 */
const authDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN?.trim() || firebaseConfig.authDomain;

const app = initializeApp({ ...firebaseConfig, authDomain });
export const db = (firebaseConfig as any).firestoreDatabaseId 
  ? getFirestore(app, (firebaseConfig as any).firestoreDatabaseId)
  : getFirestore(app);
export const auth = getAuth(app);

/**
 * LOCAL TEST MODE — the Firebase emulators on this machine, never the real shop.
 *
 * `VITE_FIREBASE_EMULATOR=1` (set only by the local test runner, together with a
 * demo project id) points the browser at emulated Firestore, Auth and Storage,
 * so every dashboard screen can be clicked through end to end without a single
 * read or write reaching the client's data — and without creating an account in
 * his project, which the 2026-09 handover removed every trace of. A production
 * build never has the variable: Vite replaces it with `undefined` at build time
 * and the branch is dropped. The server side is FIRESTORE_EMULATOR_HOST.
 */
export const usingFirebaseEmulators = import.meta.env.VITE_FIREBASE_EMULATOR === '1';
if (usingFirebaseEmulators) {
  connectFirestoreEmulator(db, '127.0.0.1', 8085);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
}
