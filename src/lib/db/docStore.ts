// A Firestore-shaped document store on MySQL / MariaDB.
//
// WHY THIS SHAPE. server.ts talks to Firestore through the Admin SDK in a few
// hundred places — doc().get(), set(..., {merge: true}), where().orderBy(),
// transactions, batches. This class answers the same calls with the same
// results, so moving off Firebase changes what getAdminDb() returns, not the
// business logic that has been tested against the live shop for months.
//
// ONLY WHAT THE SHOP USES. The operators, sentinels and options below are the
// ones an inventory of server.ts found (where: == < <= > >= in; orderBy;
// limit; select; startAfter; count; getAll; add; create; set with merge;
// update with dot paths; FieldValue.delete / arrayUnion; FieldPath.documentId;
// runTransaction; batch). Anything else throws, loudly, instead of guessing.
//
// FIRESTORE SEMANTICS KEPT, because the shop's logic relies on them:
//   * merge writes: an omitted key keeps its value, nested maps merge, an EMPTY
//     map replaces, FieldValue.delete() removes the key;
//   * update(): dot paths address nested keys, a map value replaces the whole
//     map, the document must exist (NOT_FOUND otherwise);
//   * create(): fails with ALREADY_EXISTS when the document is there;
//   * undefined anywhere in written data is refused, as the Admin SDK does;
//   * a query only matches values of the filter's type; orderBy(field) skips
//     documents without the field; ties and unordered results go by id;
//     (the one difference: an index column holds a single type, so a filter
//     of ANOTHER type matches nothing, where Firestore would match documents
//     holding that type. No filter in server.ts does this.)
//   * transactions are serializable for what they read: every read inside one
//     takes a row lock (SELECT ... FOR UPDATE), and a deadlock retries the whole
//     function, the way Firestore retries on contention.
//
// The mapping of collections to tables, and of fields to the index columns a
// query can use, is in tableMap.ts.

import crypto from 'node:crypto';
import type { Pool, PoolConnection } from 'mysql2/promise';
import { specFor, toRow, type CopyType, type TableSpec } from './tableMap';

// ───────────────────────────── Sentinels ─────────────────────────────

class DeleteSentinel {}
class ArrayUnionSentinel { constructor(readonly elements: unknown[]) {} }
const DELETE = new DeleteSentinel();

export const FieldValue = {
  delete: (): unknown => DELETE,
  arrayUnion: (...elements: unknown[]): unknown => new ArrayUnionSentinel(elements),
};

class DocumentIdPath {}
const DOCUMENT_ID = new DocumentIdPath();
export const FieldPath = { documentId: (): unknown => DOCUMENT_ID };

/** Carries the gRPC code Firestore would have thrown (5 NOT_FOUND, 6 ALREADY_EXISTS, 3 INVALID_ARGUMENT). */
export class DocStoreError extends Error {
  constructor(message: string, readonly code: number) {
    super(message);
    this.name = 'DocStoreError';
  }
}

// ───────────────────────────── Plain-data helpers ─────────────────────────────

type Obj = Record<string, unknown>;
const isPlainObject = (v: unknown): v is Obj =>
  !!v && typeof v === 'object' && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);

/** Refuses undefined anywhere in written data — the Admin SDK's own rule. */
function assertNoUndefined(v: unknown, path = ''): void {
  if (v === undefined) throw new DocStoreError(`Cannot use "undefined" as a value (found at "${path || 'document'}").`, 3);
  if (Array.isArray(v)) v.forEach((x, i) => assertNoUndefined(x, `${path}[${i}]`));
  else if (v instanceof ArrayUnionSentinel) v.elements.forEach((x, i) => assertNoUndefined(x, `${path}.arrayUnion[${i}]`));
  else if (isPlainObject(v)) for (const [k, x] of Object.entries(v)) assertNoUndefined(x, path ? `${path}.${k}` : k);
}

/** A stable text form for comparing values (arrayUnion's equality). */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (isPlainObject(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

function union(existing: unknown, elements: unknown[]): unknown[] {
  const out = Array.isArray(existing) ? existing.map(plainCopy) : [];
  const seen = new Set(out.map(canonical));
  for (const e of elements) {
    const key = canonical(e);
    if (!seen.has(key)) { seen.add(key); out.push(plainCopy(e)); }
  }
  return out;
}

/** A value as it will be stored, sentinels resolved. Nested sentinels are refused (Firestore refuses them too). */
function plainCopy(v: unknown): unknown {
  if (v instanceof DeleteSentinel) throw new DocStoreError('FieldValue.delete() can only be used at the top of update() or in set() with merge.', 3);
  if (v instanceof ArrayUnionSentinel) throw new DocStoreError('FieldValue.arrayUnion() cannot be nested inside an array.', 3);
  if (Array.isArray(v)) return v.map(plainCopy);
  if (isPlainObject(v)) {
    const out: Obj = {};
    for (const [k, x] of Object.entries(v)) out[k] = x instanceof ArrayUnionSentinel ? union(undefined, x.elements) : plainCopy(x);
    return out;
  }
  return v;
}

/** set(data, {merge: true}) applied to `target` (mutated). */
function mergeInto(target: Obj, data: Obj): void {
  for (const [k, v] of Object.entries(data)) {
    if (v instanceof DeleteSentinel) delete target[k];
    else if (v instanceof ArrayUnionSentinel) target[k] = union(target[k], v.elements);
    else if (isPlainObject(v) && Object.keys(v).length > 0) {
      if (!isPlainObject(target[k])) target[k] = {};
      mergeInto(target[k] as Obj, v);
    } else target[k] = plainCopy(v);   // scalars, arrays and EMPTY maps replace
  }
}

const splitPath = (path: string) => path.split('.');

function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of splitPath(path)) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

function setPath(obj: Obj, path: string, value: unknown): void {
  const parts = splitPath(path);
  let cur = obj;
  for (const part of parts.slice(0, -1)) {
    if (!isPlainObject(cur[part])) cur[part] = {};
    cur = cur[part] as Obj;
  }
  cur[parts[parts.length - 1]] = value;
}

function deletePath(obj: Obj, path: string): void {
  const parts = splitPath(path);
  let cur: unknown = obj;
  for (const part of parts.slice(0, -1)) {
    if (!isPlainObject(cur)) return;
    cur = cur[part];
  }
  if (isPlainObject(cur)) delete cur[parts[parts.length - 1]];
}

/** update(data) applied to `target` (mutated): keys are dot paths, values replace. */
function applyUpdate(target: Obj, data: Obj): void {
  for (const [path, v] of Object.entries(data)) {
    if (v instanceof DeleteSentinel) deletePath(target, path);
    else if (v instanceof ArrayUnionSentinel) setPath(target, path, union(getPath(target, path), v.elements));
    else setPath(target, path, plainCopy(v));
  }
}

/** Only the requested field paths (Firestore's select() / fieldMask). */
function project(doc: Obj, fields: string[]): Obj {
  const out: Obj = {};
  for (const f of fields) {
    const v = getPath(doc, f);
    if (v !== undefined) setPath(out, f, v);
  }
  return out;
}

const AUTO_ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
/** A 20-character id, the same alphabet and length as Firestore's auto ids. */
export function autoId(): string {
  let id = '';
  for (let i = 0; i < 20; i++) id += AUTO_ID_CHARS[crypto.randomInt(AUTO_ID_CHARS.length)];
  return id;
}

// ───────────────────────────── Encryption (secrets table) ─────────────────────────────

function encrypt(key: Buffer, plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')}`;
}

function decrypt(key: Buffer, text: string): string {
  if (!text.startsWith('v1:')) throw new Error('Unknown secrets format.');
  const raw = Buffer.from(text.slice(3), 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}

// ───────────────────────────── Snapshots ─────────────────────────────

export class DocumentSnapshot<T = any> {
  readonly exists: boolean;
  constructor(readonly ref: DocumentReference<T>, private readonly raw: string | null, private readonly fields: string[] | null = null) {
    this.exists = raw !== null;
  }
  get id(): string { return this.ref.id; }
  /** A fresh object on every call, like Firestore's. */
  data(): T | undefined {
    if (this.raw === null) return undefined;
    const doc = JSON.parse(this.raw) as Obj;
    return (this.fields ? project(doc, this.fields) : doc) as T;
  }
  get(fieldPath: string): unknown {
    const d = this.data();
    return d === undefined ? undefined : getPath(d, fieldPath);
  }
}

export class QuerySnapshot<T = any> {
  constructor(readonly docs: DocumentSnapshot<T>[]) {}
  get size(): number { return this.docs.length; }
  get empty(): boolean { return this.docs.length === 0; }
  forEach(cb: (doc: DocumentSnapshot<T>) => void): void { this.docs.forEach(cb); }
}

// ───────────────────────────── Queries ─────────────────────────────

type Op = '==' | '<' | '<=' | '>' | '>=' | 'in';
interface Filter { field: string | DocumentIdPath; op: Op; value: unknown }
interface Order { field: string | DocumentIdPath; dir: 'asc' | 'desc' }

interface Column { column: string; type: CopyType | 'id' }

function columnFor(spec: TableSpec, field: string | DocumentIdPath): Column {
  if (field === DOCUMENT_ID || field === '__name__') return { column: 'id', type: 'id' };
  for (const [column, copy] of Object.entries(spec.copies ?? {})) if (copy.field === field) return { column, type: copy.type };
  throw new DocStoreError(`Cannot query "${spec.table}" by "${String(field)}": it has no index column. Add one in tableMap.ts and schema.sql.`, 3);
}

/** The SQL value for a filter value, or undefined when its type cannot match (Firestore matches only same-typed values). */
function sqlValue(type: Column['type'], v: unknown): string | number | undefined {
  switch (type) {
    case 'id':     return typeof v === 'string' ? v : v instanceof DocumentReference ? v.id : undefined;
    case 'string': return typeof v === 'string' ? v : undefined;
    case 'number': return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
    case 'bool':   return typeof v === 'boolean' ? (v ? 1 : 0) : undefined;
  }
}

const SQL_OP: Record<Exclude<Op, 'in'>, string> = { '==': '=', '<': '<', '<=': '<=', '>': '>', '>=': '>=' };
const q = (name: string) => `\`${name}\``;

export class Query<T = any> {
  constructor(
    protected readonly store: DocStore,
    /** 'orders', or 'users/pointsLedger' for a subcollection. */
    readonly collectionKey: string,
    readonly parentId: string | null,
    protected readonly filters: Filter[] = [],
    protected readonly orders: Order[] = [],
    protected readonly limitN: number | null = null,
    protected readonly fields: string[] | null = null,
    protected readonly cursor: DocumentSnapshot | null = null,
  ) {}

  protected get spec(): TableSpec { return specFor(this.collectionKey); }

  private with(changes: Partial<{ filters: Filter[]; orders: Order[]; limitN: number | null; fields: string[] | null; cursor: DocumentSnapshot | null }>): Query<T> {
    return new Query<T>(this.store, this.collectionKey, this.parentId,
      changes.filters ?? this.filters, changes.orders ?? this.orders,
      'limitN' in changes ? changes.limitN! : this.limitN,
      'fields' in changes ? changes.fields! : this.fields,
      'cursor' in changes ? changes.cursor! : this.cursor);
  }

  where(field: string | unknown, op: Op, value: unknown): Query<T> {
    if (!(op in SQL_OP) && op !== 'in') throw new DocStoreError(`Unsupported where operator "${op}".`, 3);
    columnFor(this.spec, field as string);   // fail at build time, not at get()
    return this.with({ filters: [...this.filters, { field: field as string, op, value }] });
  }
  orderBy(field: string | unknown, dir: 'asc' | 'desc' = 'asc'): Query<T> {
    columnFor(this.spec, field as string);
    return this.with({ orders: [...this.orders, { field: field as string, dir }] });
  }
  limit(n: number): Query<T> { return this.with({ limitN: n }); }
  select(...fields: string[]): Query<T> { return this.with({ fields }); }
  startAfter(snapshot: DocumentSnapshot): Query<T> {
    if (!(snapshot instanceof DocumentSnapshot)) throw new DocStoreError('startAfter() supports a document snapshot only.', 3);
    return this.with({ cursor: snapshot });
  }
  count() {
    return { get: async () => { const n = await this.store._count(this.store.pool, this); return { data: () => ({ count: n }) }; } };
  }
  async get(): Promise<QuerySnapshot<T>> { return this.store._runQuery(this.store.pool, this, false) as Promise<QuerySnapshot<T>>; }

  /** @internal SQL for this query. */
  _sql(mode: 'rows' | 'count', lock: boolean): { sql: string; params: unknown[] } {
    const spec = this.spec;
    const where: string[] = [];
    const params: unknown[] = [];
    if (spec.parentColumn) { where.push(`${q(spec.parentColumn)} = ?`); params.push(this.parentId); }

    for (const f of this.filters) {
      const col = columnFor(spec, f.field);
      if (f.op === 'in') {
        const values = (Array.isArray(f.value) ? f.value : []).map((v) => sqlValue(col.type, v)).filter((v) => v !== undefined);
        if (!values.length) { where.push('FALSE'); continue; }
        where.push(`${q(col.column)} IN (${values.map(() => '?').join(',')})`);
        params.push(...values);
      } else {
        const v = sqlValue(col.type, f.value);
        if (v === undefined) { where.push('FALSE'); continue; }
        where.push(`${q(col.column)} ${SQL_OP[f.op]} ?`);
        params.push(v);
      }
    }
    // Firestore leaves out documents that lack an orderBy field.
    for (const o of this.orders) where.push(`${q(columnFor(spec, o.field).column)} IS NOT NULL`);

    // The implicit last ordering is the document id, in the direction of the last orderBy.
    const order: { column: string; dir: 'asc' | 'desc'; field: string | DocumentIdPath }[] =
      this.orders.map((o) => ({ column: columnFor(spec, o.field).column, dir: o.dir, field: o.field }));
    if (!order.some((o) => o.column === 'id')) order.push({ column: 'id', dir: order.length ? order[order.length - 1].dir : 'asc', field: DOCUMENT_ID });

    if (this.cursor && mode === 'rows') {
      const doc = (this.cursor.data() ?? {}) as Obj;
      const values = order.map((o) => (o.column === 'id' ? this.cursor!.id : getPath(doc, o.field as string)));
      const ors: string[] = [];
      for (let i = 0; i < order.length; i++) {
        const parts: string[] = [];
        for (let j = 0; j < i; j++) { parts.push(`${q(order[j].column)} = ?`); params.push(values[j]); }
        parts.push(`${q(order[i].column)} ${order[i].dir === 'asc' ? '>' : '<'} ?`);
        params.push(values[i]);
        ors.push(`(${parts.join(' AND ')})`);
      }
      where.push(`(${ors.join(' OR ')})`);
    }

    const from = `FROM ${q(spec.table)}${where.length ? ` WHERE ${where.join(' AND ')}` : ''}`;
    if (mode === 'count') return { sql: `SELECT COUNT(*) AS n ${from}`, params };
    const dataCol = spec.encrypted ? 'ciphertext' : 'data';
    let sql = `SELECT id, ${q(dataCol)} AS raw ${from} ORDER BY ${order.map((o) => `${q(o.column)} ${o.dir.toUpperCase()}`).join(', ')}`;
    if (this.limitN !== null) { sql += ' LIMIT ?'; params.push(this.limitN); }
    if (lock) sql += ' FOR UPDATE';
    return { sql, params };
  }

  /** @internal */ get _fields(): string[] | null { return this.fields; }
}

export class CollectionReference<T = any> extends Query<T> {
  constructor(store: DocStore, collectionKey: string, parentId: string | null, private readonly name: string) {
    super(store, collectionKey, parentId);
    specFor(collectionKey);   // an unmapped collection fails here, by name
  }
  get id(): string { return this.name; }
  doc(id?: string): DocumentReference<T> { return new DocumentReference<T>(this.store, this, id ?? autoId()); }
  async add(data: T): Promise<DocumentReference<T>> {
    const ref = this.doc();
    await ref.create(data);
    return ref;
  }
}

export class DocumentReference<T = any> {
  constructor(private readonly store: DocStore, readonly parent: CollectionReference<T>, readonly id: string) {}
  get path(): string {
    return this.parent.parentId !== null
      ? `${this.parent.collectionKey.split('/')[0]}/${this.parent.parentId}/${this.parent.id}/${this.id}`
      : `${this.parent.id}/${this.id}`;
  }
  collection(name: string): CollectionReference {
    if (this.parent.parentId !== null) throw new DocStoreError('Only one level of subcollection is mapped.', 3);
    return new CollectionReference(this.store, `${this.parent.collectionKey}/${name}`, this.id, name);
  }
  async get(): Promise<DocumentSnapshot<T>> { return (await this.store._read(this.store.pool, [this], false))[0] as DocumentSnapshot<T>; }
  set(data: T | Obj, options?: { merge?: boolean; mergeFields?: string[] }) { return this.store._write({ kind: 'set', ref: this, data: data as Obj, options }); }
  update(data: Obj) { return this.store._write({ kind: 'update', ref: this, data }); }
  create(data: T | Obj) { return this.store._write({ kind: 'create', ref: this, data: data as Obj }); }
  delete() { return this.store._write({ kind: 'delete', ref: this }); }
}

// ───────────────────────────── Writes ─────────────────────────────

type WriteOp =
  | { kind: 'set'; ref: DocumentReference; data: Obj; options?: { merge?: boolean; mergeFields?: string[] } }
  | { kind: 'update'; ref: DocumentReference; data: Obj }
  | { kind: 'create'; ref: DocumentReference; data: Obj }
  | { kind: 'delete'; ref: DocumentReference };

type Exec = Pick<Pool | PoolConnection, 'query'>;

export class WriteBatch {
  private readonly ops: WriteOp[] = [];
  constructor(private readonly store: DocStore) {}
  set(ref: DocumentReference, data: Obj, options?: { merge?: boolean; mergeFields?: string[] }) { this.ops.push({ kind: 'set', ref, data, options }); return this; }
  update(ref: DocumentReference, data: Obj) { this.ops.push({ kind: 'update', ref, data }); return this; }
  create(ref: DocumentReference, data: Obj) { this.ops.push({ kind: 'create', ref, data }); return this; }
  delete(ref: DocumentReference) { this.ops.push({ kind: 'delete', ref }); return this; }
  async commit(): Promise<void> {
    const ops = this.ops.splice(0);
    ops.forEach((op) => 'data' in op && assertNoUndefined(op.data));
    await this.store._withTx(async (conn) => { for (const op of ops) await this.store._apply(conn, op); });
  }
}

export class Transaction {
  private chain: Promise<void> = Promise.resolve();
  constructor(private readonly store: DocStore, private readonly conn: PoolConnection) {}
  async get(target: DocumentReference | Query): Promise<any> {
    await this.chain;
    return target instanceof DocumentReference
      ? (await this.store._read(this.conn, [target], true))[0]
      : this.store._runQuery(this.conn, target, true);
  }
  async getAll(...refs: unknown[]): Promise<DocumentSnapshot[]> {
    await this.chain;
    const { list, fields } = splitGetAllArgs(refs);
    return this.store._read(this.conn, list, true, fields);
  }
  private queue(op: WriteOp) {
    if ('data' in op) assertNoUndefined(op.data);
    this.chain = this.chain.then(() => this.store._apply(this.conn, op));
    return this;
  }
  set(ref: DocumentReference, data: Obj, options?: { merge?: boolean; mergeFields?: string[] }) { return this.queue({ kind: 'set', ref, data, options }); }
  update(ref: DocumentReference, data: Obj) { return this.queue({ kind: 'update', ref, data }); }
  create(ref: DocumentReference, data: Obj) { return this.queue({ kind: 'create', ref, data }); }
  delete(ref: DocumentReference) { return this.queue({ kind: 'delete', ref }); }
  /** @internal */ _settle(): Promise<void> { return this.chain; }
}

function splitGetAllArgs(args: unknown[]): { list: DocumentReference[]; fields: string[] | null } {
  const last = args[args.length - 1];
  if (last && !(last instanceof DocumentReference) && typeof last === 'object') {
    const mask = (last as { fieldMask?: string[] }).fieldMask;
    return { list: args.slice(0, -1) as DocumentReference[], fields: Array.isArray(mask) ? mask : null };
  }
  return { list: args as DocumentReference[], fields: null };
}

// ───────────────────────────── The store ─────────────────────────────

export interface DocStoreOptions {
  /** 32-byte key for the encrypted `secrets` table. */
  secretsKey?: Buffer | null;
  /** How many times a transaction is tried on deadlock / lock timeout. */
  maxAttempts?: number;
}

const RETRYABLE = new Set([1213 /* ER_LOCK_DEADLOCK */, 1205 /* ER_LOCK_WAIT_TIMEOUT */]);

export class DocStore {
  constructor(readonly pool: Pool, private readonly opts: DocStoreOptions = {}) {}

  collection(name: string): CollectionReference {
    if (name.includes('/')) throw new DocStoreError('Pass a collection name, not a path.', 3);
    return new CollectionReference(this, name, null, name);
  }

  batch(): WriteBatch { return new WriteBatch(this); }

  async getAll(...args: unknown[]): Promise<DocumentSnapshot[]> {
    const { list, fields } = splitGetAllArgs(args);
    return this._read(this.pool, list, false, fields);
  }

  async runTransaction<R>(fn: (tx: Transaction) => Promise<R>, options?: { maxAttempts?: number }): Promise<R> {
    return this._withTx(async (conn) => {
      const tx = new Transaction(this, conn);
      const result = await fn(tx);
      await tx._settle();
      return result;
    }, options?.maxAttempts);
  }

  // ── internals ──

  /** Runs fn inside a MySQL transaction; retries the whole thing on deadlock, like Firestore on contention. */
  async _withTx<R>(fn: (conn: PoolConnection) => Promise<R>, maxAttempts = this.opts.maxAttempts ?? 5): Promise<R> {
    for (let attempt = 1; ; attempt++) {
      const conn = await this.pool.getConnection();
      try {
        await conn.query('START TRANSACTION');
        const result = await fn(conn);
        await conn.query('COMMIT');
        return result;
      } catch (err: any) {
        await conn.query('ROLLBACK').catch(() => undefined);
        if (RETRYABLE.has(err?.errno) && attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 20 * attempt + crypto.randomInt(30)));
          continue;
        }
        throw err;
      } finally {
        conn.release();
      }
    }
  }

  private key(): Buffer {
    const k = this.opts.secretsKey;
    if (!k || k.length !== 32) throw new Error('DB_SECRETS_KEY is not set (32 bytes, base64) — the secrets table cannot be read or written.');
    return k;
  }

  private decode(spec: TableSpec, raw: string): string {
    return spec.encrypted ? decrypt(this.key(), raw) : raw;
  }

  /** Reads documents by reference, in the order asked; missing ones come back with exists = false. */
  async _read(exec: Exec, refs: DocumentReference[], lock: boolean, fields: string[] | null = null): Promise<DocumentSnapshot[]> {
    const found = new Map<DocumentReference, string>();
    const groups = new Map<string, DocumentReference[]>();
    for (const ref of refs) {
      const g = `${ref.parent.collectionKey}\u0000${ref.parent.parentId ?? ''}`;
      (groups.get(g) ?? groups.set(g, []).get(g)!).push(ref);
    }
    for (const group of groups.values()) {
      const { collectionKey, parentId } = group[0].parent;
      const spec = specFor(collectionKey);
      const ids = [...new Set(group.map((r) => r.id))];
      const params: unknown[] = [];
      let sql = `SELECT id, ${q(spec.encrypted ? 'ciphertext' : 'data')} AS raw FROM ${q(spec.table)} WHERE `;
      if (spec.parentColumn) { sql += `${q(spec.parentColumn)} = ? AND `; params.push(parentId); }
      sql += `id IN (${ids.map(() => '?').join(',')})`;
      params.push(...ids);
      if (lock) sql += ' FOR UPDATE';
      const [rows] = await exec.query(sql, params) as [Array<{ id: string; raw: string }>, unknown];
      const byId = new Map(rows.map((r) => [r.id, this.decode(spec, r.raw)]));
      for (const ref of group) if (byId.has(ref.id)) found.set(ref, byId.get(ref.id)!);
    }
    return refs.map((ref) => new DocumentSnapshot(ref, found.get(ref) ?? null, fields));
  }

  async _runQuery(exec: Exec, query: Query, lock: boolean): Promise<QuerySnapshot> {
    const spec = specFor(query.collectionKey);
    const { sql, params } = query._sql('rows', lock);
    const [rows] = await exec.query(sql, params) as [Array<{ id: string; raw: string }>, unknown];
    const coll = new CollectionReference(this, query.collectionKey, query.parentId, query.collectionKey.split('/').pop()!);
    return new QuerySnapshot(rows.map((r) => new DocumentSnapshot(coll.doc(r.id), this.decode(spec, r.raw), query._fields)));
  }

  async _count(exec: Exec, query: Query): Promise<number> {
    const { sql, params } = query._sql('count', false);
    const [rows] = await exec.query(sql, params) as [Array<{ n: number }>, unknown];
    return Number(rows[0].n);
  }

  /** A single write outside a transaction still reads-modifies-writes atomically. */
  async _write(op: WriteOp): Promise<void> {
    if ('data' in op) assertNoUndefined(op.data);
    await this._withTx((conn) => this._apply(conn, op));
  }

  /** Applies one write on a connection that is inside a transaction. */
  async _apply(conn: PoolConnection, op: WriteOp): Promise<void> {
    const { ref } = op;
    const spec = specFor(ref.parent.collectionKey);
    const current = async () => {
      const [snap] = await this._read(conn, [ref], true);
      return snap.exists ? (snap.data() as Obj) : undefined;
    };

    if (op.kind === 'delete') {
      const params: unknown[] = [];
      let sql = `DELETE FROM ${q(spec.table)} WHERE `;
      if (spec.parentColumn) { sql += `${q(spec.parentColumn)} = ? AND `; params.push(ref.parent.parentId); }
      sql += 'id = ?';
      params.push(ref.id);
      await conn.query(sql, params);
      return;
    }

    let doc: Obj;
    if (op.kind === 'create') {
      if (await current()) throw new DocStoreError(`Document already exists: ${ref.path}`, 6);
      doc = plainCopy(op.data) as Obj;
    } else if (op.kind === 'update') {
      const cur = await current();
      if (!cur) throw new DocStoreError(`No document to update: ${ref.path}`, 5);
      applyUpdate(cur, op.data);
      doc = cur;
    } else if (op.options?.mergeFields) {
      doc = (await current()) ?? {};
      for (const path of op.options.mergeFields) {
        const v = getPath(op.data, path);
        if (v === undefined || v instanceof DeleteSentinel) deletePath(doc, path);
        else setPath(doc, path, v instanceof ArrayUnionSentinel ? union(getPath(doc, path), v.elements) : plainCopy(v));
      }
    } else if (op.options?.merge) {
      doc = (await current()) ?? {};
      mergeInto(doc, op.data);
    } else {
      doc = plainCopy(op.data) as Obj;
    }

    const { table, row } = toRow(ref.parent.collectionKey, ref.id, doc, ref.parent.parentId ?? undefined);
    if (spec.encrypted) row.ciphertext = encrypt(this.key(), row.ciphertext as string);
    const cols = Object.keys(row);
    const updates = cols.filter((c) => c !== 'id' && c !== spec.parentColumn).map((c) => `${q(c)} = VALUES(${q(c)})`);
    await conn.query(
      `INSERT INTO ${q(table)} (${cols.map(q).join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) ON DUPLICATE KEY UPDATE ${updates.join(', ')}`,
      cols.map((c) => row[c]),
    );
  }
}
