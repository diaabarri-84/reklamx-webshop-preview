/**
 * THE ORDERS, LOADED ONCE — the admin dashboard and the production queue.
 *
 * Every order document carries its artwork as base64 (Storage is not enabled),
 * so an order can be most of a megabyte, and every document read is billed
 * against a free-plan quota this shop has run out of three times. Before this
 * hook each screen paid for the orders its own way:
 *
 *   - the Orders tab opened a NEW 200-order listener every time it was shown —
 *     each tile click, each "Latest orders" row, each return from another tab;
 *   - the overview read the same 200 orders again with a one-off query;
 *   - "Show older" raised the listener's limit, which re-read everything from
 *     the first order: 400 reads, then 600, then 800.
 *
 * Now: ONE live listener on the newest page, owned by the page (not the tab),
 * and older pages fetched once each with a cursor. Older pages are a snapshot,
 * not live — `patch` applies a screen's own write to them, so an edit made to an
 * old order shows at once; anyone else's edit to an old order appears on the
 * next visit.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  collection,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { Order } from '../types';

export interface OrderFeed {
  /** The newest page (live) and every older page loaded, newest first, each order once. */
  orders: Order[];
  loading: boolean;
  /** The live listener failed (quota, rules, network). */
  error: boolean;
  /** The last page loaded was full, so there may be older orders. */
  hasMore: boolean;
  loadingOlder: boolean;
  olderError: boolean;
  loadOlder: () => void;
  /** Apply this screen's own write to its copy of an order (needed for older pages). */
  patch: (orderId: string, fields: Partial<Order>) => void;
}

export function useOrderFeed(pageSize = 200, enabled = true): OrderFeed {
  const [live, setLive] = useState<QueryDocumentSnapshot[]>([]);
  const [older, setOlder] = useState<Order[]>([]);
  const [patches, setPatches] = useState<Record<string, Partial<Order>>>({});
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState(false);
  const [olderFull, setOlderFull] = useState<boolean | null>(null);
  // The cursor for the next older page: the last document of the last page read.
  const cursorRef = useRef<QueryDocumentSnapshot | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    setLoading(true);
    return onSnapshot(
      query(collection(db, 'orders'), orderBy('createdAt', 'desc'), limit(pageSize)),
      (snap) => {
        setLive(snap.docs);
        setLoading(false);
        setError(false);
      },
      (err) => {
        console.warn('Error loading orders:', err);
        setLoading(false);
        setError(true);
      },
    );
  }, [enabled, pageSize]);

  const loadOlder = useCallback(() => {
    if (busyRef.current) return;
    const after = cursorRef.current ?? live[live.length - 1];
    if (!after) return;
    busyRef.current = true;
    setLoadingOlder(true);
    setOlderError(false);
    getDocs(query(collection(db, 'orders'), orderBy('createdAt', 'desc'), startAfter(after), limit(pageSize)))
      .then((snap) => {
        if (snap.docs.length) cursorRef.current = snap.docs[snap.docs.length - 1];
        setOlder((prev) => [...prev, ...snap.docs.map((d) => ({ ...d.data(), id: d.id } as Order))]);
        setOlderFull(snap.docs.length === pageSize);
      })
      .catch((err) => {
        // What is already on screen stays on screen; only the button reports.
        console.warn('Error loading older orders:', err);
        setOlderError(true);
      })
      .finally(() => {
        busyRef.current = false;
        setLoadingOlder(false);
      });
  }, [live, pageSize]);

  const patch = useCallback((orderId: string, fields: Partial<Order>) => {
    setPatches((prev) => ({ ...prev, [orderId]: { ...prev[orderId], ...fields } }));
  }, []);

  const orders = useMemo(() => {
    const seen = new Set<string>();
    const out: Order[] = [];
    for (const d of live) {
      seen.add(d.id);
      out.push({ ...d.data(), id: d.id } as Order);
    }
    for (const o of older) {
      if (seen.has(o.id)) continue;
      seen.add(o.id);
      // A patch only ever matters for an older order: a live one already
      // carries the write (Firestore shows a pending local write at once).
      out.push(patches[o.id] ? { ...o, ...patches[o.id] } : o);
    }
    return out;
  }, [live, older, patches]);

  const hasMore = olderFull ?? live.length === pageSize;

  return { orders, loading, error, hasMore, loadingOlder, olderError, loadOlder, patch };
}
