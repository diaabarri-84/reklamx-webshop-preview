// The dashboard's call into /api/admin/products/bulk.
//
// One function, one endpoint, one shape of answer. The alternative — each screen
// building its own fetch — is how the option-image upload came to exist twice.

import { auth } from '../firebase';

export type BulkPayload =
  | { ids: string[]; op: 'delete' }
  | { ids: string[]; op: 'visibility'; hidden: boolean }
  | { ids: string[]; op: 'category'; categoryId: string }
  // The artwork upload box, per product. Turning it off clears the
  // mandatory-file flag with it, server-side.
  | { ids: string[]; op: 'artwork'; enabled: boolean }
  | { ids: string[]; op: 'price'; mode: 'set' | 'percent'; value: number }
  | { ids: string[]; op: 'salePrice'; value: number | null }
  | { ids: string[]; op: 'margin'; marginPercent: number }
  // The library goes ONCE, not once per product. The server keeps any field a
  // product already carries even when it is switched off here, so a field turned
  // off in the library is never silently stripped from a product configured
  // with it.
  | {
      ids: string[];
      op: 'printingFields';
      fields: unknown[];
      /**
       * HOW the library reaches the products — the owner picks each time; see
       * src/lib/libraryApply.ts. `fieldIds` is for 'update-selected';
       * `dropProductOnly` only means anything with 'replace-all'.
       */
      mode: 'add-new' | 'update-selected' | 'replace-all';
      fieldIds?: string[];
      /** update-selected: switch the chosen properties on / off on every target. */
      switchTo?: 'on' | 'off';
      dropProductOnly?: boolean;
      pricing?: {
        minPrice: number; pricePerSqm: number; pricePerLinearMeter: number;
        baseSetupFee: number; volumeDiscounts: unknown[];
      } | null;
    };

export interface BulkResult {
  ok: true;
  op: string;
  /** How many documents were actually written. */
  changed: number;
  /** How many were asked for — differs from `changed` when some had vanished. */
  requested: number;
  /** Present only when some of the ids no longer exist. */
  missing?: number;
  /** A plain-language aside, e.g. which products had no trade price to re-price. */
  note?: string;
}

export async function bulkProducts(payload: BulkPayload): Promise<BulkResult> {
  const token = await auth.currentUser?.getIdToken().catch(() => null);
  if (!token) throw new Error('Not signed in.');

  const res = await fetch('/api/admin/products/bulk', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error || 'The bulk change failed.');
  return body as BulkResult;
}
