/**
 * "CREATE YOUR DESIGN" — DESIGN LATER (designer v2; the owner's decision of
 * 2026-10-07: the customer may pay first and design from his order page).
 *
 * A line bought as "Design online" without its design carries what the product page
 * knew (src/lib/designLater.ts). This opens the same gallery and studio on it, from
 * the basket, the checkout or the order page: the size, the cut, the pages and the
 * owner's print values are the line's, never re-asked. The finished print file and
 * its page pictures go to storage under the customer's own identity (an anonymous
 * one for a guest, as every upload in the shop), and the screen that opened it is
 * handed the result — it puts it on the basket line, or sends it to the order.
 *
 * The draft is the product's (studio:<product id>), as on the product page: a design
 * begun there, or in the basket, is still there to continue on the order page.
 */
import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Loader2, PenTool } from 'lucide-react';
import { signInAnonymously } from 'firebase/auth';
import { auth } from '../../../firebase';
import { useAuth } from '../../../App';
import { useSiteSettings } from '../../../context/SiteSettingsContext';
import { cn } from '../../../lib/utils';
import { cleanDpiBands, printSpecFor } from '../../../lib/printSpec';
import { formatSizeForShopper } from '../../../lib/printSize';
import { deleteUploadedFile, uploadFile } from '../../../lib/uploadFile';
import { holdReloads } from '../../../lib/reloadHold';
import { parseDesignDoc } from '../../../lib/designDoc';
import { templateMiss } from '../../../lib/designTemplateMatch';
import type { DesignLaterMarker, UploadedDesign } from '../../../lib/designLater';
import type { TemplateSummary } from '../../../lib/designTemplateDoc';
import type { OutlineKind } from '../../../lib/shapes';
import type { TranslationKey } from '../../../lib/translations';
import { fetchTemplateList } from './templatesApi';
import { loadDraft } from './draftStore';
import type { DesignerResult, StudioDraft } from './types';
import type { GalleryChoice } from './studio/TemplateGallery';
import { DesignerBoundary, DesignerLoading, LazyGallery, LazyStudio, aiGenerate, loadDesigner, loadGallery } from './DesignerShell';

/** A refusal with words for the customer (already translated); anything else reads as "could not be saved". */
export class DesignAttachError extends Error {}

/**
 * SAVES IN PROGRESS, for the whole page. A design keeps uploading while the basket
 * re-renders, closes and reopens — its line must still say "Saving…", and Pay and
 * Checkout must wait for it: an order paid a moment too early went without the
 * design (and leaving for the bank cut the upload off).
 */
const saves = new Map<string, number>();
const saveListeners = new Set<() => void>();
function setSaveProgress(key: string, percent: number | null) {
  if (percent === null) saves.delete(key);
  else saves.set(key, percent);
  for (const listener of [...saveListeners]) listener();
}
function subscribeSaves(listener: () => void) {
  saveListeners.add(listener);
  return () => {
    saveListeners.delete(listener);
  };
}
/** True while a design is still being saved anywhere on this page. */
export function useDesignSaving(): boolean {
  return useSyncExternalStore(subscribeSaves, () => saves.size > 0, () => false);
}
/**
 * Each save's way to stop, while its files are still going up (code review
 * DSN-12). Storage keeps retrying a stalled upload for ten minutes, and all that
 * time Pay and Checkout waited for it with nothing to press.
 */
const cancels = new Map<string, AbortController>();
function setSaveCancel(key: string, controller: AbortController | null) {
  if (controller) cancels.set(key, controller);
  else cancels.delete(key);
  for (const listener of [...saveListeners]) listener();
}
/** Stop a design still uploading — its Cancel link, or its basket line removed. */
export function cancelDesignSave(key: string) {
  cancels.get(key)?.abort();
}
// How many of these designers are open right now (a reload's leftover history flag is
// only ours to clear when none is).
let openDesigners = 0;

/** The print file and its page pictures, into storage — under the customer's own identity. */
async function uploadDesign(result: DesignerResult, onProgress: (percent: number) => void, signal: AbortSignal): Promise<UploadedDesign> {
  // The bucket keys on the uploader's own uid; a guest gets an anonymous one, and
  // only when there is no session — signing in over a real account would end it.
  let uid = auth.currentUser?.uid;
  if (!uid) uid = (await signInAnonymously(auth)).user.uid;
  const up = await uploadFile(result.file, {
    userId: uid,
    folder: 'artwork',
    onProgress,
    contentType: result.file.type || undefined,
    signal,
  });
  // Every page's picture, small. Without them the line still has its file; screens
  // then show the file's name instead of a picture.
  const done = await Promise.allSettled(
    (result.previews ?? []).map(async (p) => {
      const r = await uploadFile(p.file, { userId: uid!, folder: 'artwork', contentType: 'image/png', signal });
      return { side: p.side, url: r.url, path: r.path };
    }),
  );
  const ok = done.flatMap((d) => (d.status === 'fulfilled' ? [d.value] : []));
  // Cancelled while its pictures went up: the print file is nobody's now.
  if (signal.aborted) {
    for (const path of [up.path, ...ok.map((p) => p.path)]) void deleteUploadedFile(path);
    throw new DOMException('Cancelled', 'AbortError');
  }
  return {
    fileName: result.file.name,
    fileUrl: up.url,
    storagePath: up.path,
    previewPaths: ok.map((p) => p.path),
    trimMm: result.trimMm,
    bleedMm: Number(result.bleedMm) > 0 ? result.bleedMm : null,
    dpi: Number(result.dpi) > 0 ? result.dpi : null,
    template: result.template?.id ? result.template : null,
    previews: ok.map(({ side, url }) => ({ side, url })),
    sides: result.sides?.length ? result.sides : ['front'],
  };
}

/** Done: saved now — or, `already`, the line had its design from an earlier try or another tab. */
type Phase = { kind: 'idle' } | { kind: 'done'; already?: boolean } | { kind: 'error'; message: string };

export interface DesignLaterProps {
  marker: DesignLaterMarker;
  productId: string;
  /** In the customer's language where the screen has it. */
  productName: string;
  /**
   * Put it on the basket line, or send it to the order. Throw a DesignAttachError to
   * say why it could not be; answer 'already' when the line had its design already.
   */
  onDesigned: (design: UploadedDesign) => Promise<void | 'already'> | void | 'already';
  /** Which line this is (line:<basket id>, order:<id>:<line>): its save outlives a closed basket. */
  saveKey: string;
  className?: string;
}

export default function DesignLater({ marker, productId, productName, onDesigned, saveKey, className }: DesignLaterProps) {
  const { t, language, user } = useAuth();
  const { settings } = useSiteSettings();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'gallery' | 'studio'>('gallery');
  const [start, setStart] = useState<{ template: string; variant?: string } | { blank: true } | null>(null);
  const [templates, setTemplates] = useState<TemplateSummary[] | null | undefined>(undefined);
  const [templatesAttempt, setTemplatesAttempt] = useState(0);
  const [draftAt, setDraftAt] = useState<number | null>(null);
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const draftRef = useRef<StudioDraft | null>(null);
  const closingRef = useRef(false);
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);
  const savingPercent = useSyncExternalStore(subscribeSaves, () => saves.get(saveKey) ?? null, () => null);
  const canCancel = useSyncExternalStore(subscribeSaves, () => cancels.has(saveKey), () => false);

  // Open designers are counted; one taken off the page while open (its line got its
  // file another way, the basket closed under it) takes its history entry with it —
  // or the next Back does nothing.
  const openRef = useRef(false);
  openRef.current = open;
  useEffect(() => {
    if (!open) return;
    openDesigners += 1;
    return () => {
      openDesigners -= 1;
    };
  }, [open]);
  // Open from the basket, it can be over a page the shop reloads by itself after a
  // deploy (BuildWatcher): not while he is designing.
  useEffect(() => (open ? holdReloads() : undefined), [open]);
  useEffect(() => {
    // A page reloaded with a designer open wakes on its history entry with none: the
    // flag is taken off, so a later close cannot go back over an entry that is not ours.
    const state = window.history.state as { rxDesigner?: boolean } | null;
    if (state?.rxDesigner && openDesigners === 0) {
      try {
        window.history.replaceState({ ...state, rxDesigner: undefined }, '');
      } catch {
        /* nothing to tidy */
      }
    }
    return () => {
      if (openRef.current && (window.history.state as { rxDesigner?: boolean } | null)?.rxDesigner) {
        try {
          window.history.back();
        } catch {
          /* no history */
        }
      }
    };
  }, []);

  const trim = marker.trimMm;
  const printSpecKey = JSON.stringify(marker.printSpec ?? null);
  const spec = useMemo(
    () => printSpecFor({ kind: marker.kind, trimMm: trim, bands: cleanDpiBands(settings.designerDpiBands), override: marker.printSpec }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [marker.kind, trim.wMm, trim.hMm, settings.designerDpiBands, printSpecKey],
  );
  const sizeLabel = formatSizeForShopper(trim.wMm, trim.hMm);

  // The owner's templates for this product, once it is opened — the server's copy.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void fetchTemplateList(productId, marker.categoryId).then((list) => {
      if (alive) setTemplates(list);
    });
    return () => {
      alive = false;
    };
  }, [open, productId, marker.categoryId, templatesAttempt]);
  const retryTemplates = () => {
    setTemplates(undefined);
    setTemplatesAttempt((n) => n + 1);
  };

  // THE PHONE'S BACK GESTURE CLOSES THE DESIGNER, not the page under it (the same
  // history entry the product page uses).
  useEffect(() => {
    if (!open) return;
    const onPop = () => {
      closingRef.current = false;
      setOpen(false);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [open]);

  const openDesigner = () => {
    if (saves.has(saveKey)) return;
    void loadGallery().catch(() => {});
    void loadDesigner().catch(() => {});
    closingRef.current = false;
    setNotice('');
    setPhase({ kind: 'idle' });
    setStep('gallery');
    setStart(null);
    setDraftNotice(null);
    setDraftAt(null);
    if (templates === null) retryTemplates();
    // His own design, if he has one — not one made from a shop template that does
    // not fit this size (the studio would set it aside, so it is not offered).
    const offerDraft = (savedAt: number, docJson: string) => {
      const meta = parseDesignDoc(docJson)?.template as { starter?: boolean; trimMm?: { wMm: number; hMm: number }; outline?: OutlineKind | null } | null;
      if (meta && !meta.starter && meta.trimMm && templateMiss(meta as Parameters<typeof templateMiss>[0], trim, marker.outline) !== null) {
        setDraftAt(null);
        setDraftNotice(t('dsgTemplateOtherSize'));
        return;
      }
      setDraftAt(savedAt);
    };
    if (draftRef.current) offerDraft(draftRef.current.savedAt, draftRef.current.doc);
    else {
      void (async () => (await loadDraft(`studio:${productId}`)) ?? (await loadDraft(productId)))().then((d) => {
        if (d && aliveRef.current) offerDraft(d.savedAt, d.json);
      });
    }
    try {
      window.history.pushState({ ...(window.history.state ?? {}), rxDesigner: true }, '');
    } catch {
      /* no history: Back simply leaves the page */
    }
    setOpen(true);
  };

  const close = () => {
    // Once is enough: the dialog stays up until the browser has gone back.
    if (closingRef.current) return;
    if ((window.history.state as { rxDesigner?: boolean } | null)?.rxDesigner) {
      closingRef.current = true;
      window.history.back();
    } else {
      setOpen(false);
    }
  };

  const failed = () => {
    setNotice(t('dsgLoadFailed'));
    close();
  };

  const save = async (result: DesignerResult) => {
    if (saves.has(saveKey)) return;
    setPhase({ kind: 'idle' });
    const controller = new AbortController();
    setSaveCancel(saveKey, controller);
    setSaveProgress(saveKey, 0);
    try {
      const design = await uploadDesign(result, (percent) => setSaveProgress(saveKey, percent), controller.signal);
      // Up: from here the line or the order takes it — too late to cancel.
      setSaveCancel(saveKey, null);
      const outcome = await onDesigned(design);
      if (aliveRef.current) setPhase({ kind: 'done', already: outcome === 'already' });
    } catch (err) {
      // Cancelled: as if never pressed — the line stays "design later", and Pay
      // no longer waits for it.
      if (controller.signal.aborted) {
        if (aliveRef.current) setPhase({ kind: 'idle' });
        return;
      }
      console.warn('The design could not be attached:', err);
      if (aliveRef.current) setPhase({ kind: 'error', message: err instanceof DesignAttachError && err.message ? err.message : t('stDlFailed') });
    } finally {
      setSaveCancel(saveKey, null);
      setSaveProgress(saveKey, null);
    }
  };

  const handleUse = (result: DesignerResult) => {
    if (closingRef.current) return;
    close();
    void save(result);
  };

  const saving = savingPercent !== null;
  return (
    <div className={cn('space-y-2', className)} data-rx-design-later>
      {phase.kind === 'done' ? (
        <p className="flex items-center gap-2 text-xs font-bold text-green-700 bg-green-50 border border-green-200 rounded-xl px-3 py-2.5" data-rx-design-later-done>
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          {/* Not "saved" when it was not this one that arrived (code review DSN-13). */}
          <span>{t(phase.already ? 'stDlAlready' : 'stDlDone')}</span>
        </p>
      ) : (
        <button
          type="button"
          onClick={openDesigner}
          disabled={saving}
          data-rx-design-later-open
          className="w-full px-4 py-2.5 rounded-xl bg-[#bb965b] hover:bg-[#a8854f] disabled:opacity-60 disabled:cursor-not-allowed text-white text-xs font-black shadow-md transition-colors flex items-center justify-center gap-2"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <PenTool className="w-4 h-4" />}
          <span>{saving ? t('stDlSaving').replace('{0}', String(savingPercent)) : t('stDlCreate')}</span>
        </button>
      )}
      {saving && canCancel && phase.kind !== 'done' && (
        <button
          type="button"
          onClick={() => cancelDesignSave(saveKey)}
          className="block mx-auto px-1 rounded text-[0.6875rem] font-bold text-gray-500 underline underline-offset-2 hover:text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
          data-rx-design-later-cancel
        >
          {t('stCancel')}
        </button>
      )}
      {phase.kind === 'error' && (
        <p className="flex items-start gap-1.5 text-[0.6875rem] font-bold text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2" role="alert" data-rx-design-later-error>
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
          <span>{phase.message}</span>
        </p>
      )}
      {notice && <p className="text-[0.6875rem] font-bold text-amber-800">{notice}</p>}

      {/* Over everything, rendered into <body>: inside a drawer or a card it would sit
          in a transformed box that a fixed layer cannot escape. */}
      {open &&
        step === 'gallery' &&
        createPortal(
          <DesignerBoundary onFail={failed}>
            <React.Suspense fallback={<DesignerLoading label={t('dsgLoading')} closeLabel={t('dsgCloseAnyway')} onClose={close} />}>
              <LazyGallery
                productName={productName}
                sizeLabel={sizeLabel}
                trimMm={trim}
                outline={marker.outline}
                spec={spec}
                sides={marker.sides}
                kind={spec.kind}
                templates={templates}
                onRetryTemplates={retryTemplates}
                order={settings.designTemplateOrder}
                hidden={settings.designTemplateHidden}
                draftSavedAt={draftAt}
                starters={settings.designerBasicLayouts !== false}
                notice={draftNotice}
                showMisses={user?.role === 'admin'}
                t={t}
                language={language}
                onChoose={(choice: GalleryChoice) => {
                  setStart('continue' in choice ? null : choice);
                  setStep('studio');
                }}
                onClose={close}
              />
            </React.Suspense>
          </DesignerBoundary>,
          document.body,
        )}
      {open &&
        step === 'studio' &&
        createPortal(
          <DesignerBoundary onFail={failed}>
            <React.Suspense fallback={<DesignerLoading label={t('dsgLoading')} closeLabel={t('dsgCloseAnyway')} onClose={close} />}>
              <LazyStudio
                key={JSON.stringify(start)}
                start={start}
                productId={productId}
                trimMm={trim}
                outline={marker.outline}
                sizeLabel={sizeLabel}
                spec={spec}
                sides={marker.sides}
                ink={marker.ink}
                sameOnBothSides={marker.sameOnBothSides}
                draft={draftRef.current}
                onDraftChange={(next) => {
                  draftRef.current = next;
                }}
                onUse={handleUse}
                onClose={close}
                t={t}
                language={language}
                templates={templates}
                onRetryTemplates={retryTemplates}
                showMisses={user?.role === 'admin'}
                title={productName}
                aiGenerate={settings.designerAiImages === true ? aiGenerate : undefined}
                order={settings.designTemplateOrder}
                hidden={settings.designTemplateHidden}
                starters={settings.designerBasicLayouts !== false}
              />
            </React.Suspense>
          </DesignerBoundary>,
          document.body,
        )}
    </div>
  );
}

/**
 * Send a design made on the order page to the order — the same endpoint a file sent
 * later goes to (POST /api/orders/:id/artwork), with what the studio knows of it. The
 * server keeps only what it can check (sanitizeFileSpecs) and names the template.
 *
 * Its refusals are the SHOP's English; the customer reads his own language — said by
 * the answer's code, never its words. A refused design's files are deleted (each try
 * uploads its own) — but not when the order is not paid, which is no fault of the
 * design; with no answer at all they are kept, since the design may well have
 * arrived (this host answers 502 after doing the work). "That line already has its
 * file" — the earlier try did arrive — is done, not an error.
 */
export async function sendDesignToOrder(input: {
  orderId: string;
  token?: string;
  itemIndex: number;
  design: UploadedDesign;
  widthCm?: number;
  heightCm?: number;
  t: (key: TranslationKey) => string;
}): Promise<'sent' | 'already'> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const idToken = await auth.currentUser?.getIdToken().catch(() => null);
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const { design } = input;
  let res: Response;
  try {
    res = await fetch(`/api/orders/${encodeURIComponent(input.orderId)}/artwork`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        t: input.token ?? '',
        itemIndex: input.itemIndex,
        fileUrl: design.fileUrl,
        fileName: design.fileName,
        fileType: (design.fileName.split('.').pop() || 'PDF').toUpperCase(),
        ...(Number(input.widthCm) > 0 && Number(input.heightCm) > 0 ? { widthCm: input.widthCm, heightCm: input.heightCm } : {}),
        bleedMm: design.bleedMm,
        dpi: design.dpi,
        templateId: design.template?.id ?? null,
        previews: design.previews,
        sides: design.sides,
      }),
    });
  } catch {
    throw new DesignAttachError(input.t('stDlFailed'));
  }
  if (res.ok) return 'sent';
  const data = (await res.json().catch(() => null)) as { code?: string } | null;
  const tidy = () => {
    for (const path of [design.storagePath, ...design.previewPaths]) void deleteUploadedFile(path).catch(() => {});
  };
  if (res.status === 409 && data?.code === 'has-file') {
    tidy();
    return 'already';
  }
  // NOT PAID — refunded since this page loaded, or a page older than the order's
  // state. It fell through to "could not be saved, try again" and his files were
  // deleted (code review 2026-10-11, J). Said for what it is, and nothing of his
  // deleted: the files stay, and his design stays on this device, offered back
  // when he opens the designer again.
  if (res.status === 409 && data?.code === 'unpaid') throw new DesignAttachError(input.t('stDlUnpaid'));
  if (res.status >= 400 && res.status < 500) {
    tidy();
    throw new DesignAttachError(input.t(data?.code === 'closed' ? 'stDlClosed' : 'stDlFailed'));
  }
  throw new DesignAttachError(input.t('stDlFailed'));
}
