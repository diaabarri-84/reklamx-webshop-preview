// Reusable Firebase Storage upload helper.
//
// This is the foundation for storing uploaded artwork/images in real object
// storage instead of base64 inside Firestore documents or localStorage (which
// breaks past ~1 MB and bloats every read/write). Store the returned `url` in
// the order/product document — NOT the file bytes.
//
// This IS live. Four screens call it — ArtworkUploadBox, ProductConfigurator,
// CustomFileUploadPage and uploadOptionImage — and the bucket holds real customer
// artwork uploaded through them. An older version of this comment said it was
// wired to nothing; do not trust that, check the call sites.

import '../firebase'; // side-effect: guarantees the default Firebase app is initialized
import { holdReloads } from './reloadHold';
import { getApp } from 'firebase/app';
import {
  connectStorageEmulator,
  deleteObject,
  getStorage,
  ref,
  uploadBytesResumable,
  getDownloadURL,
} from 'firebase/storage';

// Lazy, not module-level: getStorage() at import time crashed the WHOLE page
// when the storage service was not ready (seen with Vite's dep optimizer, and
// possible whenever initialization races). Inside the function, a failure is
// just a failed upload — which callers already handle with a fallback.
let storageEmulatorConnected = false;
function storage() {
  const s = getStorage(getApp());
  // Local test mode only — see `usingFirebaseEmulators` in src/firebase.ts.
  if (import.meta.env.VITE_FIREBASE_EMULATOR === '1' && !storageEmulatorConnected) {
    connectStorageEmulator(s, '127.0.0.1', 9199);
    storageEmulatorConnected = true;
  }
  return s;
}

const MAX_BYTES = 50 * 1024 * 1024; // keep in sync with storage.rules

/**
 * Extension → the content type a print file is stored as.
 *
 * Not `file.type` alone: browsers report nothing at all for .eps, .ai and .psd —
 * or a name of their own (application/illustrator, application/eps,
 * image/x-photoshop…) — and the bucket rules accept only image/*,
 * application/pdf and application/postscript. Such a file was refused by the
 * bucket for a type nobody chose, and the product page read the refusal as
 * "storage is down" (code review WEB-04). ArtworkUploadBox offers exactly these.
 */
export const ARTWORK_CONTENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  eps: 'application/postscript',
  ai: 'application/postscript',
  psd: 'image/vnd.adobe.photoshop',
};

/** What storage.rules' isAllowedType() lets a customer's upload be. */
const bucketAccepts = (type: string) =>
  type.startsWith('image/') || type === 'application/pdf' || type === 'application/postscript';

/**
 * The content type a file is stored as: the first stated type the bucket takes
 * (the caller's, then the browser's), else the one its extension names, else
 * what was stated — a public upload of something else (the public tree takes any
 * type) keeps its own. Pure; scripts/test-upload-type.mjs.
 */
export function storedContentType(fileName: string, ...stated: Array<string | null | undefined>): string {
  const types = stated.map((t) => String(t ?? '').trim().toLowerCase()).filter(Boolean);
  const accepted = types.find(bucketAccepts);
  if (accepted) return accepted;
  const ext = fileName.includes('.') ? fileName.split('.').pop()!.toLowerCase() : '';
  if (Object.prototype.hasOwnProperty.call(ARTWORK_CONTENT_TYPES, ext)) return ARTWORK_CONTENT_TYPES[ext];
  return types[0] ?? 'application/octet-stream';
}

export interface UploadResult {
  /** Permanent download URL — store THIS in Firestore, not the bytes. */
  url: string;
  /** Full storage path, e.g. uploads/<uid>/artwork/169..._file.pdf or public/media/169..._logo.png */
  path: string;
  size: number;
  contentType: string;
}

export interface UploadOptions {
  /**
   * The uploading user's uid. Required for a private upload — the rule matches on
   * it — and unused for a public one, so public callers may omit it rather than
   * inventing a value.
   */
  userId?: string;
  /** Sub-folder under the user's space (default: "artwork"). */
  folder?: string;
  /** Progress callback, 0–100. */
  onProgress?: (percent: number) => void;
  /**
   * The content type to store, instead of `file.type`. Either is used only when
   * the bucket takes it; otherwise the file's extension decides
   * (storedContentType above), so a caller no longer has to know that browsers
   * hand back an empty type for .eps, .ai and .psd.
   */
  contentType?: string;
  /**
   * Which tree the file goes into. The two are governed by different rules in
   * storage.rules and are not interchangeable:
   *
   *   'private' (the default) → uploads/<userId>/<folder>/...
   *       Readable by the uploader and admins only. Customer artwork belongs
   *       here — it is the customer's property and nobody else's business.
   *
   *   'public' → public/<folder>/...
   *       World-readable, admin-only write. Product images, site media and
   *       anything whose URL is meant to be pasted into a page belong here.
   *
   * KNOW THIS BEFORE YOU TREAT 'private' AS SECRET: the URL getDownloadURL()
   * returns carries a token, and a tokenised Firebase download URL bypasses
   * storage.rules completely. Verified on 2026-09-12 — a customer's artwork URL
   * answered 200 to a request with no credentials at all. The rules stop someone
   * LISTING or guessing paths; they do not stop anyone who has been handed the
   * link. So a private file does render on the storefront (that is why option
   * images under uploads/ work today), and 'private' means unlisted, not secret.
   * The split still matters: public/ is where media the shop publishes on purpose
   * belongs, and it survives any future tightening of the private tree.
   *
   * A 'public' upload from a non-admin is refused by the bucket, not by this
   * function — the rules are the authority.
   */
  visibility?: 'private' | 'public';
  /**
   * Stops the upload (task.cancel()): the promise rejects and nothing is kept.
   * Storage retries a stalled upload for up to ten minutes by itself, and a
   * screen waiting on it had no way to give up (code review DSN-12).
   */
  signal?: AbortSignal;
}

/**
 * Upload a single file to Firebase Storage and resolve with its download URL.
 * Throws on oversize files or upload errors.
 */
export async function uploadFile(file: File, opts: UploadOptions): Promise<UploadResult> {
  if (opts?.visibility !== 'public' && !opts?.userId) {
    throw new Error('uploadFile: a userId is required for a private upload.');
  }
  // >= not >, deliberately: storage.rules says `size < 50 * 1024 * 1024`, so a
  // file of exactly 50 MB passes a `>` check here and is then refused by the
  // bucket — a permission error for a file the user was just told was fine.
  if (file.size >= MAX_BYTES) {
    throw new Error(
      `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is under ${MAX_BYTES / 1024 / 1024} MB.`
    );
  }

  const isPublic = opts.visibility === 'public';
  const folder = (opts.folder || (isPublic ? 'media' : 'artwork')).replace(/[^\w\-]+/g, '_');
  const safeName = file.name.replace(/[^\w.\-]+/g, '_');
  // The uid is part of the private path because the rule matches on it
  // (`isOwner(userId)`); under public/ it would only leak who uploaded what.
  const path = isPublic
    ? `public/${folder}/${Date.now()}_${safeName}`
    : `uploads/${opts.userId}/${folder}/${Date.now()}_${safeName}`;
  const contentType = storedContentType(file.name, opts.contentType, file.type);

  if (opts.signal?.aborted) throw new DOMException('Upload cancelled', 'AbortError');
  const task = uploadBytesResumable(ref(storage(), path), file, { contentType });
  const cancel = () => task.cancel();
  opts.signal?.addEventListener('abort', cancel);

  // A reload or a closed tab mid-upload loses the file. For as long as this task
  // runs, the shop's own reload after a deploy waits (BuildWatcher shows its
  // "update ready" bar instead), and the browser asks before the tab is left —
  // only now, never on a page with nothing in flight (code review WEB-07 / DSN-08).
  const release = holdReloads();
  const warnBeforeLeaving = (e: BeforeUnloadEvent) => {
    e.preventDefault();
    e.returnValue = '';
  };
  window.addEventListener('beforeunload', warnBeforeLeaving);
  try {
    await new Promise<void>((resolve, reject) => {
      task.on(
        'state_changed',
        (snap) => opts.onProgress?.(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
        reject,
        () => resolve()
      );
    });

    const url = await getDownloadURL(task.snapshot.ref);
    return { url, path, size: file.size, contentType };
  } finally {
    opts.signal?.removeEventListener('abort', cancel);
    window.removeEventListener('beforeunload', warnBeforeLeaving);
    release();
  }
}

/**
 * Remove a private upload nobody will read: a file the customer replaced or
 * removed before it reached a basket line (round 16, item 5 — every "Use this
 * design" makes a new one). storage.rules lets the uploader delete their own.
 * Best effort and silent: a file that stays behind costs storage, never an order.
 */
export async function deleteUploadedFile(path: string): Promise<void> {
  if (!path.startsWith('uploads/')) return;
  try {
    await deleteObject(ref(storage(), path));
  } catch {
    /* already gone, or no longer ours to delete */
  }
}
