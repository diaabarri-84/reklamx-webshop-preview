/**
 * THE DESIGN STUDIO — designer v2, laid out as Pixartprinting's Designer (asked for
 * on 2026-10-07: "make it exactly like the one I sent you").
 *
 *   top:     close · the product and size · undo/redo · preview · Continue
 *   left:    the rail — Designs, Uploads, AI Studio, Text, Elements, Backgrounds, QR —
 *            each opening its panel beside the board (a sheet over it on a phone,
 *            with the rail along the bottom)
 *   centre:  the toolbar for what is chosen; the board with its marks; the bar that
 *            floats over the chosen object (replace, copy, lock, delete)
 *   bottom:  the pages (front / back), the zoom
 *
 * The engine (engine.ts) holds the board, the sides and the history; this file is
 * the screen around it and the way in and out: what the design starts from (a
 * template chosen in the gallery, the customer's own draft, a blank page), keeping
 * it on the device as it changes, and "Continue": the print file (a PNG for one side
 * that fits one picture, else a PDF of every page — printFile.ts), the check screen,
 * and the hand-over to the page.
 *
 * Kept from the round-16 designer: the dialog follows the visible viewport (a phone
 * keyboard never hides it); Escape and Tab stay inside; closing unsent work warns;
 * a template's locked parts that cannot come back send the customer to choose again.
 */
import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { FabricImage, Group, Textbox, type FabricObject } from 'fabric';
import {
  AlertTriangle,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Check,
  ChevronUp,
  CirclePlus,
  Eye,
  EyeOff,
  HelpCircle,
  LayoutTemplate,
  Loader2,
  Maximize2,
  Plus,
  Redo2,
  Settings,
  Sparkles,
  Type,
  Undo2,
  UploadCloud,
  X,
} from 'lucide-react';
import { cn } from '../../../../lib/utils';
import { localeFor } from '../../../../lib/dateFormat';
import type { Language, TranslationKey } from '../../../../lib/translations';
import type { OutlineKind } from '../../../../lib/shapes';
import type { PrintSpec } from '../../../../lib/printSpec';
import type { SideInk } from '../../../../lib/printSides';
import { blankDesignDoc, designImageIds, parseDesignDoc, serializeDesignDoc, sideFontFamilies, type DesignDoc, type SideId } from '../../../../lib/designDoc';
import type { BoardGeometry } from '../../../../lib/designRefit';
import { templateMiss } from '../../../../lib/designTemplateMatch';
import { designExportSize, designPdfFileName } from '../../../../lib/designSize';
import { DESIGN_BLEED_MM } from '../../../../lib/designSize';
import { ensureFontFamilies } from '../fonts';
import { loadDraft, saveDraft } from '../draftStore';
import { exportDesign } from '../exportDesign';
import { PrintFileError, makePrintPdf } from '../printFile';
import { fetchPictures, fetchTemplateFull } from '../templatesApi';
import type { DesignerResult, StudioDraft, TemplateMeta, TemplateSummary } from '../types';
import type { RxQr } from '../rxObjects';
import { StudioEngine, kindOf } from './engine';
import { U, type Mode, type Tagged } from './studioObjects';
import { PopoverButton, StudioLayer, SwitchRow, ToolButton } from './ui';
import { BackgroundsGlyph, CircleClose, ElementsGlyph, MasksGlyph, PagesGlyph, ShopMark, UI_FONT, useUiFont } from './look';
import { ContextToolbar, ObjectBar, paletteFor } from './Toolbars';
import Cropper from './Cropper';
import ProofView, { type ProofData } from './ProofView';
import MasksPanel from './panels/MasksPanel';
import ToolsPanel from './panels/ToolsPanel';
import UploadsPanel, { PICTURE_DRAG_TYPE } from './panels/UploadsPanel';
import ElementsPanel, { ELEMENTS } from './panels/ElementsPanel';
import { elementLabel } from './elementNames';
import BackgroundsPanel from './panels/BackgroundsPanel';
import QrPanel from './panels/QrPanel';
import DesignsPanel from './panels/DesignsPanel';
import AiPanel, { AI_IDLE, type AiGenerate, type AiRequest } from './panels/AiPanel';
import Preview3D from './Preview3D';
import { takePictures } from './pictures';
import { sideThumb, starterDoc, starterWords } from './starters';
import { isStarterId, starterById, startersFor } from '../../../../lib/starterTemplates';
import { offeredDesigns } from '../../../../lib/templateOrder';
import { holdReloads } from '../../../../lib/reloadHold';

type Panel = 'designs' | 'uploads' | 'text' | 'elements' | 'masks' | 'backgrounds' | 'tools' | 'ai' | 'qr';
/** Pixart's zoom list (its 10 % is under the studio's least). */
const ZOOM_LEVELS = [3, 2, 1.25, 1, 0.75, 0.5, 0.25];
/** The modifier key the shortcuts list names. */
const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl';
/** The desktop's right-hand column, for the pages (Pixart's: 261 px at every width measured). */
const PAGES_COLUMN = 261;
type Phase = 'loading' | 'failed' | 'edit' | 'exporting' | 'proof';

/**
 * The rail, as Pixartprinting's Designer has it (2026-10-07): Designs, Uploads, Texts
 * (adds a text — no panel), Elements, Masks, Backgrounds, and — after a rule — Tools
 * (AI Studio and the QR code).
 */
const RAIL: Array<{ id: Panel; icon: React.ComponentType<{ className?: string; strokeWidth?: number }>; label: TranslationKey; ruleBefore?: boolean }> = [
  { id: 'designs', icon: LayoutTemplate, label: 'stRailDesigns' },
  { id: 'uploads', icon: UploadCloud, label: 'stRailUploads' },
  { id: 'text', icon: Type, label: 'stRailText' },
  { id: 'elements', icon: ElementsGlyph, label: 'stRailElements' },
  { id: 'masks', icon: MasksGlyph, label: 'stRailMasks' },
  { id: 'backgrounds', icon: BackgroundsGlyph, label: 'stRailBackgrounds' },
  { id: 'tools', icon: Sparkles, label: 'stRailTools', ruleBefore: true },
];

export interface DesignStudioProps {
  productId: string;
  trimMm: { wMm: number; hMm: number };
  outline: OutlineKind | null;
  /** "85 × 55 mm" — shown under the title. */
  sizeLabel?: string;
  /** Bleed, safe area, hidden zones, resolution (src/lib/printSpec.ts). */
  spec: PrintSpec;
  /** The pages the product prints (src/lib/printSides.ts); the front alone when unsaid. */
  sides?: SideId[];
  ink?: Partial<Record<SideId, SideInk>>;
  sameOnBothSides?: boolean;
  /** The page's copy of the design from an earlier opening, if any. */
  draft: StudioDraft | null;
  onDraftChange: (draft: StudioDraft) => void;
  onUse: (result: DesignerResult) => void;
  onClose: () => void;
  t: (key: TranslationKey) => string;
  language: Language;
  mode?: Mode;
  /** Where the device draft is kept: studio:<product id> unless given (a basket line, an order line). */
  draftKey?: string;
  /** The shop's templates for this product (undefined while they load, null when the shop could not say). */
  templates?: TemplateSummary[] | null;
  onRetryTemplates?: () => void;
  /** What the gallery chose: a template (a starter in a colour variant), or a blank page; nothing — the customer's own draft. */
  start?: { template: string; variant?: string } | { blank: true } | null;
  /** An admin is looking: say which templates are left out here, and why. */
  showMisses?: boolean;
  /** AI pictures, when the shop has switched them on. */
  aiGenerate?: AiGenerate;
  /** The heading, when not "Design your print". */
  title?: string;
  /** The line's price, said beside the product's name in the header (Pixart's "Info 49,63 €"). */
  priceLabel?: string;
  /** "Want to do it later? Add to basket without the design." — where the line may be designed later. */
  onWithout?: () => void;
  /** His order of every design, the ones he hid, and whether the shop's own are offered — as the gallery shows them. */
  order?: string[];
  hidden?: string[];
  starters?: boolean;
}

function readViewport() {
  const v = typeof window !== 'undefined' ? window.visualViewport : null;
  return v ? { top: v.offsetTop, height: v.height } : { top: 0, height: typeof window !== 'undefined' ? window.innerHeight : 800 };
}

function useNarrow() {
  const query = '(max-width: 767px)';
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setNarrow(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return narrow;
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => window.setTimeout(resolve, 30)));

export default function DesignStudio(props: DesignStudioProps) {
  const {
    productId,
    trimMm,
    outline,
    sizeLabel,
    spec,
    t,
    language,
    mode = 'customer',
    templates,
    onRetryTemplates,
    showMisses = false,
    aiGenerate,
    title,
  } = props;
  const sides: SideId[] = props.sides && props.sides.length ? props.sides : ['front'];
  const owner = mode === 'owner';
  const storeKey = props.draftKey ?? `studio:${productId}`;
  const titleId = useId();
  const narrow = useNarrow();
  useUiFont();
  const inlineText = typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches;
  // A new build out while he designs: no reload under him — the page offers it instead
  // (code review DSN-08).
  useEffect(() => holdReloads(), []);

  const rootRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const [layer, setLayer] = useState<HTMLDivElement | null>(null);
  const [engine, setEngine] = useState<StudioEngine | null>(null);
  const engineRef = useRef<StudioEngine | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  const [phase, setPhase] = useState<Phase>('loading');
  const phaseRef = useRef<Phase>('loading');
  phaseRef.current = phase;
  // Pixart opens on the design itself: no panel until one is asked for.
  const [panel, setPanel] = useState<Panel | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [restoredAt, setRestoredAt] = useState<number | null>(null);
  const [replaceTarget, setReplaceTarget] = useState<FabricObject | null>(null);
  const [cropping, setCropping] = useState<FabricImage | null>(null);
  const [show3d, setShow3d] = useState(false);
  // Pixart's settings: its list of keyboard shortcuts, opened under a link.
  const [showKeys, setShowKeys] = useState(false);
  const [editingQr, setEditingQr] = useState<RxQr | null>(null);
  // The phone's text sheet: which words it types into, and a new sheet (its own key) each
  // time it opens — it kept the first text's words and wrote them into the next one.
  const [textSheet, setTextSheet] = useState<{ o: Textbox; n: number } | null>(null);
  const sheetSeq = useRef(0);
  const openTextSheet = useCallback((o: Textbox) => setTextSheet({ o, n: (sheetSeq.current += 1) }), []);
  // A start that could not finish (fonts, or the shop's pictures for his design): tried
  // again in place — never by reloading the page, which lost the product's choices.
  const [bootAttempt, setBootAttempt] = useState(0);
  // Typing in a panel on a phone (the QR or contact form, the AI's words, a search):
  // the keyboard leaves about 400 px, and the bars kept 224 of them — the form had 50.
  const [panelTyping, setPanelTyping] = useState(false);
  // Room the floating controls take (Pixart's layout): the board fits in the rest.
  // Desktop, measured on Pixart's own at 1280, 1440 and 1920 px: the board's top is
  // 126 px under the header and its foot 110 px over the window's, it is centred
  // between the rail and a 261 px column for the pages, with 84 px beside it at most.
  useEffect(() => {
    if (!engine) return;
    engine.setCompact(narrow);
    // Phone: 32 px each side and the board in the middle, as Pixart's at 390 px.
    engine.setInsets(narrow ? { top: 104, right: 32, bottom: 104, left: 32, pad: 0 } : { top: 126, right: PAGES_COLUMN + 84, bottom: 110, left: 84, pad: 0 });
  }, [engine, narrow]);
  // Pixart's ⓧ over the pages hides them (and its stacked pages bring them back).
  const [pagesShown, setPagesShown] = useState(true);
  // The AI request outlives its panel: closed and reopened, Generate stays off until it ends.
  const [aiRequest, setAiRequest] = useState<AiRequest>(AI_IDLE);

  // EVERY PAGE'S PICTURE in the pages column, as Pixart shows them — not only the ones
  // visited: a side the board has not shown is drawn from the design itself.
  const [sideThumbs, setSideThumbs] = useState<Partial<Record<SideId, string>>>({});
  const docVersion = engine ? engine.getVersion() : -1;
  useEffect(() => {
    if (!engine || sides.length < 2 || phase !== 'edit') return;
    let alive = true;
    const timer = window.setTimeout(() => {
      for (const scene of engine.printScenes({ flush: false })) {
        if (scene.id === engine.side) continue;
        const json = JSON.stringify(scene.json);
        void sideThumb(`page|${scene.id}|${json.length}|${json.slice(0, 64)}|${json.slice(-64)}`, json, trimMm, spec.bleedMm, 220)
          .then((url) => alive && setSideThumbs((cur) => (cur[scene.id] === url ? cur : { ...cur, [scene.id]: url })))
          .catch(() => {});
      }
    }, 700);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, phase, sides.length, engine?.side, Math.floor(docVersion / 25)]);

  // A panel closed with a field still focused never blurs it (it is simply gone).
  useEffect(() => {
    if (!panel) setPanelTyping(false);
  }, [panel]);
  const [failure, setFailure] = useState<'fonts' | 'pictures'>('fonts');
  const freshStartRef = useRef(false);
  const [proof, setProof] = useState<ProofData | null>(null);
  const [checked, setChecked] = useState(false);
  const [progress, setProgress] = useState(0);
  const [confirmClose, setConfirmClose] = useState(false);
  const [deviceSaveFailed, setDeviceSaveFailed] = useState(false);
  // When the design was last kept on this device: Save's dot is green after it.
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [dropping, setDropping] = useState(false);
  const [vv, setVv] = useState(readViewport);
  const attachingRef = useRef(false);
  const closeWarningRef = useRef<HTMLDivElement>(null);

  // Re-render on every change the engine reports.
  useSyncExternalStore(
    useCallback((fn: () => void) => engine?.subscribe(fn) ?? (() => {}), [engine]),
    () => engine?.getVersion() ?? -1,
  );

  // The sheet types into ONE text. Gone from the board (Undo, another page, deleted):
  // it closes, keeping nothing. Another object chosen: what was typed is kept, then it
  // closes.
  useEffect(() => {
    if (!textSheet || !engine) return;
    if (!engine.canvas?.getObjects().includes(textSheet.o)) setTextSheet(null);
    else if (engine.selected && engine.selected !== textSheet.o) {
      engine.commit();
      setTextSheet(null);
    }
  });

  const sideLabel = useCallback(
    (s: SideId) => (props.sameOnBothSides ? t('stBothSidesSame') : s === 'back' ? t('stBack') : t('stFront')),
    [props.sameOnBothSides, t],
  );

  // ---- the engine, the canvas, and what the design starts from --------------------------
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let alive = true;
    const e = new StudioEngine(
      {
        mode,
        trimMm: { wMm: trimMm.wMm, hMm: trimMm.hMm },
        outline,
        spec,
        sides,
        labels: { hidden: t('stGuideHidden'), photoHere: t('dsgPhotoHere'), cut: t('stGuideCutChip'), safe: t('stGuideSafeChip') },
        compact: narrow,
        inlineText,
        onAutosave: (doc, pictures, uploads) => {
          const savedAt = Date.now();
          const json = serializeDesignDoc(doc);
          const draft: StudioDraft = { doc: json, images: pictures, uploads, trimMm: { wMm: trimMm.wMm, hMm: trimMm.hMm }, bleedMm: spec.bleedMm, savedAt };
          propsRef.current.onDraftChange(draft);
          void saveDraft(
            { key: storeKey, json, imageIds: Object.keys(pictures), trimMm: draft.trimMm, savedAt, template: doc.template, v: 2, bleedMm: spec.bleedMm, uploads },
            pictures,
          ).then((ok) => {
            if (!alive) return;
            setDeviceSaveFailed(!ok);
            if (ok) setSavedAt(savedAt);
          });
        },
        // A tap on something the shop fixed says so — and stops saying it at the next
        // tap anywhere else (it stood over the very text he then picked to change).
        onTap: (locked) => {
          const fixed = t('dsgFixedByShop');
          if (locked) setNotice(fixed);
          else setNotice((cur) => (cur === fixed ? null : cur));
        },
        // Never on words the shop fixed (a mouse's double click reached them).
        onTextEditRequest: (o) => {
          if (mode === 'customer' && (o as Tagged).rxLock === 'locked') return;
          openTextSheet(o);
        },
      },
      blankDesignDoc(sides),
    );
    e.mount(host);
    engineRef.current = e;
    setEngine(e);
    // The local test suites drive the board through its engine (never in a production build).
    if (import.meta.env.DEV) (window as unknown as { __rxStudio?: StudioEngine }).__rxStudio = e;

    const boot = async () => {
      setPhase('loading');
      const { failed } = await ensureFontFamilies([]);
      if (!alive) return;
      if (failed.length) {
        setFailure('fonts');
        setPhase('failed');
        return;
      }
      const start = freshStartRef.current ? { blank: true as const } : propsRef.current.start ?? null;
      let doc: DesignDoc | null = null;
      let pictures: Record<string, Blob> = {};
      let from: BoardGeometry | null = null;
      let uploads: string[] = [];
      let restored: number | null = null;
      let fromTemplate: { id: string; variant?: string } | null = null;

      if (start && 'template' in start) {
        fromTemplate = { id: start.template, variant: start.variant };
      } else if (!(start && 'blank' in start)) {
        // The customer's own design: the page's copy, else this device's (a studio
        // draft, else one from the round-16 designer for this product).
        let saved: { doc: DesignDoc | null; images: Record<string, Blob>; trimMm: { wMm: number; hMm: number }; bleedMm: number; uploads: string[]; savedAt: number } | null = null;
        const page = propsRef.current.draft;
        if (page) {
          saved = { doc: parseDesignDoc(page.doc), images: page.images, trimMm: page.trimMm, bleedMm: page.bleedMm, uploads: page.uploads, savedAt: page.savedAt };
        } else {
          const stored = (await loadDraft(storeKey)) ?? (await loadDraft(productId));
          if (!alive) return;
          if (stored) {
            const parsed = parseDesignDoc(stored.json);
            // A round-16 draft names its template at the top of the JSON.
            const template = parsed?.template ?? (stored.template as Record<string, unknown> | null) ?? null;
            saved = {
              doc: parsed ? { ...parsed, template } : null,
              images: stored.images,
              trimMm: stored.trimMm,
              bleedMm: typeof stored.bleedMm === 'number' ? stored.bleedMm : DESIGN_BLEED_MM,
              uploads: stored.uploads ?? [],
              savedAt: stored.savedAt,
            };
            restored = stored.savedAt;
          }
        }
        if (saved?.doc) {
          const meta = saved.doc.template as unknown as (TemplateMeta & { starter?: boolean }) | null;
          // Made from a template that does not fit this size: refitting would stretch
          // the shop's locked layout. Choose again. (A starter has no locked layout:
          // it is the customer's design now, refitted like any other.)
          if (meta && !meta.starter && !owner && templateMiss(meta, trimMm, outline) !== null) {
            setNotice(t('dsgTemplateOtherSize'));
          } else {
            doc = saved.doc;
            pictures = saved.images;
            from = { trimMm: saved.trimMm, bleedMm: saved.bleedMm };
            uploads = saved.uploads;
            // The shop's pictures the device no longer holds are fetched again.
            const missing = designImageIds(doc).filter((id) => !(pictures[id] instanceof Blob));
            if (meta && !meta.starter && missing.length > 0) {
              const full = await fetchTemplateFull(meta.id);
              const want = full ? Object.fromEntries(missing.filter((id) => full.images[id]).map((id) => [id, full.images[id]])) : {};
              const got = Object.keys(want).length > 0 ? await fetchPictures(want) : {};
              if (!alive) return;
              if (got) pictures = { ...pictures, ...got };
              // NO ANSWER IS NOT "GONE". The shop's copy could not be had (a dropped
              // connection): starting would set his design aside for a blank page, and
              // the next change would save that over his draft. Wait — and offer to retry.
              if (!full || !got) {
                setFailure('pictures');
                setPhase('failed');
                return;
              }
            }
          }
        }
      }

      if (!alive) return;
      let result = await e.start(doc ?? blankDesignDoc(sides), pictures, from, uploads);
      if (!alive) return;
      if (doc?.template && result.lockedLost && !owner) {
        // A piece the shop locked did not come back: his print would go out without it.
        await e.start(blankDesignDoc(sides), {}, null, uploads);
        result = { lost: 0, lockedLost: false };
        setNotice(t('dsgTemplateRestoreFailed'));
        restored = null;
      } else if (result.lost > 0) {
        setNotice(t('dsgPicturesLost'));
      }
      if (doc && restored) setRestoredAt(restored);
      if (fromTemplate) {
        const ok = await applyTemplate(e, fromTemplate.id, { initial: true, variant: fromTemplate.variant });
        if (!alive) return;
        if (!ok) setNotice(t('dsgTemplateFailed'));
      }
      setPhase('edit');
    };
    void boot();

    return () => {
      alive = false;
      e.flush();
      engineRef.current = null;
      e.dispose();
    };
    // Mounted once (and again only for "Try again"): the page closes and reopens the
    // studio for a new size or product.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootAttempt]);

  // The canvas follows its area.
  useLayoutEffect(() => {
    const area = hostRef.current;
    if (!area || !engine) return;
    const ro = new ResizeObserver(() => engine.resize(area.clientWidth, area.clientHeight));
    ro.observe(area);
    return () => ro.disconnect();
  }, [engine]);

  // The dialog follows the VISIBLE viewport: with the keyboard up, it shrinks above it.
  useEffect(() => {
    const v = window.visualViewport;
    if (!v) return;
    const on = () => setVv(readViewport());
    v.addEventListener('resize', on);
    v.addEventListener('scroll', on);
    return () => {
      v.removeEventListener('resize', on);
      v.removeEventListener('scroll', on);
    };
  }, []);

  useEffect(() => {
    if (confirmClose) closeWarningRef.current?.focus();
  }, [confirmClose]);

  // ---- templates ---------------------------------------------------------------------------------
  /** A frame's "Your photo here" in the CUSTOMER's language; a words-only text's box as the shop drew it. */
  const prepareTemplateSide = useCallback(
    (c: { getObjects(): FabricObject[]; requestRenderAll(): void }) => {
      for (const o of c.getObjects()) {
        if ((o as Tagged).rxSlot && o instanceof Group) {
          for (const child of o.getObjects()) {
            if (child instanceof Textbox) {
              child.set('text', t('dsgPhotoHere'));
              child.initDimensions();
            }
          }
          o.set('dirty', true);
        }
        if (o instanceof Textbox && (o as Tagged).rxLock === 'words' && !(o as Tagged).rxBox) {
          (o as Tagged).rxBox = { w: o.width, h: o.height, fontSize: o.fontSize };
        }
      }
      c.requestRenderAll();
    },
    [t],
  );

  /** One of the shop's templates onto the pages — every picture, or nothing; or one of its starters, built here. */
  const applyTemplate = async (e: StudioEngine, id: string, { initial = false, variant }: { initial?: boolean; variant?: string } = {}): Promise<boolean> => {
    try {
      if (isStarterId(id)) {
        const def = starterById(id);
        const doc = def
          ? starterDoc(
              id,
              variant,
              { trimMm: { wMm: trimMm.wMm, hMm: trimMm.hMm }, bleedMm: spec.bleedMm, outline, safeMm: spec.safeMm, hiddenMm: spec.hiddenMm, sides, words: starterWords(t) },
              t(def.labelKey as TranslationKey),
            )
          : null;
        if (!doc) return false;
        await e.replaceDoc(doc, {}, null, { prepare: prepareTemplateSide });
        if (initial) e.resetHistory();
        setRestoredAt(null);
        return true;
      }
      const full = await fetchTemplateFull(id);
      if (!full || templateMiss(full, trimMm, outline) !== null) return false;
      const pictures = await fetchPictures(full.images);
      if (!pictures) return false;
      const parsed = parseDesignDoc(full.json);
      if (!parsed) return false;
      const meta: TemplateMeta = {
        id: full.id,
        name: full.name,
        trimMm: full.trimMm,
        outline: full.outline,
        lowestPictureDpi: full.lowestPictureDpi,
        lockBackground: full.lockBackground,
      };
      const bleed = typeof (full as { bleedMm?: unknown }).bleedMm === 'number' ? Number((full as { bleedMm?: number }).bleedMm) : DESIGN_BLEED_MM;
      await e.replaceDoc({ ...parsed, template: meta as unknown as Record<string, unknown> }, pictures, { trimMm: full.trimMm, bleedMm: bleed }, { prepare: prepareTemplateSide });
      if (initial) e.resetHistory();
      setRestoredAt(null);
      return true;
    } catch {
      return false;
    }
  };

  const pickTemplate = async (summary: { id: string }, variant?: string) => {
    const e = engineRef.current;
    if (!e || e.busy) return;
    setNotice(null);
    const ok = await applyTemplate(e, summary.id, { variant });
    if (!ok) setNotice(t('dsgTemplateFailed'));
    else if (narrow) setPanel(null);
  };

  const startBlank = async () => {
    const e = engineRef.current;
    if (!e || e.busy) return;
    await e.replaceDoc(blankDesignDoc(sides), {}, null);
    setRestoredAt(null);
    if (narrow) setPanel(null);
  };

  // ---- the print file and the hand-over ----------------------------------------------------
  const makeProof = async () => {
    const e = engineRef.current;
    if (!e || e.busy || phaseRef.current !== 'edit') return;
    e.flush();
    if (e.canvas?.getActiveObject() instanceof Textbox && (e.canvas.getActiveObject() as Textbox).isEditing) (e.canvas.getActiveObject() as Textbox).exitEditing();
    e.canvas?.discardActiveObject();
    const scenes = e.printScenes();
    if (!scenes.some((s) => s.inked)) {
      setNotice(t('dsgEmpty'));
      return;
    }
    setNotice(null);
    setProgress(0);
    setPhase('exporting');
    await nextFrame();
    try {
      const families = scenes.flatMap((s) => sideFontFamilies(JSON.stringify(s.json)));
      const { failed } = await ensureFontFamilies(families);
      if (failed.length) throw new PrintFileError('fonts');
      await document.fonts.ready;
      const pngSize = designExportSize(trimMm, { bleedMm: spec.bleedMm, targetDpi: spec.targetDpi, minDpi: spec.minDpi });
      // A side printed in black or greys only is made — and shown — in greys.
      const greyOf = (id: SideId) => props.ink?.[id] === 'black' || props.ink?.[id] === 'greyscale';
      let data: Omit<ProofData, 'lowestDpi' | 'textOutside' | 'edgeAtCut' | 'qrWeak' | 'blank' | 'emptySlots'>;
      if (scenes.length === 1 && pngSize.kind === 'ok' && pngSize.dpi >= spec.targetDpi) {
        const scene = scenes[0];
        const objects = (scene.json.objects as Array<Record<string, unknown>>) ?? [];
        const r = await exportDesign({
          json: scene.json,
          unitsPerMm: U,
          trimMm: { wMm: trimMm.wMm, hMm: trimMm.hMm },
          size: pngSize,
          hasPhotos: objects.some((o) => String(o.type).toLowerCase() === 'image'),
          inkExpected: true,
          grey: greyOf(scene.id),
        });
        data = { file: r.file, previews: [{ side: scene.id, file: r.preview }], dpi: pngSize.dpi, format: 'png', pages: 1, widthPx: r.widthPx, heightPx: r.heightPx };
      } else {
        const r = await makePrintPdf({
          sides: scenes.map((s) => ({ id: s.id, json: s.json, grey: greyOf(s.id) })),
          trimMm: { wMm: trimMm.wMm, hMm: trimMm.hMm },
          spec,
          unitsPerMm: U,
          fileName: (dpi, pages) => designPdfFileName(trimMm, { dpi, bleedMm: spec.bleedMm, pages }),
          onProgress: (done, total) => setProgress(Math.round((done / Math.max(1, total)) * 100)),
        });
        data = { file: r.file, previews: r.previews.map((p) => ({ side: p.id, file: p.file })), dpi: r.dpi, format: 'pdf', pages: scenes.length };
      }
      setProof({
        ...data,
        lowestDpi: e.lowestPictureDpi(),
        textOutside: e.textNearEdge(),
        edgeAtCut: e.edgeAtCutSides(),
        qrWeak: e.weakQrSides(),
        blank: scenes.filter((s) => !s.inked).map((s) => s.id),
        emptySlots: scenes.reduce((n, s) => n + s.emptySlots, 0),
      });
      setChecked(false);
      setPhase('proof');
    } catch (err) {
      console.warn('The print file could not be made:', err);
      const reason = err instanceof PrintFileError ? err.reason : null;
      setNotice(t(reason === 'too-large' ? 'stProofTooLarge' : reason === 'fonts' ? 'stProofFonts' : 'dsgExportFailed'));
      setPhase('edit');
    }
  };

  const attach = () => {
    const e = engineRef.current;
    if (!e || !proof || !checked || attachingRef.current) return;
    attachingRef.current = true;
    e.dirty = false;
    e.saveNow();
    const meta = e.template as unknown as TemplateMeta | null;
    props.onUse({
      file: proof.file,
      preview: proof.previews[0].file,
      previews: proof.previews,
      sides,
      format: proof.format,
      trimMm: { wMm: trimMm.wMm, hMm: trimMm.hMm },
      outline,
      bleedMm: spec.bleedMm,
      dpi: proof.dpi,
      lowestImageDpi: proof.lowestDpi,
      template: meta?.id ? { id: meta.id, name: meta.name } : null,
    });
  };

  // ---- leaving ----------------------------------------------------------------------------------------
  const requestClose = () => {
    const e = engineRef.current;
    if (phaseRef.current === 'exporting' || attachingRef.current) return;
    if (e?.dirty && (phaseRef.current === 'edit' || phaseRef.current === 'proof')) {
      setConfirmClose(true);
      return;
    }
    e?.flush();
    props.onClose();
  };
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;
  // A layer over the board (3D, the cropper, the phone's text sheet) has the keyboard:
  // read by the handler below, which was registered first and so heard every key first.
  const layerOpenRef = useRef({ sheet: false, other: false });
  layerOpenRef.current = { sheet: !!textSheet, other: show3d || !!cropping };
  const closeSheetRef = useRef<() => void>(() => {});
  closeSheetRef.current = () => {
    engineRef.current?.commit();
    setTextSheet(null);
  };
  // What a screen reader says when Tab chooses an object on the board: its name, and
  // where it is among the page's objects.
  const [announce, setAnnounce] = useState('');
  const announceRef = useRef<(chosen: { o: FabricObject; index: number; count: number }) => void>(() => {});
  announceRef.current = ({ o, index, count }) => {
    const kind = kindOf(o);
    const element = kind === 'element' ? ELEMENTS.find((x) => x.id === (o as Tagged).rxElement?.id) : undefined;
    const name =
      kind === 'text'
        ? `${t('dsgTextField')}: ${String((o as Textbox).text ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)}`
        : kind === 'image'
          ? t('dsgAddPhoto')
          : kind === 'qr'
            ? t('stRailQr')
            : kind === 'slot'
              ? t('stPhotoFrameSquare')
              : element
                ? elementLabel(element, language)
                : t('stShape');
    setAnnounce(t('stKeyChosen').replace('{0}', name).replace('{1}', String(index + 1)).replace('{2}', String(count)));
  };

  // Escape, Tab, and the keyboard's shortcuts — never while typing.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    rootRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (ev: KeyboardEvent) => {
      const e = engineRef.current;
      const active = e?.canvas?.getActiveObject();
      const editingText = active instanceof Textbox && active.isEditing;
      // THE LAYER ON TOP FIRST. 3D, the cropper and a popover listen for keys too, but
      // this handler was registered first and heard them first: Escape in the 3D view
      // closed the whole designer, Delete in the cropper removed the picture being
      // cropped. While one is open, the board does nothing with the keyboard.
      const popoverOpen = !!document.querySelector('[role="dialog"][data-rx-st-popover]');
      const layer = layerOpenRef.current;
      // Tab walks the layer on top only.
      const topLayer = layer.other ? rootRef.current?.querySelector<HTMLElement>('[data-rx-st-layer]:not([data-rx-st-textsheet])') ?? null : null;
      if (ev.key === 'Tab' && topLayer) {
        ev.stopPropagation();
        const inLayer = Array.from(
          topLayer.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'),
        ).filter((el) => el.offsetParent !== null);
        if (inLayer.length === 0) {
          ev.preventDefault();
          return;
        }
        const current = document.activeElement as HTMLElement | null;
        const first = inLayer[0];
        const last = inLayer[inLayer.length - 1];
        if (!current || !topLayer.contains(current) || current === topLayer) {
          ev.preventDefault();
          (ev.shiftKey ? last : first).focus();
        } else if (ev.shiftKey && current === first) {
          ev.preventDefault();
          last.focus();
        } else if (!ev.shiftKey && current === last) {
          ev.preventDefault();
          first.focus();
        }
        return;
      }
      if (layer.sheet || layer.other || popoverOpen) {
        // The phone's text sheet has no key of its own: Escape is its Done.
        if (ev.key === 'Escape' && layer.sheet && !layer.other && !popoverOpen) {
          ev.stopPropagation();
          ev.preventDefault();
          closeSheetRef.current();
        }
        return;
      }
      const target = ev.target as HTMLElement | null;
      const inField = !!target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable);
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        ev.preventDefault();
        // In a field (a search box, the AI's words, a QR address): Escape leaves the
        // field — it closed the whole designer. Marked while it loses the focus: a box
        // that applies when it is left (the sizes, Toolbars.tsx) puts back what it
        // showed instead — Escape applied the number typed (second pass #4).
        if (inField) {
          target!.setAttribute('data-rx-escaping', '');
          target!.blur();
          target!.removeAttribute('data-rx-escaping');
          return;
        }
        if (editingText) (active as Textbox).exitEditing();
        else if (active && phaseRef.current === 'edit') {
          e?.canvas?.discardActiveObject();
          e?.canvas?.requestRenderAll();
        } else if (phaseRef.current === 'proof') setPhase('edit');
        else requestCloseRef.current();
        return;
      }
      // THE BOARD HAS THE KEYBOARD: Tab and Shift+Tab choose its objects one by one, in
      // stacking order; past the last (or the first) Tab leaves the board as usual, the
      // object chosen last still chosen. Enter goes to that object's tools.
      const boardFocused = !!target && target === hostRef.current && !!e && phaseRef.current === 'edit';
      if (boardFocused && ev.key === 'Tab') {
        const chosen = e.chooseNext(ev.shiftKey ? -1 : 1);
        if (chosen) {
          ev.preventDefault();
          ev.stopPropagation();
          announceRef.current(chosen);
          return;
        }
      }
      if (boardFocused && ev.key === 'Enter' && active) {
        const tool = rootRef.current?.querySelector<HTMLElement>('[data-rx-st-toolbar] button:not([disabled]), [data-rx-st-toolbar] input:not([disabled])');
        if (tool) {
          ev.preventDefault();
          tool.focus();
          return;
        }
      }
      if (ev.key === 'Tab') {
        const root = rootRef.current;
        if (!root) return;
        ev.stopPropagation();
        const focusable = Array.from(
          root.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'),
        ).filter((el) => el.offsetParent !== null || el === document.activeElement);
        if (focusable.length === 0) {
          ev.preventDefault();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const current = document.activeElement as HTMLElement | null;
        if (!current || !root.contains(current) || current === root) {
          ev.preventDefault();
          (ev.shiftKey ? last : first).focus();
        } else if (ev.shiftKey && current === first) {
          ev.preventDefault();
          last.focus();
        } else if (!ev.shiftKey && current === last) {
          ev.preventDefault();
          first.focus();
        }
        return;
      }
      if (inField || editingText || !e || phaseRef.current !== 'edit') return;
      const mod = ev.metaKey || ev.ctrlKey;
      const key = ev.key.toLowerCase();
      if ((ev.key === 'Delete' || ev.key === 'Backspace') && active) {
        ev.preventDefault();
        e.remove(active);
      } else if (mod && key === 'z') {
        ev.preventDefault();
        void (ev.shiftKey ? e.redo() : e.undo());
      } else if (mod && key === 'y') {
        ev.preventDefault();
        void e.redo();
      } else if (mod && key === 'd' && active) {
        ev.preventDefault();
        void e.duplicate(active);
      } else if (mod && (key === '=' || key === '+')) {
        ev.preventDefault();
        e.zoomStep(1);
      } else if (mod && key === '-') {
        ev.preventDefault();
        e.zoomStep(-1);
      } else if (mod && key === '0') {
        ev.preventDefault();
        e.fit();
      } else if (active && ev.key.startsWith('Arrow') && !e.fixedSelected) {
        ev.preventDefault();
        const step = (ev.shiftKey ? 10 : 1) * U;
        const dx = ev.key === 'ArrowLeft' ? -step : ev.key === 'ArrowRight' ? step : 0;
        const dy = ev.key === 'ArrowUp' ? -step : ev.key === 'ArrowDown' ? step : 0;
        active.set({ left: active.left + dx, top: active.top + dy });
        active.setCoords();
        e.canvas?.requestRenderAll();
        e.commitSoon();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = previousOverflow;
      const back = opener && opener.isConnected ? opener : document.querySelector<HTMLElement>('[data-rx-designer-step]');
      back?.focus?.();
    };
  }, []);

  // ---- dropping pictures on the board -----------------------------------------------------------
  const onDrop = async (ev: React.DragEvent) => {
    const e = engineRef.current;
    setDropping(false);
    if (!e || phaseRef.current !== 'edit') return;
    const id = ev.dataTransfer.getData(PICTURE_DRAG_TYPE);
    const files = Array.from(ev.dataTransfer.files ?? []);
    if (!id && files.length === 0) return;
    ev.preventDefault();
    const host = hostRef.current;
    if (!host) return;
    const r = host.getBoundingClientRect();
    const at = e.boardPointAt(ev.clientX - r.left, ev.clientY - r.top);
    let pictureId = id;
    if (!pictureId) {
      const { ids, problems } = await takePictures(files, e, { owner });
      if (problems.length) setNotice(problems.map((k) => t(k)).join(' '));
      pictureId = ids[0] ?? '';
    }
    if (!pictureId) return;
    const target = e.objectAt(at);
    const kind = kindOf(target);
    if (target && (kind === 'image' || kind === 'slot') && !(e.opts.mode === 'customer' && (target as Tagged).rxLock)) await e.replacePicture(target, pictureId);
    else await e.addPicture(pictureId, at);
  };

  // ---- what the screen shows -------------------------------------------------------------------------
  const e = engine;
  const selected = e?.selected ?? null;
  const ink = props.ink?.[e?.side ?? 'front'];
  const palette = paletteFor(ink);
  const twoSided = sides.length > 1;
  const zoomPct = Math.round((e?.zoom ?? 1) * 100);
  // From the rail a panel ADDS: the code or picture an earlier "Update"/"Replace" was
  // for is forgotten (the QR rail reopened in Update mode for good — no second code).
  // Made once per size: a new object on every render re-drew every starter picture in
  // the Designs panel at each keystroke, nudge and pinch.
  const starterCtx = React.useMemo(
    () => ({ trimMm: { wMm: trimMm.wMm, hMm: trimMm.hMm }, bleedMm: spec.bleedMm, outline, safeMm: spec.safeMm, hiddenMm: spec.hiddenMm, sides: ['front'] as SideId[], words: starterWords(t) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trimMm.wMm, trimMm.hMm, spec.bleedMm, spec.safeMm, JSON.stringify(spec.hiddenMm), outline, t],
  );
  const openPanel = (p: Panel) => {
    setPanelTyping(false);
    setEditingQr(null);
    setReplaceTarget(null);
    if (p === 'text') {
      // Pixart's "Texts": a text on the page at once, chosen — no panel. Its new text is
      // Montserrat, 14 pt on a business card: 9 % of the short side, as our headings.
      setPanel(null);
      if (e && !e.busy) void e.addText('body', t('stTextNew'), { family: 'RX Montserrat', scale: 0.09 / 0.035 });
      return;
    }
    setPanel((cur) => (cur === p ? null : p));
  };
  // …and one no longer on the board (deleted, undone, another page) is not a target.
  const onBoard = (o: FabricObject | null) => !!o && !!e?.canvas?.getObjects().includes(o);
  const closePanelOnPhone = () => {
    if (narrow) setPanel(null);
  };
  const onReplace = (o: FabricObject) => {
    setReplaceTarget(o);
    setPanel('uploads');
  };
  const onEditQr = (o: RxQr) => {
    setEditingQr(o);
    setPanel('qr');
  };

  const panelBody = e && panel && (
    <>
      {panel === 'designs' && (
        <DesignsPanel
          t={t}
          language={language}
          templates={templates}
          designs={offeredDesigns({
            templates,
            fits: (x) => templateMiss(x, trimMm, outline) === null,
            starters: startersFor(spec.kind),
            startersOn: props.starters !== false,
            hidden: props.hidden,
            order: props.order,
          })}
          starterCtx={starterCtx}
          trimMm={trimMm}
          outline={outline}
          showMisses={showMisses}
          busy={e.busy}
          onRetry={onRetryTemplates}
          onPick={(x, variant) => void pickTemplate(x, variant)}
          onBlank={() => void startBlank()}
        />
      )}
      {panel === 'uploads' && (
        <UploadsPanel
          engine={e}
          t={t}
          owner={owner}
          replaceTarget={onBoard(replaceTarget) ? replaceTarget : null}
          onReplaced={() => setReplaceTarget(null)}
          onNotice={setNotice}
          onDone={closePanelOnPhone}
        />
      )}
      {panel === 'elements' && <ElementsPanel engine={e} t={t} language={language} onDone={closePanelOnPhone} />}
      {panel === 'masks' && <MasksPanel engine={e} t={t} onDone={closePanelOnPhone} />}
      {panel === 'backgrounds' && <BackgroundsPanel engine={e} t={t} />}
      {panel === 'tools' && <ToolsPanel t={t} ai={!!aiGenerate} onOpen={(tool) => setPanel(tool)} />}
      {panel === 'ai' && <AiPanel engine={e} t={t} generate={aiGenerate} request={aiRequest} onRequest={setAiRequest} onDone={closePanelOnPhone} />}
      {panel === 'qr' && <QrPanel engine={e} t={t} editing={onBoard(editingQr) ? editingQr : null} onDone={closePanelOnPhone} />}
    </>
  );
  const panelTitle = panel ? (panel === 'ai' ? t('stRailAi') : panel === 'qr' ? t('stToolQrTitle') : t(RAIL.find((r) => r.id === panel)!.label)) : '';
  // AI Studio and the QR code are Tools' own panels: their header leads back to Tools.
  const panelBack = panel === 'ai' || panel === 'qr' ? () => setPanel('tools') : null;
  const sideIndex = Math.max(0, sides.indexOf(e?.side ?? sides[0]));
  const toPage = (i: number) => {
    const s = sides[Math.min(sides.length - 1, Math.max(0, i))];
    if (e && s) void e.showSide(s);
  };
  const savePending = !!e && (e.savePending || deviceSaveFailed || (savedAt === null && e.canUndo));
  const fromTemplate = !!(e?.template as { id?: unknown } | null)?.id;
  // Where the board is on screen (every view change re-renders): what Pixart lines up with it.
  const boardBox = e?.boardOnScreen() ?? null;

  // ---- Pixart's pieces ----------------------------------------------------------------
  const helpButton = (
    <PopoverButton
      label={t('stHelp')}
      testId="help"
      width={300}
      trigger={<HelpCircle className="w-[1.1875rem] h-[1.1875rem] text-[#1174ba]" strokeWidth={2} />}
    >
      {() => (
        <div className="space-y-2.5 text-[0.8125rem] leading-snug text-[#1d1d1d]">
          <p className="flex gap-2"><span className="mt-1 w-3 h-3 shrink-0 rounded-full bg-[#ff00ff]" />{t('stHelpCut')}</p>
          <p className="flex gap-2"><span className="mt-1 w-3 h-3 shrink-0 rounded-full bg-[#82e955]" />{t('stHelpSafe')}</p>
          <p className="flex gap-2"><span className="mt-1 w-3 h-3 shrink-0 rounded-full bg-[#d1d5db]" />{t('stHelpBleed')}</p>
        </div>
      )}
    </PopoverButton>
  );
  const saveButton = !owner && e && (
    <button
      type="button"
      onClick={() => {
        e.flush();
        setSavedAt(Date.now());
      }}
      title={t(savePending ? 'stUnsavedHint' : 'stSavedHint')}
      data-rx-st-save
      className="shrink-0 inline-flex items-center gap-2 text-[0.9375rem] font-bold text-[#0b77c4]"
    >
      {t('stSave')}
      <span className={cn('w-4 h-4 rounded-full', savePending ? 'bg-[#f7cd1b]' : 'bg-[#2ea512]')} aria-hidden="true" />
    </button>
  );
  const continueButton = !owner && phase === 'edit' && e && (
    <button
      type="button"
      onClick={() => void makeProof()}
      disabled={e.busy}
      data-rx-designer-use
      className={cn(
        'shrink-0 inline-flex items-center justify-center rounded-full font-bold text-white bg-[#2ea512] hover:bg-[#28910f] shadow-sm disabled:opacity-50',
        narrow ? 'px-2.5 h-[1.6875rem] text-[0.875rem]' : 'px-6 h-8 text-[0.9375rem]',
      )}
    >
      {t('stNext')}
    </button>
  );
  const laterLink = props.onWithout && (
    <div className="hidden lg:block text-right leading-tight">
      <p className="text-[0.8125rem] text-[#1d1d1d]">{t('stLaterQuestion')}</p>
      <button type="button" onClick={props.onWithout} data-rx-st-without className="text-[0.8125rem] font-bold text-[#0b77c4] underline underline-offset-2">
        {t('stLaterLink')}
      </button>
    </div>
  );
  const settingsButton = e && (
    // Pixart's: "Settings" and its ×, a switch per line (the guides, the ruler), then its
    // keyboard shortcuts under a link. (A phone has no ruler and no zoom bar: "fit" here.)
    <PopoverButton label={t('stSettings')} testId="settings" width={280} icon={Settings}>
      {(close) => (
        <div className="px-2 pb-1" data-rx-st-settings>
          <div className="flex items-center justify-between">
            <span className="text-[0.9375rem] font-bold text-[#1d1d1d]">{t('stSettings')}</span>
            <button type="button" onClick={close} aria-label={t('dsgClose')} className="w-8 h-8 -mr-2 flex items-center justify-center text-[#1174ba]" data-rx-st="settings-close">
              <X className="w-4 h-4" strokeWidth={1.8} />
            </button>
          </div>
          <SwitchRow label={t('stShowGuides')} on={!e.preview} onChange={() => e.setPreview(!e.preview)} testId="preview" />
          {!narrow && <SwitchRow label={t('stRulers')} on={e.rulers} onChange={() => e.setRulers(!e.rulers)} testId="rulers" />}
          {narrow ? (
            <button
              type="button"
              onClick={() => {
                e.fit();
                close();
              }}
              className="w-full flex items-center gap-2 py-4 text-[0.9375rem] text-[#1d1d1d]"
              data-rx-st="zoom-fit"
            >
              <Maximize2 className="w-4 h-4 text-[#1174ba]" />
              {t('stZoomFit')}
            </button>
          ) : (
            <>
              <button type="button" onClick={() => setShowKeys((v) => !v)} aria-expanded={showKeys} className="mt-4 mb-1 text-[0.9375rem] text-[#1d1d1d] underline underline-offset-2" data-rx-st="keys">
                {t('stShortcuts')}
              </button>
              {showKeys && (
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[0.75rem] text-[#1d1d1d]" data-rx-st-keys>
                  {(
                    [
                      [`${MOD} Z`, t('dsgUndo')],
                      [`${MOD} ⇧ Z`, t('dsgRedo')],
                      [`${MOD} D`, t('dsgDuplicate')],
                      ['Delete', t('dsgDelete')],
                      ['Tab / ⇧ Tab', t('stKeyCycle')],
                      ['← ↑ → ↓', t('stKeyMove')],
                      [`${MOD} + / −`, `${t('stZoomIn')} / ${t('stZoomOut')}`],
                      [`${MOD} 0`, t('stZoomFit')],
                    ] as const
                  ).map(([k, v]) => (
                    <React.Fragment key={k}>
                      <dt className="font-bold whitespace-nowrap">{k}</dt>
                      <dd>{v}</dd>
                    </React.Fragment>
                  ))}
                </dl>
              )}
            </>
          )}
        </div>
      )}
    </PopoverButton>
  );
  const pageThumb = (s: SideId, i: number, size: string) => (
    <button
      key={s}
      type="button"
      role="tab"
      aria-selected={e?.side === s}
      onClick={() => e && void e.showSide(s)}
      disabled={!e || e.busy}
      aria-label={sideLabel(s)}
      title={sideLabel(s)}
      data-rx-st-page={s}
      className="group flex flex-col items-start gap-2"
    >
      <span className={cn(size, 'rounded bg-white flex items-center justify-center overflow-hidden shadow-[0_2px_8px_rgba(0,0,0,0.12)] border', e?.side === s ? 'border-[#0b77c4]' : 'border-transparent group-hover:border-[#a9cfee]')}>
        {e?.thumbs[s] || sideThumbs[s] ? <img src={e?.thumbs[s] ?? sideThumbs[s]} alt="" className="max-w-[86%] max-h-[86%] object-contain" /> : null}
      </span>
      <span className="text-[0.8125rem] text-[#1d1d1d] tabular-nums">{String(i + 1).padStart(2, '0')}</span>
    </button>
  );

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      data-rx-designer
      data-rx-studio
      lang={language}
      className="fixed left-0 right-0 z-[200] flex flex-col bg-white outline-none overflow-hidden text-[#1d1d1d]"
      style={{ top: vv.top, height: vv.height, fontFamily: UI_FONT }}
    >
      <StudioLayer.Provider value={layer}>
        {/* The header, as Pixart's: close, the shop's mark, the product and its price, Save … help, "later", Continue */}
        {!narrow ? (
          <header className="flex items-center gap-4 px-5 h-[4.375rem] shrink-0 bg-white border-b border-[#d1d2d4]">
            <button type="button" onClick={requestClose} aria-label={t('dsgClose')} className="shrink-0 text-[#686868] hover:text-[#1d1d1d]">
              <CircleClose className="w-5 h-5" />
            </button>
            <ShopMark />
            <span className="w-px h-9 bg-[#e3e3e3]" aria-hidden="true" />
            <div className="min-w-0">
              <h2 id={titleId} className="text-[0.875rem] font-bold text-[#555555] truncate max-w-[22rem]">{title ?? t('dsgTitle')}</h2>
              <p className="flex items-center gap-1.5 text-[0.75rem] font-bold">
                <CirclePlus className="w-3.5 h-3.5 text-[#0b77c4]" strokeWidth={1.6} />
                <span className="text-[#0b77c4]">{t('stInfo')}</span>
                <span className="text-[#2ea512]">{props.priceLabel ?? sizeLabel}</span>
              </p>
            </div>
            {saveButton && <span className="w-px h-9 bg-[#e3e3e3]" aria-hidden="true" />}
            {saveButton}
            <span className="flex-1" />
            {phase === 'edit' && helpButton}
            {laterLink}
            {continueButton}
          </header>
        ) : (
          <header className="shrink-0 bg-white border-b border-[#d1d2d4]">
            <div className="flex items-center gap-3 px-3 h-14">
              <button type="button" onClick={requestClose} aria-label={t('dsgClose')} className="shrink-0 text-[#686868]">
                <CircleClose className="w-5 h-5" />
              </button>
              <span className="w-px h-8 bg-[#e3e3e3]" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <h2 id={titleId} className="text-[0.9375rem] font-bold text-[#555555] truncate">{title ?? t('dsgTitle')}</h2>
                <p className="text-[0.8125rem] font-bold text-[#2ea512] truncate">{props.priceLabel ? t('stTotalPrice').replace('{0}', props.priceLabel) : sizeLabel}</p>
              </div>
              {phase === 'edit' && helpButton}
              {continueButton}
            </div>
            {saveButton && <div className="flex items-center justify-end px-4 h-[2.625rem] border-t border-[#d1d2d4]">{saveButton}</div>}
          </header>
        )}

        {confirmClose && (
          <div ref={closeWarningRef} tabIndex={-1} className="flex flex-wrap items-center gap-2 px-3 sm:px-5 py-2.5 bg-amber-50 border-b border-amber-200 outline-none" role="alert" data-rx-close-warning>
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span className="text-xs font-bold text-amber-900 flex-1 min-w-[12rem]">
              {owner ? 'This template has changes that are not saved yet.' : t(deviceSaveFailed ? 'dsgCloseWarnUnsaved' : 'dsgCloseWarn')}
            </span>
            <button type="button" onClick={() => setConfirmClose(false)} className="px-3 py-1.5 rounded-full text-xs font-black text-white bg-[#0b77c4] hover:bg-[#0a68ab]">
              {t('dsgKeepDesigning')}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmClose(false);
                engineRef.current?.flush();
                props.onClose();
              }}
              className="px-3 py-1.5 rounded-full text-xs font-black text-gray-700 bg-white border border-gray-300"
            >
              {t('dsgCloseAnyway')}
            </button>
          </div>
        )}

        <div className="relative flex-1 min-h-0 flex">
          {phase === 'proof' && proof && (
            <ProofView
              proof={proof}
              t={t}
              trimMm={trimMm}
              outline={outline}
              sizeLabel={sizeLabel}
              bleedMm={spec.bleedMm}
              dpiSpec={spec}
              sideLabel={sideLabel}
              twoSided={twoSided}
              checked={checked}
              onCheck={setChecked}
              onBack={() => setPhase('edit')}
              onAttach={attach}
            />
          )}
          {/* The rail: Pixart's tiles, its words under them */}
          {!narrow && (
            <nav className="w-[7.1875rem] shrink-0 bg-white border-r border-[#c0c3c4] flex flex-col items-stretch pt-1.5 overflow-y-auto" aria-label={t('dsgTitle')}>
              {RAIL.map((r) => (
                <React.Fragment key={r.id}>
                  {/* Pixart sets Tools apart by a gap, no line. */}
                  {r.ruleBefore && <span className="h-[1.125rem] shrink-0" aria-hidden="true" />}
                  <button
                    type="button"
                    onClick={() => openPanel(r.id)}
                    aria-pressed={panel === r.id || (r.id === 'tools' && (panel === 'ai' || panel === 'qr'))}
                    disabled={phase !== 'edit'}
                    data-rx-st-rail={r.id}
                    className="group flex flex-col items-center gap-1 py-3 text-[0.8125rem] font-bold leading-tight text-center text-[#1d1d1d] disabled:opacity-40"
                  >
                    <span
                      className={cn(
                        // Pixart's open one: its tile turns pale grey, its icon dark blue.
                        'w-8 h-8 rounded-md flex items-center justify-center transition-colors',
                        panel === r.id || (r.id === 'tools' && (panel === 'ai' || panel === 'qr')) ? 'bg-[#f2f2f2] text-[#0a4670]' : 'bg-[#e7f1f8] text-[#1174ba] group-hover:bg-[#d5e7f5]',
                      )}
                    >
                      <r.icon className="w-[1.375rem] h-[1.375rem]" strokeWidth={1.5} />
                    </span>
                    {t(r.label)}
                  </button>
                </React.Fragment>
              ))}
            </nav>
          )}

          {/* The work: Pixart's pale grey, the board in it, its bars floating over it */}
          <div className="relative flex-1 min-w-0 bg-[#f7f7f7]">
            <div
              ref={areaRef}
              className="absolute inset-0"
              onDragOver={(ev) => {
                const types = Array.from(ev.dataTransfer.types);
                if (!types.includes('Files') && !types.includes(PICTURE_DRAG_TYPE)) return;
                ev.preventDefault();
                ev.dataTransfer.dropEffect = 'copy';
                setDropping(true);
              }}
              onDragLeave={() => setDropping(false)}
              onDrop={(ev) => void onDrop(ev)}
            >
              <div
                ref={hostRef}
                // Reached with Tab: then Tab chooses its objects (the keyboard handler above).
                // Its focus ring is drawn over the canvas, which would hide an outline. Only
                // while it can be edited: under the check before attaching, Tab still reached
                // a board nobody could see or use (second pass #6).
                tabIndex={phase === 'edit' ? 0 : -1}
                role="application"
                aria-label={t('stBoardLabel')}
                className="absolute inset-0 outline-none after:absolute after:inset-0 after:z-10 after:pointer-events-none focus-visible:after:border-2 focus-visible:after:border-[#1174ba]"
                style={{ touchAction: 'none' }}
                data-rx-designer-board
                data-rx-cut={outline ?? 'rect'}
                data-rx-board-mm={`${Math.round((trimMm.wMm + 2 * spec.bleedMm) * 10) / 10}x${Math.round((trimMm.hMm + 2 * spec.bleedMm) * 10) / 10}`}
                data-rx-side={e?.side ?? sides[0]}
              />
              {e && <ObjectBar engine={e} t={t} area={areaRef.current} onReplace={onReplace} />}
            </div>

            {/* The selection's tools: a white bar over the top of the work (desktop), along its foot (phone). */}
            {(phase === 'edit' || phase === 'loading') && e && selected && !e.preview && (
              <div
                className={cn(
                  'absolute left-0 right-0 z-20 flex items-center bg-white overflow-x-auto',
                  narrow ? 'gap-1 px-3 bottom-0 h-16 border-t border-[#e3e3e3]' : 'gap-3 pl-4 pr-5 top-0 h-[3.75rem] border-b border-[#f2f2f2]',
                )}
                role="toolbar"
                aria-label={t('dsgTitle')}
                data-rx-st-toolbar={kindOf(selected) ?? ''}
              >
                <ContextToolbar
                  engine={e}
                  t={t}
                  palette={palette}
                  inlineText={inlineText}
                  narrow={narrow}
                  onReplace={onReplace}
                  onCrop={(o) => setCropping(o)}
                  onEditQr={onEditQr}
                  onEditText={(o) => openTextSheet(o)}
                />
              </div>
            )}

            {/* Desktop: "Edit the design" over the work, the pages on the right, the bars at the foot */}
            {!narrow && phase === 'edit' && e && (
              <>
                {fromTemplate && !selected && (
                  <button
                    type="button"
                    onClick={() => openPanel('designs')}
                    data-rx-st-edit-template
                    // Over the board's left edge, as Pixart's.
                    style={{ left: Math.max(16, Math.round(boardBox?.left ?? 84)) }}
                    className="absolute top-[4.375rem] z-10 inline-flex items-center gap-2 px-4 h-[3.25rem] rounded-lg bg-white text-[0.9375rem] font-bold text-[#0b77c4] shadow-[0_2px_10px_rgba(0,0,0,0.10)]"
                  >
                    <LayoutTemplate className="w-5 h-5" strokeWidth={1.6} />
                    {t('stEditTemplate')}
                  </button>
                )}
                {/* The pages column: Pixart's ⓧ hides it, its stacked pages bring it back; both move
                    down out of the way of the selection's bar. */}
                <button
                  type="button"
                  onClick={() => setPagesShown((v) => !v)}
                  aria-label={t('stPages')}
                  aria-expanded={pagesShown}
                  title={t('stPages')}
                  data-rx-st-pages-toggle
                  className={cn(
                    'absolute right-[2.25rem] z-10 w-14 h-14 rounded-lg flex items-center justify-center text-[#1174ba] shadow-[0_2px_10px_rgba(0,0,0,0.10)]',
                    selected && !e.preview ? 'top-[5.625rem]' : 'top-[1.875rem]',
                    pagesShown ? 'bg-white' : 'bg-[#e0eaf1]',
                  )}
                >
                  {pagesShown ? <CircleClose className="w-6 h-6" /> : <PagesGlyph className="w-6 h-6" strokeWidth={2} />}
                </button>
                {pagesShown && (
                  <div
                    className={cn('absolute right-[2.25rem] z-10 flex flex-col gap-[1.625rem]', selected && !e.preview ? 'top-[11.125rem]' : 'top-[7.375rem]')}
                    role="tablist"
                    aria-label={t('stPages')}
                    data-rx-st-pages
                  >
                    {sides.map((s, i) => pageThumb(s, i, 'w-[6.25rem] h-[6.25rem]'))}
                  </div>
                )}
                {/* Pixart's bars at the foot, centred under the board (the pages column is not theirs). */}
                <div className="absolute bottom-[0.625rem] left-0 z-10 flex justify-center pointer-events-none" style={{ right: PAGES_COLUMN }}>
                <div className="flex items-center gap-4 pointer-events-auto">
                  <div className="flex items-center gap-1 h-[3.125rem] px-4 rounded-lg bg-white shadow-[0_2px_10px_rgba(0,0,0,0.10)]">
                    <ToolButton icon={ChevronLeft} label={t('stPrevPage')} onClick={() => toPage(sideIndex - 1)} disabled={sideIndex === 0 || e.busy} testId="page-prev" iconClassName="w-[1.125rem] h-[1.125rem]" iconStroke={2.2} />
                    <span className="px-1 text-[0.9375rem] tabular-nums whitespace-nowrap text-[#1d1d1d]" data-rx-st-page-count>{sideIndex + 1} / {sides.length}</span>
                    <ToolButton icon={ChevronRight} label={t('stNextPage')} onClick={() => toPage(sideIndex + 1)} disabled={sideIndex >= sides.length - 1 || e.busy} testId="page-next" iconClassName="w-[1.125rem] h-[1.125rem]" iconStroke={2.2} />
                    <span className="w-px h-8 bg-[#f2f2f2] mx-2" aria-hidden="true" />
                    <PopoverButton
                      label={t('stZoomFit')}
                      testId="zoom"
                      width={170}
                      trigger={
                        <span className="flex items-center gap-3 px-2 text-[1.125rem] tabular-nums text-[#1d1d1d]" data-rx-st-zoom>
                          {zoomPct} %
                          <ChevronUp className="w-[1.125rem] h-[1.125rem] text-[#1174ba]" strokeWidth={2.2} />
                        </span>
                      }
                    >
                      {(close) => (
                        // Pixart's list of sizes, the one shown ticked, then "fit".
                        <div className="py-1" data-rx-st-zoom-list>
                          {ZOOM_LEVELS.map((z) => {
                            const pct = Math.round(z * 100);
                            const on = zoomPct === pct;
                            return (
                              <button
                                key={pct}
                                type="button"
                                onClick={() => {
                                  e.zoomAt(z);
                                  close();
                                }}
                                aria-pressed={on}
                                data-rx-st-zoom-level={pct}
                                className={cn('w-full flex items-center justify-between px-3 h-[2.5625rem] rounded-lg text-[1rem] tabular-nums text-[#1d1d1d]', on ? 'bg-[#e7f1f8]' : 'hover:bg-[#f2f2f2]')}
                              >
                                {pct} %
                                {on && <Check className="w-4 h-4 text-[#1174ba]" strokeWidth={1.6} />}
                              </button>
                            );
                          })}
                          <div className="my-2 h-px bg-[#e3e3e3]" />
                          <button
                            type="button"
                            onClick={() => {
                              e.fit();
                              close();
                            }}
                            className="w-full text-left px-3 h-[2.5625rem] rounded-lg text-[1rem] text-[#1d1d1d] hover:bg-[#f2f2f2]"
                            data-rx-st="zoom-fit"
                          >
                            {t('stZoomFitShort')}
                          </button>
                        </div>
                      )}
                    </PopoverButton>
                    <span className="w-px h-8 bg-[#f2f2f2] mx-2" aria-hidden="true" />
                    <ToolButton icon={Undo2} label={t('dsgUndo')} onClick={() => void e.undo()} disabled={!e.canUndo || e.busy} testId="undo" />
                    <span className="w-3" aria-hidden="true" />
                    <ToolButton icon={Redo2} label={t('dsgRedo')} onClick={() => void e.redo()} disabled={!e.canRedo || e.busy} testId="redo" />
                    <span className="w-2" aria-hidden="true" />
                    {settingsButton}
                  </div>
                  <button
                    type="button"
                    onClick={() => setShow3d((v) => !v)}
                    aria-pressed={show3d}
                    data-rx-st="3d"
                    className={cn(
                      'inline-flex items-center gap-3 h-[3.125rem] px-4 rounded-lg shadow-[0_2px_10px_rgba(0,0,0,0.10)] text-[1.125rem] text-[#1d1d1d]',
                      show3d ? 'bg-[#e7f1f8]' : 'bg-white',
                    )}
                  >
                    {show3d ? <EyeOff className="w-[1.625rem] h-[1.625rem] text-[#1174ba]" strokeWidth={1.6} /> : <Eye className="w-[1.625rem] h-[1.625rem] text-[#1174ba]" strokeWidth={1.6} />}
                    {t('stPreview')}
                  </button>
                </div>
                </div>
              </>
            )}

            {/* Phone: undo/redo/settings top left, preview and pages top right, designs and "+" at the foot */}
            {narrow && phase === 'edit' && e && !panelTyping && (
              <>
                <div className="absolute left-3 top-3 z-10 flex items-center gap-1 h-12 px-2 rounded-lg bg-white shadow-[0_2px_10px_rgba(0,0,0,0.10)]">
                  <ToolButton icon={Undo2} label={t('dsgUndo')} onClick={() => void e.undo()} disabled={!e.canUndo || e.busy} testId="undo" />
                  <ToolButton icon={Redo2} label={t('dsgRedo')} onClick={() => void e.redo()} disabled={!e.canRedo || e.busy} testId="redo" />
                  <span className="w-px h-6 bg-[#e3e3e3] mx-1" aria-hidden="true" />
                  {settingsButton}
                </div>
                <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
                  <button type="button" onClick={() => setShow3d(true)} aria-label={t('stPreview')} data-rx-st="3d" className="w-12 h-12 rounded-lg bg-white shadow-[0_2px_10px_rgba(0,0,0,0.10)] flex items-center justify-center text-[#1174ba]">
                    <Eye className="w-6 h-6" strokeWidth={1.6} />
                  </button>
                  {twoSided && (
                    <PopoverButton
                      label={t('stPages')}
                      testId="pages"
                      width={260}
                      trigger={
                        <span className="w-12 h-12 rounded-lg bg-white shadow-[0_2px_10px_rgba(0,0,0,0.10)] flex items-center justify-center text-[#1174ba]">
                          <PagesGlyph className="w-6 h-6" strokeWidth={1.8} />
                        </span>
                      }
                    >
                      {() => (
                        <div className="flex gap-4 p-1" role="tablist" aria-label={t('stPages')} data-rx-st-pages>
                          {sides.map((s, i) => pageThumb(s, i, 'w-[6rem] h-[6rem]'))}
                        </div>
                      )}
                    </PopoverButton>
                  )}
                </div>
                {!selected && !panel && (
                  <>
                    <button
                      type="button"
                      onClick={() => openPanel('designs')}
                      aria-label={t('stRailDesigns')}
                      data-rx-st-rail="designs"
                      className="absolute left-3 bottom-3 z-10 w-12 h-12 rounded-lg bg-white shadow-[0_2px_10px_rgba(0,0,0,0.10)] flex items-center justify-center text-[#1174ba]"
                    >
                      <LayoutTemplate className="w-6 h-6" strokeWidth={1.6} />
                    </button>
                    <button
                      type="button"
                      onClick={() => openPanel('designs')}
                      aria-label={t('stAddMenu')}
                      data-rx-st-add-menu
                      className="absolute right-3 bottom-3 z-10 w-16 h-16 rounded-full bg-[#1174ba] text-white shadow-lg flex items-center justify-center"
                    >
                      <Plus className="w-8 h-8" strokeWidth={1.6} />
                    </button>
                  </>
                )}
              </>
            )}

            {/* Words for the customer, over the board */}
            <div className={cn('absolute left-2 right-2 z-10 flex flex-col items-center gap-1.5 pointer-events-none', narrow ? 'top-[4.5rem]' : selected ? 'top-[4.375rem]' : 'top-3')}>
              {notice && (
                <p role="alert" className="pointer-events-auto max-w-lg flex items-start gap-2 text-[0.6875rem] font-black text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2 shadow-sm" data-rx-st-notice>
                  <span className="flex-1">{notice}</span>
                  <button type="button" onClick={() => setNotice(null)} aria-label={t('stDismiss')} className="shrink-0 -m-2 p-2 text-red-500 hover:text-red-800">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </p>
              )}
              {restoredAt && phase === 'edit' && (
                <div className="pointer-events-auto max-w-lg flex items-center gap-2 text-[0.6875rem] font-bold text-gray-700 bg-white/95 border border-gray-200 rounded-xl px-3 py-2 shadow-sm" data-rx-restored>
                  <span className="flex-1">
                    {t('dsgRestored').replace(
                      '{0}',
                      new Date(restoredAt).toLocaleString(localeFor(language), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setRestoredAt(null);
                      setPanel('designs');
                    }}
                    className="font-black text-[#0b77c4] shrink-0"
                  >
                    {t('dsgStartOver')}
                  </button>
                  <button type="button" onClick={() => setRestoredAt(null)} aria-label={t('stDismiss')} className="shrink-0 -m-2 p-2 text-gray-400 hover:text-gray-700">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              {(ink === 'black' || ink === 'greyscale') && phase === 'edit' && (
                <p className="max-w-lg text-[0.6875rem] font-bold text-gray-700 bg-white/95 border border-gray-200 rounded-xl px-3 py-1.5 shadow-sm" data-rx-st-ink={ink}>
                  {t(ink === 'black' ? 'stInkBlack' : 'stInkGrey')}
                </p>
              )}
            </div>

            {dropping && (
              <div className="absolute inset-3 z-20 rounded-2xl border-4 border-dashed border-[#0b77c4] bg-[#e7f1f8]/60 flex items-center justify-center pointer-events-none">
                <span className="text-sm font-black text-[#08558c]">{t('stDropHere')}</span>
              </div>
            )}

            {(phase === 'loading' || phase === 'exporting' || (e?.busy && phase === 'edit')) && (
              <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-[#f7f7f7]/80" data-rx-designer-busy={phase} role="status" aria-live="polite">
                <Loader2 className="w-8 h-8 text-[#1174ba] animate-spin" />
                <span className="text-xs font-black text-gray-700">
                  {phase === 'exporting' ? (progress > 0 ? t('stProofProgress').replace('{0}', String(progress)) : t('dsgPreparing')) : t('dsgLoading')}
                </span>
              </div>
            )}

            {phase === 'failed' && (
              <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 p-6 text-center bg-[#f7f7f7]">
                <AlertTriangle className="w-8 h-8 text-amber-600" />
                <span className="text-sm font-bold text-gray-800 max-w-xs" data-rx-st-failed={failure}>{t(failure === 'pictures' ? 'stRestoreFailed' : 'dsgFontsFailed')}</span>
                <div className="flex flex-wrap justify-center gap-2">
                  <button type="button" onClick={() => setBootAttempt((n) => n + 1)} className="px-4 py-2 rounded-full text-xs font-black text-white bg-[#0b77c4] hover:bg-[#0a68ab]">
                    {t('dsgRetry')}
                  </button>
                  {failure === 'pictures' && (
                    <button
                      type="button"
                      onClick={() => {
                        freshStartRef.current = true;
                        setBootAttempt((n) => n + 1);
                      }}
                      className="px-4 py-2 rounded-full text-xs font-black text-gray-700 bg-white border border-gray-300"
                    >
                      {t('stDesignsBlank')}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* The panel: over the work beside the rail (desktop) — the board does not move */}
            {!narrow && panel && phase === 'edit' && (
              <aside className="absolute left-0 top-0 bottom-0 z-30 w-[23.75rem] bg-white border-r border-[#e3e3e3] shadow-[4px_0_16px_rgba(0,0,0,0.06)] flex flex-col min-h-0" data-rx-designer-panel>
                <div className="flex items-center gap-2 px-6 pt-6 pb-3 shrink-0">
                  {panelBack && (
                    <button type="button" onClick={panelBack} aria-label={t('stRailTools')} className="-ml-2 w-8 h-8 rounded-full flex items-center justify-center text-[#0b77c4] hover:bg-[#e7f1f8]">
                      <ArrowLeft className="w-5 h-5" />
                    </button>
                  )}
                  <h3 className="flex-1 text-[1.1875rem] font-bold text-[#1d1d1d]">{panelTitle}</h3>
                  <button type="button" onClick={() => setPanel(null)} aria-label={t('stClosePanel')} className="w-8 h-8 rounded-full flex items-center justify-center text-[#0b77c4] hover:bg-[#e7f1f8]">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-6">{panelBody}</div>
              </aside>
            )}

            {/* The panel on a phone: a sheet, its tabs along the foot (Pixart's "+" menu), the
                work dimmed above it — a tap there closes it, as on Pixart's. */}
            {narrow && panel && phase === 'edit' && !panelTyping && (
              <div className="absolute inset-0 z-[24] bg-black/40" onClick={() => setPanel(null)} aria-hidden="true" data-rx-st-scrim />
            )}
            {narrow && panel && phase === 'edit' && (
              <div
                className={cn(
                  'absolute inset-x-0 bottom-0 z-[25] flex flex-col bg-white shadow-[0_-12px_40px_rgba(15,23,42,0.18)]',
                  panelTyping ? 'top-0' : 'top-[4.5rem] rounded-t-3xl',
                )}
                onFocus={(ev) => {
                  if (/^(INPUT|TEXTAREA|SELECT)$/.test((ev.target as HTMLElement).tagName)) setPanelTyping(true);
                }}
                onBlur={(ev) => {
                  if (!ev.currentTarget.contains(ev.relatedTarget as Node | null)) setPanelTyping(false);
                }}
                data-rx-designer-panel
              >
                <div className="flex items-center gap-2 px-6 h-16 shrink-0">
                  {panelBack && (
                    <button type="button" onClick={panelBack} aria-label={t('stRailTools')} className="-ml-2 w-8 h-8 rounded-full flex items-center justify-center text-[#0b77c4]">
                      <ArrowLeft className="w-5 h-5" />
                    </button>
                  )}
                  <h3 className="flex-1 text-[1.1875rem] font-bold text-[#1d1d1d]">{panelTitle}</h3>
                  <button type="button" onClick={() => setPanel(null)} aria-label={t('stClosePanel')} className="w-8 h-8 rounded-full flex items-center justify-center text-[#0b77c4]">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-4">{panelBody}</div>
                {!panelTyping && (
                  <nav className="shrink-0 flex items-stretch justify-between gap-1 px-2 h-16 border-t border-[#e3e3e3] bg-white overflow-x-auto" aria-label={t('dsgTitle')}>
                    {RAIL.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => openPanel(r.id)}
                        aria-pressed={panel === r.id || (r.id === 'tools' && (panel === 'ai' || panel === 'qr'))}
                        aria-label={t(r.label)}
                        title={t(r.label)}
                        data-rx-st-rail={r.id}
                        className={cn(
                          'w-12 shrink-0 flex items-center justify-center rounded-lg',
                          panel === r.id || (r.id === 'tools' && (panel === 'ai' || panel === 'qr')) ? 'bg-[#e7f1f8] text-[#0b77c4]' : 'text-[#1174ba]',
                        )}
                      >
                        <r.icon className="w-7 h-7" strokeWidth={1.5} />
                      </button>
                    ))}
                  </nav>
                )}
              </div>
            )}
          </div>
        </div>

        {cropping && e && <Cropper engine={e} o={cropping} t={t} onClose={() => setCropping(null)} />}

        {show3d && e && <Preview3D engine={e} t={t} kind={spec.kind} outline={outline} sides={sides} floating={!narrow} onClose={() => setShow3d(false)} />}

        {textSheet && e && (
          <TextSheet
            key={textSheet.n}
            text={String(textSheet.o.text ?? '')}
            t={t}
            onChange={(v) => {
              // Only into words still on the board (Undo, a page or a delete took them away).
              if (e.canvas?.getObjects().includes(textSheet.o)) e.setText(textSheet.o, v);
            }}
            onDone={() => {
              e.commit();
              setTextSheet(null);
            }}
          />
        )}

        <p className="sr-only" aria-live="polite" data-rx-st-announce>{announce}</p>
        <div ref={setLayer} />
      </StudioLayer.Provider>
    </div>
  );
}

/** Words typed on a touch screen: above the keyboard, never under it. */
function TextSheet({ text, t, onChange, onDone }: { text: string; t: (k: TranslationKey) => string; onChange: (v: string) => void; onDone: () => void }) {
  const [value, setValue] = useState(text);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  return (
    <div className="absolute inset-x-0 bottom-0 z-[235] bg-white rounded-t-3xl shadow-[0_-12px_40px_rgba(15,23,42,0.2)] p-4 space-y-3" data-rx-st-textsheet data-rx-st-layer>
      <label className="block space-y-1">
        <span className="text-[0.625rem] font-black uppercase tracking-wider text-gray-400">{t('dsgTextField')}</span>
        <textarea
          ref={ref}
          value={value}
          rows={3}
          onChange={(ev) => {
            setValue(ev.target.value);
            onChange(ev.target.value);
          }}
          className="w-full px-3 py-2 rounded-xl border border-gray-200 text-base font-bold text-gray-900 resize-none"
          data-rx-designer-text
        />
      </label>
      <button type="button" onClick={onDone} className="w-full px-4 py-2.5 rounded-full text-xs font-black uppercase tracking-wider text-white bg-[#0b77c4] hover:bg-[#0a68ab]">
        {t('stDone')}
      </button>
    </div>
  );
}
