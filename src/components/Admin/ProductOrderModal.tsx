import React, { useMemo, useState } from 'react';
import { deleteField, doc, updateDoc } from 'firebase/firestore';
import { motion } from 'motion/react';
import { Loader2, X } from 'lucide-react';
import { db } from '../../firebase';
import type { Category, Product } from '../../types';
import { descendantIds } from '../../lib/categoryTree';
import { orderByIdList } from '../../lib/ownerOrder';
import { invalidateShopCache } from '../../lib/invalidateShopCache';
import { safeImageSrc } from '../../lib/utils';
import SortableList, { DragHandle } from './SortableList';

/**
 * ARRANGE ONE CATEGORY PAGE — drag its products into the order the shop shows.
 *
 * The list is exactly what that page shows: the category's own products AND its
 * sub-categories', matched by id or by name the way the shop matches them, so
 * what he arranges here is what a customer scrolls through there. Hidden
 * products are in the list too, marked: arranging them now means they appear in
 * the right place the day he shows them.
 *
 * Saved as ONE write — `productOrder` on the category (src/lib/ownerOrder.ts) —
 * not a write to every product. A product that is added to the category later
 * simply follows the arranged ones.
 */
export default function ProductOrderModal({
  category,
  categories,
  products,
  onClose,
  onSaved,
}: {
  category: Category;
  categories: Category[];
  products: Product[];
  onClose: () => void;
  onSaved: (productOrder: string[] | null) => void;
}) {
  /** Every id and name the page's filter covers — the shop's own rule. */
  const forms = useMemo(() => {
    const set = new Set<string>();
    for (const id of descendantIds(categories, category.id)) {
      set.add(id);
      const c = categories.find((x) => x.id === id);
      if (c?.name) set.add(c.name);
    }
    return set;
  }, [categories, category.id]);

  const onPage = useMemo(
    () =>
      products
        .filter((p) => forms.has(String(p.categoryId ?? '')))
        .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''))),
    [products, forms],
  );

  const initialIds = useMemo(
    () => orderByIdList(onPage, category.productOrder).map((p) => p.id),
    [onPage, category.productOrder],
  );
  const [ids, setIds] = useState<string[]>(initialIds);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const byId = useMemo(() => new Map(onPage.map((p) => [p.id, p])), [onPage]);
  const changed = JSON.stringify(ids) !== JSON.stringify(initialIds);

  const write = async (productOrder: string[] | null) => {
    setSaving(true);
    setError(null);
    try {
      await updateDoc(doc(db, 'categories', category.id), {
        productOrder: productOrder ?? deleteField(),
      });
      await invalidateShopCache();
      onSaved(productOrder);
    } catch (err: any) {
      const raw = String(err?.message ?? err);
      setError(
        /no document to update|not-found/i.test(raw)
          ? 'This category was changed or deleted since this window opened. Reload the page and arrange again.'
          : /permission/i.test(raw)
            ? 'Only an admin can change the order.'
            : raw.slice(0, 300) || 'The order could not be saved.',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white w-full max-w-xl rounded-3xl shadow-2xl border border-gray-100 overflow-hidden"
      >
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-start gap-3 bg-gray-50">
          <div>
            <h3 className="text-base font-black text-gray-900">Arrange “{category.name}”</h3>
            <p className="text-[0.6875rem] font-bold text-gray-500 mt-0.5">
              {onPage.length} product{onPage.length === 1 ? '' : 's'} on this category page, sub-categories included.
              Drag a product by its grip; the shop shows them top to bottom in this order.
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 max-h-[62vh] overflow-y-auto">
          {onPage.length === 0 ? (
            <p className="text-xs font-bold text-gray-400 text-center py-6">This category has no products yet.</p>
          ) : (
            <SortableList
              ids={ids}
              onReorder={setIds}
              className="space-y-1.5"
              renderItem={(id, { handle, index }) => {
                const p = byId.get(id);
                if (!p) return null;
                const img = safeImageSrc(p.images?.[0]);
                return (
                  <div className="flex items-center gap-2.5 p-2 rounded-xl border border-gray-200 bg-white">
                    <DragHandle handle={handle} label={`Drag "${p.name}"`} />
                    <span className="w-7 text-[0.6875rem] font-black text-gray-400 tabular-nums">{index + 1}</span>
                    {img ? (
                      <img src={img} alt="" className="w-9 h-9 rounded-lg object-contain bg-gray-50 border border-gray-100 shrink-0" />
                    ) : (
                      <span className="w-9 h-9 rounded-lg bg-gray-100 shrink-0" />
                    )}
                    <span className="flex-1 min-w-0 text-xs font-black text-gray-800 truncate">{p.name}</span>
                    {p.isHidden && (
                      <span className="text-[0.5625rem] font-black uppercase bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-md shrink-0">
                        hidden
                      </span>
                    )}
                  </div>
                );
              }}
            />
          )}
        </div>

        {error && (
          <p role="alert" className="mx-6 mb-3 text-xs font-bold text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
            {error}
          </p>
        )}

        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => void write(null)}
            disabled={saving || !category.productOrder?.length}
            title="Forget this arrangement — the page goes back to A–Ö"
            className="px-3 py-2 text-[0.6875rem] font-black text-gray-500 hover:text-red-600 disabled:opacity-40"
          >
            Back to A–Ö
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-bold text-gray-600 hover:text-gray-900">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void write(ids)}
              disabled={saving || !changed}
              className="px-5 py-2 bg-blue-600 text-white text-xs font-black rounded-xl hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-2"
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Save the order
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
