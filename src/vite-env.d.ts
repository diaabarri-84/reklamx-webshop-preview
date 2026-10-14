/// <reference types="vite/client" />

/**
 * Build-time settings the browser bundle is allowed to see.
 *
 * Vite only exposes variables prefixed with VITE_, and it INLINES them at build
 * time — so a change here needs a rebuild, not a restart, and nothing secret
 * may ever go in one. The Gemini key and the Mollie key are deliberately absent
 * for that reason; they are read server-side only (see vite.config.ts).
 */
interface ImportMetaEnv {
  readonly MODE: string;
  /** '1' only in the local test runner: talk to the Firebase emulators — src/firebase.ts. */
  readonly VITE_FIREBASE_EMULATOR?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
