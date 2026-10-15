// Stand-in for 'firebase/firestore' when the shop runs on its own database
// (DATA_BACKEND=mysql; swapped in by vite.config.ts). The functions the screens
// use — doc, collection, query/where/orderBy/limit/startAfter, getDoc(s),
// setDoc, updateDoc, deleteDoc, writeBatch, onSnapshot, deleteField — with the
// same shapes, against /api/data/* (src/lib/db/localRoutes.ts), where the rules
// of firestore.rules are enforced (src/lib/db/accessRules.ts).
//
// onSnapshot is a poll here, not a push: every few seconds while the page is
// visible, calling back only when the data changed. Fine for the three places
// that listen (site settings, the order feed, an upload page).

import { api } from './session';

export class FirestoreError extends Error {
  constructor(readonly code: string, message?: string) {
    super(message ?? code);
    this.name = 'FirebaseError';
  }
}

// ── References ──

export interface Firestore { type: 'firestore' }
const DB: Firestore = { type: 'firestore' };
export const getFirestore = (..._args: unknown[]): Firestore => DB;
export const connectFirestoreEmulator = (..._args: unknown[]): void => {};

const AUTO_ID = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
function autoId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return Array.from(bytes, (b) => AUTO_ID[b % AUTO_ID.length]).join('');
}

export class CollectionReference {
  readonly type = 'collection' as const;
  constructor(readonly path: string) {}
  get id(): string { return this.path.split('/').pop()!; }
  get parent(): DocumentReference | null {
    const parts = this.path.split('/');
    return parts.length > 1 ? new DocumentReference(parts.slice(0, -1).join('/')) : null;
  }
}
export class DocumentReference {
  readonly type = 'document' as const;
  constructor(readonly path: string) {}
  get id(): string { return this.path.split('/').pop()!; }
  get parent(): CollectionReference { return new CollectionReference(this.path.split('/').slice(0, -1).join('/')); }
}

const join = (...parts: string[]) => parts.join('/').split('/').filter(Boolean).join('/');

export function collection(parent: Firestore | DocumentReference | CollectionReference, ...segments: string[]): CollectionReference {
  const base = parent instanceof DocumentReference || parent instanceof CollectionReference ? parent.path : '';
  return new CollectionReference(join(base, ...segments));
}
export function doc(parent: Firestore | CollectionReference | DocumentReference, ...segments: string[]): DocumentReference {
  const base = parent instanceof DocumentReference || parent instanceof CollectionReference ? parent.path : '';
  const path = join(base, ...segments);
  // doc(collectionRef) with no id: a new auto id, like Firestore.
  return new DocumentReference(path.split('/').length % 2 === 1 ? `${path}/${autoId()}` : path);
}

// ── Queries ──

type Op = '==' | '<' | '<=' | '>' | '>=' | 'in';
type Constraint =
  | { kind: 'where'; field: string; op: Op; value: unknown }
  | { kind: 'orderBy'; field: string; dir: 'asc' | 'desc' }
  | { kind: 'limit'; n: number }
  | { kind: 'startAfter'; snap: QueryDocumentSnapshot };

export class Query {
  readonly type = 'query' as const;
  constructor(readonly collectionRef: CollectionReference, readonly constraints: Constraint[]) {}
}
export const where = (field: string, op: Op, value: unknown): Constraint => ({ kind: 'where', field, op, value: encode(value) });
export const orderBy = (field: string, dir: 'asc' | 'desc' = 'asc'): Constraint => ({ kind: 'orderBy', field, dir });
export const limit = (n: number): Constraint => ({ kind: 'limit', n });
export const startAfter = (snap: QueryDocumentSnapshot): Constraint => ({ kind: 'startAfter', snap });
export function query(ref: CollectionReference | Query, ...constraints: Constraint[]): Query {
  return ref instanceof Query ? new Query(ref.collectionRef, [...ref.constraints, ...constraints]) : new Query(ref, constraints);
}
export const documentId = () => '__name__';

// ── Snapshots ──

const META = { fromCache: false, hasPendingWrites: false };
const getPath = (o: any, path: string) => path.split('.').reduce((v, k) => (v && typeof v === 'object' ? v[k] : undefined), o);

export class DocumentSnapshot<T = any> {
  readonly metadata = META;
  constructor(readonly ref: DocumentReference, private readonly raw: T | null) {}
  get id(): string { return this.ref.id; }
  exists(): this is QueryDocumentSnapshot<T> { return this.raw !== null; }
  /** A fresh copy every call, like Firestore's. */
  data(): T | undefined { return this.raw === null ? undefined : structuredClone(this.raw); }
  get(field: string): unknown { return this.raw === null ? undefined : getPath(this.raw, field); }
}
export class QueryDocumentSnapshot<T = any> extends DocumentSnapshot<T> {
  data(): T { return super.data() as T; }
}
export class QuerySnapshot<T = any> {
  readonly metadata = META;
  constructor(readonly docs: QueryDocumentSnapshot<T>[]) {}
  get size(): number { return this.docs.length; }
  get empty(): boolean { return this.docs.length === 0; }
  forEach(cb: (d: QueryDocumentSnapshot<T>) => void): void { this.docs.forEach(cb); }
}

// ── Values ──

const DELETE = { __rx: 'delete' };
export const deleteField = () => DELETE;
export const arrayUnion = (...v: unknown[]) => ({ __rx: 'arrayUnion', v: v.map(encode) });
export const serverTimestamp = () => ({ __rx: 'serverTimestamp' });

/** What goes over the wire: Dates as ISO strings (what the server itself writes), undefined dropped. */
function encode(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(encode);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (x !== undefined) out[k] = encode(x);
    return out;
  }
  return v;
}

async function call(path: string, body: unknown): Promise<any> {
  let r;
  try { r = await api(path, body); } catch { throw new FirestoreError('unavailable', 'The shop\'s server did not answer.'); }
  if (!r.ok) throw new FirestoreError(String(r.data?.code ?? (r.status === 403 ? 'permission-denied' : 'unknown')), r.data?.error);
  return r.data;
}

// ── Reads ──

export async function getDoc<T = any>(ref: DocumentReference): Promise<DocumentSnapshot<T>> {
  const r = await call('/api/data/get', { path: ref.path });
  return r.exists ? new QueryDocumentSnapshot<T>(ref, r.data) : new DocumentSnapshot<T>(ref, null);
}
export const getDocFromServer = getDoc;

export async function getDocs<T = any>(q: Query | CollectionReference): Promise<QuerySnapshot<T>> {
  const query_ = q instanceof Query ? q : new Query(q, []);
  const body: Record<string, unknown> = { collection: query_.collectionRef.path, where: [], orderBy: [] };
  for (const c of query_.constraints) {
    if (c.kind === 'where') (body.where as unknown[]).push([c.field, c.op, c.value]);
    else if (c.kind === 'orderBy') (body.orderBy as unknown[]).push([c.field, c.dir]);
    else if (c.kind === 'limit') body.limit = c.n;
    else if (c.kind === 'startAfter') body.startAfter = { id: c.snap.id, data: c.snap.data() };
  }
  const r = await call('/api/data/query', body);
  return new QuerySnapshot<T>(r.docs.map((d: { id: string; data: T }) => new QueryDocumentSnapshot<T>(new DocumentReference(`${query_.collectionRef.path}/${d.id}`), d.data)));
}
export const getDocsFromServer = getDocs;

// ── Writes ──

type Write = { type: 'set' | 'update' | 'delete'; path: string; data?: unknown; merge?: boolean; mergeFields?: string[] };
type SetOptions = { merge?: boolean; mergeFields?: string[] };
const commit = (writes: Write[]) => call('/api/data/commit', { writes });

/** updateDoc(ref, {a: 1}) or updateDoc(ref, 'a', 1, 'b', 2). */
function updateData(args: unknown[]): Record<string, unknown> {
  if (args.length === 1) return args[0] as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (let i = 0; i < args.length; i += 2) out[String(args[i])] = args[i + 1];
  return out;
}

export async function setDoc(ref: DocumentReference, data: unknown, options?: SetOptions): Promise<void> {
  await commit([{ type: 'set', path: ref.path, data: encode(data), merge: !!options?.merge, mergeFields: options?.mergeFields }]);
}
export async function updateDoc(ref: DocumentReference, ...args: unknown[]): Promise<void> {
  await commit([{ type: 'update', path: ref.path, data: encode(updateData(args)) }]);
}
export async function deleteDoc(ref: DocumentReference): Promise<void> {
  await commit([{ type: 'delete', path: ref.path }]);
}
export async function addDoc(coll: CollectionReference, data: unknown): Promise<DocumentReference> {
  const ref = doc(coll);
  await setDoc(ref, data);
  return ref;
}

export function writeBatch(_db?: Firestore) {
  const writes: Write[] = [];
  const batch = {
    set(ref: DocumentReference, data: unknown, options?: SetOptions) { writes.push({ type: 'set', path: ref.path, data: encode(data), merge: !!options?.merge, mergeFields: options?.mergeFields }); return batch; },
    update(ref: DocumentReference, ...args: unknown[]) { writes.push({ type: 'update', path: ref.path, data: encode(updateData(args)) }); return batch; },
    delete(ref: DocumentReference) { writes.push({ type: 'delete', path: ref.path }); return batch; },
    async commit() { if (writes.length) await commit(writes.splice(0)); },
  };
  return batch;
}

// ── Listening (polled) ──

type Next<T> = (snap: T) => void;
type Err = (e: FirestoreError) => void;

export function onSnapshot(target: DocumentReference | Query | CollectionReference, ...rest: unknown[]): () => void {
  // onSnapshot(ref, next, error?) or onSnapshot(ref, options, next, error?)
  const fns = rest.filter((x) => typeof x === 'function') as [Next<any>, Err?];
  const [next, error] = fns;
  const observer = rest.find((x) => x && typeof x === 'object' && typeof (x as any).next === 'function') as { next: Next<any>; error?: Err } | undefined;
  const onNext = next ?? observer?.next;
  const onError = error ?? observer?.error;
  let stopped = false;
  let last = '';
  let timer: ReturnType<typeof setTimeout> | null = null;
  const every = target instanceof DocumentReference ? 5000 : 10000;

  let running = false;
  const tick = async () => {
    if (stopped || running) return;   // one poll in flight at a time, whatever woke it
    running = true;
    try { await poll(); } finally { running = false; }
    if (!stopped) timer = setTimeout(tick, every);
  };
  const poll = async () => {
    if (typeof document === 'undefined' || document.visibilityState !== 'hidden') {
      try {
        const snap = target instanceof DocumentReference ? await getDoc(target) : await getDocs(target);
        const sig = JSON.stringify(snap instanceof QuerySnapshot ? snap.docs.map((d) => [d.id, d.data()]) : [snap.exists(), snap.data()]);
        if (!stopped && sig !== last) { last = sig; onNext?.(snap); }
      } catch (err) {
        if (!stopped) onError?.(err as FirestoreError);
        if ((err as FirestoreError)?.code === 'permission-denied') stopped = true;   // Firestore ends a refused listener
      }
    }
  };
  void tick();
  const wake = () => { if (!stopped && document.visibilityState === 'visible') { if (timer) clearTimeout(timer); void tick(); } };
  document.addEventListener('visibilitychange', wake);
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    document.removeEventListener('visibilitychange', wake);
  };
}
