import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { Copy, Eye, EyeOff, LayoutTemplate, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import { auth, db } from '../../firebase';
import { useAuth } from '../../App';
import { useSiteSettings, type SiteSettings } from '../../context/SiteSettingsContext';
import { cn } from '../../lib/utils';
import { withoutUndefined } from '../../lib/withoutUndefined';
import { OUTLINE_KINDS, OUTLINE_NAMES, diameterMm, needsSquareBox, type OutlineKind } from '../../lib/shapes';
import { designExportSize } from '../../lib/designSize';
import { cleanScope, templateMiss, type TemplateScope } from '../../lib/designTemplateMatch';
import { TEMPLATE_JSON_MAX } from '../../lib/designTemplateDoc';
import { parseDimensionsMm } from '../../lib/printSize';
import { categoryPickList } from '../../lib/categoryTree';
import { deleteUploadedFile, uploadFile } from '../../lib/uploadFile';
import { inOwnerOrder } from '../../lib/templateOrder';
import type { LocalizedText, PrintingField } from '../../types';
import { LocalizedTextFields } from './LocalizedTextFields';
import SortableList, { DragHandle } from './SortableList';
import DesignerSettingsPanel from './DesignerSettingsPanel';
import { STARTER_TEMPLATES, type StarterDef } from '../../lib/starterTemplates';
import { OPTION_LIBRARY_DOC } from './PrintingFieldsAdmin';
import { fetchPictures } from '../product/designer/templatesApi';
import type { DesignDraft, TemplateDesign } from '../product/designer/types';

const OnlineDesigner = React.lazy(() => import('../product/designer/OnlineDesigner'));
// The shop's own designs drawn small (brings fabric with it: loaded only here, when shown).
const StarterThumb = React.lazy(() => import('../product/designer/studio/StarterThumb'));

/**
 * DESIGN TEMPLATES — round 16, item 5b: "the owner adds design templates from
 * the dashboard, and the customer edits them".
 *
 * The owner makes a template in the SAME designer the customers use (owner
 * mode): a size and a cut, his layout, and for each element what a customer may
 * do with it (change it, only its words, nothing). The shop then offers it, before
 * the basic layouts, on every product where it fits (src/lib/designTemplateMatch.ts):
 * the same cut, the same proportions within 2 %, from 0.85× to 2× its size. The
 * screen tells him where that is ("Shows on"), and an admin looking at a product
 * page sees which templates were left out there, and why.
 *
 * Writes go to Firestore from here (admin only, firestore.rules); customers get
 * the templates from the server's copy, which this screen refreshes after every
 * change. Pictures go to Storage BEFORE the document is written, so a template is
 * never saved pointing at a picture that is not there.
 */

interface StoredPicture {
  url: string;
  path: string;
}

interface TemplateDoc {
  id: string;
  name: string;
  nameI18n?: LocalizedText | null;
  trimMm: { wMm: number; hMm: number };
  outline: OutlineKind | null;
  json?: string;
  images?: Record<string, StoredPicture>;
  thumbnailUrl?: string;
  thumbnailPath?: string;
  scope: TemplateScope;
  hidden: boolean;
  sortOrder: number;
  lockBackground?: boolean;
  lowestPictureDpi?: number | null;
  createdAt?: string;
  updatedAt?: string;
  /**
   * When the DESIGN was last saved — not the name, the scope or "hidden". The
   * designer keeps unsaved work on the device only while it is newer than this;
   * measured against updatedAt, renaming the template threw that work away.
   */
  designSavedAt?: string;
}

interface Form {
  id: string;
  isNew: boolean;
  name: string;
  nameI18n: LocalizedText;
  wMm: string;
  hMm: string;
  outline: OutlineKind | null;
  scope: TemplateScope;
  hidden: boolean;
  lockBackground: boolean;
  /** Where it was offered, and whether hidden, when this form was filled: what "changed here" is measured from. */
  loaded: { scope: TemplateScope; hidden: boolean };
}

/** This form changed where it is offered, or whether it is hidden, from what it was filled with. */
const scopeChanged = (f: Form) => JSON.stringify(cleanScope(f.scope)) !== JSON.stringify(cleanScope(f.loaded.scope));
const hiddenChanged = (f: Form) => f.hidden !== f.loaded.hidden;

interface CategoryRow {
  id: string;
  name: string;
  parentId?: string | null;
  sortOrder?: number;
}

interface ProductRow {
  id: string;
  name: string;
  categoryId?: string;
}

const CUT_CHOICES: Array<OutlineKind | null> = [null, ...OUTLINE_KINDS.filter((k) => k !== 'rect' && k !== 'custom')];
const cutName = (k: OutlineKind | null) => (k ? OUTLINE_NAMES[k] : 'Rectangle (plain)');
// To the hundredth: an 85.6 × 53.98 card must come back as itself, or "Save
// settings" takes the rounding for a change of size.
const mmText = (n: number) => String(Math.round(n * 100) / 100);
const mmOf = (text: string) => Number(String(text ?? '').replace(',', '.'));

/** Every path a template's files live at. */
const pathsOf = (t: TemplateDoc | undefined): string[] =>
  t ? [...Object.values(t.images ?? {}).map((p) => p.path), t.thumbnailPath].filter((p): p is string => !!p) : [];

/**
 * Tell the shop its copy is out of date — three tries. False when it could not
 * be told: customers then see the version before the change for up to twelve
 * hours, so the files that version uses must NOT be deleted yet.
 */
async function refreshShopCopy(): Promise<boolean> {
  for (const wait of [0, 1500, 4000]) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    // Ten seconds a try: this host has kept a request waiting for fifty.
    const ctl = new AbortController();
    const timer = window.setTimeout(() => ctl.abort(), 10_000);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return false;
      const res = await fetch('/api/admin/design-templates/invalidate', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        signal: ctl.signal,
      });
      if (res.ok) return true;
    } catch {
      /* the next try */
    } finally {
      window.clearTimeout(timer);
    }
  }
  return false;
}

/** Every size in the property library, as "W × H mm" — what "Shows on" is measured against. */
function librarySizes(fields: PrintingField[]): Array<{ label: string; wMm: number; hMm: number }> {
  const out = new Map<string, { label: string; wMm: number; hMm: number }>();
  const walk = (list: PrintingField[] | undefined, depth: number) => {
    for (const field of list ?? []) {
      for (const option of field.options ?? []) {
        const dims = parseDimensionsMm(option);
        const d = diameterMm(option);
        const size = dims ?? (d ? { wMm: d, hMm: d } : null);
        if (size) {
          const key = `${mmText(size.wMm)} × ${mmText(size.hMm)} mm`;
          if (!out.has(key)) out.set(key, { label: key, ...size });
        }
        if (depth < 4) walk(option.subFields, depth + 1);
      }
    }
  };
  walk(fields, 0);
  return [...out.values()];
}

export default function DesignTemplatesAdmin() {
  const { t, language } = useAuth();
  const { settings, updateSettings } = useSiteSettings();
  const [templates, setTemplates] = useState<TemplateDoc[]>([]);
  const [loading, setLoading] = useState(true);
  // His templates could not be read: the list then holds only the shop's own, and a
  // drag would save an order without his — every one of them "new" and on top.
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  // The library's sizes: undefined while they load, null when they could not be read.
  const [sizes, setSizes] = useState<Array<{ label: string; wMm: number; hMm: number }> | null | undefined>(undefined);
  const [form, setForm] = useState<Form | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [productSearch, setProductSearch] = useState('');
  const [designerOpen, setDesignerOpen] = useState(false);
  const [designDraft, setDesignDraft] = useState<DesignDraft | null>(null);
  // The shop could not be told about a change: say so, and keep the files the
  // version it still shows uses until it can.
  const [shopBehind, setShopBehind] = useState(false);
  const pendingFilesRef = useRef<string[]>([]);
  // Each "Open the designer" gets a ticket; closing the form voids it, so a slow
  // picture download cannot open the designer on whatever is edited next.
  const openTicketRef = useRef(0);
  // A design saved in another window since this one read it: the second press of
  // "Save template" replaces that version — the first only says so.
  const overwriteRef = useRef<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    setLoadFailed(false);
    try {
      const snap = await getDocs(collection(db, 'designTemplates'));
      const rows = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<TemplateDoc, 'id'>) }))
        .map((x) => ({ ...x, scope: cleanScope(x.scope), hidden: x.hidden === true, sortOrder: Number(x.sortOrder) || 0 }))
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
      setTemplates(rows);
    } catch (err: any) {
      setError(`The templates could not be loaded: ${err?.message ?? err}`);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // Categories and products from the shop's own copy: no Firestore reads.
    void fetch('/api/categories')
      .then((r) => r.json())
      .then((b) => setCategories(Array.isArray(b?.categories) ? b.categories : []))
      .catch(() => {});
    void (async () => {
      const all: ProductRow[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 30; page += 1) {
        const q = new URLSearchParams({ limit: '200', ...(cursor ? { cursor } : {}) });
        const body = await fetch(`/api/catalogue?${q}`).then((r) => r.json()).catch(() => null);
        for (const p of body?.products ?? []) all.push({ id: String(p.id), name: String(p.name ?? p.id), categoryId: p.categoryId });
        cursor = body?.nextCursor ?? null;
        if (!cursor) break;
      }
      setProducts(all);
    })();
    // One read: the sizes "Shows on" is measured against.
    void getDoc(doc(db, 'settings', OPTION_LIBRARY_DOC))
      .then((s) => setSizes(librarySizes((s.data()?.fields ?? []) as PrintingField[])))
      .catch(() => setSizes(null));
  }, []);

  // A complaint about the form is about the form as it WAS: any change answers it.
  useEffect(() => setFormError(null), [form]);

  const editing = form ? templates.find((x) => x.id === form.id) : undefined;
  const wMm = mmOf(form?.wMm ?? '');
  const hMm = mmOf(form?.hMm ?? '');
  const square = !!form?.outline && needsSquareBox(form.outline);
  const sizeProblem = !form
    ? null
    : !(wMm > 0 && hMm > 0)
      ? 'Enter the width and height in millimetres.'
      : designExportSize({ wMm, hMm }).kind === 'too-large'
        ? 'Too large for the online designer: it stops a little under A1 (594 × 841 mm). Choose a smaller size.'
        : square && Math.abs(wMm - hMm) > 0.01
          ? `A ${cutName(form.outline)} is cut in a square: make the width and height the same.`
          : null;
  // How sharp its pictures print at the size in the form — the saved figure is
  // for the size it was saved at, and the designer refits it to the new one.
  const pictureDpi = editing?.lowestPictureDpi && wMm > 0 && hMm > 0
    ? editing.lowestPictureDpi / Math.min(wMm / editing.trimMm.wMm, hMm / editing.trimMm.hMm)
    : null;
  // Where it will show: the library's sizes it fits (same cut assumed — the cut
  // is the product's choice), and whether its pictures are what keeps it off some.
  const showsOn = useMemo(() => {
    if (!form || sizeProblem || !sizes) return null;
    const template = { trimMm: { wMm, hMm }, outline: form.outline, lowestPictureDpi: pictureDpi };
    const misses = sizes.map((s) => ({ s, why: templateMiss(template, s, form.outline) }));
    return { fits: misses.filter((m) => m.why === null).map((m) => m.s.label), pictures: misses.some((m) => m.why === 'pictures') };
  }, [form, sizeProblem, wMm, hMm, sizes, pictureDpi]);

  const closeForm = () => {
    openTicketRef.current += 1;
    setBusy((b) => (b === 'open' ? null : b));
    setDesignerOpen(false);
    setDesignDraft(null);
    setForm(null);
  };

  const startNew = () => {
    setFormError(null);
    setForm({
      id: doc(collection(db, 'designTemplates')).id,
      isNew: true,
      name: '',
      nameI18n: {},
      wMm: '85',
      hMm: '55',
      outline: null,
      scope: { kind: 'all' },
      hidden: false,
      lockBackground: false,
      loaded: { scope: { kind: 'all' }, hidden: false },
    });
  };

  const startEdit = (x: TemplateDoc) => {
    setFormError(null);
    setForm({
      id: x.id,
      isNew: false,
      name: x.name,
      nameI18n: (x.nameI18n ?? {}) as LocalizedText,
      wMm: mmText(x.trimMm.wMm),
      hMm: mmText(x.trimMm.hMm),
      outline: x.outline ?? null,
      scope: cleanScope(x.scope),
      hidden: x.hidden,
      lockBackground: x.lockBackground === true,
      loaded: { scope: cleanScope(x.scope), hidden: x.hidden },
    });
  };

  /**
   * Delete files no template uses — judged by EVERY document as it is now, not
   * by this tab's list: a copy made in another tab shares these files.
   */
  const deleteUnused = async (paths: string[]) => {
    if (!paths.length) return;
    let used: Set<string>;
    try {
      const snap = await getDocs(collection(db, 'designTemplates'));
      used = new Set(snap.docs.flatMap((d) => pathsOf({ id: d.id, ...(d.data() as Omit<TemplateDoc, 'id'>) })));
    } catch {
      return; // cannot tell what is used: keep them all
    }
    for (const p of paths) if (!used.has(p)) void deleteUploadedFile(p);
  };

  /**
   * After a change: tell the shop — in the background, never holding up the
   * screen — and only once it knows, delete the files of what it showed before.
   * Each telling takes the files of changes made BEFORE it (its own, and any a
   * failed telling left); a failure puts them back for the next one.
   */
  const tellShop = async (replaced: string[] = []) => {
    const files = [...new Set([...pendingFilesRef.current, ...replaced])];
    pendingFilesRef.current = [];
    const ok = await refreshShopCopy();
    setShopBehind(!ok);
    if (!ok) {
      pendingFilesRef.current = [...new Set([...pendingFilesRef.current, ...files])];
      return;
    }
    await deleteUnused(files);
  };

  /** The document as it is in the database now (another window may have changed it). */
  const readFresh = async (id: string): Promise<TemplateDoc | undefined> => {
    const snap = await getDoc(doc(db, 'designTemplates', id));
    return snap.exists() ? ({ id: snap.id, ...(snap.data() as Omit<TemplateDoc, 'id'>) }) : undefined;
  };

  const formChecks = (f: Form): { trimMm: { wMm: number; hMm: number }; uid: string } => {
    if (!f.name.trim()) throw new Error('Give the template a name.');
    if (sizeProblem) throw new Error(sizeProblem);
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('You are signed out. Sign in again and save.');
    return { trimMm: { wMm: mmOf(f.wMm), hMm: mmOf(f.hMm) }, uid };
  };

  /**
   * THE DESIGN'S SAVE, from the designer. Pictures first (every one, or nothing
   * is written), then the whole document, then — once the shop has been told —
   * the files this template no longer uses, unless some template still does.
   */
  const saveDesign = async (f: Form, design: TemplateDesign) => {
    const { trimMm, uid } = formChecks(f);
    if (design.json.length > TEMPLATE_JSON_MAX) throw new Error('This design is too large to keep as a template. Take some elements out and save again.');
    const existing = templates.find((x) => x.id === f.id);
    // As it is NOW: pictures are reused only from the document as stored — a file
    // this window remembers may have been replaced, and deleted, in another one.
    let current: TemplateDoc | undefined;
    try {
      current = await readFresh(f.id);
    } catch (err: any) {
      throw new Error(`The template could not be read before saving, so nothing was saved: ${err?.message ?? err}`);
    }
    const theirs = current?.designSavedAt ?? null;
    if (current && existing && theirs && theirs !== (existing.designSavedAt ?? null) && overwriteRef.current !== `${f.id}@${theirs}`) {
      overwriteRef.current = `${f.id}@${theirs}`;
      throw new Error(
        'This template\'s design was saved in another window after you opened it here. Press "Save template" again to replace that version with this one, or close without saving to keep it.',
      );
    }
    // WHERE IT IS OFFERED AND WHETHER IT IS HIDDEN: as stored NOW, unless this form
    // changed them. The whole document is written below, from this window — and a
    // template hidden in another window meanwhile was put back on show by a design
    // saved here (code review DSN-09).
    const scope = current && !scopeChanged(f) ? cleanScope(current.scope) : f.scope;
    const hidden = current && !hiddenChanged(f) ? current.hidden === true : f.hidden;
    const before = current?.images ?? {};
    const images: Record<string, StoredPicture> = {};
    const uploaded: string[] = [];
    let thumbnail: StoredPicture;
    try {
      for (const [imageId, blob] of Object.entries(design.images)) {
        // A picture's id is made when it is placed: the same id is the same picture.
        if (before[imageId]) {
          images[imageId] = before[imageId];
          continue;
        }
        const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
        const up = await uploadFile(new File([blob], `${f.id}-${imageId}.${ext}`, { type: blob.type || 'image/jpeg' }), {
          userId: uid,
          folder: 'design-templates',
        });
        uploaded.push(up.path);
        images[imageId] = { url: up.url, path: up.path };
      }
      const thumb = await uploadFile(new File([design.thumbnail], `${f.id}-thumbnail.png`, { type: 'image/png' }), {
        userId: uid,
        folder: 'design-templates',
      });
      uploaded.push(thumb.path);
      thumbnail = { url: thumb.url, path: thumb.path };
    } catch (err: any) {
      for (const p of uploaded) void deleteUploadedFile(p);
      throw new Error(`A picture could not be uploaded, so nothing was saved: ${err?.message ?? err}`);
    }
    const now = new Date().toISOString();
    const data: Omit<TemplateDoc, 'id'> = {
      name: f.name.trim(),
      nameI18n: Object.keys(f.nameI18n).length ? f.nameI18n : null,
      trimMm,
      outline: f.outline,
      json: design.json,
      images,
      thumbnailUrl: thumbnail.url,
      thumbnailPath: thumbnail.path,
      scope,
      hidden,
      sortOrder: current?.sortOrder ?? existing?.sortOrder ?? Math.max(0, ...templates.map((x) => x.sortOrder)) + 10,
      lockBackground: f.lockBackground,
      lowestPictureDpi: design.lowestPictureDpi,
      createdAt: current?.createdAt ?? existing?.createdAt ?? now,
      updatedAt: now,
      designSavedAt: now,
    };
    try {
      await setDoc(doc(db, 'designTemplates', f.id), withoutUndefined(data));
    } catch (err: any) {
      for (const p of uploaded) void deleteUploadedFile(p);
      throw new Error(`The template could not be saved: ${err?.message ?? err}`);
    }
    const saved: TemplateDoc = { id: f.id, ...data };
    const nowUsed = new Set(pathsOf(saved));
    overwriteRef.current = null;
    setTemplates((cur) => [...cur.filter((x) => x.id !== f.id), saved].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)));
    // The form shows what was saved — and measures its next changes from it.
    setForm((cur) => (cur && cur.id === f.id ? { ...cur, isNew: false, scope, hidden, loaded: { scope, hidden } } : cur));
    void tellShop(pathsOf(current).filter((p) => !nowUsed.has(p)));
  };

  /**
   * "Save settings": the name, where it is offered, hidden, the background —
   * written as THOSE fields only. Rewriting the whole document from this tab's
   * copy put an older design back over one saved in another tab since.
   */
  const saveSettings = async () => {
    if (!form || !editing) return;
    setBusy('save');
    setFormError(null);
    try {
      const { trimMm } = formChecks(form);
      // The design is laid out AT its size and for its cut: saved without it, a
      // new size would be read as the old layout — everything in the wrong place.
      if (
        Math.abs(editing.trimMm.wMm - trimMm.wMm) > 0.01 ||
        Math.abs(editing.trimMm.hMm - trimMm.hMm) > 0.01 ||
        (editing.outline ?? null) !== form.outline
      ) {
        throw new Error('You changed the size or the cut. Open the designer to fit the design to it, and save it there.');
      }
      const fields = {
        name: form.name.trim(),
        nameI18n: Object.keys(form.nameI18n).length ? form.nameI18n : null,
        // Only what this form changed: another window may have hidden it, or
        // offered it elsewhere, since this one opened (DSN-09).
        ...(scopeChanged(form) ? { scope: form.scope } : {}),
        ...(hiddenChanged(form) ? { hidden: form.hidden } : {}),
        lockBackground: form.lockBackground,
        updatedAt: new Date().toISOString(),
      };
      await updateDoc(doc(db, 'designTemplates', form.id), fields);
      setTemplates((cur) => cur.map((x) => (x.id === form.id ? { ...x, ...fields } : x)));
      closeForm();
      void tellShop();
    } catch (err: any) {
      setFormError(err?.message ?? String(err));
    } finally {
      setBusy(null);
    }
  };

  const openDesigner = async () => {
    if (!form) return;
    if (!form.name.trim()) {
      setFormError('Give the template a name first.');
      return;
    }
    if (sizeProblem) {
      setFormError(sizeProblem);
      return;
    }
    setFormError(null);
    const ticket = (openTicketRef.current += 1);
    if (editing?.json) {
      setBusy('open');
      const urls = Object.fromEntries(Object.entries(editing.images ?? {}).map(([k, v]) => [k, v.url]));
      const pictures = await fetchPictures(urls);
      // Closed, or opened again, while the pictures came: this answer is for nobody.
      if (openTicketRef.current !== ticket) return;
      setBusy(null);
      if (!pictures) {
        setFormError('A picture of this template could not be loaded, so it was not opened (saving it now would lose the picture). Try again.');
        return;
      }
      setDesignDraft({ json: editing.json, images: pictures, trimMm: editing.trimMm, savedAt: Date.parse(editing.designSavedAt ?? editing.updatedAt ?? '') || 0 });
    } else {
      setDesignDraft(null);
    }
    setDesignerOpen(true);
  };

  const duplicate = async (x: TemplateDoc) => {
    setError(null);
    setBusy(`dup:${x.id}`);
    try {
      // From the document as stored, not this window's row: another window may
      // have saved it since, and the row's files be gone.
      const source = await readFresh(x.id);
      if (!source) throw new Error('it no longer exists (deleted in another window)');
      const id = doc(collection(db, 'designTemplates')).id;
      const now = new Date().toISOString();
      // The copy SHARES its original's files (deleting either keeps what the
      // other still uses) and starts hidden, so the shop never shows two at once.
      const { id: _old, ...rest } = { ...source, scope: cleanScope(source.scope), sortOrder: Number(source.sortOrder) || 0 };
      const copy: Omit<TemplateDoc, 'id'> = {
        ...rest,
        name: `${source.name} (copy)`,
        hidden: true,
        sortOrder: Math.max(0, ...templates.map((y) => y.sortOrder)) + 10,
        createdAt: now,
        updatedAt: now,
        designSavedAt: now,
      };
      await setDoc(doc(db, 'designTemplates', id), withoutUndefined(copy));
      setTemplates((cur) => [...cur, { id, ...copy }]);
      void tellShop();
    } catch (err: any) {
      setError(`Could not duplicate: ${err?.message ?? err}`);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (x: TemplateDoc) => {
    if (!window.confirm(`Delete the template "${x.name}"? Customers will no longer be offered it.`)) return;
    setError(null);
    setBusy(`del:${x.id}`);
    try {
      // Its files as stored (another window may have saved it since this row was read).
      const stored = await readFresh(x.id).catch(() => undefined);
      await deleteDoc(doc(db, 'designTemplates', x.id));
      setTemplates((cur) => cur.filter((y) => y.id !== x.id));
      void tellShop([...new Set([...pathsOf(x), ...pathsOf(stored)])]);
    } catch (err: any) {
      setError(`Could not delete: ${err?.message ?? err}`);
    } finally {
      setBusy(null);
    }
  };

  const toggleHidden = async (x: TemplateDoc) => {
    setError(null);
    setBusy(`hide:${x.id}`);
    try {
      await updateDoc(doc(db, 'designTemplates', x.id), { hidden: !x.hidden, updatedAt: new Date().toISOString() });
      setTemplates((cur) => cur.map((y) => (y.id === x.id ? { ...y, hidden: !x.hidden } : y)));
      void tellShop();
    } catch (err: any) {
      setError(`Could not change it: ${err?.message ?? err}`);
    } finally {
      setBusy(null);
    }
  };

  // ---- ALL the designs a customer is offered, in his order (his decision of 2026-10-07:
  // "he decides who shows first, moves them as he likes") — his templates AND the shop's
  // own starters (src/lib/starterTemplates.ts), one list. The order of all of them lives
  // in the shop's settings (designTemplateOrder); his templates' sortOrder follows it.
  //
  // SHOWN AT ONCE, WRITTEN ONCE (code review DSN-10). Every drag and every eye was a
  // settings write of its own, and each one makes the server read the whole
  // catalogue again: a dozen quick moves were a dozen of those. The list shows what
  // he did at once; it is written 1.5 s after his last move, or when he leaves.
  const [pendingOrder, setPendingOrder] = useState<string[] | null>(null);
  const [pendingHidden, setPendingHidden] = useState<string[] | null>(null);
  const pendingRef = useRef<Partial<SiteSettings>>({});
  const flushTimerRef = useRef<number | null>(null);
  const updateSettingsRef = useRef(updateSettings);
  updateSettingsRef.current = updateSettings;
  const flushArrangement = () => {
    if (flushTimerRef.current !== null) window.clearTimeout(flushTimerRef.current);
    flushTimerRef.current = null;
    const patch = pendingRef.current;
    pendingRef.current = {};
    if (Object.keys(patch).length === 0) return;
    void updateSettingsRef.current(patch).catch((err) => setError(`Your changes to the list could not be saved: ${err?.message ?? err}`));
    // updateSettings puts the patch in `settings` at once, in the same render as these.
    setPendingOrder(null);
    setPendingHidden(null);
  };
  const queueArrangement = (patch: Partial<SiteSettings>) => {
    pendingRef.current = { ...pendingRef.current, ...patch };
    if (flushTimerRef.current !== null) window.clearTimeout(flushTimerRef.current);
    flushTimerRef.current = window.setTimeout(flushArrangement, 1500);
  };
  // Leaving writes what is still waiting: the screen (React's cleanup) — and the tab,
  // closed, reloaded or put away within those 1.5 s, which no cleanup sees: written
  // there and then, the browser asked to wait while it goes. Refs and setters only:
  // the first render's function is as good as the last's.
  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => {
      if (Object.keys(pendingRef.current).length === 0) return;
      flushArrangement();
      e.preventDefault();
      e.returnValue = '';
    };
    const onHidden = () => {
      if (document.visibilityState === 'hidden') flushArrangement();
    };
    window.addEventListener('beforeunload', onLeave);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('beforeunload', onLeave);
      document.removeEventListener('visibilitychange', onHidden);
      flushArrangement();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const orderList = pendingOrder ?? settings.designTemplateOrder ?? [];
  const hiddenStarters = new Set(pendingHidden ?? settings.designTemplateHidden ?? []);
  type ListRow = { kind: 'own'; id: string; x: TemplateDoc } | { kind: 'starter'; id: string; def: StarterDef };
  const listRows: ListRow[] = useMemo(() => {
    const all: ListRow[] = [
      ...templates.map((x) => ({ kind: 'own' as const, id: x.id, x })),
      ...STARTER_TEMPLATES.map((def) => ({ kind: 'starter' as const, id: def.id, def })),
    ];
    // The same order the gallery shows (src/lib/templateOrder.ts): a template made
    // since he last arranged them comes first.
    return inOwnerOrder(all, (r) => r.id, (r) => r.kind === 'own', orderList);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates, JSON.stringify(orderList)]);

  // ONE write: the order of every design. His templates' own sortOrder is not rewritten
  // as well — the gallery and this list both rank by this order, and N more writes (and
  // the server reading all N again) per drag bought nothing but a second way to fail.
  const reorderAll = (ids: string[]) => {
    if (loadFailed) return;
    setError(null);
    setPendingOrder(ids);
    queueArrangement({ designTemplateOrder: ids });
  };

  const toggleStarter = (id: string) => {
    const next = hiddenStarters.has(id) ? [...hiddenStarters].filter((x) => x !== id) : [...hiddenStarters, id];
    setPendingHidden(next);
    queueArrangement({ designTemplateHidden: next });
  };
  // Where a design of the shop's shows, from its own kinds (two said "flyers…" only and
  // also show on stickers).
  const starterWhere = (def: StarterDef) => {
    const has = (k: string) => (def.kinds as string[]).includes(k);
    const parts: string[] = [];
    if (has('card')) parts.push('business cards');
    if (['print', 'poster', 'rollup', 'banner', 'sign'].every(has)) parts.push('flyers, posters, roll-ups, banners, signs');
    else {
      const words: Record<string, string> = { print: 'flyers', poster: 'posters', rollup: 'roll-ups', banner: 'banners', flag: 'flags', sign: 'signs' };
      for (const k of Object.keys(words)) if (has(k)) parts.push(words[k]);
    }
    if (has('sticker')) parts.push('stickers and labels');
    const text = parts.join(', ');
    return text.charAt(0).toUpperCase() + text.slice(1);
  };

  const scopeText = (s: TemplateScope) =>
    s.kind === 'all'
      ? 'Every product'
      : s.kind === 'categories'
        ? s.ids.length === 1
          ? '1 category (with its sub-categories)'
          : `${s.ids.length} categories (with their sub-categories)`
        : `${s.ids.length} product${s.ids.length === 1 ? '' : 's'}`;

  const toggleId = (id: string) => {
    if (!form || form.scope.kind === 'all') return;
    const ids = form.scope.ids.includes(id) ? form.scope.ids.filter((x) => x !== id) : [...form.scope.ids, id];
    setForm({ ...form, scope: { kind: form.scope.kind, ids } });
  };

  const field = 'w-full px-3 py-2 rounded-xl border border-gray-200 text-sm font-bold bg-white';
  const small = 'block text-[0.6875rem] font-extrabold text-gray-600 mb-1';

  return (
    <div className="space-y-6" data-rx-design-templates>
      <div className="bg-white rounded-3xl border border-gray-100 p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-black text-gray-900 flex items-center gap-2">
              <LayoutTemplate className="w-5 h-5 text-blue-600" />
              Design templates
            </h2>
            <p className="text-xs font-bold text-gray-500 mt-1 max-w-2xl">
              Ready-made designs your customers start from in the online designer and then edit. Make one at a size and
              a cut; it is offered on every product where it fits — the same cut, the same proportions. The shop&rsquo;s own
              designs are built for every size. Drag to set the order customers see ALL of them in; the eye hides one.
            </p>
          </div>
          <button
            type="button"
            onClick={startNew}
            className="px-4 py-2.5 rounded-xl bg-blue-600 text-white text-xs font-black flex items-center gap-1.5 hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" />
            New template
          </button>
        </div>

        <label className="flex items-start gap-2.5 p-3 rounded-xl bg-gray-50 border border-gray-200 cursor-pointer" data-rx-basic-layouts-setting>
          <input
            type="checkbox"
            checked={settings.designerBasicLayouts !== false}
            onChange={(e) =>
              void updateSettings({ designerBasicLayouts: e.target.checked }).catch((err) =>
                setError(`The setting could not be saved: ${err?.message ?? err}`),
              )
            }
            className="mt-0.5 w-4 h-4 accent-blue-600"
          />
          <span>
            <span className="block text-xs font-black text-gray-900">Also offer the shop&rsquo;s own ready-made designs</span>
            <span className="block text-[0.625rem] font-bold text-gray-500">
              16 designs built for whatever size the customer chooses, in four colours each — in the order below. Off:
              customers see only your templates (and a blank page where none fits).
            </span>
          </span>
        </label>

        {error && <p className="text-xs font-black text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</p>}
        {shopBehind && (
          <div className="flex flex-wrap items-center gap-3 text-xs font-bold text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2" role="status" data-rx-shop-behind>
            <span className="flex-1 min-w-[14rem]">
              Saved — but the shop could not be told yet, so customers may see the version before this change for a while
              (twelve hours at most). The files that version uses are kept until it can.
            </span>
            <button type="button" onClick={() => void tellShop()} className="font-black text-blue-700 shrink-0">
              Tell the shop again
            </button>
          </div>
        )}

        {loading ? (
          <p className="flex items-center gap-2 text-xs font-bold text-gray-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading…
          </p>
        ) : (
          <>
          {loadFailed && (
            <p className="flex flex-wrap items-center gap-3 p-3 text-xs font-bold text-amber-900 bg-amber-50 rounded-2xl border border-amber-200" data-rx-templates-load-failed>
              <span className="flex-1 min-w-[12rem]">Your templates could not be read just now, so the order cannot be changed until they are — a drag would leave them out.</span>
              <button type="button" onClick={() => void load()} className="font-black text-blue-700 shrink-0">
                Try again
              </button>
            </p>
          )}
          {templates.length === 0 && !loadFailed && (
            <p className="p-4 text-center text-xs font-bold text-gray-500 bg-gray-50 rounded-2xl border border-dashed border-gray-200">
              No templates yet of your own. Press &ldquo;New template&rdquo; to make the first one — the shop&rsquo;s own designs below are offered meanwhile.
            </p>
          )}
          <SortableList
            ids={listRows.map((r) => r.id)}
            onReorder={(ids) => void reorderAll(ids)}
            disabled={loadFailed}
            labelOf={(id) => {
              const r = listRows.find((y) => y.id === id);
              return r?.kind === 'own' ? r.x.name : r?.kind === 'starter' ? r.def.name : 'Design';
            }}
            className="rounded-2xl border border-gray-200 divide-y divide-gray-100 overflow-hidden"
            renderItem={(id, { handle }) => {
              const row = listRows.find((y) => y.id === id);
              if (!row) return null;
              if (row.kind === 'starter') {
                const def = row.def;
                const off = hiddenStarters.has(def.id) || settings.designerBasicLayouts === false;
                return (
                  <div className={cn('flex items-center gap-3 p-3 bg-white', off && 'opacity-60')} data-rx-starter-row={def.id}>
                    <DragHandle handle={handle} label={`Drag "${def.name}"`} />
                    <span className="w-16 h-12 rounded-lg bg-gray-50 border border-gray-200 flex items-center justify-center overflow-hidden shrink-0 p-0.5">
                      <React.Suspense fallback={<LayoutTemplate className="w-5 h-5 text-gray-300" />}>
                        <StarterThumb id={def.id} t={t} />
                      </React.Suspense>
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-black text-gray-900 truncate">
                        {def.name}
                        <span className="ml-2 px-1.5 py-0.5 rounded bg-blue-50 text-[0.625rem] font-black text-blue-700 align-middle">The shop&rsquo;s own</span>
                        {hiddenStarters.has(def.id) && (
                          <span className="ml-2 px-1.5 py-0.5 rounded bg-gray-100 text-[0.625rem] font-black text-gray-500 align-middle">Hidden</span>
                        )}
                      </span>
                      <span className="block text-[0.6875rem] font-bold text-gray-500 truncate">
                        {starterWhere(def)} · built for every size · {def.palettes.length} colours · {def.styles.join(', ')}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleStarter(def.id)}
                      title={hiddenStarters.has(def.id) ? 'Show to customers' : 'Hide from customers'}
                      className="p-2 rounded-lg text-gray-500 hover:text-blue-700 hover:bg-blue-50 shrink-0"
                      data-rx-starter-hide={def.id}
                    >
                      {hiddenStarters.has(def.id) ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                );
              }
              const x = row.x;
              return (
                <div className="flex items-center gap-3 p-3 bg-white" data-rx-template-row={x.id}>
                  <DragHandle handle={handle} label={`Drag "${x.name}"`} />
                  <span className="w-16 h-12 rounded-lg bg-gray-50 border border-gray-200 flex items-center justify-center overflow-hidden shrink-0">
                    {x.thumbnailUrl ? (
                      <img src={x.thumbnailUrl} alt="" className="max-w-full max-h-full object-contain" />
                    ) : (
                      <LayoutTemplate className="w-5 h-5 text-gray-300" />
                    )}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-black text-gray-900 truncate">
                      {x.name}
                      {x.hidden && (
                        <span className="ml-2 px-1.5 py-0.5 rounded bg-gray-100 text-[0.625rem] font-black text-gray-500 align-middle">Hidden</span>
                      )}
                    </span>
                    <span className="block text-[0.6875rem] font-bold text-gray-500 truncate">
                      {mmText(x.trimMm.wMm)} × {mmText(x.trimMm.hMm)} mm · {cutName(x.outline)} · {scopeText(cleanScope(x.scope))}
                    </span>
                  </span>
                  <span className="flex items-center gap-1 shrink-0">
                    <button type="button" onClick={() => startEdit(x)} title="Edit" className="p-2 rounded-lg text-gray-500 hover:text-blue-700 hover:bg-blue-50" data-rx-template-edit={x.id}>
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button type="button" onClick={() => void duplicate(x)} disabled={!!busy} title="Duplicate (for another size)" className="p-2 rounded-lg text-gray-500 hover:text-blue-700 hover:bg-blue-50" data-rx-template-duplicate={x.id}>
                      <Copy className="w-4 h-4" />
                    </button>
                    <button type="button" onClick={() => void toggleHidden(x)} disabled={!!busy} title={x.hidden ? 'Show to customers' : 'Hide from customers'} className="p-2 rounded-lg text-gray-500 hover:text-blue-700 hover:bg-blue-50" data-rx-template-hide={x.id}>
                      {x.hidden ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                    <button type="button" onClick={() => void remove(x)} disabled={!!busy} title="Delete" className="p-2 rounded-lg text-gray-500 hover:text-red-700 hover:bg-red-50" data-rx-template-delete={x.id}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </span>
                </div>
              );
            }}
          />
          </>
        )}

        {/* The designer's own settings, under the designs: resolution by size, AI pictures. */}
        <DesignerSettingsPanel onError={setError} />
      </div>

      {form && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-3 md:p-8 overflow-y-auto" role="dialog" aria-modal="true" aria-label="Template" data-rx-template-form>
          <div className="w-full max-w-2xl bg-white rounded-3xl shadow-2xl my-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="text-base font-black text-gray-900">{form.isNew ? 'New template' : `Template: ${form.name}`}</h3>
              <button type="button" onClick={closeForm} className="p-1.5 rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100" aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-5">
              <div>
                <label className={small} htmlFor="tpl-name">Name (customers see it under the picture)</label>
                <input id="tpl-name" className={field} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Classic business card" />
              </div>
              <LocalizedTextFields label="Name in the other languages" fallback={form.name} value={form.nameI18n} onChange={(next) => setForm({ ...form, nameI18n: next })} />

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className={small} htmlFor="tpl-w">Width (mm)</label>
                  <input
                    id="tpl-w"
                    className={field}
                    inputMode="decimal"
                    value={form.wMm}
                    onChange={(e) => setForm({ ...form, wMm: e.target.value, ...(square ? { hMm: e.target.value } : {}) })}
                  />
                </div>
                <div>
                  <label className={small} htmlFor="tpl-h">Height (mm)</label>
                  <input
                    id="tpl-h"
                    className={field}
                    inputMode="decimal"
                    value={form.hMm}
                    disabled={square}
                    onChange={(e) => setForm({ ...form, hMm: e.target.value })}
                  />
                </div>
                <div>
                  <label className={small} htmlFor="tpl-cut">Cut shape</label>
                  <select
                    id="tpl-cut"
                    className={field}
                    value={form.outline ?? ''}
                    onChange={(e) => {
                      const outline = (e.target.value || null) as OutlineKind | null;
                      setForm({ ...form, outline, ...(outline && needsSquareBox(outline) ? { hMm: form.wMm } : {}) });
                    }}
                  >
                    {CUT_CHOICES.map((k) => (
                      <option key={k ?? 'rect'} value={k ?? ''}>
                        {cutName(k)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {sizeProblem ? (
                <p className="text-xs font-black text-red-700">{sizeProblem}</p>
              ) : !showsOn ? (
                <p className="text-[0.6875rem] font-bold text-gray-500 rounded-xl px-3 py-2 border border-gray-200 bg-gray-50" data-rx-shows-on>
                  {sizes === null
                    ? 'Your property library could not be read just now, so this cannot say which sizes it will show on.'
                    : 'Checking your property library…'}
                </p>
              ) : (
                <div className={cn('text-[0.6875rem] font-bold rounded-xl px-3 py-2 border', showsOn.fits.length ? 'text-gray-600 bg-gray-50 border-gray-200' : 'text-red-800 bg-red-50 border-red-200')} data-rx-shows-on>
                  {showsOn.fits.length ? (
                    <>
                      <span className="font-black">Shows on</span> these sizes in your property library (when the product&rsquo;s cut is
                      {' '}{cutName(form.outline).toLowerCase()}): {showsOn.fits.slice(0, 10).join(', ')}
                      {showsOn.fits.length > 10 ? ` and ${showsOn.fits.length - 10} more` : ''}.
                      {showsOn.pictures && ' Not on the larger sizes with its proportions: its pictures would print under 150 DPI there.'}
                    </>
                  ) : showsOn.pictures ? (
                    <>
                      No size in your property library can take it: its pictures would print under 150 DPI on every size with
                      its proportions{pictureDpi ? ` (at this size the least sharp prints at ${Math.round(pictureDpi)} DPI)` : ''}.
                      Use larger pictures.
                    </>
                  ) : (
                    <>
                      No size in your property library fits this template (the same proportions within 2 %, from 0.85× to 2×
                      its size), so customers would not be offered it. Choose a size your products sell.
                    </>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <span className={small}>Where it is offered</span>
                <div className="flex flex-wrap gap-2">
                  {(['all', 'categories', 'products'] as const).map((kind) => (
                    <label key={kind} className={cn('px-3 py-1.5 rounded-xl border text-xs font-black cursor-pointer', form.scope.kind === kind ? 'border-blue-500 bg-blue-50 text-blue-800' : 'border-gray-200 text-gray-600')}>
                      <input
                        type="radio"
                        name="tpl-scope"
                        className="sr-only"
                        checked={form.scope.kind === kind}
                        onChange={() => setForm({ ...form, scope: kind === 'all' ? { kind } : { kind, ids: form.scope.kind === kind ? form.scope.ids : [] } })}
                        data-rx-scope={kind}
                      />
                      {kind === 'all' ? 'Every product' : kind === 'categories' ? 'Some categories' : 'Some products'}
                    </label>
                  ))}
                </div>
                {form.scope.kind === 'categories' && (
                  <div className="max-h-56 overflow-y-auto rounded-xl border border-gray-200 p-2 space-y-0.5">
                    {categoryPickList(categories).map(({ category: cat, indent }) => (
                      <label key={cat.id} className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-gray-50 text-xs font-bold text-gray-700 cursor-pointer">
                        <input type="checkbox" checked={form.scope.kind === 'categories' && form.scope.ids.includes(cat.id)} onChange={() => toggleId(cat.id)} className="accent-blue-600" data-rx-scope-category={cat.id} />
                        <span>{indent}{cat.name}</span>
                      </label>
                    ))}
                    <p className="px-2 pt-1 text-[0.625rem] font-bold text-gray-400">A category includes its sub-categories.</p>
                  </div>
                )}
                {form.scope.kind === 'products' && (
                  <div className="rounded-xl border border-gray-200 p-2 space-y-1">
                    <input className={field} placeholder="Search products…" value={productSearch} onChange={(e) => setProductSearch(e.target.value)} />
                    <div className="max-h-56 overflow-y-auto space-y-0.5">
                      {products
                        .filter((p) => !productSearch.trim() || p.name.toLowerCase().includes(productSearch.trim().toLowerCase()) || (form.scope.kind === 'products' && form.scope.ids.includes(p.id)))
                        .slice(0, 200)
                        .map((p) => (
                          <label key={p.id} className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-gray-50 text-xs font-bold text-gray-700 cursor-pointer">
                            <input type="checkbox" checked={form.scope.kind === 'products' && form.scope.ids.includes(p.id)} onChange={() => toggleId(p.id)} className="accent-blue-600" data-rx-scope-product={p.id} />
                            <span>{p.name}</span>
                          </label>
                        ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="flex items-start gap-2.5 p-3 rounded-xl border border-gray-200 cursor-pointer">
                  <input type="checkbox" checked={!form.lockBackground} onChange={(e) => setForm({ ...form, lockBackground: !e.target.checked })} className="mt-0.5 w-4 h-4 accent-blue-600" />
                  <span className="text-xs font-black text-gray-800">Customers may change the background colour</span>
                </label>
                <label className="flex items-start gap-2.5 p-3 rounded-xl border border-gray-200 cursor-pointer">
                  <input type="checkbox" checked={form.hidden} onChange={(e) => setForm({ ...form, hidden: e.target.checked })} className="mt-0.5 w-4 h-4 accent-blue-600" data-rx-template-hidden />
                  <span>
                    <span className="block text-xs font-black text-gray-800">Hidden from customers for now</span>
                    {/* "Where it is offered" decides where customers are shown it, not who can
                        open it: the shop serves a saved template to anyone with its link
                        (code review DSN-16). */}
                    <span className="block text-[0.625rem] font-bold text-gray-500" data-rx-template-hidden-hint>
                      Anyone with a saved template&rsquo;s link can open it, wherever it is offered — only Hidden keeps it private.
                    </span>
                  </span>
                </label>
              </div>

              <div className="flex items-center gap-4 p-3 rounded-2xl bg-gray-50 border border-gray-200">
                <span className="w-28 h-20 rounded-xl bg-white border border-gray-200 flex items-center justify-center overflow-hidden shrink-0">
                  {editing?.thumbnailUrl ? (
                    <img src={editing.thumbnailUrl} alt="" className="max-w-full max-h-full object-contain" />
                  ) : (
                    <LayoutTemplate className="w-6 h-6 text-gray-300" />
                  )}
                </span>
                <span className="text-[0.6875rem] font-bold text-gray-500">
                  {editing?.json
                    ? 'Open the designer to change the design. Changing the size or the cut here refits it when you open it.'
                    : 'Open the designer to make the design. In it, choose for every element what a customer may do with it.'}
                </span>
              </div>

              {formError && <p className="text-xs font-black text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2" role="alert">{formError}</p>}

              <div className="flex flex-wrap justify-end gap-2">
                <button type="button" onClick={closeForm} className="px-4 py-2.5 rounded-xl text-xs font-black text-gray-600 border border-gray-200 hover:bg-gray-50">
                  Cancel
                </button>
                {!form.isNew && editing?.json && (
                  <button type="button" onClick={() => void saveSettings()} disabled={!!busy} className="px-4 py-2.5 rounded-xl text-xs font-black text-blue-700 border border-blue-200 hover:bg-blue-50 disabled:opacity-50" data-rx-template-save-settings>
                    {busy === 'save' ? 'Saving…' : 'Save settings'}
                  </button>
                )}
                <button type="button" onClick={() => void openDesigner()} disabled={!!busy} className="px-4 py-2.5 rounded-xl text-xs font-black text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5" data-rx-template-open-designer>
                  {busy === 'open' && <Loader2 className="w-4 h-4 animate-spin" />}
                  Open the designer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {form && designerOpen &&
        createPortal(
          <React.Suspense
            fallback={
              <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[#eceef4]" role="status">
                <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
              </div>
            }
          >
            <OnlineDesigner
              mode="owner"
              productId={`template-${form.id}`}
              draftKey={`template:${form.id}`}
              trimMm={{ wMm, hMm }}
              outline={form.outline}
              sizeLabel={`${mmText(wMm)} × ${mmText(hMm)} mm · ${cutName(form.outline)}`}
              title={`Template: ${form.name.trim() || 'New template'}`}
              draft={designDraft}
              draftNotBefore={Date.parse(editing?.designSavedAt ?? editing?.updatedAt ?? '') || 0}
              onDraftChange={() => {}}
              onUse={() => {}}
              onClose={() => setDesignerOpen(false)}
              onSaveTemplate={async (design) => {
                await saveDesign(form, design);
                setDesignerOpen(false);
              }}
              t={t}
              language={language}
            />
          </React.Suspense>,
          document.body,
        )}
    </div>
  );
}
