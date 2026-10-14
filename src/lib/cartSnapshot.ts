// A basket, reduced to what a report may keep — plan task 5.7c.
//
// WHY IT IS A REDUCTION AND NOT A COPY.
//
// A cart line carries the customer's ARTWORK. When object storage was reachable
// that is a URL, but the fallback path stores the file itself as base64 — in
// `fileUrl` AND again in `fileSpecs.fileUrl` — and the shop lets a single basket
// hold 85% of a megabyte of it (see artworkLimits.ts). Copying a basket verbatim
// into Firestore would therefore:
//
//   * put a customer's print file into a second place nobody asked for it to be,
//     which is a data-protection question and not a technical one;
//   * push the document against the 1 MiB limit, so the write fails on exactly
//     the baskets worth the most money;
//   * and spend the free tier's storage and bandwidth on bytes no report reads.
//
// AND IT IS NOT ONLY THE ARTWORK. A line also copies `image` — the product's own
// first picture (cart.ts:134) — verbatim, and that is a base64 data URL whenever
// the owner used the upload button in the product admin rather than pasting a
// URL. It is capped by NOTHING: `artworkWouldOverflow` does not count it. In a
// real backup of this shop, 6 of 18 products carried one, the largest 290 119
// characters; four such lines are 1.11 MB of basket with no artwork in it at all,
// already over the Firestore document limit.
//
// So this keeps the SHAPE of the basket — what was in it, how much, what it was
// worth — and throws every picture and every file away. `artworkPending` survives
// because "he never sent the file" is one of the most useful reasons a basket
// stalls, and it is a boolean, not a file.
//
// Pure, and tested in scripts/test-cart-snapshot.mjs.

/** How many lines a snapshot will describe. A basket longer than this is summarised. */
export const MAX_SNAPSHOT_LINES = 20;

/** Trimmed hard: a product name is for reading in a list, not for storing a novel. */
const MAX_TEXT = 120;

export interface SnapshotLine {
  productId: string | null;
  name: string;
  quantity: number;
  /** Ex-VAT, as the cart computed it. Recomputed by the server at checkout. */
  totalPrice: number;
  /** True when the line needs a print file and has none — a common reason to stall. */
  artworkPending: boolean;
}

export interface CartSnapshot {
  lines: SnapshotLine[];
  /** Lines actually described; `lineCount` may be larger. */
  lineCount: number;
  itemCount: number;
  /** Ex-VAT sum of every line, including any beyond MAX_SNAPSHOT_LINES. */
  value: number;
  /** True when at least one line is waiting for artwork. */
  anyArtworkPending: boolean;
  /** A stable fingerprint of the basket's CONTENT, so an unchanged cart is not re-written. */
  fingerprint: string;
}

const text = (value: unknown): string => String(value ?? '').trim().slice(0, MAX_TEXT);

const money = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
};

const count = (value: unknown): number => {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * A short, stable hash of what is in the basket.
 *
 * Its only job is to answer "has this changed since I last stored it?" — so it is
 * a cheap non-cryptographic hash, not a security primitive. It must be STABLE:
 * the same basket on two days has to hash the same, or every visit writes.
 */
export function fingerprintCart(lines: SnapshotLine[], value: number): string {
  const basis = lines
    .map((l) => `${l.productId ?? ''}:${l.quantity}:${l.totalPrice}`)
    .join('|') + `#${value}`;
  // FNV-1a, 32-bit. Short, deterministic, and it never has to be reversed.
  let h = 0x811c9dc5;
  for (let i = 0; i < basis.length; i += 1) {
    h ^= basis.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/**
 * Reduce a live cart to a snapshot. Never throws: this runs beside the
 * customer's own basket, and a report must not be able to break a purchase.
 */
export function snapshotCart(items: unknown): CartSnapshot {
  const all = Array.isArray(items) ? items : [];

  let value = 0;
  let itemCount = 0;
  let anyArtworkPending = false;
  for (const raw of all) {
    const line = (raw ?? {}) as Record<string, any>;
    value += money(line.totalPrice);
    itemCount += count(line.quantity);
    if (line.artworkPending === true) anyArtworkPending = true;
  }

  const lines: SnapshotLine[] = all.slice(0, MAX_SNAPSHOT_LINES).map((raw) => {
    const line = (raw ?? {}) as Record<string, any>;
    return {
      // The id, so the owner can see WHICH product people abandon. Never the
      // artwork, never the file name, never the storage path.
      productId: text(line.productId) || null,
      // THREE SHAPES SHARE THIS KEY, and they name themselves differently:
      // a configured product has `productName` (cart.ts:133), a custom upload and
      // a saved design have `title`. Reading only `name` — which none of them
      // actually has — would have filled the report with blank rows.
      name: text(line.productName ?? line.title ?? line.name),
      quantity: count(line.quantity),
      totalPrice: money(line.totalPrice),
      artworkPending: line.artworkPending === true,
    };
  });

  return {
    lines,
    lineCount: all.length,
    itemCount,
    value: Math.round(value * 100) / 100,
    anyArtworkPending,
    fingerprint: fingerprintCart(lines, Math.round(value * 100) / 100),
  };
}

/**
 * Is this basket worth recording at all?
 *
 * An empty basket is not an abandoned one, and neither is a basket worth nothing
 * — a line whose price never resolved is a bug to fix, not a sale that was lost.
 */
export function worthRecording(snapshot: CartSnapshot): boolean {
  return snapshot.lineCount > 0 && snapshot.value > 0;
}
