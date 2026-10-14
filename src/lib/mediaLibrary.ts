// The dashboard's side of the media library.
//
// Listing, deleting and re-hosting go through the server, which has the Admin
// SDK. UPLOADING does not: the browser writes straight to the bucket with
// uploadFile({ visibility: 'public' }), so the bytes never pass through the
// Passenger process — which on this host is the slow, memory-limited part.

import { auth } from '../firebase';
import { uploadFile } from './uploadFile';
import { compressImageFile } from './imageCompress';

export interface MediaItem {
  /** Full object path, e.g. public/media/1789_logo.png. Needed to delete it. */
  path: string;
  /** Just the file name, for display. */
  name: string;
  size: number;
  contentType: string;
  updated: string | null;
  /** null when the object has no download token — nothing the library wrote. */
  url: string | null;
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await auth.currentUser?.getIdToken().catch(() => null);
  if (!token) throw new Error('Not signed in.');
  return { Authorization: `Bearer ${token}` };
}

async function readError(res: Response, fallback: string): Promise<never> {
  const body = await res.json().catch(() => null);
  throw new Error(body?.error || fallback);
}

export async function listMedia(cursor?: string | null): Promise<{ items: MediaItem[]; nextCursor: string | null }> {
  const params = new URLSearchParams({ limit: '60' });
  if (cursor) params.set('cursor', cursor);
  const res = await fetch(`/api/admin/media?${params}`, { headers: await authHeaders() });
  if (!res.ok) await readError(res, 'Could not load the media.');
  return res.json();
}

export async function deleteMedia(path: string): Promise<void> {
  const res = await fetch('/api/admin/media/delete', {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) await readError(res, 'Could not delete the file.');
}

export async function rehostImage(url: string): Promise<MediaItem> {
  const res = await fetch('/api/admin/media/rehost', {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) await readError(res, 'Could not fetch that image.');
  return res.json();
}

/**
 * The most pixels a shop picture ever needs.
 *
 * A phone photograph is 4000 px and 6 MB; the largest slot on this site renders
 * it at about 1200. Uploading the original costs every shopper the download and
 * gains them nothing.
 */
const MAX_PX = 1600;
const QUALITY = 0.82;
/** Below this, shrinking is not worth the loss. */
const COMPRESS_OVER_BYTES = 600 * 1024;

/**
 * WHAT IS DELIBERATELY NOT COMPRESSED, and why it matters here.
 *
 * compressImageFile draws into a canvas and returns a **JPEG**. JPEG has no
 * transparency, so a logo on a transparent background comes back on a solid one
 * — this shop has already had a "black background" bug reported by the owner
 * from exactly that class of conversion. A media library is where logos live, so
 * PNG and SVG are stored as they are. The size is shown under every thumbnail
 * instead, which is the honest way to let him see a heavy file and decide.
 */
function shouldCompress(file: File): boolean {
  if (file.type === 'image/svg+xml' || file.type === 'image/png' || file.type === 'image/gif') return false;
  return file.size > COMPRESS_OVER_BYTES;
}

/** A JPEG data URL back into a File, so uploadFile can stream it. */
async function dataUrlToFile(dataUrl: string, name: string): Promise<File> {
  const blob = await (await fetch(dataUrl)).blob();
  const base = name.replace(/\.[^.]*$/, '') || 'image';
  return new File([blob], `${base}.jpg`, { type: 'image/jpeg' });
}

export async function uploadMedia(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<{ url: string; path: string }> {
  let prepared = file;
  if (shouldCompress(file)) {
    try {
      const dataUrl = await compressImageFile(file, MAX_PX, MAX_PX, QUALITY);
      const shrunk = await dataUrlToFile(dataUrl, file.name);
      // Only if it actually helped. A photo already saved at high compression
      // can come back BIGGER from a re-encode, and storing the larger one would
      // be the opposite of the point.
      if (shrunk.size < file.size) prepared = shrunk;
    } catch {
      // The original is always a valid answer; a failed squeeze is not a failed
      // upload.
    }
  }

  const { url, path } = await uploadFile(prepared, {
    userId: auth.currentUser?.uid,
    visibility: 'public',
    folder: 'media',
    contentType: prepared.type || file.type || undefined,
    onProgress,
  });
  return { url, path };
}

/** Human file size, for a caption under a thumbnail. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
