/**
 * THE DESIGN, KEPT ON THE CUSTOMER'S OWN DEVICE — round 16, item 5.
 *
 * A phone reloads or kills a background tab whenever it runs short of memory:
 * while the customer is in Photos picking a picture, while the print file is
 * being made, or just because they switched apps. A design held only in the
 * page's memory is gone when that happens. So every change is written to this
 * browser's IndexedDB, one draft per product, and the designer offers it back
 * when it opens.
 *
 * PICTURES ARE WRITTEN ONCE, under their own keys. The draft itself is a few KB
 * of JSON naming them. Writing the pictures inside the draft copied every photo
 * again on each pause in typing: tens of MB, every few seconds, on a phone. A
 * picture no draft names any more is deleted with the save that drops it.
 *
 * It costs the shop nothing: no Firestore reads or writes and no storage. Nothing
 * here may throw: private windows, blocked or full storage and old browsers just
 * have no draft, and `saveDraft` says false so the designer can stop promising
 * "it stays saved on this device". Drafts older than 30 days are dropped when read.
 */

import type { TemplateMeta } from './types';

const DB_NAME = 'reklamx-designer';
const DRAFTS = 'drafts';
const PICTURES = 'pictures';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

interface DraftRecord {
  /** The product id (a customer's design), or template:<id> (the owner's). */
  key: string;
  /** The board, as fabric JSON. Pictures are referenced by `rxImageId`. */
  json: string;
  imageIds: string[];
  trimMm: { wMm: number; hMm: number };
  savedAt: number;
  /** The owner's template the design started from, when it did. */
  template?: TemplateMeta | Record<string, unknown> | null;
  /** 2: a studio design — `json` holds every side (src/lib/designDoc.ts). */
  v?: 2;
  /** The bleed the design was made with (the studio's is per product). */
  bleedMm?: number;
  /** The studio's Uploads list (its pictures are among imageIds). */
  uploads?: string[];
}

export interface LoadedDraft {
  json: string;
  images: Record<string, Blob>;
  trimMm: { wMm: number; hMm: number };
  savedAt: number;
  template?: TemplateMeta | Record<string, unknown> | null;
  v?: 2;
  bleedMm?: number;
  uploads?: string[];
}

const pictureKey = (key: string, id: string) => `${key}/${id}`;
const picturesOf = (key: string) => IDBKeyRange.bound(`${key}/`, `${key}/￿`);

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DRAFTS)) db.createObjectStore(DRAFTS, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(PICTURES)) db.createObjectStore(PICTURES);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('blocked'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('aborted'));
  });
}

const result = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

export async function loadDraft(key: string): Promise<LoadedDraft | null> {
  try {
    const db = await openDb();
    try {
      const tx = db.transaction([DRAFTS, PICTURES], 'readonly');
      const draft = (await result(tx.objectStore(DRAFTS).get(key))) as DraftRecord | undefined;
      if (!draft || typeof draft.json !== 'string') return null;
      if (Date.now() - Number(draft.savedAt) > MAX_AGE_MS) {
        void deleteDraft(key);
        return null;
      }
      const images: Record<string, Blob> = {};
      for (const id of Array.isArray(draft.imageIds) ? draft.imageIds : []) {
        const blob = await result(tx.objectStore(PICTURES).get(pictureKey(key, id)));
        if (blob instanceof Blob) images[id] = blob;
      }
      return {
        json: draft.json,
        images,
        trimMm: draft.trimMm,
        savedAt: draft.savedAt,
        template: draft.template ?? null,
        ...(draft.v === 2 ? { v: 2 as const } : {}),
        ...(typeof draft.bleedMm === 'number' ? { bleedMm: draft.bleedMm } : {}),
        ...(Array.isArray(draft.uploads) ? { uploads: draft.uploads.filter((id) => typeof id === 'string') } : {}),
      };
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

/**
 * Keep the draft. `pictures` are all the pictures it uses; each is written only
 * when the store does not hold it yet, and any other picture of this design is
 * deleted — all in ONE transaction. The page used to remember which it had
 * written: a save in between that deleted one (a layout chosen, then Undo) left
 * it "remembered" and never written again, and the shop's logo was missing from
 * the design the device gave back.
 */
export async function saveDraft(
  draft: DraftRecord,
  pictures: Record<string, Blob>,
): Promise<boolean> {
  try {
    const db = await openDb();
    try {
      const tx = db.transaction([DRAFTS, PICTURES], 'readwrite');
      const store = tx.objectStore(PICTURES);
      const keep = new Set(draft.imageIds.map((id) => pictureKey(draft.key, id)));
      const stored = new Set(((await result(store.getAllKeys(picturesOf(draft.key)))) as IDBValidKey[]).map(String));
      for (const [id, blob] of Object.entries(pictures)) {
        const k = pictureKey(draft.key, id);
        if (!stored.has(k)) store.put(blob, k);
      }
      for (const k of stored) if (!keep.has(k)) store.delete(k);
      tx.objectStore(DRAFTS).put(draft);
      await done(tx);
      return true;
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
}

export async function deleteDraft(key: string): Promise<void> {
  try {
    const db = await openDb();
    try {
      const tx = db.transaction([DRAFTS, PICTURES], 'readwrite');
      tx.objectStore(DRAFTS).delete(key);
      tx.objectStore(PICTURES).delete(picturesOf(key));
      await done(tx);
    } finally {
      db.close();
    }
  } catch {
    /* nothing to delete */
  }
}

/**
 * Every CUSTOMER design on this device, gone — called when someone signs out. A shop
 * or a family computer kept the last customer's designs, photos and all, and offered
 * them to the next person to open the designer (code review DSN-04). The owner's
 * template drafts (template:<id>) are his work in the dashboard and stay. Drafts are
 * not keyed by account: a guest designs before signing in at the checkout. One
 * transaction; never throws.
 */
export async function clearCustomerDrafts(): Promise<void> {
  const customers = (key: IDBValidKey) => !String(key).startsWith('template:');
  try {
    const db = await openDb();
    try {
      const tx = db.transaction([DRAFTS, PICTURES], 'readwrite');
      const drafts = tx.objectStore(DRAFTS);
      const pictures = tx.objectStore(PICTURES);
      for (const key of ((await result(drafts.getAllKeys())) as IDBValidKey[]).filter(customers)) drafts.delete(key);
      // Each picture is kept under <draft key>/<id>: a customer's go with his drafts.
      for (const key of ((await result(pictures.getAllKeys())) as IDBValidKey[]).filter(customers)) pictures.delete(key);
      await done(tx);
    } finally {
      db.close();
    }
  } catch {
    /* nothing to clear */
  }
}
