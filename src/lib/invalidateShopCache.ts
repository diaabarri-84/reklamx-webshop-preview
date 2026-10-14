// Tell the server its cached copy of the shop is out of date.
//
// WHY THIS EXISTS
// The storefront no longer reads `products` or `categories` from Firestore — it
// asks /api/catalogue and /api/categories, which the server reads once every
// five minutes and hands to every visitor. That is what keeps the shop alive
// when the project's daily read quota runs out, as it did on 2026-09-12.
//
// But the DASHBOARD still writes straight to Firestore from the browser, so the
// server never sees those writes and cannot drop its cache the way the supplier
// importer does. Without this call the owner edits a category, opens the shop,
// sees the old one, and concludes the save failed — which is exactly the "press
// refresh" complaint round 9 was supposed to end.
//
// It is deliberately quiet. The write it follows has already succeeded; a failed
// cache hint means the shop is five minutes stale, not that anything was lost,
// and an error toast here would be reporting a problem the owner cannot act on.

import { auth } from '../firebase';

export async function invalidateShopCache(): Promise<void> {
  try {
    const token = await auth.currentUser?.getIdToken().catch(() => null);
    if (!token) return;
    await fetch('/api/admin/cache/invalidate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    /* see the note above: the save itself already went through */
  }
}
