import React, { useState, useEffect, useMemo } from 'react';
import { collection, getDocs, doc, setDoc, deleteDoc, updateDoc, query, where, writeBatch } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../App';
import { Category, LocalizedText } from '../../types';
import { 
  FolderPlus, 
  Layers, 
  Edit3, 
  Trash2, 
  Search, 
  Plus, 
  Check, 
  X, 
  Tag, 
  Image as ImageIcon, 
  Box, 
  Sparkles,
  Grid,
  ChevronRight,
  ArrowUpDown,
  Upload,
  Link
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, safeImageSrc } from '../../lib/utils';
import { invalidateShopCache } from '../../lib/invalidateShopCache';
import { MediaPickerModal } from './MediaLibrary';
import { buildCategoryTree, flattenTree, wouldCycle, categoryPickList, descendantIds } from '../../lib/categoryTree';
import { compressImageFile } from '../../lib/imageCompress';
import { uploadFile } from '../../lib/uploadFile';
import { ConfirmDialog, useConfirmDialog } from '../ConfirmDialog';
import { LocalizedTextFields } from './LocalizedTextFields';
import CategoryOrderModal from './CategoryOrderModal';
import { compareOwnerOrder } from '../../lib/ownerOrder';

export const INITIAL_CATEGORIES: Category[] = [
  {
    id: 'banners',
    name: 'Banners & Large Format',
    description: 'Outdoor vinyl banners, posters, mesh, and large-format architectural prints.',
    image: 'https://images.unsplash.com/photo-1563986768609-322da13575f3?auto=format&fit=crop&w=500&q=80'
  },
  {
    id: 'boxes',
    name: 'Packaging & Custom Boxes',
    description: 'Corrugated boxes, gift packaging, e-commerce mailers, and folding cartons.',
    image: 'https://images.unsplash.com/photo-1544816155-12df9643f363?auto=format&fit=crop&w=500&q=80'
  },
  {
    id: 'labels',
    name: 'Labels & Roll Stickers',
    description: 'Custom die-cut stickers, product roll labels, and foil stamped seals.',
    image: 'https://images.unsplash.com/photo-1572375992501-4b0892d50c69?auto=format&fit=crop&w=500&q=80'
  },
  {
    id: 'exhibition',
    name: 'Exhibition Stands & Displays',
    description: 'Rollup banners, pop-up backdrops, counter stands, and trade show displays.',
    image: '/placeholder-print.svg'
  },
  {
    id: 'cups',
    name: 'Paper Cups & Hospitality',
    description: 'Single and double-wall printed paper cups, food containers, and sleeves.',
    image: 'https://images.unsplash.com/photo-1517256064527-09c73fc73e38?auto=format&fit=crop&w=500&q=80'
  },
  {
    id: 'illuminated',
    name: 'Illuminated Signs & Neon',
    description: 'LED lightbox signs, 3D channel letters, and flexible neon signs.',
    image: 'https://images.unsplash.com/photo-1572949645841-094f3a9c4c94?auto=format&fit=crop&w=500&q=80'
  },
  {
    id: 'cards',
    name: 'Business Cards & Stationery',
    description: 'Premium business cards, letterheads, envelopes, folders, and notebooks.',
    image: 'https://images.unsplash.com/photo-1589829545856-d10d557cf95f?auto=format&fit=crop&w=500&q=80'
  },
  {
    id: 'textiles',
    name: 'Textiles & Soft Signage',
    description: 'Fabric banners, backlit textile, table covers, and custom canvas.',
    image: '/placeholder-print.svg'
  }
];

export default function CategoryAdmin() {
  const { t, user } = useAuth();
  // The order is written straight to Firestore, whose rules let only an ADMIN
  // write categories — staff reach this screen too, and would only meet a
  // permission error after dragging everything into place.
  const canArrange = user?.role === 'admin';
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  // The drag-to-arrange dialog — see CategoryOrderModal.
  const [arrangeOpen, setArrangeOpen] = useState(false);
  
  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [imageInputMode, setImageInputMode] = useState<'upload' | 'url'>('upload');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [formData, setFormData] = useState({
    id: '',
    name: '',
    description: '',
    image: '',
    parentId: '',
    showOnHome: true,
  });
  // The category's name and description in the shop's other three languages.
  // Products have had this since round 11; categories were the one piece of
  // owner-typed, customer-facing text that never got it, so a Swedish visitor
  // read a translated product title under an English category badge on the very
  // same card. Kept beside formData rather than inside it because the English
  // string is the canonical one — see Category.nameI18n in src/types.
  const [formNameI18n, setFormNameI18n] = useState<LocalizedText>({});
  const [formDescI18n, setFormDescI18n] = useState<LocalizedText>({});

  // Messages the owner must actually see. alert() is silenced by the same
  // browser switch that silenced confirm(), so nothing here uses it.
  const { notify, dialog: noticeDialog } = useConfirmDialog();

  // Shrink first, THEN judge the size — the same order every other upload in the
  // shop uses (ProductsAdmin, uploadOptionImage). This screen used to read the
  // raw file straight into base64 and reject anything over 700 KB, so a photo
  // off a phone was simply refused with no way forward; now it is resized to at
  // most 800x800 and almost always fits. compressImageFile also paints white
  // behind transparency, which is what stopped transparent PNGs turning into
  // black rectangles elsewhere.
  //
  // Note it preserves aspect ratio — it does not square the picture. That is
  // deliberate and is why the storefront uses object-contain: whatever shape the
  // owner uploads, the whole of it is shown.
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImageFile(file, 800, 800, 0.75);
      // TO STORAGE, the category keeps the address (2026-10-08): the free
      // database bills reads BY SIZE, and every category document is read with
      // the shop's copy and sent in /api/categories to every visitor.
      //
      // AND ONLY THERE, as for product pictures (code review ADM-11): the inline
      // fallback, even capped at 700 KB, put ~175 read units into every read of
      // the categories and that much into every visitor's download, unseen. A
      // refused upload is said, and the picture the category had stays.
      try {
        const [, b64 = ''] = compressed.split(',');
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const jpeg = new File([bytes], `category-${Date.now()}.jpg`, { type: 'image/jpeg' });
        const { url } = await uploadFile(jpeg, { visibility: 'public', folder: 'categories', contentType: 'image/jpeg' });
        setFormData(prev => ({ ...prev, image: url }));
      } catch (uploadErr) {
        console.warn('Category picture upload failed; not kept:', uploadErr);
        void notify({ title: t('caPictureUploadFailed'), tone: 'primary' });
      }
    } catch (err) {
      console.error('Failed to compress category image:', err);
      void notify({ title: t('caImageTooLarge'), tone: 'primary' });
    } finally {
      e.target.value = '';
    }
  };

  useEffect(() => {
    fetchCategories();
  }, []);

  const fetchCategories = async () => {
    setLoading(true);
    // Cleared on every attempt, or a successful retry would keep showing the
    // failure it just fixed.
    setLoadError(false);
    try {
      const snapshot = await getDocs(collection(db, 'categories'));
      const fetchedDocs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Category[];

      // Whatever is stored, exactly as stored.
      //
      // An empty collection used to be filled in with the eight built-in demo
      // categories AND written to Firestore. Deleting them therefore never stuck:
      // the owner cleared the list to add his own, reopened the screen, and all
      // eight came back. Emptying the catalogue was impossible.
      setCategories(fetchedDocs);
    } catch (err) {
      console.error('Error fetching categories:', err);
      setLoadError(true);
      setCategories([]);
    } finally {
      setLoading(false);
    }
  };

  const [autoSlug, setAutoSlug] = useState(true);
  const [saving, setSaving] = useState(false);

  const generateSlug = (text: string) => {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  };

  const handleNameChange = (newName: string) => {
    setFormData(prev => {
      const updated = { ...prev, name: newName };
      if (autoSlug || !prev.id) {
        updated.id = generateSlug(newName);
      }
      return updated;
    });
  };

  /**
   * @param presetParentId  Opens the ADD form with this category already chosen
   *   as the parent — what "+ Add sub-category" on a card does. It stays a
   *   CREATE: editingCategory is left null, so the duplicate-id guard, the
   *   hidden Delete button and the auto-slug all behave exactly as they do for
   *   any new category.
   */
  const handleOpenModal = (category?: Category, presetParentId?: string) => {
    if (category) {
      setEditingCategory(category);
      setAutoSlug(false);
      setFormData({
        id: category.id,
        name: category.name || '',
        description: category.description || '',
        image: category.image || '',
        parentId: category.parentId || '',
        showOnHome: category.hiddenOnHome !== true,
      });
      setFormNameI18n(category.nameI18n || {});
      setFormDescI18n(category.descriptionI18n || {});
    } else {
      setEditingCategory(null);
      setAutoSlug(true);
      setFormData({
        id: '',
        name: '',
        description: '',
        image: '/placeholder-print.svg',
        parentId: presetParentId ?? '',
        showOnHome: true,
      });
      setFormNameI18n({});
      setFormDescI18n({});
    }
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) return;
    // A save can now take several round trips — it may relocate hundreds of
    // products — so a second submit while one is in flight would run the whole
    // remap twice against a half-moved catalogue. Every button that could close
    // or re-enter this dialog is disabled below for the same reason, and the
    // overlay has no click-to-dismiss and no Escape handler, so once saving
    // starts this form is the only thing the owner can touch.
    if (saving) return;

    const categoryId = formData.id.trim() || generateSlug(formData.name) || `cat-${Date.now()}`;
    const newCategory: Category = {
      id: categoryId,
      name: formData.name.trim(),
      description: formData.description.trim(),
      image: formData.image.trim(),
      // Always assign, never omit — the same rule the SKU field follows in
      // ProductsAdmin and for the same reason: the write below is a MERGE, so
      // leaving the key out when the owner has cleared every translation KEEPS
      // the stored one. He would empty the Swedish box, save, see it empty, and
      // the old Swedish name would go on showing in the shop forever.
      nameI18n: Object.keys(formNameI18n).length > 0 ? formNameI18n : null,
      descriptionI18n: Object.keys(formDescI18n).length > 0 ? formDescI18n : null,
      // ALWAYS ASSIGNED, never omitted — the same rule the two i18n maps above
      // follow, and for the same reason. The write is a MERGE, so an omitted key
      // KEEPS what is on disk: choosing "Top level — not inside another" saved,
      // reported success, put the parent-less object into local state so the
      // card flipped, and changed nothing in Firestore. The category was still
      // nested in the shop and nothing in the dashboard could say why. An empty
      // string is a root everywhere — categoryTree.ts reads (parentId ?? '').trim().
      parentId: formData.parentId.trim(),
      // Always assigned, for the same merge reason as parentId above.
      hiddenOnHome: !formData.showOnHome,
    };

    // The slug box is free text. Firestore refuses an id containing a slash, an
    // id of "." or "..", and anything shaped __like_this__ — and it refuses it
    // by THROWING as doc() is called, not by rejecting a promise. One "/" typed
    // into that box used to take the save down mid-flight; checked here, before
    // a single write goes out.
    if (
      !/^[\p{L}\p{N}][\p{L}\p{N}._~-]*$/u.test(categoryId) ||
      categoryId === '.' ||
      categoryId === '..' ||
      /^__.*__$/.test(categoryId)
    ) {
      void notify({ title: t('caInvalidId').replace('{0}', categoryId), tone: 'primary' });
      return;
    }

    // Prevent silently overwriting an existing category when creating a new one whose
    // slug collides with an existing id.
    if (!editingCategory && categories.some(c => c.id === categoryId)) {
      void notify({ title: t('caDuplicateId').replace('{0}', categoryId), tone: 'primary' });
      return;
    }

    // A CYCLE IS REFUSED HERE, not only by the dropdown.
    //
    // The <option> list is filtered with wouldCycle, but it is built from a
    // snapshot fetched when the screen mounted. A second tab, another admin, or
    // the supplier Build button can nest something in between, and A inside B
    // inside A reaches the storefront as a category tree with no root — which
    // reads to the owner as "my categories disappeared". categoryTree survives
    // it by treating the knot as roots; that is a safety net, not a licence to
    // write one.
    if (editingCategory && formData.parentId.trim() && wouldCycle(categories, editingCategory.id, formData.parentId.trim())) {
      void notify({ title: t('caCycleRefused'), tone: 'primary' });
      return;
    }

    // ---- renaming: what it does to the products in this category ----------
    //
    // A product names its category in `categoryId`, and that field holds EITHER
    // the category's document id OR its name — both forms are in the live data,
    // which is why every lookup in the shop matches on both. So there are two
    // ways to cut a category loose from its products, and the dialog offered
    // both without a word of warning:
    //
    //   * changing the ID — the old document was deleted and a new one written,
    //     and nothing remapped the products. "Match the name" sits inches from
    //     the name box and rewrites the id from the name, so this was one click
    //     away at all times.
    //   * changing the NAME — products that reference the category by its old
    //     name stop matching it, with no document deleted and nothing to see.
    //
    // Either way the products vanished from the shop's category drawer, lost
    // their breadcrumb, and disappeared from the home tile, while still sitting
    // in the database looking perfectly healthy. The 635 imported products hang
    // off four ids.
    //
    // So: find whatever pointed at the OLD id or the OLD name, and point it at
    // the new id — the canonical form — before the old document goes anywhere.
    const idChanged = !!editingCategory && editingCategory.id !== categoryId;
    const nameChanged = !!editingCategory && (editingCategory.name || '') !== newCategory.name;

    // Changing an id onto one that is already taken would merge this category
    // into that one and then delete this one. The create path has always been
    // guarded against that; the edit path was not.
    if (idChanged && categories.some(c => c.id === categoryId && c.id !== editingCategory!.id)) {
      void notify({ title: t('caDuplicateId').replace('{0}', categoryId), tone: 'primary' });
      return;
    }

    setSaving(true);
    try {
      // ORDER MATTERS, and it is this: write the destination, move the products
      // into it, then remove the old document.
      //
      // Moving the products first — which is what this did when it was written
      // — puts every product in the category on an id that has no document yet.
      // If the write that follows then fails, they are pointing at nothing AND
      // they no longer answer to the old id or the old name, so the retry finds
      // none of them and no action in the dashboard can reunite them. Written
      // in this order, every intermediate state is coherent: a failed remap
      // leaves a duplicate category with its products still correctly attached
      // to the old one, and a failed delete leaves a stray document and nothing
      // worse.
      //
      // MERGE, not replace. This form owns the name, description, image and
      // parent — it does not know about isHidden, which is set outside it and
      // decides whether the category appears on the storefront at all. A plain
      // setDoc rebuilt the document from these four fields and silently
      // un-hid every hidden category the moment someone edited its name.
      //
      // On the id-changed path the destination is a NEW document, so there is
      // nothing to merge WITH and isHidden would be lost anyway — the old
      // document's own fields are carried across explicitly.
      await setDoc(
        doc(db, 'categories', categoryId),
        idChanged ? { ...editingCategory, ...newCategory } : newCategory,
        { merge: true },
      );

      let movedProducts = 0;
      if (editingCategory && (idChanged || nameChanged)) {
        const oldTerms = [...new Set([editingCategory.id, editingCategory.name].filter(Boolean) as string[])]
          .filter((term) => term !== categoryId);

        const affected = new Set<string>();
        for (const term of oldTerms) {
          const snap = await getDocs(query(collection(db, 'products'), where('categoryId', '==', term)));
          snap.docs.forEach((d) => affected.add(d.id));
        }

        if (affected.size > 0) {
          // Batched, so the catalogue cannot end up half-moved. Firestore caps a
          // batch at 500 writes and one category can hold more than that — the
          // supplier feed alone brings in 635 products.
          const ids = [...affected];
          for (let i = 0; i < ids.length; i += 400) {
            const batch = writeBatch(db);
            for (const productId of ids.slice(i, i + 400)) {
              batch.update(doc(db, 'products', productId), { categoryId });
            }
            await batch.commit();
          }
          movedProducts = ids.length;
        }
      }

      // THE CHILDREN COME WITH IT.
      //
      // The remap above moves PRODUCTS. Nothing moved the sub-categories, so
      // re-slugging a parent left every child pointing at a document that was
      // about to be deleted — and a dangling parent is not hidden, it is
      // PROMOTED: categoryTree treats it as a root, so the child appeared as a
      // top-level tile on the live shop, instantly, from one click, with
      // nothing to explain it. Same order discipline as the products: the new
      // document exists, the children are moved onto it, and only then is the
      // old one removed.
      let movedChildren = 0;
      if (idChanged) {
        const kids = categories.filter(
          (c) => (c.parentId ?? '').toString().trim() === editingCategory!.id && c.id !== categoryId,
        );
        for (let i = 0; i < kids.length; i += 400) {
          const batch = writeBatch(db);
          for (const kid of kids.slice(i, i + 400)) {
            batch.update(doc(db, 'categories', kid.id), { parentId: categoryId });
          }
          await batch.commit();
        }
        movedChildren = kids.length;
      }

      if (idChanged) {
        await deleteDoc(doc(db, 'categories', editingCategory!.id));
      }

      // The shop reads its categories from the server's cache now, and the
      // server never saw this write — it went straight to Firestore from here.
      void invalidateShopCache();

      if (editingCategory) {
        const oldId = editingCategory.id;
        setCategories(prev =>
          prev.map(c => {
            // MERGED onto what the list had, exactly as the write above merges
            // onto the document: the form only knows its own fields, and
            // replacing the whole entry dropped sortOrder (the category fell to
            // the end of its siblings on screen — and an "Arrange order" opened
            // next would have saved it there), productOrder and isHidden.
            if (c.id === oldId) return { ...c, ...newCategory };
            // Without this the moved children would still show the old parent
            // until the next reload — the screen would contradict the database
            // it had just written.
            if (movedChildren > 0 && (c.parentId ?? '').toString().trim() === oldId) {
              return { ...c, parentId: categoryId };
            }
            return c;
          }),
        );
      } else {
        setCategories(prev => [newCategory, ...prev]);
      }
      setIsModalOpen(false);

      // Say it out loud. Moving products is not something to do silently.
      if (movedProducts > 0) {
        void notify({
          title: t('caProductsRemapped').replace('{0}', String(movedProducts)),
          tone: 'primary',
        });
      }
    } catch (error) {
      // The modal used to close on failure exactly as it does on success, so the
      // category simply was not there afterwards and nobody knew why.
      console.error('Failed to save category:', error);
      void notify({ title: t('caSaveFailed'), tone: 'primary' });
    } finally {
      setSaving(false);
    }
  };

  // ---- deleting a category -----------------------------------------------
  //
  // The old flow asked with window.confirm and refused outright when the
  // category still held products. Both halves failed the owner: a browser that
  // has been told to stop prompting makes confirm() return false without a
  // word, so pressing Delete did nothing at all — and even when it did prompt,
  // eight of the ten categories were in use and could never be removed.
  //
  // Now the dialog is part of the page, and it offers the move that the refusal
  // used to demand be done by hand, one product at a time.
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null);
  const [usage, setUsage] = useState<{ state: 'loading' | 'ready' | 'error'; ids: string[] }>({
    state: 'loading',
    ids: [],
  });
  const [moveTargetId, setMoveTargetId] = useState('');
  /** Where the sub-categories go when their parent is deleted. '' = top level. */
  const [moveChildrenToId, setMoveChildrenToId] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const openDelete = async (category: Category) => {
    setDeleteTarget(category);
    setDeleteError(null);
    setMoveTargetId('');
    setMoveChildrenToId('');
    setUsage({ state: 'loading', ids: [] });

    try {
      // Products name their category by id OR by name — both forms are in the
      // live data — so both are asked for. Two equality queries rather than
      // reading the collection: every product document carries its artwork
      // inline, and pulling all of them down to count four is a lot of quota
      // for a number.
      const terms = [...new Set([category.id, category.name].filter(Boolean) as string[])];
      const found = new Set<string>();
      for (const term of terms) {
        const snap = await getDocs(query(collection(db, 'products'), where('categoryId', '==', term)));
        snap.docs.forEach((d) => found.add(d.id));
      }
      setUsage({ state: 'ready', ids: [...found] });
    } catch (error) {
      console.error('Failed to check which products use this category:', error);
      setUsage({ state: 'error', ids: [] });
    }
  };

  const closeDelete = () => {
    if (deleteBusy) return;
    setDeleteTarget(null);
    setDeleteError(null);
  };

  const confirmDelete = async () => {
    if (!deleteTarget || usage.state !== 'ready' || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      // The products move FIRST. If that half fails the category is still
      // standing and the owner can try again; the other order would strand
      // every product on a category that no longer exists.
      if (usage.ids.length > 0) {
        try {
          await Promise.all(
            usage.ids.map((productId) =>
              updateDoc(doc(db, 'products', productId), { categoryId: moveTargetId }),
            ),
          );
        } catch (error) {
          console.error('Failed to move products out of the category:', error);
          setDeleteError(t('caMoveFailed'));
          return;
        }
      }

      // THE SUB-CATEGORIES FIRST, for the same reason the products go first: a
      // child left pointing at a deleted parent is not hidden, it is promoted
      // to a top-level tile on the live shop. The owner chooses where they go —
      // top level is a choice here, not an accident.
      const kids = childrenByParent.get(deleteTarget.id) ?? [];
      if (kids.length > 0) {
        try {
          for (let i = 0; i < kids.length; i += 400) {
            const batch = writeBatch(db);
            for (const kid of kids.slice(i, i + 400)) {
              batch.update(doc(db, 'categories', kid.id), { parentId: moveChildrenToId });
            }
            await batch.commit();
          }
        } catch (error) {
          console.error('Failed to move the sub-categories out of the category:', error);
          setDeleteError(t('caMoveFailed'));
          return;
        }
      }

      await deleteDoc(doc(db, 'categories', deleteTarget.id));
      void invalidateShopCache();
      // Only leave the list after the delete actually succeeded.
      setCategories((prev) =>
        prev
          .filter((c) => c.id !== deleteTarget.id)
          .map((c) =>
            (c.parentId ?? '').toString().trim() === deleteTarget.id
              ? { ...c, parentId: moveChildrenToId }
              : c,
          ),
      );
      setDeleteTarget(null);
      setIsModalOpen(false);
    } catch (error) {
      console.error('Failed to delete category:', error);
      setDeleteError(t('caDeleteFailed'));
    } finally {
      setDeleteBusy(false);
    }
  };

  /**
   * In TREE ORDER — a child immediately after its parent — rather than in
   * whatever order Firestore returned them.
   *
   * The cards are a grid, so there is nowhere to indent to; the order plus the
   * "inside X" line on each child is what makes the shape visible. Sorting
   * happens before the search filter so that filtering never reshuffles what is
   * left into an order the owner did not choose.
   */
  /**
   * Who is inside whom — computed ONCE from the full list, never from the
   * filtered one.
   *
   * The search filter runs after the tree flatten, so deriving a child count
   * from it would tell the owner a parent has no sub-categories the moment he
   * typed in the search box. It is also why nothing here counts PRODUCTS: that
   * would be two unprojected equality queries per card per open, on a project
   * whose free daily read quota has died four times. Everything on a card comes
   * from the single read this screen already does.
   */
  const childrenByParent = useMemo(() => {
    const byId = new Set(categories.map((c) => c.id));
    const map = new Map<string, Category[]>();
    for (const c of categories) {
      const parent = (c.parentId ?? '').toString().trim();
      // A parent that no longer exists makes the category a root — the same
      // rule categoryTree.ts applies, so the card and the shop agree.
      if (!parent || parent === c.id || !byId.has(parent)) continue;
      const list = map.get(parent) ?? [];
      list.push(c);
      map.set(parent, list);
    }
    // The owner's order, as on the shop (src/lib/ownerOrder.ts).
    for (const list of map.values()) {
      list.sort((a, b) => compareOwnerOrder(a, b, (x, y) => String(x.name ?? '').localeCompare(String(y.name ?? ''))));
    }
    return map;
  }, [categories]);

  const orderedCategories = useMemo(
    () => flattenTree(buildCategoryTree(categories)).map((n) => n.category),
    [categories],
  );

  // String(... ?? '') because ONE category document with no name used to throw
  // here and take the whole screen down at the first keystroke in the search box.
  const filteredCategories = orderedCategories.filter(cat =>
    String(cat.name ?? '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    String(cat.description ?? '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-8" dir="ltr">
      
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
        <div>
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-orange-50 text-orange-600 flex items-center justify-center font-bold">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-black text-gray-900 tracking-tight">
                {t('caTitle')}
              </h2>
              <p className="text-xs font-medium text-gray-500 mt-0.5">
                {t('caSubtitle')}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Drag the categories into the order the shop shows them in. */}
          {canArrange && (
          <button
            type="button"
            onClick={() => setArrangeOpen(true)}
            disabled={categories.length < 2}
            className="px-4 py-3 bg-white border border-gray-200 hover:border-orange-400 text-gray-700 hover:text-orange-600 font-extrabold text-xs rounded-2xl transition-all flex items-center space-x-2 disabled:opacity-50"
          >
            <ArrowUpDown className="w-4 h-4" />
            <span>Arrange order</span>
          </button>
          )}
          <button
            onClick={() => handleOpenModal()}
            className="px-5 py-3 bg-orange-600 hover:bg-orange-500 text-white font-extrabold text-xs rounded-2xl shadow-lg shadow-orange-500/20 transition-all flex items-center space-x-2"
          >
            <Plus className="w-4 h-4" />
            <span>{t('caAddNew')}</span>
          </button>
        </div>
      </div>

      {arrangeOpen && (
        <CategoryOrderModal
          categories={categories}
          onClose={() => setArrangeOpen(false)}
          onSaved={() => {
            setArrangeOpen(false);
            void fetchCategories();
          }}
        />
      )}

      {/* Search & Filter Controls */}
      <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-2xs flex items-center space-x-4">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={t('caSearchPlaceholder')}
            className="w-full pl-10 pr-4 py-2.5 bg-gray-50 rounded-xl text-xs font-semibold border border-gray-200 focus:outline-hidden focus:border-orange-500 transition-colors"
          />
        </div>
        <div className="text-xs font-extrabold text-gray-400 px-2">
          {t('caCountLabel').replace('{0}', String(filteredCategories.length))}
        </div>
      </div>

      {/* Categories Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[1, 2, 3, 4].map(n => (
            <div key={n} className="bg-white rounded-3xl p-6 h-64 border border-gray-100 animate-pulse" />
          ))}
        </div>
      ) : loadError ? (
        /* A FAILED READ IS NOT AN EMPTY SHOP. `loadError` has been set since the
           screen was written and nothing ever rendered it, so a refused read —
           this project has run its free daily quota out four times — showed
           "No categories found. Create your first." Now that a card also shows
           what is nested inside it, that screen would read as the nesting having
           eaten the catalogue. */
        <div className="bg-white rounded-3xl p-12 text-center border border-red-100 space-y-4">
          <Box className="w-12 h-12 text-red-200 mx-auto" />
          <h3 className="text-base font-bold text-red-700">{t('caLoadFailed')}</h3>
          <button
            onClick={fetchCategories}
            className="px-4 py-2 bg-orange-600 text-white font-bold text-xs rounded-xl inline-flex items-center space-x-2"
          >
            <ArrowUpDown className="w-4 h-4" />
            <span>{t('caRetry')}</span>
          </button>
        </div>
      ) : filteredCategories.length === 0 ? (
        <div className="bg-white rounded-3xl p-12 text-center border border-gray-100 space-y-4">
          <Box className="w-12 h-12 text-gray-300 mx-auto" />
          <h3 className="text-base font-bold text-gray-700">
            {t('caEmptyTitle')}
          </h3>
          <p className="text-xs text-gray-400 max-w-sm mx-auto">
            {t('caEmptyBody')}
          </p>
          <button
            onClick={() => handleOpenModal()}
            className="px-4 py-2 bg-orange-600 text-white font-bold text-xs rounded-xl inline-flex items-center space-x-2"
          >
            <Plus className="w-4 h-4" />
            <span>{t('caEmptyCta')}</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {filteredCategories.map((category) => (
            <motion.div
              key={category.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="group bg-white rounded-3xl border border-gray-200/80 shadow-xs hover:shadow-xl hover:border-orange-200 transition-all overflow-hidden flex flex-col"
            >
              {/* Square + contain, matching the storefront exactly. This tile
                  used to be 16:9 and object-cover while the shop showed a
                  square object-contain, so the dashboard showed the owner a
                  third framing of his picture and none of them was the one his
                  customers saw. */}
              <div className="aspect-square bg-gray-50 relative overflow-hidden p-3">
                {safeImageSrc(category.image) ? (
                  <img
                    src={safeImageSrc(category.image) as string}
                    alt={category.name}
                    className="w-full h-full object-contain rounded-xl group-hover:scale-105 transition-transform duration-500"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-300">
                    <ImageIcon className="w-10 h-10" />
                  </div>
                )}
                
                <div className="absolute top-3 left-3 flex space-x-1.5">
                  <button
                    onClick={() => handleOpenModal(category)}
                    className="w-8 h-8 rounded-xl bg-white/90 backdrop-blur-md text-gray-700 hover:text-orange-600 shadow-md flex items-center justify-center transition-colors"
                    title={t('caEdit')}
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => openDelete(category)}
                    className="w-8 h-8 rounded-xl bg-white/90 backdrop-blur-md text-gray-700 hover:text-red-600 shadow-md flex items-center justify-center transition-colors"
                    title={t('caDelete')}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <div className="absolute bottom-2 right-2 bg-black/60 backdrop-blur-md text-white text-[0.5625rem] font-black uppercase tracking-wider px-2.5 py-1 rounded-md">
                  {t('caIdLabel')} {category.id}
                  {category.parentId && categories.some((c) => c.id === category.parentId) && (
                    <span className="block text-[0.625rem] font-bold text-orange-600 mt-0.5">
                      ↳ {t('caInside').replace('{0}', categories.find((c) => c.id === category.parentId)!.name)}
                    </span>
                  )}
                </div>
              </div>

              <div className="p-5 flex-1 flex flex-col justify-between space-y-3">
                <div>
                  <h3 className="text-base font-black text-gray-900 group-hover:text-orange-600 transition-colors">
                    {category.name}
                  </h3>
                  {category.description && (
                    <p className="text-xs font-medium text-gray-500 mt-1 line-clamp-2 leading-relaxed">
                      {category.description}
                    </p>
                  )}
                </div>

                {/* WHAT IS INSIDE THIS ONE, on the card, before any click.
                    Nesting has worked since round 13 and the only way to reach
                    it was to open the CHILD and pick a parent — so the owner
                    read it as a feature that does not exist. This is the
                    feature, where he is already looking.

                    FIXED HEIGHT on every card, three chips and then a count.
                    The grid stretches every row to its tallest card, so a
                    wrapping list under one parent with six children would blow
                    out a whole row of four. */}
                <div className="h-14 flex flex-col justify-end gap-1.5 overflow-hidden">
                  {/* TWO FIXED ROWS, not one. Sharing a row with the button left
                      each chip about thirty pixels — "ZZ E2E Child One" rendered
                      as the single letter "Z", which tells him nothing and looks
                      like a bug. The pair of rows is the same height on every
                      card, children or not, so the grid still cannot stretch. */}
                  {(childrenByParent.get(category.id)?.length ?? 0) > 0 && (
                    <div className="h-6 flex items-center gap-1.5 overflow-hidden">
                      {(childrenByParent.get(category.id) ?? []).slice(0, 3).map((child) => (
                        <button
                          key={child.id}
                          type="button"
                          onClick={() => handleOpenModal(child)}
                          title={String(child.name ?? child.id)}
                          className="flex-1 min-w-0 truncate px-2 py-1 rounded-lg bg-orange-50 text-orange-700 border border-orange-100 text-[0.625rem] font-black hover:border-orange-400 transition-colors"
                        >
                          {String(child.name ?? child.id)}
                        </button>
                      ))}
                      {(childrenByParent.get(category.id)?.length ?? 0) > 3 && (
                        <span className="text-[0.625rem] font-black text-gray-400 shrink-0">
                          +{(childrenByParent.get(category.id)?.length ?? 0) - 3}
                        </span>
                      )}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => handleOpenModal(undefined, category.id)}
                    className="h-6 w-full shrink-0 px-2 rounded-lg border border-dashed border-gray-300 text-gray-500 text-[0.625rem] font-black hover:border-orange-400 hover:text-orange-600 transition-colors inline-flex items-center justify-center gap-1"
                  >
                    <Plus className="w-3 h-3" />
                    {t('caAddChild')}
                  </button>
                </div>

                <div className="pt-3 border-t border-gray-100 flex items-center justify-between text-xs font-extrabold text-gray-400">
                  {/* THREE CASES, IN THIS ORDER. It printed "Main category" on
                      every card including the children — a live falsehood, and
                      half the reason the feature looked absent. */}
                  <span className="inline-flex items-center">
                    <Tag className="w-3.5 h-3.5 mr-1 text-orange-500" />
                    {(() => {
                      const kids = childrenByParent.get(category.id)?.length ?? 0;
                      if (kids > 0) {
                        return kids === 1 ? t('caSubCountOne') : t('caSubCount').replace('{0}', String(kids));
                      }
                      const parent = categories.find((c) => c.id === (category.parentId ?? '').toString().trim());
                      return parent ? t('caInside').replace('{0}', String(parent.name ?? parent.id)) : t('caMainCategory');
                    })()}
                  </span>
                  <span className="text-orange-600 hover:underline cursor-pointer flex items-center" onClick={() => handleOpenModal(category)}>
                    {t('caConfigure')} <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
                  </span>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Add/Edit Modal — the panel is capped and scrolls on its own: without it the
          form grew taller than a phone screen and Save/Delete/close sat off-screen
          with nothing to scroll. Same cap as the product and user modals. */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs overflow-y-auto">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 shadow-2xl border border-gray-100 relative space-y-6"
            >
              <div className="flex items-center justify-between border-b border-gray-100 pb-4">
                <div className="flex items-center space-x-2">
                  <div className="w-9 h-9 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center font-bold">
                    <Layers className="w-5 h-5" />
                  </div>
                  <h3 className="text-lg font-black text-gray-900">
                    {/* The title is what confirms the card button did something
                        different from "Add new category" — no new state needed. */}
                    {editingCategory
                      ? t('caEditTitle')
                      : (() => {
                          const parent = categories.find((c) => c.id === formData.parentId.trim());
                          return parent
                            ? t('caAddChildTitle').replace('{0}', String(parent.name ?? parent.id))
                            : t('caAddNew');
                        })()}
                  </h3>
                </div>
                <button
                  onClick={() => setIsModalOpen(false)}
                  disabled={saving}
                  className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSave} className="space-y-4">
                <div>
                  <label className="block text-xs font-extrabold text-gray-700 mb-1">
                    {t('caName')}
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => handleNameChange(e.target.value)}
                    placeholder={t('caNamePlaceholder')}
                    className="w-full px-4 py-2.5 bg-gray-50 rounded-xl text-xs font-bold border border-gray-200 focus:outline-hidden focus:border-orange-500 transition-colors"
                  />
                  {/* The name above is the canonical one and stays English-safe:
                      it is what products are joined on. These three are what the
                      customer reads. */}
                  <LocalizedTextFields
                    label={t('caNameTranslations')}
                    fallback={formData.name}
                    value={formNameI18n}
                    onChange={setFormNameI18n}
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-extrabold text-gray-700">
                      {t('caSlug')}
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        const newSlug = generateSlug(formData.name);
                        setFormData(prev => ({ ...prev, id: newSlug }));
                        setAutoSlug(true);
                      }}
                      className="text-[0.6875rem] font-bold text-orange-600 hover:text-orange-700 flex items-center space-x-1 space-x-reverse"
                    >
                      <Sparkles className="w-3 h-3" />
                      <span>{t('caSyncWithName')}</span>
                    </button>
                  </div>
                  <input
                    type="text"
                    value={formData.id}
                    onChange={(e) => {
                      setAutoSlug(false);
                      setFormData(prev => ({ ...prev, id: e.target.value }));
                    }}
                    placeholder={t('caSlugPlaceholder')}
                    className="w-full px-4 py-2.5 bg-gray-50 rounded-xl text-xs font-bold border border-gray-200 focus:outline-hidden focus:border-orange-500 transition-colors"
                  />
                  <p className="text-[0.625rem] text-gray-400 mt-1">
                    {t('caSlugNote')}
                  </p>
                </div>

                {/* THE PARENT. `parentId` has been stored on every category
                    since round 13 and there has never been a way to set it, so
                    the field existed and the feature did not.

                    The options exclude this category and everything beneath it.
                    Offering them and rejecting the save afterwards would be the
                    same information delivered later and more rudely — and the
                    result of getting it wrong is a set of categories reachable
                    from nowhere, with products that appear in no tree at all. */}
                <div>
                  <label className="block text-xs font-extrabold text-gray-700 mb-1.5">
                    {t('caParentLabel')}
                  </label>
                  <select
                    value={formData.parentId}
                    onChange={(e) => setFormData(prev => ({ ...prev, parentId: e.target.value }))}
                    className="w-full px-4 py-2.5 bg-gray-50 rounded-xl text-xs font-bold border border-gray-200 focus:outline-hidden focus:border-orange-500 transition-colors"
                  >
                    <option value="">{t('caParentNone')}</option>
                    {/* The same list, and the same indent, as every other place
                        that offers a category — one definition, in categoryTree. */}
                    {categoryPickList(categories)
                      .filter(({ category: c }) => {
                        const selfId = (formData.id || '').trim();
                        if (!selfId) return true;             // a new category cannot be its own ancestor
                        if (c.id === selfId) return false;
                        return !wouldCycle(categories, selfId, c.id);
                      })
                      .map(({ category: c, indent }) => (
                        <option key={c.id} value={c.id}>
                          {indent}{c.name}
                        </option>
                      ))}
                  </select>
                  <p className="text-[0.625rem] text-gray-400 mt-1">
                    {t('caParentNote')}
                  </p>
                </div>

                {/* The home page grid shows main categories; this takes one out of
                    it without hiding it from the shop (2026-10-14). */}
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.showOnHome}
                    onChange={(e) => setFormData(prev => ({ ...prev, showOnHome: e.target.checked }))}
                    className="mt-0.5 w-4 h-4 accent-orange-600"
                    data-rx-category-show-on-home
                  />
                  <span>
                    <span className="block text-xs font-extrabold text-gray-700">{t('caShowOnHome')}</span>
                    <span className="block text-[0.625rem] text-gray-400 mt-0.5">{t('caShowOnHomeNote')}</span>
                  </span>
                </label>

                {/* "Who am I inside" now has "what is inside me" next to it.
                    Read-only on purpose: one relationship, one write path. The
                    rows open the child, which is where it is edited. */}
                {editingCategory && (childrenByParent.get(editingCategory.id)?.length ?? 0) > 0 && (
                  <div>
                    <label className="block text-xs font-extrabold text-gray-700 mb-1.5">
                      {t('caSubList')}
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {(childrenByParent.get(editingCategory.id) ?? []).map((child) => (
                        <button
                          key={child.id}
                          type="button"
                          onClick={() => handleOpenModal(child)}
                          disabled={saving}
                          className="px-2.5 py-1 rounded-lg bg-orange-50 text-orange-700 border border-orange-100 text-[0.6875rem] font-black hover:border-orange-400 transition-colors disabled:opacity-50"
                        >
                          {String(child.name ?? child.id)}
                        </button>
                      ))}
                    </div>
                    {/* Said at the moment he is about to trigger it, not after. */}
                    {formData.id.trim() !== editingCategory.id && (
                      <p className="mt-1.5 text-[0.625rem] font-bold text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1">
                        {t('caSubMovesWithId')}
                      </p>
                    )}
                  </div>
                )}

                <div>
                  <label className="block text-xs font-extrabold text-gray-700 mb-1.5 flex items-center justify-between">
                    <span>{t('caCoverImage')}</span>
                    <span className="text-[0.625rem] text-gray-400 font-normal">{t('caUploadOrUrl')}</span>
                  </label>

                  {/* Mode Switcher */}
                  <div className="flex rounded-xl bg-gray-100 p-1 mb-3">
                    <button
                      type="button"
                      onClick={() => setImageInputMode('upload')}
                      className={cn(
                        "flex-1 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center justify-center space-x-1.5 space-x-reverse",
                        imageInputMode === 'upload' ? "bg-white text-orange-600 shadow-xs" : "text-gray-500 hover:text-gray-900"
                      )}
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>{t('caUploadFile')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setImageInputMode('url')}
                      className={cn(
                        "flex-1 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center justify-center space-x-1.5 space-x-reverse",
                        imageInputMode === 'url' ? "bg-white text-orange-600 shadow-xs" : "text-gray-500 hover:text-gray-900"
                      )}
                    >
                      <Link className="w-3.5 h-3.5" />
                      <span>{t('caImageUrl')}</span>
                    </button>
                  </div>

                  {/* Input Area */}
                  {imageInputMode === 'upload' ? (
                    <div className="space-y-2">
                      <label 
                        htmlFor="category-image-upload"
                        className="border-2 border-dashed border-gray-200 hover:border-orange-400 bg-gray-50/80 hover:bg-orange-50/20 transition-all rounded-2xl p-4 flex flex-col items-center justify-center cursor-pointer group text-center"
                      >
                        <Upload className="w-6 h-6 text-gray-400 group-hover:text-orange-600 mb-1 transition-colors" />
                        <span className="text-xs font-bold text-gray-700 group-hover:text-orange-600">
                          {t('caClickToUpload')}
                        </span>
                        <span className="text-[0.625rem] text-gray-400 mt-0.5">
                          {t('caFormatsNote')}
                        </span>
                        <input
                          id="category-image-upload"
                          type="file"
                          accept="image/*"
                          onChange={handleFileUpload}
                          className="hidden"
                        />
                      </label>
                    </div>
                  ) : (
                    <div className="relative">
                      <input
                        type="url"
                        value={formData.image}
                        onChange={(e) => setFormData(prev => ({ ...prev, image: e.target.value }))}
                        placeholder={t('caImageUrlPlaceholder')}
                        className="w-full px-4 py-2.5 bg-gray-50 rounded-xl text-xs font-bold border border-gray-200 focus:outline-hidden focus:border-orange-500 transition-colors pl-9"
                      />
                      <Link className="w-4 h-4 text-gray-400 absolute left-3 top-3" />
                    </div>
                  )}

                  {/* The third way: a picture already in the library.
                      Upload and paste-a-URL both existed; neither let him reuse
                      something he had already put somewhere else, so the same
                      logo was uploaded once per category. */}
                  <button
                    type="button"
                    onClick={() => setPickerOpen(true)}
                    className="mt-2 w-full px-4 py-2.5 bg-gray-100 text-gray-800 text-xs font-black rounded-xl hover:bg-gray-200 transition-colors inline-flex items-center justify-center gap-2"
                  >
                    <ImageIcon className="w-4 h-4" />
                    {t('mlChoose')}
                  </button>

                  {/* Image Preview Box if image exists */}
                  {safeImageSrc(formData.image) && (
                    <div className="mt-3 p-2 bg-gray-50 rounded-2xl border border-gray-200 flex items-center space-x-3 space-x-reverse">
                      <img
                        src={safeImageSrc(formData.image) as string}
                        alt={t('caCurrentPreview')}
                        // contain, not cover: a 56px centre-crop hid the fact
                        // that a portrait photo was about to be cut in half.
                        className="w-14 h-14 object-contain rounded-xl border border-gray-200 bg-white p-0.5"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = '/placeholder-print.svg';
                        }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-gray-800 truncate">
                          {t('caCurrentPreview')}
                        </p>
                        <p className="text-[0.625rem] text-gray-400 truncate dir-ltr">
                          {formData.image.startsWith('data:') ? t('caUploadedImage') : formData.image}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setFormData(prev => ({ ...prev, image: '' }))}
                        className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors text-xs font-bold"
                        title={t('caRemoveImage')}
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-gray-700 mb-1">
                    {t('caDescription')}
                  </label>
                  <textarea
                    rows={3}
                    value={formData.description}
                    onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                    placeholder={t('caDescriptionPlaceholder')}
                    className="w-full px-4 py-2.5 bg-gray-50 rounded-xl text-xs font-semibold border border-gray-200 focus:outline-hidden focus:border-orange-500 transition-colors"
                  />
                  <LocalizedTextFields
                    label={t('caDescriptionTranslations')}
                    fallback={formData.description}
                    value={formDescI18n}
                    onChange={setFormDescI18n}
                    multiline
                  />
                </div>

                <div className="pt-4 flex items-center justify-between border-t border-gray-100 mt-6">
                  {editingCategory ? (
                    <button
                      type="button"
                      onClick={() => openDelete(editingCategory)}
                      className="px-4 py-2.5 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 text-xs font-bold transition-colors flex items-center space-x-1.5 space-x-reverse"
                    >
                      <Trash2 className="w-4 h-4" />
                      <span>{t('caDeleteTitle')}</span>
                    </button>
                  ) : <div />}

                  <div className="flex items-center space-x-3">
                    <button
                      type="button"
                      onClick={() => setIsModalOpen(false)}
                      disabled={saving}
                      className="px-5 py-2.5 rounded-xl border border-gray-200 text-xs font-bold text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {t('caCancel')}
                    </button>
                    <button
                      type="submit"
                      disabled={saving}
                      className="px-6 py-2.5 rounded-xl bg-orange-600 hover:bg-orange-500 text-white text-xs font-black shadow-md shadow-orange-500/20 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {saving ? t('caSaving') : t('caSave')}
                    </button>
                  </div>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={!!deleteTarget}
        title={t('caDeleteTitle')}
        message={
          usage.state === 'loading'
            ? t('caUsageChecking')
            : usage.state === 'error'
              ? t('caUsageCheckFailed')
              : usage.ids.length > 0
                ? t('caDeleteInUse').replace('{0}', String(usage.ids.length))
                : `${t('caConfirmDelete').replace('{0}', deleteTarget?.name ? ` "${deleteTarget.name}"` : '')} ${t('caDeleteCannotUndo')}`
        }
        confirmLabel={usage.ids.length > 0 ? t('caMoveAndDelete') : t('caDeleteTitle')}
        busy={deleteBusy}
        busyLabel={t('caDeleteBusy')}
        confirmDisabled={usage.state !== 'ready'}
        onConfirm={confirmDelete}
        onCancel={closeDelete}
      >
        {/* The children, said out loud and given a destination. The count is
            free — it comes from the list already in state, not from a query. */}
        {!!deleteTarget && (childrenByParent.get(deleteTarget.id)?.length ?? 0) > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-bold text-amber-800 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
              {t('caDeleteHasChildren').replace(
                '{0}',
                String(childrenByParent.get(deleteTarget.id)?.length ?? 0),
              )}
            </p>
            <label className="block text-xs font-extrabold text-gray-700 mb-1.5">{t('caMoveChildrenTo')}</label>
            <select
              value={moveChildrenToId}
              onChange={(e) => setMoveChildrenToId(e.target.value)}
              className="w-full px-4 py-2.5 bg-gray-50 rounded-xl text-xs font-bold border border-gray-200 focus:outline-hidden focus:border-orange-500 transition-colors"
            >
              <option value="">{t('caChildrenToTop')}</option>
              {/* Never into the category being deleted, and never into one of
                  its own descendants — that would be a knot with no root. */}
              {categoryPickList(
                categories.filter(
                  (c) => c.id !== deleteTarget.id && !descendantIds(categories, deleteTarget.id).includes(c.id),
                ),
              ).map(({ category: c, indent }) => (
                <option key={c.id} value={c.id}>{indent}{String(c.name ?? c.id)}</option>
              ))}
            </select>
          </div>
        )}
        {usage.state === 'ready' && usage.ids.length > 0 && (
          <div>
            <label className="block text-xs font-extrabold text-gray-700 mb-1.5">{t('caMoveTo')}</label>
            <select
              value={moveTargetId}
              onChange={(e) => setMoveTargetId(e.target.value)}
              className="w-full px-4 py-2.5 bg-gray-50 rounded-xl text-xs font-bold border border-gray-200 focus:outline-hidden focus:border-orange-500 transition-colors"
            >
              <option value="">{t('caLeaveUncategorised')}</option>
              {categoryPickList(categories.filter((c) => c.id !== deleteTarget?.id)).map(
                ({ category: c, indent }) => (
                  <option key={c.id} value={c.id}>
                    {indent}{String(c.name ?? c.id)}
                  </option>
                ),
              )}
            </select>
          </div>
        )}
        {deleteError && (
          <p className="text-xs font-bold text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
            {deleteError}
          </p>
        )}
      </ConfirmDialog>

      {noticeDialog}

      {/* Picking a picture only fills the field — nothing is saved until he
          presses Save, the same as typing a URL by hand. */}
      <MediaPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(url) => setFormData((prev) => ({ ...prev, image: url }))}
      />

    </div>
  );
}
