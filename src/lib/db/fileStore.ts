// Stored files on the server's own disk — the replacement for Firebase Storage.
//
// The `files` table (migration/schema.sql) holds the LOGICAL path, in the same
// scheme the shop has always used (public/media/…, uploads/<uid>/artwork/…), and
// a generated name on disk: Firebase object names may be 1024 bytes of anything,
// which no Linux file name can hold.
//
// ACCESS, kept as it was (storage.rules and the note in src/lib/uploadFile.ts):
//   * public/…  — anyone may read; admins write.
//   * uploads/<uid>/… — the owner and admins; and anyone holding the file's
//     download TOKEN, because a tokenised Firebase URL worked for anyone it was
//     handed to, and order e-mails, job sheets and option pictures rely on that.
//     So a private file's URL carries its token, as before; without it, 404.
//
// Files live under FILES_DIR (default ./storage-files next to the server) —
// on cPanel, a folder outside public_html so nothing is served without this check.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Pool, RowDataPacket } from 'mysql2/promise';

export interface FileRow extends RowDataPacket {
  id: number;
  disk_name: string;
  path: string;
  visibility: 'public' | 'private';
  owner_id: string | null;
  content_type: string | null;
  size_bytes: number;
  created_at: string | null;
  metadata: string | null;
}

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

/** A logical path the store accepts: the two trees the shop uses, no climbing out, no oddities. */
export function cleanFilePath(raw: unknown): string | null {
  const p = String(raw ?? '');
  if (!p || p.length > 1000 || p.includes('..') || p.includes('\\') || p.startsWith('/') || /[\u0000-\u001f]/.test(p)) return null;
  if (!p.startsWith('public/') && !p.startsWith('uploads/')) return null;
  return p;
}

/** The URL the shop stores and shows. Private files carry their token. */
export function fileUrl(filePath: string, token: string | null): string {
  const enc = filePath.split('/').map(encodeURIComponent).join('/');
  return `/files/${enc}${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}

export class FileStore {
  readonly root: string;
  constructor(private readonly pool: Pool, root?: string) {
    this.root = path.resolve(root || process.env.FILES_DIR || path.join(process.cwd(), 'storage-files'));
  }

  private diskPath(diskName: string): string {
    return path.join(this.root, ...diskName.split('/'));
  }

  async find(filePath: string): Promise<FileRow | null> {
    const [rows] = await this.pool.query<FileRow[]>('SELECT * FROM files WHERE path_hash = ? LIMIT 1', [sha256(filePath)]);
    return rows[0] ?? null;
  }

  static meta(row: FileRow): Record<string, string> {
    try { return JSON.parse(row.metadata || '{}') ?? {}; } catch { return {}; }
  }
  static token(row: FileRow): string | null {
    return String(FileStore.meta(row).firebaseStorageDownloadTokens ?? '').split(',')[0] || null;
  }

  /** Saves (or replaces) a file; resolves with its download token. */
  async save(filePath: string, data: Buffer, opts: { contentType?: string; ownerId?: string | null; metadata?: Record<string, string>; legacyPath?: string } = {}): Promise<{ token: string; size: number }> {
    const clean = cleanFilePath(filePath);
    if (!clean) throw Object.assign(new Error('That is not a storable path.'), { status: 400 });
    const existing = await this.find(clean);
    const ext = (path.extname(clean).toLowerCase().match(/^\.[a-z0-9]{1,8}$/)?.[0]) ?? '';
    const rand = crypto.randomBytes(16).toString('hex');
    const diskName = `${rand.slice(0, 2)}/${rand.slice(2, 4)}/${rand}${ext}`;
    const file = this.diskPath(diskName);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);

    const metadata = { ...(opts.metadata ?? {}) };
    if (!metadata.firebaseStorageDownloadTokens) metadata.firebaseStorageDownloadTokens = crypto.randomUUID();
    const visibility = clean.startsWith('public/') ? 'public' : 'private';
    const ownerId = opts.ownerId ?? (clean.startsWith('uploads/') ? clean.split('/')[1] : null);
    const row = {
      disk_name: diskName, path: clean, path_hash: sha256(clean), visibility, owner_id: ownerId,
      content_type: opts.contentType ?? 'application/octet-stream', size_bytes: data.length,
      created_at: new Date().toISOString(), metadata: JSON.stringify(metadata),
      legacy_path_hash: opts.legacyPath ? sha256(opts.legacyPath) : null,
    };
    if (existing) {
      await this.pool.query('UPDATE files SET disk_name=?, visibility=?, owner_id=?, content_type=?, size_bytes=?, created_at=?, metadata=? WHERE id=?',
        [row.disk_name, row.visibility, row.owner_id, row.content_type, row.size_bytes, row.created_at, row.metadata, existing.id]);
      fs.rmSync(this.diskPath(existing.disk_name), { force: true });
    } else {
      const cols = Object.keys(row);
      await this.pool.query(`INSERT INTO files (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, Object.values(row));
    }
    return { token: metadata.firebaseStorageDownloadTokens, size: data.length };
  }

  async remove(filePath: string): Promise<boolean> {
    const row = await this.find(filePath);
    if (!row) return false;
    await this.pool.query('DELETE FROM files WHERE id = ?', [row.id]);
    fs.rmSync(this.diskPath(row.disk_name), { force: true });
    return true;
  }

  /** The bytes of a stored file, for the download route. */
  open(row: FileRow): fs.ReadStream | null {
    const file = this.diskPath(row.disk_name);
    return fs.existsSync(file) ? fs.createReadStream(file) : null;
  }

  async list(prefix: string, limit: number, cursor: string | null): Promise<{ rows: FileRow[]; next: string | null }> {
    const [rows] = await this.pool.query<FileRow[]>(
      'SELECT * FROM files WHERE path LIKE ? AND id > ? ORDER BY id LIMIT ?',
      [`${prefix.replace(/[\\%_]/g, (c) => `\\${c}`)}%`, Number(cursor) || 0, limit + 1]);
    const more = rows.length > limit;
    const page = rows.slice(0, limit);
    return { rows: page, next: more ? String(page[page.length - 1].id) : null };
  }

  /**
   * The part of Google Cloud Storage's Bucket that server.ts uses (the media
   * library: getFiles, file().save, file().delete), so getAdminBucket() can
   * hand this out and the media endpoints run unchanged.
   */
  bucket() {
    const store = this;
    const asGcsFile = (row: FileRow) => ({
      name: row.path,
      metadata: {
        size: String(row.size_bytes),
        contentType: row.content_type ?? '',
        updated: row.created_at,
        metadata: FileStore.meta(row),
      },
    });
    return {
      name: 'local',
      async getFiles(opts: { prefix?: string; maxResults?: number; pageToken?: string } = {}) {
        const { rows, next } = await store.list(opts.prefix ?? '', Math.min(opts.maxResults ?? 100, 1000), opts.pageToken ?? null);
        return [rows.map(asGcsFile), null, { nextPageToken: next }] as const;
      },
      file(filePath: string) {
        return {
          name: filePath,
          async save(data: Buffer, opts: { contentType?: string; metadata?: { contentType?: string; metadata?: Record<string, string> } } = {}) {
            await store.save(filePath, data, { contentType: opts.contentType ?? opts.metadata?.contentType, metadata: opts.metadata?.metadata });
          },
          async delete(opts: { ignoreNotFound?: boolean } = {}) {
            const gone = await store.remove(filePath);
            if (!gone && !opts.ignoreNotFound) throw Object.assign(new Error('No such object.'), { code: 404 });
          },
          async exists() { return [!!(await store.find(filePath))] as const; },
        };
      },
    };
  }
}
