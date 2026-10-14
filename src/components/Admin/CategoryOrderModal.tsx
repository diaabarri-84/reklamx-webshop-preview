import React, { useMemo, useState } from 'react';
import { doc, writeBatch } from 'firebase/firestore';
import { motion } from 'motion/react';
import { CornerDownRight, Loader2, X } from 'lucide-react';
import { db } from '../../firebase';
import type { Category } from '../../types';
import { buildCategoryTree, type CategoryNode } from '../../lib/categoryTree';
import { sortOrdersFor } from '../../lib/ownerOrder';
import { invalidateShopCache } from '../../lib/invalidateShopCache';
import SortableList, { DragHandle } from './SortableList';

/**
 * ARRANGE THE CATEGORIES — drag them into the order the shop shows them in.
 *
 * Every level of the tree is its own list: the main categories among
 * themselves, and each one's sub-categories among themselves. A category is
 * never dragged into a different parent here — that is what "Parent category"
 * in the category form is for, and it carries its own cycle check.
 *
 * Nothing is written while dragging. Save writes `sortOrder` only on the
 * categories whose number actually changes (src/lib/ownerOrder.ts), in one
 * batch, then tells the server to drop its cached copy so the shop shows the new
 * order straight away.
 */
const ROOT = '';

export default function CategoryOrderModal({
  categories,
  onClose,
  onSaved,
}: {
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const tree = useMemo(() => buildCategoryTree(categories), [categories]);

  /** parent id ('' for the top level) → the ids of its children, in order. */
  const initial = useMemo(() => {
    const out: Record<string, string[]> = {};
    const walk = (parent: string, nodes: CategoryNode<Category>[]) => {
      out[parent] = nodes.map((n) => n.category.id);
      for (const n of nodes) if (n.children.length) walk(n.category.id, n.children);
    };
    walk(ROOT, tree);
    return out;
  }, [tree]);

  const [order, setOrder] = useState<Record<string, string[]>>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const changedGroups = Object.keys(order).filter(
    (parent) => JSON.stringify(order[parent]) !== JSON.stringify(initial[parent]),
  );

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const batch = writeBatch(db);
      let writes = 0;
      for (const parent of changedGroups) {
        const numbers = sortOrdersFor(order[parent]);
        for (const [id, sortOrder] of Object.entries(numbers)) {
          if (byId.get(id)?.sortOrder === sortOrder) continue;
          batch.update(doc(db, 'categories', id), { sortOrder });
          writes += 1;
        }
      }
      if (writes > 0) await batch.commit();
      await invalidateShopCache();
      onSaved();
    } catch (err: any) {
      // One batch: either every number is written or none is. The usual cause
      // is a category deleted or renamed in another tab since this opened.
      const raw = String(err?.message ?? err);
      setError(
        /no document to update|not-found/i.test(raw)
          ? 'A category was changed or deleted since this window opened. Nothing was saved — close it, reload the page and arrange again.'
          : /permission/i.test(raw)
            ? 'Only an admin can change the order.'
            : raw.slice(0, 300) || 'The order could not be saved.',
      );
    } finally {
      setSaving(false);
    }
  };

  const renderLevel = (parent: string, depth: number): React.ReactNode => {
    const ids = order[parent] ?? [];
    if (ids.length === 0) return null;
    return (
      <SortableList
        ids={ids}
        onReorder={(next) => setOrder((prev) => ({ ...prev, [parent]: next }))}
        className={depth === 0 ? 'space-y-2' : 'space-y-1.5 mt-1.5'}
        renderItem={(id, { handle, index }) => {
          const cat = byId.get(id);
          if (!cat) return null;
          const hasChildren = (order[id] ?? []).length > 0;
          return (
            <div className={depth === 0 ? 'rounded-2xl border border-gray-200 bg-white p-2.5' : ''}>
              <div className="flex items-center gap-2">
                {depth > 0 && <CornerDownRight className="w-3.5 h-3.5 text-gray-300 shrink-0" />}
                <DragHandle handle={handle} label={`Drag "${cat.name}"`} />
                <span className="w-6 text-[0.6875rem] font-black text-gray-400 tabular-nums">{index + 1}</span>
                <span className={depth === 0 ? 'text-xs font-black text-gray-900' : 'text-xs font-bold text-gray-700'}>
                  {cat.name || cat.id}
                </span>
                {cat.isHidden && (
                  <span className="text-[0.5625rem] font-black uppercase bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-md">
                    hidden
                  </span>
                )}
              </div>
              {hasChildren && <div className="pl-8">{renderLevel(id, depth + 1)}</div>}
            </div>
          );
        }}
      />
    );
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
            <h3 className="text-base font-black text-gray-900">Arrange the categories</h3>
            <p className="text-[0.6875rem] font-bold text-gray-500 mt-0.5">
              Drag a category by its grip. Main categories move among themselves, sub-categories within
              their own parent. The shop shows this order after you save.
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 max-h-[65vh] overflow-y-auto">{renderLevel(ROOT, 0)}</div>

        {error && (
          <p role="alert" className="mx-6 mb-3 text-xs font-bold text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
            {error}
          </p>
        )}

        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-bold text-gray-600 hover:text-gray-900">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || changedGroups.length === 0}
            className="px-5 py-2 bg-orange-600 text-white text-xs font-black rounded-xl hover:bg-orange-500 disabled:opacity-50 inline-flex items-center gap-2"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Save the order
          </button>
        </div>
      </motion.div>
    </div>
  );
}
