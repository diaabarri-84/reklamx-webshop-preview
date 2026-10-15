// Stand-in for 'firebase/storage' when the shop runs on its own database
// (DATA_BACKEND=mysql; swapped in by vite.config.ts): ref, uploadBytesResumable
// (with real progress and cancel), uploadBytes, getDownloadURL, deleteObject —
// against /api/files/* (src/lib/db/localRoutes.ts), which applies storage.rules.

import { api, readToken } from './session';

export class StorageError extends Error {
  constructor(readonly code: string, message?: string) {
    super(message ?? code);
    this.name = 'FirebaseError';
  }
}

export interface FirebaseStorage { type: 'storage' }
const STORAGE: FirebaseStorage = { type: 'storage' };
export const getStorage = (..._args: unknown[]): FirebaseStorage => STORAGE;
export const connectStorageEmulator = (..._args: unknown[]): void => {};

export interface StorageReference { fullPath: string; name: string; bucket: string }
export function ref(_storage: FirebaseStorage, path: string): StorageReference {
  const fullPath = String(path).replace(/^\/+/, '');
  return { fullPath, name: fullPath.split('/').pop() ?? fullPath, bucket: 'local' };
}

/** URLs of files uploaded in this page's lifetime, so getDownloadURL needs no round trip. */
const known = new Map<string, string>();
const absolute = (u: string) => (u.startsWith('/') ? `${window.location.origin}${u}` : u);
const errorFor = (status: number, body: any) =>
  new StorageError(status === 403 ? 'storage/unauthorized' : status === 413 ? 'storage/quota-exceeded' : status === 404 ? 'storage/object-not-found' : 'storage/unknown', body?.error);

interface TaskSnapshot { ref: StorageReference; bytesTransferred: number; totalBytes: number; state: 'running' | 'success' | 'canceled' | 'error' }

export function uploadBytesResumable(r: StorageReference, data: Blob | ArrayBuffer | Uint8Array, metadata?: { contentType?: string }) {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart]);
  const contentType = metadata?.contentType || (data instanceof Blob ? data.type : '') || 'application/octet-stream';
  const xhr = new XMLHttpRequest();
  const snapshot: TaskSnapshot = { ref: r, bytesTransferred: 0, totalBytes: blob.size, state: 'running' };
  const observers: { next?: (s: TaskSnapshot) => void; error?: (e: StorageError) => void; complete?: () => void }[] = [];

  const done = new Promise<TaskSnapshot>((resolve, reject) => {
    xhr.upload.onprogress = (e) => {
      snapshot.bytesTransferred = e.loaded;
      if (e.lengthComputable) snapshot.totalBytes = e.total;
      observers.forEach((o) => o.next?.(snapshot));
    };
    xhr.onload = () => {
      let body: any = {};
      try { body = JSON.parse(xhr.responseText || '{}'); } catch { /* not JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) {
        known.set(r.fullPath, absolute(body.url));
        snapshot.state = 'success';
        snapshot.bytesTransferred = snapshot.totalBytes;
        observers.forEach((o) => { o.next?.(snapshot); o.complete?.(); });
        resolve(snapshot);
      } else {
        const err = errorFor(xhr.status, body);
        snapshot.state = 'error';
        observers.forEach((o) => o.error?.(err));
        reject(err);
      }
    };
    xhr.onerror = () => {
      const err = new StorageError('storage/retry-limit-exceeded', 'The upload failed.');
      snapshot.state = 'error';
      observers.forEach((o) => o.error?.(err));
      reject(err);
    };
    xhr.onabort = () => {
      const err = new StorageError('storage/canceled', 'Upload cancelled.');
      snapshot.state = 'canceled';
      observers.forEach((o) => o.error?.(err));
      reject(err);
    };
  });
  done.catch(() => undefined);   // reported through on() and then(); never unhandled

  xhr.open('POST', `/api/files/upload?path=${encodeURIComponent(r.fullPath)}&contentType=${encodeURIComponent(contentType)}`);
  xhr.setRequestHeader('content-type', contentType);
  const token = readToken();
  if (token) xhr.setRequestHeader('authorization', `Bearer ${token}`);
  xhr.send(blob);

  return {
    snapshot,
    on(_event: 'state_changed', next?: ((s: TaskSnapshot) => void) | { next?: (s: TaskSnapshot) => void; error?: (e: StorageError) => void; complete?: () => void }, error?: (e: StorageError) => void, complete?: () => void) {
      const o = typeof next === 'object' && next ? next : { next: next as ((s: TaskSnapshot) => void) | undefined, error, complete };
      observers.push(o);
      return () => { const i = observers.indexOf(o); if (i >= 0) observers.splice(i, 1); };
    },
    cancel() { if (snapshot.state === 'running') xhr.abort(); return true; },
    pause() { return false; },
    resume() { return false; },
    then<A, B>(ok?: (s: TaskSnapshot) => A, bad?: (e: unknown) => B) { return done.then(ok, bad); },
    catch<B>(bad: (e: unknown) => B) { return done.catch(bad); },
  };
}

export async function uploadBytes(r: StorageReference, data: Blob | ArrayBuffer | Uint8Array, metadata?: { contentType?: string }) {
  const snap = await uploadBytesResumable(r, data, metadata);
  return { ref: snap.ref, metadata: { fullPath: r.fullPath, size: snap.totalBytes, contentType: metadata?.contentType } };
}

export async function getDownloadURL(r: StorageReference): Promise<string> {
  const hit = known.get(r.fullPath);
  if (hit) return hit;
  const res = await api<{ url: string; error?: string }>('/api/files/url', { path: r.fullPath });
  if (!res.ok) throw errorFor(res.status, res.data);
  const url = absolute(res.data.url);
  known.set(r.fullPath, url);
  return url;
}

export async function deleteObject(r: StorageReference): Promise<void> {
  const res = await api('/api/files/delete', { path: r.fullPath });
  if (!res.ok) throw errorFor(res.status, res.data);
  known.delete(r.fullPath);
}
