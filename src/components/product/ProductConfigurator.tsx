import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Clock, ShoppingCart, UploadCloud, FileText } from 'lucide-react';
import { DeliveryOption, PrintingField, PrintingFieldOption, Product } from '../../types';
import { useAuth } from '../../App';
import { useSiteSettings } from '../../context/SiteSettingsContext';
import { fetchTemplateList } from './designer/templatesApi';
import type { TemplateSummary } from '../../lib/designTemplateDoc';
import { calcConfiguredItemPrice, PRICING_DEFAULTS } from '../../lib/pricing';
import { offerPercentShown, unitPriceFloor } from '../../lib/cardPrice';
import { artworkBoxShown, artworkFileRequired, artworkSourceOf } from '../../lib/artwork';
import { buildQuantityLadder, ladderQuantities } from '../../lib/quantityLadder';
import { localized } from '../../lib/localizedText';
import { DEFAULT_ARTWORK_FORMATS, ARTWORK_MIN_DPI, minPixelsFor } from '../../lib/artworkLimits';
import { cn } from '../../lib/utils';
import { NEO } from '../NeumorphicSidebar';
import VatTag from '../VatTag';
import NeoOptionField, { parseDimensionsMm } from '../NeoOptionField';
import { formatSizeForShopper } from '../../lib/printSize';
import { diameterMm, needsSquareBox, outlineOf, primaryOutline } from '../../lib/shapes';
// The option tree — paths, defaults, branch pruning and the surcharge sum — is a
// pure module so the money can be tested without a browser. See
// src/lib/optionTree.ts and scripts/test-option-tree.mjs.
import {
  CUSTOM_SIZE_OPTION_ID,
  MAX_OPTION_DEPTH,
  defaultSelection,
  fieldPathKey,
  flattenSelectionByFieldId,
  makeCustomSizeOption,
  onceChargesOf,
  optionsSurchargeOf,
  selectOption,
  subFieldsOf,
  visibleFieldEntries,
} from '../../lib/optionTree';
import NeoProductGallery from './NeoProductGallery';
import NeoQuantityLadder from './NeoQuantityLadder';
import NeoDeliveryEstimate from './NeoDeliveryEstimate';
import NeoArtworkStep, { methodNeedsArtwork } from './NeoArtworkStep';
import { withoutUnavailableOptions } from '../../lib/optionAvailability';
import { isSizeQuantityField } from '../../lib/clothingTemplate';
import ClothingSizeQuantities from './ClothingSizeQuantities';
import { PAGE_BLOCKS, pageRowsOf } from '../../lib/pageOrder';
import { isChargedOnce } from '../../lib/chargeOnce';
import { deleteUploadedFile, uploadFile } from '../../lib/uploadFile';
import { holdReloads } from '../../lib/reloadHold';
import { checkArtworkFit, ARTWORK_BLEED_MM } from '../../lib/artworkFit';
import {
  designerBlock,
  designerCanOpenOn,
  designerWhereItWorks,
  isDesignerMethod,
  onlineDesignOffered,
  type DesignerBlock,
} from '../../lib/onlineDesign';
import { MAX_EMBEDDED_FILE_BYTES } from '../../lib/artworkLimits';
import type { DesignerResult, StudioDraft } from './designer/types';
import { cleanDpiBands, kindOfProduct, printSpecFor } from '../../lib/printSpec';
import { cleanDesignLaterMarker, type DesignLaterMarker } from '../../lib/designLater';
import { printSides, type SideId } from '../../lib/printSides';
import { loadDraft } from './designer/draftStore';
import { parseDesignDoc } from '../../lib/designDoc';
import { templateMiss } from '../../lib/designTemplateMatch';
import type { GalleryChoice } from './designer/studio/TemplateGallery';
import type { OutlineKind } from '../../lib/shapes';
import type { TranslationKey } from '../../lib/translations';
import { signInAnonymously } from 'firebase/auth';
import { promiseNumbers, speedRangeOf } from '../../lib/productionSpeed';
import type { ChosenArtworkBox } from '../../lib/pdfBoxes';
import { auth } from '../../firebase';

// The online designer (designer v2) and fabric under it: fetched when a customer
// chooses "Design online", never for the product page itself (DesignerShell.tsx).
import { DesignerBoundary, DesignerLoading, LazyGallery, LazyStudio, aiGenerate, loadDesigner, loadGallery } from './designer/DesignerShell';

/** Why the designer cannot open, in the customer's words. */
const DESIGNER_BLOCK_TEXT: Record<DesignerBlock, TranslationKey> = {
  'no-size': 'dsgBlockNoSize',
  'invalid-size': 'dsgBlockInvalidSize',
  'custom-contour': 'dsgBlockCustomContour',
  'too-large': 'dsgBlockTooLarge',
  'special-ink': 'stBlockSpecialInk',
  'all-over': 'stBlockAllOver',
  unprinted: 'stBlockUnprinted',
};

/** What a design was made for, kept beside it: a change of size, cut, sides or ink takes it off. */
interface DesignFit {
  wMm: number;
  hMm: number;
  outline: OutlineKind | null;
  /** The pages it was made with ("front", "front,back"). */
  sides: string;
  /** The ink of each of those pages ("front:colour,back:black") — see inkKeyOf. */
  ink: string;
}

/** Each page's ink, as one comparable string: a design made in colour is not the artwork for black only. */
const inkKeyOf = (sides: readonly SideId[], ink: Record<SideId, string>) => sides.map((s) => `${s}:${ink[s]}`).join(',');

/**
 * The product configurator — everything a shopper touches to turn a catalogue
 * product into a cart line: gallery, options, quantity ladder, delivery estimate,
 * price and add-to-cart.
 *
 * WHY IT LIVES HERE AND NOT IN THE MODAL
 * The shop used to have exactly one way to configure a product: a modal. The
 * client asked for the presentation his competitors use, which is a full product
 * PAGE with its own URL. Rather than write that twice and let the two drift, the
 * whole configurator moved into this component and both surfaces mount it —
 * `variant="modal"` inside ProductConfiguratorModal, `variant="page"` inside
 * ProductPage. There is one configurator in this shop; only its frame changes.
 *
 * Pricing here is a PREVIEW. `POST /api/checkout/quote` recomputes the real price
 * on the server from the product document using lib/pricing.ts — the same module
 * this file imports — so the number on screen and the number charged cannot drift,
 * and editing it in the browser buys nothing.
 */

/**
 * The cap when a file has to be EMBEDDED — base64 inside the Firestore order
 * document, which itself stops at 1 MiB. It only applies when object storage is
 * unreachable; a normal upload goes to Firebase Storage and gets the bucket's
 * own 50 MB ceiling, which is what a press-ready PDF actually needs.
 *
 * The server's own number (src/lib/artworkLimits.ts, about 0.5 MB). This said
 * 0.6, and a file between the two was accepted here and dropped by the server.
 */
const CONFIGURATOR_MAX_UPLOAD_MB = MAX_EMBEDDED_FILE_BYTES / (1024 * 1024);

/** Matches storage.rules; the bucket refuses anything larger. */
const STORAGE_MAX_UPLOAD_MB = 50;

/** Our four shop languages mapped to the locale tags Intl actually knows. */
const NUMBER_LOCALE: Record<string, string> = {
  en: 'en-GB',
  sv: 'sv-SE',
  da: 'da-DK',
  no: 'nb-NO',
};

/** Delivery speed is chosen through this catalogue field, so the server prices it. */
const DELIVERY_SPEED_FIELD_ID = 'production_delivery_speed';

/** How the artwork reaches us — rendered as the artwork step, not a plain field. */
const ARTWORK_METHOD_FIELD_ID = 'artwork_supply_method';

export interface ConfiguredCartLine {
  product: Product;
  selectedOptions: Record<string, PrintingFieldOption>;
  quantity: number;
  totalUnitPrice: number;
  totalPrice: number;
  /**
   * Carried into the cart so the server can re-price without trusting the
   * browser. Absent when the shopper was never asked for a size — see
   * handleAddToCart; a product with no size to choose has no size to report.
   *
   * `number | undefined` and not `?:` — the key is always sent, it just may be
   * empty. Written `?:` it stops being assignable to the cart's own
   * ConfiguredLineInput, which still declares it required.
   */
  widthCm: number | undefined;
  heightCm: number | undefined;
  /**
   * The size the customer's artwork has to be — 15.6.3. Descriptive only; it is
   * never priced. See ConfiguredLineInput in src/lib/cart.ts for why it cannot
   * simply reuse the pair above.
   */
  printWidthCm?: number;
  printHeightCm?: number;
  fileName?: string;
  /** The base64 fallback, used only when object storage could not take the file. */
  fileDataUrl?: string | null;
  /** The download URL once the file is in object storage — preferred over the bytes. */
  fileUrl?: string | null;
  /** Where it lives in the bucket, so staff and support can find it again. */
  storagePath?: string | null;
  /** Bleed the file carries on every side, in mm, when it is known (round 16). */
  fileBleedMm?: number | null;
  /** The file's resolution, when the shop made it (the online designer). */
  fileDpi?: number | null;
  /** The owner's design template the file started from (round 16, 5b). */
  fileTemplate?: { id: string; name: string } | null;
  /** A PDF/X with crop marks, accepted by its own box: how production places it (src/lib/pdfBoxes.ts). */
  filePlaceBy?: 'trimbox' | 'bleedbox' | null;
  /** …and its whole page, marks and all, so staff can tell the two apart. */
  filePageMm?: { wMm: number; hMm: number } | null;
  /** A studio design: each page's picture, and its pages in print order (src/lib/cart.ts). */
  filePreviews?: Array<{ side: SideId; url: string }> | null;
  fileSides?: SideId[] | null;
  /** "Add to basket without the design": designed later, from the basket or the order (src/lib/designLater.ts). */
  designLater?: DesignLaterMarker | null;
}

interface ProductConfiguratorProps {
  product: Product;
  variant?: 'page' | 'modal';
  /**
   * Returns false when the line was NOT added — a full basket, storage refused.
   * The button then leaves the price where it is instead of ticking "Added",
   * which is what it used to do while the page showed a red error beside it.
   */
  onAddToCart?: (line: ConfiguredCartLine) => boolean | void;
  /** Called after a successful add, once the confirmation has been shown. */
  onAdded?: () => void;
  /** Rendered in the left column under the gallery — the page's info sections. */
  leftColumn?: React.ReactNode;
  /** Rendered directly under the add-to-cart button (the page's "request a quote"). */
  secondaryAction?: React.ReactNode;
  className?: string;
}

/** Fields that get their own dedicated control further down the column. */
function isSpeciallyRendered(field: PrintingField): boolean {
  return field.id === DELIVERY_SPEED_FIELD_ID || field.id === ARTWORK_METHOD_FIELD_ID;
}

// Sub-options — an option that carries options of its own — are implemented in
// src/lib/optionTree.ts. This component only renders them.

/**
 * Turn the delivery-speed field's options into the shape the estimate block reads.
 * Going through the field rather than the product's legacy `deliverySpeedOptions`
 * matters: the field's options carry ids the server knows, so choosing express
 * actually charges for express. The legacy list is display data nobody prices.
 */
function deliveryOptionsFrom(
  field: PrintingField | undefined,
  labelOf: (option: PrintingFieldOption) => string,
): DeliveryOption[] {
  if (!field) return [];
  return field.options.map((option) => ({
    id: option.id,
    name: labelOf(option),
    // The catalogue writes the lead time into the label ("Standard — 5 working
    // days"); the estimate block parses what it can and degrades gracefully.
    deliveryDays: labelOf(option),
    priceSurcharge: option.priceModifier || 0,
    // A rush is for the JOB, not each piece — the speed options are one-off
    // (src/lib/chargeOnce.ts), and the row must not say "per unit" over them.
    chargeOnce: isChargedOnce(option),
    // The days, from the BASE option (its own words, value, id) — what the
    // server promises the order on, not the translated label.
    lead: speedRangeOf({ id: option.id, value: option.value, label: option.label }),
  }));
}

export default function ProductConfigurator({
  product,
  variant = 'modal',
  onAddToCart,
  onAdded,
  leftColumn,
  secondaryAction,
  className,
}: ProductConfiguratorProps) {
  const { formatPriceWithVat, formatMoney, includeVat, language, t, user } = useAuth();
  // The owner can switch off the four basic layouts (round 16, 5b); every
  // visitor already has these settings, so this costs no read.
  const { settings: siteSettings } = useSiteSettings();
  // His delivery-time numbers, made safe — the ones the order's promise uses.
  const deliveryPromise = promiseNumbers((siteSettings as any).deliveryPromise);
  const isPage = variant === 'page';
  const sizeInputId = useId();

  const formatPrice = (amount: number) => formatPriceWithVat(amount).formatted;
  const labelOf = (option: PrintingFieldOption) =>
    localized(option.label, option.labelI18n, language);

  // Options the shop cannot deliver are taken out here, once, for every field on
  // the page — see src/lib/optionAvailability.ts. "Design online" stays only on
  // a product that offers it: the upload box on, the owner's switch not off, and
  // some choice that gives the designer a size (src/lib/onlineDesign.ts). That is
  // decided per PRODUCT, never per size chosen, or switching sizes would quietly
  // drop the customer's choice.
  const activeFields: PrintingField[] = useMemo(() => {
    const fields = withoutUnavailableOptions((product.printingFields || []).filter((f) => f.enabled));
    const offered =
      onlineDesignOffered(product) &&
      designerCanOpenOn(fields, product.customUploadRules?.areaPriced === true);
    return designerWhereItWorks(fields, offered);
  }, [product]);

  const [selectedOptions, setSelectedOptions] = useState<Record<string, PrintingFieldOption>>(
    () => defaultSelection(activeFields, t('cfgCustomSizeCard')),
  );

  // Switching products without unmounting (the page's ":id" route does exactly
  // that when a related product is clicked) must not carry the previous
  // product's selections across.
  const productIdRef = useRef(product.id);
  useEffect(() => {
    if (productIdRef.current === product.id) return;
    productIdRef.current = product.id;
    setSelectedOptions(defaultSelection(activeFields, t('cfgCustomSizeCard')));
    setQuantity(Math.max(1, product.minQuantity || 1));
    uploadTokenRef.current += 1;
    discardUpload(uploadedPathRef.current);
    setUploadedFileName('');
    setUploadedFile(null);
    setUploadedFileData(null);
    setUploadedUrl(null);
    setStoredPath(null);
    setUploadProgress(null);
    setFileValidationError('');
    setUploadedSource(null);
    setDesignFit(null);
    setUploadedBleedMm(null);
    setUploadedPdfBox(null);
    setUploadedDpi(null);
    setUploadedTemplate(null);
    setUploadedPages(null);
    setDesignerNotice('');
    setDesignerOpen(false);
    designDraftRef.current = null;
  }, [product.id, activeFields, product.minQuantity]);

  const minQty = product.minQuantity || 1;
  const [quantity, setQuantity] = useState<number>(minQty);
  // The clothing template: how many of each size, by size option id.
  const [sizeQty, setSizeQty] = useState<Record<string, number>>({});
  useEffect(() => setSizeQty({}), [product.id]);
  const [addedSuccess, setAddedSuccess] = useState(false);

  // ---- configured size ---------------------------------------------------
  // PRICING_DEFAULTS' own default sheet size. Anything priced by area falls back
  // to this when the shopper has not set a size.
  const [customWidthCm, setCustomWidthCm] = useState<number>(PRICING_DEFAULTS.defaultWidthCm);
  const [customHeightCm, setCustomHeightCm] = useState<number>(PRICING_DEFAULTS.defaultHeightCm);
  const [customSizeWidthInput, setCustomSizeWidthInput] = useState<string>('');
  const [customSizeHeightInput, setCustomSizeHeightInput] = useState<string>('');

  /** "140" or "140,5" → cm as a number; null when empty or not a positive number. */
  const parseCmInput = (raw: string): number | null => {
    if (raw.trim() === '') return null;
    const n = Number(raw.replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  /** Inside the owner's bounds for one axis; a missing bound leaves that side open. */
  const withinBounds = (n: number | null, min?: number, max?: number): boolean =>
    n !== null && (min === undefined || n >= min) && (max === undefined || n <= max);

  /**
   * Every field on screen right now — top-level, and the sub-fields of whichever
   * options are currently chosen. Everything that walks "the fields the shopper
   * can see" goes through this, so a question inside an option is treated
   * exactly like one outside it.
   */
  const visibleEntries = useMemo(
    () => visibleFieldEntries(activeFields, selectedOptions),
    [activeFields, selectedOptions],
  );

  const customModeEntries = visibleEntries.filter(
    ({ field, pathKey }) =>
      field.allowCustomSize && selectedOptions[pathKey]?.id === CUSTOM_SIZE_OPTION_ID,
  );
  const customModeFields = customModeEntries.map((entry) => entry.field);
  const parsedCustomW = parseCmInput(customSizeWidthInput);
  const parsedCustomH = parseCmInput(customSizeHeightInput);
  const customSizeInvalid =
    customModeFields.length > 0 &&
    customModeFields.some(
      (f) =>
        !withinBounds(parsedCustomW, f.minWidthCm, f.maxWidthCm) ||
        !withinBounds(parsedCustomH, f.minHeightCm, f.maxHeightCm),
    );

  const handleCustomSizeInput = (axis: 'w' | 'h', raw: string) => {
    if (axis === 'w') setCustomSizeWidthInput(raw);
    else setCustomSizeHeightInput(raw);
    const n = parseCmInput(raw);
    if (n !== null) {
      if (axis === 'w') setCustomWidthCm(n);
      else setCustomHeightCm(n);
    }
  };

  /** 'Custom size 140 × 70 cm' — the label the cart and staff will see. */
  const customSizeCartLabel = (w: number, h: number) =>
    `${t('cfgCustomSizeCard').replace('…', '').trim()} ${w} × ${h} cm`;

  // ---- artwork -----------------------------------------------------------
  const [uploadedFileName, setUploadedFileName] = useState<string>('');
  // The File itself, kept only so the size preview can draw it. It never leaves
  // the browser — what travels to the cart is the storage URL.
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadedFileData, setUploadedFileData] = useState<string | null>(null);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const [uploadedPath, setUploadedPath] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [fileValidationError, setFileValidationError] = useState<string>('');
  // Where the attached file came from: the dropzone, or the online designer.
  // "Design online" is only satisfied by a design — a PDF uploaded earlier and
  // left attached does not count.
  const [uploadedSource, setUploadedSource] = useState<'upload' | 'designer' | null>(null);
  // The size and cut a design was made for. When either changes, the design no
  // longer fits the order, and it is taken off (see below).
  const [designFit, setDesignFit] = useState<DesignFit | null>(null);
  const [designerOpen, setDesignerOpen] = useState(false);
  // Inside the designer: the gallery of ready-made designs first (as Pixartprinting
  // opens its Designer), then the studio with what was chosen there.
  const [designerStep, setDesignerStep] = useState<'gallery' | 'studio'>('gallery');
  const [designerStart, setDesignerStart] = useState<{ template: string; variant?: string } | { blank: true } | null>(null);
  const [deviceDraftAt, setDeviceDraftAt] = useState<number | null>(null);
  // His draft was made from a template for another size: it is not offered back; he is told why.
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  const [designerNotice, setDesignerNotice] = useState('');
  // What the attached file carries, for the line and production: the bleed on
  // every side (null: none, or nobody can tell) and, for a design, its DPI.
  const [uploadedBleedMm, setUploadedBleedMm] = useState<number | null>(null);
  // A PDF accepted by its own TrimBox/BleedBox (crop marks): the box, for the
  // preview, the line and the job sheet. null for every other file.
  const [uploadedPdfBox, setUploadedPdfBox] = useState<ChosenArtworkBox | null>(null);
  const [uploadedDpi, setUploadedDpi] = useState<number | null>(null);
  // The owner's template an attached design started from, for the job sheet.
  const [uploadedTemplate, setUploadedTemplate] = useState<{ id: string; name: string } | null>(null);
  // A studio design's pages: a small picture of each, in storage beside the file
  // (what the basket, the order and production show), and the sides in print order.
  const [uploadedPages, setUploadedPages] = useState<{ sides: SideId[]; previews: Array<{ side: SideId; url: string }> } | null>(null);
  const previewPathsRef = useRef<string[]>([]);
  // The owner's templates offered on this product — kept WITH the product they
  // are for: going back to a product shown earlier skips the loading state, and
  // the list of the product in between was offered here until this one's came.
  // list: null when the shop could not say (the designer offers a retry).
  const [designTemplates, setDesignTemplates] = useState<{ productId: string; list: TemplateSummary[] | null } | null>(null);
  const [templatesAttempt, setTemplatesAttempt] = useState(0);
  // Closing goes back over the designer's history entry, and the dialog stays
  // mounted until that arrives: a second close in between (a double tap on
  // "Attach", Escape twice) went back TWICE and left the product page.
  const closingRef = useRef(false);
  const designerOpenRef = useRef(false);
  designerOpenRef.current = designerOpen;
  // A product being configured holds the shop's self-reload after a deploy: the
  // options chosen, a file or a design attached. The product list is a page the
  // shop otherwise reloads by itself, and this opens over it (BuildWatcher).
  useEffect(() => holdReloads(), []);
  // The design in progress, kept while the page is open (the designer also
  // keeps it on the device): "Edit your design" reopens it where it was left.
  const designDraftRef = useRef<StudioDraft | null>(null);
  // The current upload's path, readable inside async work, and every path a
  // basket line already points at. Those files are never deleted from here.
  const uploadedPathRef = useRef<string | null>(null);
  const committedPathsRef = useRef<Set<string>>(new Set());
  // Bumped by every new attachment, so an upload that finishes after it was
  // replaced cannot write its stale URL over the newer one.
  const uploadTokenRef = useRef(0);

  const setStoredPath = (path: string | null) => {
    uploadedPathRef.current = path;
    setUploadedPath(path);
  };

  /**
   * A replaced or removed upload nobody will ever read. Every "Use this design"
   * makes a new file, and each one left behind is storage paid for nothing.
   * Never one a basket line points at.
   */
  const discardUpload = (path: string | null) => {
    if (!path || committedPathsRef.current.has(path)) return;
    void deleteUploadedFile(path);
    // A design's page pictures go with its file.
    if (path === uploadedPathRef.current) {
      for (const p of previewPathsRef.current) if (!committedPathsRef.current.has(p)) void deleteUploadedFile(p);
      previewPathsRef.current = [];
    }
  };

  const uploadRules = product.customUploadRules || {
    enabled: true,
    minPrice: 149,
    pricePerLinearMeter: 250,
    pricePerSqm: 350,
    allowedFormats: [...DEFAULT_ARTWORK_FORMATS],
    maxFileSizeMb: 100,
  };

  const pricingRules = product.pricingRules || {
    baseSetupFee: 49,
    priceCalculationType: 'tiered_volume' as const,
    volumeDiscounts: [
      { minQuantity: 10, discountPercentage: 10 },
      { minQuantity: 50, discountPercentage: 20 },
      { minQuantity: 100, discountPercentage: 30 },
      { minQuantity: 500, discountPercentage: 40 },
    ],
  };

  /**
   * Products priced by the square metre need somewhere to say how big the job is.
   * A field with allowCustomSize already offers that; when the product has none,
   * this standalone calculator is the only control there is — and the first cut of
   * this component dropped it, which left every area-priced product silently stuck
   * at the 50 x 70 cm default. Never show both: two size controls fighting over one
   * width x height pair is the bug that once made add-to-cart unreachable.
   */
  /** "0,6" for a Swedish shopper, "0.6" for an English one. */
  const formatMb = (mb: number) => new Intl.NumberFormat(NUMBER_LOCALE[language]).format(mb);

  /**
   * TWO ceilings, and they are not the same number.
   *
   * `productMaxUploadMb` is the owner's house rule for this product, set in the
   * dashboard, and it is what the shopper is told and what their file is
   * measured against. It was previously computed only as a min() against the
   * 0.6 MB EMBEDDING limit, which meant any value the owner could actually type
   * (the field's minimum is 1) was clamped straight back to 0.6 and never
   * reached the real check — so the control existed, stored a number, and did
   * nothing at all.
   *
   * `embedMaxUploadMb` is the separate, much smaller ceiling that applies only
   * when object storage is unreachable and the bytes have to travel inside the
   * order document.
   */
  const productMaxUploadMb = Math.min(
    Number(uploadRules.maxFileSizeMb) > 0 ? Number(uploadRules.maxFileSizeMb) : STORAGE_MAX_UPLOAD_MB,
    STORAGE_MAX_UPLOAD_MB,
  );
  const embedMaxUploadMb = Math.min(productMaxUploadMb, CONFIGURATOR_MAX_UPLOAD_MB);
  const hasCustomSizeField = activeFields.some((f) => f.allowCustomSize);
  // The calculator belongs to area pricing, so it follows the same flag the
  // price does — see calcConfiguredItemPrice. It used to follow `enabled`, the
  // artwork-upload switch, and so appeared on every product that took a file.
  const sizeCalculatorVisible = uploadRules.areaPriced === true && !hasCustomSizeField;

  // ---- pricing -----------------------------------------------------------
  // Only the branches actually on screen are in `selectedOptions`, so a
  // surcharge behind an unchosen option cannot reach this sum. See optionTree.ts.
  const optionsSurcharge = optionsSurchargeOf(selectedOptions);
  // Options charged once per line (a die, a proof, a designer) — added after the
  // quantity, never multiplied by it. Same split the server makes; see
  // src/lib/chargeOnce.ts.
  const onceCharges = onceChargesOf(selectedOptions);

  // A size typed into custom-size mode must stop counting the moment the shopper
  // goes back to a preset. It did not: the entered 200 x 150 stayed in state,
  // kept inflating the area surcharge, travelled into the cart line and was then
  // re-priced by the server from those same stale numbers — so a customer who
  // tried a custom size and changed their mind was charged for it anyway.
  const sizedByShopper = customModeFields.length > 0 || sizeCalculatorVisible;
  const effectiveWidthCm = sizedByShopper ? customWidthCm : PRICING_DEFAULTS.defaultWidthCm;
  const effectiveHeightCm = sizedByShopper ? customHeightCm : PRICING_DEFAULTS.defaultHeightCm;

  const pricingInput = {
    basePrice: product.basePrice,
    // The offer price, if the owner set one. It goes in HERE rather than being
    // applied afterwards, so the quantity ladder, every option card's "what this
    // would cost" figure and the sticky total are all computed from the same
    // number the server will charge.
    salePrice: product.salePrice,
    optionsSurcharge,
    onceCharges,
    widthCm: effectiveWidthCm,
    heightCm: effectiveHeightCm,
    uploadRules,
    pricingRules,
  };

  const {
    dimensionSurcharge, rawUnitPrice, discountPercent, unitPrice, setupFee, totalPrice,
    isOnSale, listUnitPrice, listTotalPrice, onceCharges: lineOnceCharges,
  } = calcConfiguredItemPrice({ ...pricingInput, quantity });

  // THE CLOTHING TEMPLATE — one basket line per size (src/lib/clothingTemplate.ts).
  // Each size is priced as the line it becomes: the chosen options with that
  // size's surcharge in place of the selected one, at that size's quantity —
  // what the server will charge for the line.
  const sizeQtyField = activeFields.find(isSizeQuantityField);
  const sizeQtyChosen = sizeQtyField ? selectedOptions[fieldPathKey([sizeQtyField.id])] : undefined;
  const sizeQtyOptions = sizeQtyField ? sizeQtyField.options : [];
  const priceForSize = (option: PrintingFieldOption, qty: number) =>
    calcConfiguredItemPrice({
      ...pricingInput,
      optionsSurcharge: optionsSurcharge - (Number(sizeQtyChosen?.priceModifier) || 0) + (Number(option.priceModifier) || 0),
      quantity: qty,
    });
  const sizeLines = sizeQtyOptions
    .map((option) => ({ option, qty: sizeQty[option.id] || 0 }))
    .filter((line) => line.qty > 0)
    .map((line) => ({ ...line, price: priceForSize(line.option, line.qty) }));
  const sizePieces = sizeLines.reduce((sum, line) => sum + line.qty, 0);
  const sizeTooFew = !!sizeQtyField && sizePieces < minQty;
  const shownTotal = sizeQtyField ? sizeLines.reduce((sum, line) => sum + line.price.totalPrice, 0) : totalPrice;

  // THE BADGE IS A PROPERTY OF THE PRODUCT, not of this configuration.
  //
  // Two rules, and they do different jobs:
  //  - WHETHER to show it: isOnSale, which comes off the finished totals and so
  //    knows about the minimum-price floor. An offer the floor erased is not an
  //    offer and gets no badge.
  //  - WHAT it says: the product's own two prices, each lifted to the minimum
  //    unit price as the shop card lifts them — the card's rule, read from the
  //    same place (src/lib/cardPrice.ts). From the bare prices, 200 kr offered at
  //    100 with the 149 kr minimum said "−50%" here while the page charged 149
  //    (code review 2026-10-11, REVIEW-3 #4 / N). Deriving it from the finished
  //    unit prices instead makes it drift as the shopper adds options — 30%
  //    before choosing a 250 kr paper, 24% after — and disagree with the grid,
  //    which cannot know what they picked. His reference shows a campaign badge
  //    on the photo; that is a fact about the product.
  // No badge at 0: the minimum can leave the product's two shown prices equal.
  const offerPercent = isOnSale ? offerPercentShown(product.basePrice, product.salePrice, unitPriceFloor(uploadRules)) : 0;

  const ladderRows = useMemo(
    () =>
      buildQuantityLadder(
        pricingInput,
        ladderQuantities({
          minQuantity: product.minQuantity,
          maxQuantity: product.maxQuantity,
          volumeDiscounts: pricingRules.volumeDiscounts,
          currentQuantity: quantity,
        }),
      ),
    // The ladder depends on everything that moves a price, quantity included —
    // the configured quantity is one of the rows.
    [
      product.basePrice,
      // Nothing enforces hook dependencies in this project — there is no ESLint,
      // and the disable comment below is decorative. Leave salePrice out and the
      // ladder keeps quoting yesterday's prices after an offer starts.
      product.salePrice,
      product.minQuantity,
      product.maxQuantity,
      optionsSurcharge,
      onceCharges,
      effectiveWidthCm,
      effectiveHeightCm,
      quantity,
      // eslint-disable-next-line react-hooks/exhaustive-deps
      JSON.stringify(pricingRules.volumeDiscounts),
    ],
  );

  /**
   * WHAT ONE UNIT COSTS IF THIS OPTION WERE THE CHOSEN ONE.
   *
   * The cards used to say "Included" or "+150 kr" and nothing else, so a shopper
   * comparing three rollup sizes could see what each one ADDED but never what
   * any of them COST — the reference shops put the price on the card and this
   * one did not, which is what the owner is asking for.
   *
   * Two rules make this safe to show. It prices through
   * `calcConfiguredItemPrice`, the same function the server re-prices the basket
   * with, so a number on a card cannot promise something checkout will not
   * honour. And it builds the hypothetical selection with `selectOption`, the
   * same pruning the real click goes through, so switching an option that
   * carries sub-options does not leave the old branch's surcharges in the sum.
   */
  const unitPriceIfChosen = (pathKey: string, option: PrintingFieldOption): number =>
    calcConfiguredItemPrice({
      ...pricingInput,
      // Only the per-piece options move a unit price; a one-off option leaves
      // it alone and the card says "+X kr per order" instead.
      optionsSurcharge: optionsSurchargeOf(
        selectOption(selectedOptions, pathKey, option, t('cfgCustomSizeCard')),
      ),
      quantity,
    }).unitPrice;

  // ---- option selection --------------------------------------------------
  /**
   * @param pathKey the field's selection path — its id at the top level,
   *        'field>option>subField' inside an option. See src/lib/optionTree.ts.
   */
  const handleSelectOption = (pathKey: string, option: PrintingFieldOption) => {
    setSelectedOptions((prev) => {
      // Sets the choice, drops whatever the previous branch had answered, and
      // seeds the new branch's defaults — all of it in optionTree.ts, where it
      // is tested.
      const next = selectOption(prev, pathKey, option, t('cfgCustomSizeCard'));

      // There is one width × height pair for the whole item, and the bounds of
      // every field in custom-size mode are enforced together. Two such fields
      // with different limits can therefore have no valid size at all, which
      // blocks add-to-cart with no way out. Only the field just chosen stays in
      // custom mode; the others fall back to their default preset.
      //
      // Sub-fields are included: a custom size inside an option is still the same
      // single pair of numbers.
      if (option.id === CUSTOM_SIZE_OPTION_ID) {
        for (const { field, pathKey: otherKey } of visibleFieldEntries(activeFields, next)) {
          if (otherKey === pathKey || !field.allowCustomSize) continue;
          if (next[otherKey]?.id !== CUSTOM_SIZE_OPTION_ID) continue;
          const fallback =
            field.options.find((o) => o.isDefault) ??
            [...field.options].sort((a, b) => (a.priceModifier || 0) - (b.priceModifier || 0))[0];
          if (fallback) next[otherKey] = fallback;
        }
      }

      return next;
    });
  };

  // ---- artwork upload ----------------------------------------------------
  const clearArtwork = () => {
    uploadTokenRef.current += 1;
    discardUpload(uploadedPathRef.current);
    setUploadedFileName('');
    setUploadedFile(null);
    setUploadedFileData(null);
    setUploadedUrl(null);
    setStoredPath(null);
    setUploadProgress(null);
    setFileValidationError('');
    setUploadedSource(null);
    setDesignFit(null);
    setUploadedBleedMm(null);
    setUploadedPdfBox(null);
    setUploadedDpi(null);
    setUploadedTemplate(null);
    setUploadedPages(null);
  };

  /**
   * A file that has passed its checks goes onto the line: into object storage,
   * or embedded when storage is unreachable. The dropzone and the online designer
   * both end here.
   *
   * The designer's file does NOT go through handlePickFile's checks (round 16
   * review). They are rules for files a customer brings: the owner's formats
   * picker (a PDF-only product would refuse the designer's PNG), his size cap,
   * and a re-decode of a 16 MP image to measure what the designer already knows.
   */
  const attachArtwork = async (
    file: File,
    {
      source,
      preview,
      fit,
      bleedMm = null,
      dpi = null,
      template = null,
      pdfBox = null,
      pages = null,
    }: {
      source: 'upload' | 'designer';
      preview?: File;
      fit?: DesignFit;
      bleedMm?: number | null;
      dpi?: number | null;
      template?: { id: string; name: string } | null;
      pdfBox?: ChosenArtworkBox | null;
      /** A studio design's pages: each side's picture, to upload beside the file. */
      pages?: { sides: SideId[]; previews: Array<{ side: SideId; file: File }> } | null;
    },
  ) => {
    const token = (uploadTokenRef.current += 1);
    discardUpload(uploadedPathRef.current);
    setUploadedBleedMm(bleedMm);
    setUploadedPdfBox(pdfBox);
    setUploadedDpi(dpi);
    setUploadedTemplate(template);
    setUploadedPages(null);
    // Put it in OBJECT STORAGE, which is where a print file belongs: the order
    // document then carries a URL of a couple of hundred bytes instead of
    // megabytes of base64, and the 0.6 MB ceiling that used to turn away
    // ordinary press-ready PDFs disappears.
    setUploadedFileName(file.name);
    // The preview draws this. A design hands over a small picture of its trim,
    // so a phone does not decode a 16 MP file into a 190-pixel box.
    setUploadedFile(preview ?? file);
    setUploadedSource(source);
    setDesignFit(fit ?? null);
    setUploadedUrl(null);
    setStoredPath(null);
    setUploadedFileData(null);
    setUploadProgress(0);

    try {
      // The bucket's rules key on an owner, and most shoppers are not signed in
      // when they configure a job — so a guest gets an anonymous identity, the
      // same way the custom-upload page has done since storage went live.
      let uid = auth.currentUser?.uid;
      if (!uid) uid = (await signInAnonymously(auth)).user.uid;
      const up = await uploadFile(file, {
        userId: uid,
        folder: 'artwork',
        onProgress: (percent) => {
          if (token === uploadTokenRef.current) setUploadProgress(percent);
        },
        // No contentType: uploadFile stores the file under a type the bucket
        // takes, by its extension when the browser gave none (.eps, .ai, .psd).
      });
      if (token !== uploadTokenRef.current) {
        // Replaced or removed while it was uploading.
        discardUpload(up.path);
        return;
      }
      // A studio design's page pictures, small, beside it. Without them the order
      // still has its file; screens then show the file's name instead of a picture.
      let previews: Array<{ side: SideId; url: string }> = [];
      if (pages?.previews.length) {
        const done = await Promise.allSettled(
          pages.previews.map(async (p) => {
            const r = await uploadFile(p.file, { userId: uid!, folder: 'artwork', contentType: 'image/png' });
            return { side: p.side, url: r.url, path: r.path };
          }),
        );
        const ok = done.flatMap((d) => (d.status === 'fulfilled' ? [d.value] : []));
        if (token !== uploadTokenRef.current) {
          discardUpload(up.path);
          for (const p of ok) void deleteUploadedFile(p.path);
          return;
        }
        previewPathsRef.current = ok.map((p) => p.path);
        previews = ok.map(({ side, url }) => ({ side, url }));
      }
      setUploadedUrl(up.url);
      setStoredPath(up.path);
      if (pages) setUploadedPages({ sides: pages.sides, previews });
      setUploadedFileData(null);
      setUploadProgress(null);
      return;
    } catch (err) {
      if (token !== uploadTokenRef.current) return;
      console.warn('Storage upload unavailable — falling back to embedding the file:', err);
    }

    // Storage was unreachable. Embedding still works, but only for a file small
    // enough to survive inside the order document — and saying so beats a
    // failure at payment time.
    setUploadProgress(null);
    if (file.size > embedMaxUploadMb * 1024 * 1024) {
      setUploadedFileName('');
      setUploadedFile(null);
      setUploadedSource(null);
      setDesignFit(null);
      setFileValidationError(
        t('ppArtworkStorageDown').replace('{0}', formatMb(embedMaxUploadMb)),
      );
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (token === uploadTokenRef.current) setUploadedFileData(ev.target?.result as string);
    };
    reader.onerror = () => {
      if (token !== uploadTokenRef.current) return;
      setUploadedFileName('');
      setUploadedFileData(null);
      setUploadedSource(null);
      setDesignFit(null);
      setFileValidationError(t('cfgFileReadError'));
    };
    reader.readAsDataURL(file);
  };

  const handlePickFile = async (file: File) => {
    // A ticket for THIS pick. Measuring a big PDF takes a while with nothing on
    // screen, so picking again is natural: without the ticket the first, slower
    // pick finished last and replaced the second (and deleted its upload). A
    // design attached meanwhile, or "Remove", bumps it too.
    const ticket = (uploadTokenRef.current += 1);
    setFileValidationError('');
    setDesignerNotice('');
    const reject = (message: string) => {
      if (ticket !== uploadTokenRef.current) return;
      setFileValidationError(message);
      setUploadProgress(null);
    };

    // The owner's ceiling for this product, capped by the bucket's own 50 MB.
    // A press-ready PDF is routinely several megabytes; the 0.6 MB limit further
    // down is only what an EMBEDDED file can be, and embedding is the fallback,
    // not the plan.
    if (file.size > productMaxUploadMb * 1024 * 1024) {
      reject(t('cfgFileTooLargeError').replace('{0}', formatMb(productMaxUploadMb)));
      return;
    }

    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    if (
      uploadRules.allowedFormats &&
      uploadRules.allowedFormats.length > 0 &&
      !uploadRules.allowedFormats.includes(ext)
    ) {
      reject(t('cfgUnsupportedFormatError').replace('{0}', uploadRules.allowedFormats.join(', ')));
      return;
    }

    // The artwork must physically FIT the print size the customer picked.
    // The same size the dropzone promised and the preview drew — computed once,
    // above, so the three can never disagree about what the file has to be.
    const requiredMm = customSizeInvalid ? undefined : requiredArtworkMm ?? undefined;
    if (requiredMm) {
      const fmtMm = (w: number, h: number) => `${Math.round(w)} × ${Math.round(h)} mm`;
      // Either size is right: the trim, or the trim with the 3 mm bleed the
      // dropzone itself asks for (src/lib/artworkFit.ts). Say both.
      const requiredLabel =
        fmtMm(requiredMm.wMm, requiredMm.hMm) +
        t('cfgOrWithBleed').replace('{0}', fmtMm(requiredMm.wMm + 2 * ARTWORK_BLEED_MM, requiredMm.hMm + 2 * ARTWORK_BLEED_MM));
      // Loaded on demand, never at import time: dpiUtils pulls in pdfjs-dist
      // (~479 KB raw / 142 KB gzipped) to read a PDF's true page size, and this
      // component is reached from App.tsx's static import of the configurator
      // modal — so a statically imported measureArtworkMm made EVERY visitor
      // download and parse a PDF engine before the home page painted. The size
      // check only runs once someone actually picks a file, which is the only
      // moment the engine is needed. NeoSizePreview defers pdf.js the same way.
      const { measureArtworkMm } = await import('../../lib/dpiUtils');
      const measured = await measureArtworkMm(file);
      if (ticket !== uploadTokenRef.current) return;
      // A PDF's page within ±2 mm, a picture's proportions within 2 % and at
      // 150 DPI or more (15.6.2b: the same constant the dropzone quotes) —
      // against the trim OR the trim with its bleed. src/lib/artworkFit.ts.
      let fit = checkArtworkFit(measured, requiredMm);
      // THE PAGE FIRST, exactly as before. Only a page that does not fit is
      // measured again by the file's own TrimBox (or BleedBox) — a PDF/X exported
      // with crop marks, whose page is bigger than the product (src/lib/pdfBoxes.ts).
      // So no file accepted before is refused now, or read differently.
      let byBox: ChosenArtworkBox | null = null;
      // Read only now, for a refused page: most files never need their bytes twice.
      const fileBox = fit.kind === 'size-mismatch' && measured.kind === 'pdf' && measured.readBox ? await measured.readBox() : null;
      if (ticket !== uploadTokenRef.current) return;
      if (fileBox) {
        const boxFit = checkArtworkFit({ kind: 'pdf', widthMm: fileBox.widthMm, heightMm: fileBox.heightMm }, requiredMm);
        // A TrimBox IS the product, so it must be the size itself. One the size WITH
        // bleed is a document made with its bleed inside, then exported with marks:
        // placed by that box, the bleed would print as product (round 16 review).
        if (boxFit.kind === 'ok' && fileBox.source === 'trimbox' && boxFit.withBleed === true) {
          reject(
            t('cfgArtworkTrimHasBleed')
              .split('{0}')
              .join(fmtMm(fileBox.widthMm, fileBox.heightMm))
              .replace('{1}', fmtMm(requiredMm.wMm, requiredMm.hMm)),
          );
          return;
        }
        if (boxFit.kind === 'ok') {
          fit = boxFit;
          byBox = fileBox;
        }
      }
      if (fit.kind === 'size-mismatch' && measured.kind === 'pdf') {
        // Quote what the file SAYS its product is, when it says; else the page.
        const said = fileBox?.source === 'trimbox' ? fileBox : null;
        let message = t('cfgArtworkSizeMismatch')
          .replace('{0}', fmtMm(said ? said.widthMm : measured.widthMm, said ? said.heightMm : measured.heightMm))
          .replace('{1}', requiredLabel);
        // A page well over the size WITH bleed, and no TrimBox to say where the
        // product is: most likely printer's marks.
        const over = (w: number, h: number) =>
          w - (requiredMm.wMm + 2 * ARTWORK_BLEED_MM) > 5 && h - (requiredMm.hMm + 2 * ARTWORK_BLEED_MM) > 5;
        if (!said && (over(measured.widthMm, measured.heightMm) || over(measured.heightMm, measured.widthMm))) {
          message += ' ' + t('cfgArtworkCropMarksHint');
        }
        reject(message);
        return;
      }
      if (fit.kind === 'ratio-mismatch' && measured.kind === 'raster') {
        reject(
          t('cfgArtworkRatioMismatch')
            .replace('{0}', `${measured.widthPx} × ${measured.heightPx} px`)
            .replace('{1}', requiredLabel),
        );
        return;
      }
      if (fit.kind === 'too-low-res') {
        reject(t('cfgArtworkTooLowRes').replace('{0}', `${fit.minWPx} × ${fit.minHPx}`));
        return;
      }
      // 'unmeasurable' (SVG/EPS/AI/PSD or undecodable) → accepted as before.
      if (fit.kind === 'ok' && byBox) {
        // Placed by its own box. A TrimBox's bleed is what its BleedBox says (none
        // said = unknown) — the TrimBox itself is the size, checked above; a BleedBox
        // measured alone is the size WITH bleed.
        const bleed = byBox.source === 'trimbox' ? byBox.bleedMm || null : fit.withBleed === true ? ARTWORK_BLEED_MM : null;
        await attachArtwork(file, { source: 'upload', bleedMm: bleed, pdfBox: byBox });
        return;
      }
      if (fit.kind === 'ok' && fit.withBleed === true) {
        await attachArtwork(file, { source: 'upload', bleedMm: ARTWORK_BLEED_MM });
        return;
      }
    }

    await attachArtwork(file, { source: 'upload' });
  };

  const handleAddToCart = () => addLine(false);

  /**
   * Into the basket — with his file or design, or (designer v2, design later) as
   * "Design online" WITHOUT the design: the gallery's "Add to basket without the
   * design". That line carries what the designer needs to open on it from the basket
   * or, once paid, the order page (src/lib/designLater.ts), and travels with no file
   * — the order then waits for the design like any artwork sent later.
   */
  const addLine = (withoutDesign: boolean) => {
    // The button is disabled too; this guards keyboard/programmatic submits.
    if (customSizeInvalid || uploadInProgress) return;
    if (sizeQtyField && (sizeLines.length === 0 || sizeTooFew)) return;
    if (withoutDesign ? !laterMarker : artworkMissing) return;
    // The cart carries the sentinel with the ENTERED size in its label, so the
    // cart panel and staff screens show what was ordered. The id stays
    // __custom_size — the server ignores ids it does not know and prices the
    // size from widthCm/heightCm instead.
    //
    // Keyed by FIELD ID, not by selection path: the cart drawer, the order
    // document and the production screens have always read a flat
    // {field: choice} map, and a sub-option is a choice like any other. Only one
    // branch of a field is ever selected at a time, so the flattening cannot lose
    // a choice the shopper actually made.
    const optionsForCart: Record<string, PrintingFieldOption> = flattenSelectionByFieldId(selectedOptions);
    if (parsedCustomW !== null && parsedCustomH !== null) {
      for (const f of customModeFields) {
        optionsForCart[f.id] = {
          ...optionsForCart[f.id],
          label: customSizeCartLabel(parsedCustomW, parsedCustomH),
        };
      }
    }

    // THE FILE TRAVELS ONLY WITH A METHOD THAT SENDS ONE (round 16 review). A
    // customer who attached a design and then chose "send the files later" or
    // "Reprint" still sent it: the order was filed as having its artwork, the
    // "we still need your file" e-mail never went, his real file was refused as
    // "already supplied", and the job sheet said "send later" beside an
    // abandoned draft that production would print.
    const fileTravels = !withoutDesign && (!artworkField || methodWantsFile || designerChosen);
    const travelling = fileTravels && !!uploadedFileName;
    // Protected BEFORE the line is handed over: at worst a file is orphaned,
    // never a line left pointing at one that was deleted.
    if (travelling && uploadedPathRef.current) committedPathsRef.current.add(uploadedPathRef.current);
    if (travelling) for (const p of previewPathsRef.current) committedPathsRef.current.add(p);
    // A round design's size is its diameter, which the file check never reads
    // (requiredArtworkMm is null for "30 mm ø"): the design's own trim says it.
    // Designed later: the size the designer will open at — the board this page shows.
    const lineTrim =
      requiredArtworkMm ?? (withoutDesign ? designTrim : travelling && uploadedSource === 'designer' ? designFit : null);

    const linePayload: ConfiguredCartLine = {
      product,
      selectedOptions: optionsForCart,
      quantity,
      totalUnitPrice: unitPrice,
      totalPrice,
      // ONLY when the shopper actually chose a size. When they were never asked
      // one, effectiveWidth/HeightCm are the 50 x 70 pricing defaults — a number
      // the area formula needs to produce a price, not a measurement of anything
      // — and sending them on made every line in the basket read "50 × 70 cm".
      // None of the 16 live products has a custom-size field, so that was the
      // whole shop: a 180 x 70 MM door sign was listed as half a metre wide.
      // The cart drawer and the checkout summary both print the size only if it
      // is there, so omitting it shows nothing rather than a lie.
      widthCm: sizedByShopper ? effectiveWidthCm : undefined,
      heightCm: sizedByShopper ? effectiveHeightCm : undefined,
      // 15.6.3 — the size his FILE has to be, which on a preset-size product is
      // not the pair above (they are a pricing input and stay undefined). It is
      // the size on the option he picked, and it is the answer to "at the size
      // the customer chose".
      printWidthCm: lineTrim ? Math.round(lineTrim.wMm) / 10 : undefined,
      printHeightCm: lineTrim ? Math.round(lineTrim.hMm) / 10 : undefined,
      fileName: travelling ? uploadedFileName : undefined,
      fileDataUrl: travelling ? uploadedFileData : null,
      fileUrl: travelling ? uploadedUrl : null,
      storagePath: travelling ? uploadedPath : null,
      fileBleedMm: travelling ? uploadedBleedMm : null,
      fileDpi: travelling ? uploadedDpi : null,
      fileTemplate: travelling ? uploadedTemplate : null,
      filePlaceBy: travelling && uploadedPdfBox ? (uploadedPdfBox.source === 'trimbox' ? 'trimbox' : 'bleedbox') : null,
      filePreviews: travelling && uploadedPages?.previews.length ? uploadedPages.previews : null,
      fileSides: travelling && uploadedPages ? uploadedPages.sides : null,
      filePageMm: travelling && uploadedPdfBox ? { wMm: uploadedPdfBox.pageWidthMm, hMm: uploadedPdfBox.pageHeightMm } : null,
      designLater: withoutDesign ? laterMarker : null,
    };

    // The clothing template: one line per size that has a quantity, each with
    // its own size, quantity and price; everything else is the same line.
    let accepted: boolean | void | undefined;
    if (sizeQtyField) {
      for (const line of sizeLines) {
        accepted = onAddToCart?.({
          ...linePayload,
          selectedOptions: { ...optionsForCart, [sizeQtyField.id]: line.option },
          quantity: line.qty,
          totalUnitPrice: line.price.unitPrice,
          totalPrice: line.price.totalPrice,
        });
        if (accepted === false) return;
      }
      setSizeQty({});
    } else {
      accepted = onAddToCart?.(linePayload);
    }

    if (accepted === false) return;
    // Added without the design: said where he is (the designer step), with where to design it.
    if (withoutDesign) setDesignerNotice(t('stDlAdded'));
    setAddedSuccess(true);
    window.setTimeout(() => {
      setAddedSuccess(false);
      // Not while the designer is open again: closing the product dialog under
      // it would unmount it mid-design and strand its history entry.
      if (!designerOpenRef.current) onAdded?.();
    }, 1800);
  };

  // ---- what goes where ---------------------------------------------------
  const artworkField = activeFields.find((f) => f.id === ARTWORK_METHOD_FIELD_ID);

  /**
   * Does the chosen supply method expect a file at all?
   *
   * With the method field, the chosen method decides — "send the files later"
   * and the design service do not. Without it there is nothing to choose and a
   * printed job normally wants one, so the dropzone stands on its own.
   */
  const methodWantsFile = artworkField
    ? methodNeedsArtwork(selectedOptions[artworkField.id])
    : true;

  /**
   * ...and is that file OBLIGATORY before the shopper may buy?
   *
   * Only when the owner has said so on the product. The shop's default is that
   * artwork is optional: phone orders, repeat jobs and "my designer is still
   * finishing it" are ordinary print-shop business, and refusing the sale until
   * a file appears loses the order instead of starting it. When nothing is
   * attached the line travels as `artworkPending` and production is told.
   */
  /**
   * Whether the artwork block appears AT ALL on this product.
   *
   * He circled "YOUR ARTWORK (OPTIONAL) / order now and send the file later" and
   * asked to decide per product. Some of what he sells is finished goods — a
   * supplier's mug or a rollup stand bought as stock — where asking the customer
   * for a print file is a question with no answer, and one he cannot switch off.
   *
   * THE DEFAULT IS OFF, and it was the other way round until 2026-09-13.
   *
   * It shipped as "shown unless switched off" for a careful reason — the whole
   * catalogue predates the field, and flipping it would take the upload box off
   * every product at once. That is exactly what the owner then asked for. His
   * client opened an ACRYLIC DISPLAY STAND — a finished good, nothing is printed
   * on it — and found "YOUR ARTWORK · Click or drop your file here" on it, and on
   * all 109 products, because not one of them had the field set. The importer
   * does not set it either: it marks supplier stock `artworkRequired: false` and
   * says in its own comment that these are "stocked hardware, not print jobs".
   *
   * So: the box appears only where the owner has ticked it. Nothing was written
   * to any product to achieve that — every one of the 109 simply has no value,
   * and no value now means off, which is why this is one line and is reversible
   * by changing it back.
   */
  const artworkBlockShown = artworkBoxShown(product);
  /**
   * THE SHOP'S STUDIO designs this line — the design-service question or the
   * supply method's own "full design service" (src/lib/artwork.ts). His file is
   * not what prints, so it is never REQUIRED of him: on a "file required" product
   * a customer who had bought the design service could not add it to the basket.
   * Deliberately NOT folded into methodWantsFile — a file he attaches anyway still
   * travels, as his material for the designer.
   */
  // By FIELD id, as the basket and the server read it: the selection is keyed by
  // path, and a design-service question nested under another option would not be
  // recognised by its value here while the server counted it.
  const shopArtwork = artworkSourceOf(
    Object.entries(flattenSelectionByFieldId(selectedOptions)).map(([fieldId, opt]) => ({
      fieldId,
      id: opt?.id ?? null,
      value: opt?.value ?? null,
    })),
  );
  const studioChosen = shopArtwork === 'studio';
  const artworkRequired = artworkFileRequired(product, methodWantsFile && !studioChosen);
  /**
   * "DESIGN ONLINE" WANTS A DESIGN — round 16, item 5 (review B2).
   *
   * It was listed with "send the files later" as a method that needs no file
   * today, so choosing it and pressing add-to-cart sent production an order
   * stamped "waiting for artwork" while the customer believed his design had
   * gone with it. The line now waits for the design itself, whatever the
   * product's "file required" setting says: the customer chose to make it here.
   */
  const designerChosen = artworkBlockShown && !!artworkField && isDesignerMethod(selectedOptions[artworkField.id]);
  // designStale is computed further down, once the size is known: a design made
  // for another size holds the order at once, though it is taken off only when
  // the customer stops typing (see the detach effect).
  // Not when the studio makes the artwork anyway (a studio package beside "Design
  // online"): the order would be held for a design the shop does not print from.
  const designMissing = designerChosen && !studioChosen && (uploadedSource !== 'designer' || !uploadedFileName);
  const artworkMissingNow = (artworkRequired && !uploadedFileName) || designMissing;
  const uploadInProgress = uploadProgress !== null;

  /**
   * The finished size the shopper has configured, and WHICH FIELD said so.
   *
   * One source, used by three things that must agree: the sentence on the
   * dropzone, the frame the preview draws, and the check that refuses a file of
   * the wrong size. A typed custom size wins; otherwise it is the first selected
   * option carrying a parseable size, in field order.
   */
  const sizeSource: { mm: { wMm: number; hMm: number }; field?: PrintingField } | null = (() => {
    if (customModeFields.length > 0 && parsedCustomW !== null && parsedCustomH !== null) {
      return { mm: { wMm: parsedCustomW * 10, hMm: parsedCustomH * 10 }, field: customModeFields[0] };
    }
    /**
     * THE STANDALONE SIZE CALCULATOR COUNTS TOO — 15.6.1.
     *
     * An area-priced product with no custom-size FIELD shows the width × height
     * calculator instead, and that size never reached here: the screen read its
     * size from this function while the cart read a different one
     * (`sizedByShopper`), and the two only overlapped on the custom-size field.
     * So on exactly the products where the customer types his own size, the
     * dropzone said nothing about what size his file should be — which is the
     * question he was asking.
     */
    if (sizeCalculatorVisible && customWidthCm > 0 && customHeightCm > 0) {
      return { mm: { wMm: customWidthCm * 10, hMm: customHeightCm * 10 } };
    }
    for (const { field, pathKey } of visibleEntries) {
      const chosen = selectedOptions[pathKey];
      if (!chosen) continue;
      const dims = parseDimensionsMm(chosen);
      if (dims) return { mm: dims, field };
    }
    return null;
  })();

  const requiredArtworkMm = sizeSource?.mm ?? null;

  /**
   * THE CUT SHAPE the customer chose (src/lib/shapes.ts) — any real shape before
   * a square or a rectangle, so a product carrying the legacy "Design shape"
   * (rectangle) beside "Shape" previews the customer's Star. `cutPathKey` is the
   * question it was chosen in: the notes about the cut are shown under it.
   */
  const outlineEntries = visibleEntries.flatMap(({ field, pathKey }) => {
    const chosen = selectedOptions[pathKey];
    const outline = chosen ? outlineOf(chosen, field) : null;
    return outline ? [{ outline, pathKey }] : [];
  });
  const chosenOutline = primaryOutline(outlineEntries);
  const cutPathKey = outlineEntries.find((e) => e.outline === chosenOutline)?.pathKey ?? null;
  // A round item sized "30 mm ø" has no width × height for the file check, by
  // design; the preview may still draw it, as a circle that size.
  const previewArtworkMm = requiredArtworkMm ?? (() => {
    if (chosenOutline !== 'circle') return null;
    for (const { pathKey } of visibleEntries) {
      const d = diameterMm(selectedOptions[pathKey]);
      if (d) return { wMm: d, hMm: d };
    }
    return null;
  })();

  // WHAT THE CUT MEANS FOR THE FILE, said under the shape question itself. Both
  // notes used to live inside the preview, which shows only when the upload box
  // is on AND the customer is sending a file now — so a "custom contour" buyer
  // who chose "send the file later" was never told to put the cut line in it.
  const cutSize = requiredArtworkMm ?? previewArtworkMm;
  const cutNote: 'ppCustomOutlineNote' | 'ppShapeNotSquare' | null =
    chosenOutline === 'custom'
      ? 'ppCustomOutlineNote'
      : chosenOutline && needsSquareBox(chosenOutline) && cutSize && Math.abs(cutSize.wMm - cutSize.hMm) > 0.5
        ? 'ppShapeNotSquare'
        : null;

  /**
   * The size in words, for the dropzone — 15.6.2.
   *
   * In the unit the customer thinks in. It was always millimetres, so a roll-up
   * was described to him as "850 × 2000 mm": correct, and not how anybody orders
   * a roll-up. formatSizeForShopper switches to centimetres from 100 mm up,
   * which is where the trade switches too.
   */
  const requiredArtworkLabel = requiredArtworkMm
    ? formatSizeForShopper(requiredArtworkMm.wMm, requiredArtworkMm.hMm)
    : undefined;

  // ---- the online designer (round 16, item 5) ------------------------------
  // The board is the size the file check uses, or for a round item sized
  // "30 mm ø" the preview's circle.
  const designTrim = customSizeInvalid ? null : (requiredArtworkMm ?? previewArtworkMm);
  // The pages the line prints, and how: from the options chosen (src/lib/printSides.ts).
  const chosenByField = useMemo(() => flattenSelectionByFieldId(selectedOptions), [selectedOptions]);
  const lineSides = useMemo(
    () => printSides(Object.entries(chosenByField).map(([fieldId, o]) => ({ fieldId, id: o?.id, value: o?.value }))),
    [chosenByField],
  );
  const sidesKey = lineSides.sides.join(',');
  // Bleed, safe area, hidden zones and resolution for this product at this size: its
  // kind's defaults, the owner's resolution table, his own values for the product.
  const designSpec = useMemo(
    () =>
      designTrim
        ? printSpecFor({
            kind: kindOfProduct(Object.keys(chosenByField)),
            trimMm: designTrim,
            bands: cleanDpiBands(siteSettings.designerDpiBands),
            override: (product as { printSpec?: unknown }).printSpec,
          })
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [designTrim?.wMm, designTrim?.hMm, chosenByField, siteSettings.designerDpiBands, (product as { printSpec?: unknown }).printSpec],
  );
  const designBlock = designerChosen
    ? designerBlock(designTrim, { customSizeInvalid, outline: chosenOutline, sides: lineSides.blocked })
    : null;
  // "Add to basket without the design" (design later): what the designer needs to
  // open on the line away from this page. Not when the owner wants the file before
  // the sale (the product's "file required"), nor when the designer cannot open here.
  // Asked of the PRODUCT: `artworkRequired` above is always false while "Design online"
  // is chosen (it is not a method that sends a file NOW), so it let these through.
  const fileRequiredBeforeSale = artworkBlockShown && product.artworkRequired === true;
  const laterMarker =
    designerChosen && !studioChosen && !designBlock && designTrim && designSpec && !fileRequiredBeforeSale
      ? cleanDesignLaterMarker({
          trimMm: designTrim,
          outline: chosenOutline && chosenOutline !== 'rect' ? chosenOutline : null,
          sides: lineSides.sides,
          ink: lineSides.ink,
          sameOnBothSides: lineSides.sameOnBothSides,
          kind: designSpec.kind,
          printSpec: (product as { printSpec?: unknown }).printSpec ?? null,
          categoryId: product.categoryId ?? null,
        })
      : null;

  // Start fetching the designer the moment it is chosen, so "Open the designer"
  // opens rather than loads.
  useEffect(() => {
    if (!designerChosen) return;
    void loadGallery().catch(() => {});
    void loadDesigner().catch(() => {});
  }, [designerChosen]);

  // …and the owner's templates for this product, from the server's copy (no
  // Firestore read per page view). An empty list when there are none.
  useEffect(() => {
    if (!designerChosen) return;
    let alive = true;
    const productId = product.id;
    void fetchTemplateList(productId, product.categoryId).then((list) => {
      if (alive) setDesignTemplates({ productId, list });
    });
    return () => {
      alive = false;
    };
  }, [designerChosen, product.id, product.categoryId, templatesAttempt]);
  // undefined while this product's list is on its way.
  const templatesHere = designTemplates?.productId === product.id ? designTemplates.list : undefined;
  const retryTemplates = () => {
    setDesignTemplates(null);
    setTemplatesAttempt((n) => n + 1);
  };

  // A DESIGN MADE FOR ONE SIZE IS NOT THE ARTWORK FOR ANOTHER. Changing the size
  // or the cut after "Use this design" left the 50 × 50 file on a 100 × 50 line,
  // and the line's print size then stated the new one. The order is held AT ONCE;
  // the design is taken off (its upload deleted, if no basket line uses it) only
  // once the size has stayed changed for a moment. Typing "100" over "100" goes
  // through "10", and that alone must not throw a finished design away.
  //
  // NOR FOR ANOTHER INK (code review DSN-03). A design made in full colour stayed
  // on a line switched to 1/0 black, or to a Pantone, all-over or unprinted
  // setting the designer refuses to make — and the order went through with it.
  //
  // The size and the cut only: that is what the size notice is about. The pages
  // are part of the print — a card switched from 4/4 to 4/0 is the same size, and
  // was told "you changed the size or the shape" (code review 2026-10-11, H).
  const designSizeFits =
    !!designFit &&
    !!designTrim &&
    Math.abs(designTrim.wMm - designFit.wMm) < 0.01 &&
    Math.abs(designTrim.hMm - designFit.hMm) < 0.01 &&
    (chosenOutline ?? null) === designFit.outline;
  const inkKey = inkKeyOf(lineSides.sides, lineSides.ink);
  const designStale =
    uploadedSource === 'designer' &&
    !!designFit &&
    (!designSizeFits || sidesKey !== designFit.sides || inkKey !== designFit.ink || !!lineSides.blocked);
  const artworkMissing = artworkMissingNow || designStale;
  useEffect(() => {
    if (!designStale || customSizeInvalid) return;
    const timer = window.setTimeout(() => {
      clearArtwork();
      // Size and cut as they were: it is the print that changed — its pages or ink.
      setDesignerNotice(t(designSizeFits ? 'dsgPrintChanged' : 'dsgSizeChanged'));
    }, 900);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designStale, customSizeInvalid, designTrim?.wMm, designTrim?.hMm, chosenOutline, sidesKey, inkKey, lineSides.blocked]);

  // THE PHONE'S BACK GESTURE CLOSES THE DESIGNER, not the product. Opening it
  // put a history entry under it (openDesigner); Back pops that entry, and
  // closing it any other way goes back over the same entry.
  useEffect(() => {
    if (!designerOpen) return;
    const onPop = () => {
      closingRef.current = false;
      setDesignerOpen(false);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [designerOpen]);

  // A page reloaded with the designer open (the shop reloads itself after a
  // deploy) wakes on the designer's history entry with no designer: the flag is
  // taken off, so the next close cannot go back over an entry that is not ours.
  useEffect(() => {
    const state = window.history.state as { rxDesigner?: boolean } | null;
    if (!state?.rxDesigner) return;
    try {
      window.history.replaceState({ ...state, rxDesigner: undefined }, '');
    } catch {
      /* nothing to tidy */
    }
  }, []);

  const openDesigner = () => {
    if (designBlock || !designTrim) return;
    // The list could not be had a moment ago: ask again as he opens it.
    if (templatesHere === null) retryTemplates();
    setDesignerNotice('');
    closingRef.current = false;
    // A design already attached: "Edit your design" goes straight back to it.
    // Otherwise the gallery, with his own draft (this page's, else this device's) first.
    const attached = uploadedSource === 'designer' && !!uploadedFileName;
    setDesignerStep(attached ? 'studio' : 'gallery');
    setDesignerStart(null);
    setDraftNotice(null);
    // His own design, if he has one: this page's, else this device's — not one made
    // from a shop template that does not fit this size (refitting would stretch the
    // shop's locked layout; the studio would set it aside, so it is not offered).
    const offerDraft = (savedAt: number, docJson: string) => {
      const meta = parseDesignDoc(docJson)?.template as { starter?: boolean; trimMm?: { wMm: number; hMm: number }; outline?: OutlineKind | null } | null;
      if (meta && !meta.starter && meta.trimMm && templateMiss(meta as Parameters<typeof templateMiss>[0], designTrim, chosenOutline) !== null) {
        setDeviceDraftAt(null);
        setDraftNotice(t('dsgTemplateOtherSize'));
        return;
      }
      setDeviceDraftAt(savedAt);
    };
    setDeviceDraftAt(null);
    if (designDraftRef.current) offerDraft(designDraftRef.current.savedAt, designDraftRef.current.doc);
    else if (!attached) {
      const productId = product.id;
      // A studio draft, else one the round-16 designer kept for this product.
      void (async () => (await loadDraft(`studio:${productId}`)) ?? (await loadDraft(productId)))().then((d) => {
        if (d && productIdRef.current === productId) offerDraft(d.savedAt, d.json);
      });
    }
    try {
      window.history.pushState({ ...(window.history.state ?? {}), rxDesigner: true }, '');
    } catch {
      /* no history: Back simply leaves the page, as before */
    }
    setDesignerOpen(true);
  };

  const closeDesigner = () => {
    // Once is enough: the dialog stays up until the browser has gone back.
    if (closingRef.current) return;
    if ((window.history.state as { rxDesigner?: boolean } | null)?.rxDesigner) {
      closingRef.current = true;
      window.history.back();
    } else {
      setDesignerOpen(false);
    }
  };

  /** The designer could not load or broke: the page stays, and says so. */
  const handleDesignerFailed = () => {
    setDesignerNotice(t('dsgLoadFailed'));
    closeDesigner();
  };

  /** The gallery's "Add to basket without the design": the line goes in, designed later. */
  const handleAddWithoutDesign = () => {
    if (closingRef.current || !laterMarker) return;
    setFileValidationError('');
    setDesignerNotice('');
    closeDesigner();
    addLine(true);
  };

  const handleDesignUsed = (result: DesignerResult) => {
    if (closingRef.current) return;
    setFileValidationError('');
    setDesignerNotice('');
    closeDesigner();
    const sides = result.sides ?? ['front'];
    void attachArtwork(result.file, {
      source: 'designer',
      preview: result.preview,
      // The ink is the line's as the studio was opened on it: nothing else can
      // change while the studio covers the page.
      fit: { wMm: result.trimMm.wMm, hMm: result.trimMm.hMm, outline: result.outline ?? null, sides: sides.join(','), ink: inkKeyOf(sides, lineSides.ink) },
      bleedMm: result.bleedMm,
      dpi: result.dpi,
      template: result.template?.id ? result.template : null,
      pages: result.previews?.length ? { sides: result.sides ?? result.previews.map((p) => p.side), previews: result.previews } : null,
    });
  };

  const deliveryField = activeFields.find((f) => f.id === DELIVERY_SPEED_FIELD_ID);
  const deliveryOptions = deliveryOptionsFrom(deliveryField, labelOf);

  // ONE COLUMN IN THE OWNER'S ORDER.
  //
  // This used to be three sections fixed in this file — print, artwork, then
  // delivery-and-services — which bucketed every field by its `group` and left
  // the shop no say in what came first. The visible consequence was a page that
  // asked how fast the customer wanted it before it asked how many they wanted,
  // and no setting anywhere could change that.
  //
  // The order of `printingFields` is now the order of the page, and the
  // dashboard's arrows are what rewrite it. The headings went with the buckets:
  // every field already carries its own name, so they were labelling a grouping
  // that no longer exists.
  const orderedFields = activeFields.filter((f) => !isSpeciallyRendered(f));


  const priceInfo = formatPriceWithVat(shownTotal);
  const sizeQtyBlocked = !!sizeQtyField && (sizeLines.length === 0 || sizeTooFew);

  // The quantity ladder — the price curve, which is the point of the redesign.
  // A row of the page like any other: it goes where he dragged it (pageRows).
  // The clothing template asks for a quantity under each size instead.
  const quantitySection = sizeQtyField ? null : (
    <section className="space-y-3" data-rx-block="quantity">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[0.6875rem] font-black uppercase text-gray-400 tracking-wider">
          {t('cfgQuantity')}
        </h3>
        <span className="text-[0.6875rem] font-black text-orange-600">
          {quantity} {t('ppPieces')}
        </span>
      </div>
      <NeoQuantityLadder
        rows={ladderRows}
        quantity={quantity}
        onPick={setQuantity}
        formatPrice={formatPrice}
        t={t}
        minQuantity={product.minQuantity}
        maxQuantity={product.maxQuantity}
      />
    </section>
  );

  /**
   * The hint under ONE axis: 'Between {min} and {max} cm', or nothing when that
   * axis is unbounded.
   *
   * The free-size sentence deliberately does not live here. It names both axes
   * ("type the width and height you need"), so printing it per axis showed it
   * twice side by side on a fully free field — and, worse, printed it under an
   * unbounded height while the bounded width beside it said "Between 20 and
   * 300 cm", two hints contradicting each other. It is a statement about the
   * field, so it is rendered once, above the pair.
   */
  const boundsHint = (min?: number, max?: number) =>
    min === undefined && max === undefined ? null : (
      <p className="text-[0.625rem] text-gray-500 font-medium mt-1">
        {t('cfgCustomSizeBounds')
          .replace('{0}', String(min ?? 1))
          .replace('{1}', String(max ?? 10000))}
      </p>
    );

  /** True only when the owner set no limit on any side. */
  const isFullyFreeSize = (field: PrintingField) =>
    field.minWidthCm === undefined &&
    field.maxWidthCm === undefined &&
    field.minHeightCm === undefined &&
    field.maxHeightCm === undefined;

  /**
   * One field, and — underneath it — whatever the chosen option asks next.
   *
   * `path` is the field's ancestry: empty at the top, ['sticker_type','opt_roll']
   * for a field that lives inside the "printed on a roll" option. Everything the
   * shopper sees is rendered by this one function, so a sub-option gets the same
   * cards, colour swatches, size grids, custom-size box and validation as a
   * top-level field. There is no second, lesser kind of option in this shop.
   */
  const renderField = (field: PrintingField, path: string[] = [], depth = 0) => {
    if (depth === 0 && sizeQtyField && field.id === sizeQtyField.id) {
      return (
        <ClothingSizeQuantities
          key={field.id}
          field={field}
          options={sizeQtyOptions}
          quantities={sizeQty}
          onChange={(id, n) => setSizeQty((prev) => ({ ...prev, [id]: n }))}
          unitPriceFor={(option, qty) => priceForSize(option, qty).unitPrice}
          labelOf={labelOf}
          productName={localized(product.name, product.nameI18n, language)}
          language={language}
        />
      );
    }
    const pathKey = fieldPathKey([...path, field.id]);
    const chosen = selectedOptions[pathKey];
    const inCustomMode = !!field.allowCustomSize && chosen?.id === CUSTOM_SIZE_OPTION_ID;
    const fieldInvalid =
      inCustomMode &&
      (!withinBounds(parsedCustomW, field.minWidthCm, field.maxWidthCm) ||
        !withinBounds(parsedCustomH, field.minHeightCm, field.maxHeightCm));

    const children = depth < MAX_OPTION_DEPTH ? subFieldsOf(chosen) : [];

    return (
      <div key={pathKey} className="space-y-3" data-rx-field={depth === 0 ? field.id : undefined}>
        <NeoOptionField
          field={field}
          selected={chosen}
          onSelect={(option) => handleSelectOption(pathKey, option)}
          unitPriceFor={(option) => unitPriceIfChosen(pathKey, option)}
          formatPrice={formatPrice}
          t={t}
        />
        {pathKey === cutPathKey && cutNote && (
          <p className="text-[0.6875rem] font-bold text-orange-800 bg-orange-50 border border-orange-200 rounded-xl px-3 py-2" data-rx-cut-note={cutNote}>
            {t(cutNote)}
          </p>
        )}
        {inCustomMode && (
          <div className={cn('p-4 rounded-2xl space-y-3', NEO.card, NEO.raisedSm)}>
            {isFullyFreeSize(field) && (
              <p className="text-[0.625rem] text-emerald-700 font-bold">{t('cfgCustomSizeNoLimit')}</p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[0.625rem] font-bold text-gray-600 block mb-1">
                  {t('cfgCustomWidth')}
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  min={field.minWidthCm}
                  max={field.maxWidthCm}
                  step="any"
                  value={customSizeWidthInput}
                  placeholder="cm"
                  onChange={(e) => handleCustomSizeInput('w', e.target.value)}
                  className={cn(
                    'w-full px-3 py-2 rounded-xl text-xs font-black text-gray-900 bg-[#e9ebf2] outline-none border-none',
                    NEO.inset,
                  )}
                />
                {boundsHint(field.minWidthCm, field.maxWidthCm)}
              </div>
              <div>
                <label className="text-[0.625rem] font-bold text-gray-600 block mb-1">
                  {t('cfgCustomHeight')}
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  min={field.minHeightCm}
                  max={field.maxHeightCm}
                  step="any"
                  value={customSizeHeightInput}
                  placeholder="cm"
                  onChange={(e) => handleCustomSizeInput('h', e.target.value)}
                  className={cn(
                    'w-full px-3 py-2 rounded-xl text-xs font-black text-gray-900 bg-[#e9ebf2] outline-none border-none',
                    NEO.inset,
                  )}
                />
                {boundsHint(field.minHeightCm, field.maxHeightCm)}
              </div>
            </div>
            {fieldInvalid && (
              <p className="text-[0.625rem] font-black text-red-600 bg-red-50 p-1.5 rounded-lg">
                {t('cfgCustomSizeInvalid')}
              </p>
            )}
          </div>
        )}

        {/* THE QUESTIONS THIS ANSWER OPENS.
            Indented and rules off to the left, so it reads as "and for that
            choice…" rather than as another question at the same level. They
            appear and disappear with the option above them. */}
        {children.length > 0 && chosen && (
          <div className="ml-3 pl-4 border-l-2 border-gray-300/70 space-y-5">
            <p className="text-[0.625rem] font-black uppercase text-gray-400 tracking-wider">
              {t('cfgSubOptionsFor').replace('{0}', labelOf(chosen))}
            </p>
            {children.map((child) => renderField(child, [...path, field.id, chosen.id], depth + 1))}
          </div>
        )}
      </div>
    );
  };

  // Size, for anything priced by the square metre.
  const sizeSection = sizeCalculatorVisible ? (
    <section className="space-y-3" data-rx-block="size">
      <h3 className="text-[0.6875rem] font-black uppercase text-gray-400 tracking-wider">
        {t('cfgDimensionsCalculator')}
      </h3>
      <div className={cn('p-4 rounded-2xl space-y-3', NEO.card, NEO.raisedSm)}>
        <div className="flex items-center justify-between border-b border-white/70 pb-2">
          <span className="text-xs font-black text-gray-900">{t('cfgDimensionsCalculator')}</span>
          <span className="text-[0.625rem] font-black text-orange-700 bg-orange-100 px-2 py-0.5 rounded-full">
            {t('cfgAreaLabel')} {((effectiveWidthCm * effectiveHeightCm) / 10000).toFixed(2)} m²
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[0.625rem] font-bold text-gray-600 block mb-1" htmlFor={`${sizeInputId}-w`}>
              {t('cfgWidthCm')}
            </label>
            <input
              id={`${sizeInputId}-w`}
              type="number"
              inputMode="decimal"
              min={10}
              value={customWidthCm}
              onChange={(e) => setCustomWidthCm(Math.max(10, Number(e.target.value) || 10))}
              className={cn('w-full px-3 py-2 rounded-xl text-xs font-black text-gray-900 bg-[#e9ebf2] outline-none border-none', NEO.inset)}
            />
          </div>
          <div>
            <label className="text-[0.625rem] font-bold text-gray-600 block mb-1" htmlFor={`${sizeInputId}-h`}>
              {t('cfgHeightCm')}
            </label>
            <input
              id={`${sizeInputId}-h`}
              type="number"
              inputMode="decimal"
              min={10}
              value={customHeightCm}
              onChange={(e) => setCustomHeightCm(Math.max(10, Number(e.target.value) || 10))}
              className={cn('w-full px-3 py-2 rounded-xl text-xs font-black text-gray-900 bg-[#e9ebf2] outline-none border-none', NEO.inset)}
            />
          </div>
        </div>
        <p className="text-[0.625rem] text-gray-500 font-medium">
          {/* Both figures through formatPrice: they used to print raw net
              SEK next to a converted, VAT-inclusive total. */}
          {t('cfgAreaSurchargeNote')
            .replace('{0}', formatPrice(dimensionSurcharge))
            .replace('{1}', formatPrice(uploadRules.pricePerSqm || PRICING_DEFAULTS.pricePerSqm))}
        </p>
      </div>
    </section>
  ) : null;

  // How the artwork reaches us — on the products the owner has ticked.
  // This comment said `artworkEnabled: false` was how he took the box OFF,
  // which stopped being true on 2026-09-13: the default is now off and an
  // explicit `true` is how he puts it ON. See src/lib/artwork.ts.
  const artworkSection = artworkBlockShown ? (
    <>
      <div data-rx-block="artwork">
        <NeoArtworkStep
          field={artworkField}
          selected={artworkField ? selectedOptions[artworkField.id] : undefined}
          onSelect={(option) => artworkField && handleSelectOption(artworkField.id, option)}
          labelOf={labelOf}
          formatPrice={formatPrice}
          upload={{
            fileName: uploadedFileName,
            progress: uploadProgress,
            error: fileValidationError,
            storedUrl: uploadedUrl,
          }}
          onPickFile={handlePickFile}
          onClearFile={clearArtwork}
          required={artworkRequired}
          accept={(uploadRules.allowedFormats || []).map((f) => `.${f}`).join(',')}
          maxMb={productMaxUploadMb}
          sizeLabel={requiredArtworkLabel}
          sizeMm={requiredArtworkMm}
          previewMm={previewArtworkMm}
          outline={chosenOutline}
          file={uploadedFile}
          bleedSizeLabel={
            requiredArtworkMm
              ? formatSizeForShopper(requiredArtworkMm.wMm + 2 * ARTWORK_BLEED_MM, requiredArtworkMm.hMm + 2 * ARTWORK_BLEED_MM)
              : undefined
          }
          // A design's preview is already its trim; a customer's file may carry the bleed.
          fileBleedMm={uploadedSource === 'upload' ? uploadedBleedMm : null}
          filePdfBox={uploadedSource === 'upload' ? uploadedPdfBox?.box ?? null : null}
          shopArtwork={shopArtwork}
          designer={
            designerChosen
              ? {
                  blocked: designBlock ? t(DESIGNER_BLOCK_TEXT[designBlock]) : undefined,
                  attached: uploadedSource === 'designer' && !!uploadedFileName,
                  onOpen: openDesigner,
                  notice: designerNotice || undefined,
                }
              : undefined
          }
          t={t}
        />
      </div>
      {/* Buying without the file is a supported way to order, not a mistake —
          so say so here, where the shopper is deciding whether to leave. The
          old screen simply left the dropzone empty and optional, and the
          customer had no way of knowing what happened next. */}
      {methodWantsFile && !studioChosen && !artworkRequired && !uploadedFileName && (
        <p className="-mt-3 flex items-start gap-2 text-xs font-semibold text-gray-500 bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3">
          <Clock className="w-4 h-4 shrink-0 mt-px text-[#bb965b]" />
          <span>{t('cfgSendFileLater')}</span>
        </p>
      )}
    </>
  ) : null;

  // Delivery — driven by the catalogue field, so the choice is priced.
  const deliverySection = deliveryField && deliveryOptions.length > 0 ? (
    <section className="space-y-3" data-rx-block="delivery">
      <h3 className="text-[0.6875rem] font-black uppercase text-gray-400 tracking-wider">
        {t('ppDeliveryHeading')}
      </h3>
      <NeoDeliveryEstimate
        options={deliveryOptions}
        selectedId={selectedOptions[deliveryField.id]?.id}
        onSelect={(id) => {
          const option = deliveryField.options.find((o) => o.id === id);
          if (option) handleSelectOption(deliveryField.id, option);
        }}
        formatPrice={formatPrice}
        t={t}
        language={language}
        // The date shown is the date the order will be promised with standard
        // delivery: production + his standard transit days, in working days.
        transitDays={deliveryPromise.zone}
        skipWeekends={deliveryPromise.skipWeekends}
      />
    </section>
  ) : null;

  // EVERY ROW OF THE COLUMN IN HIS ORDER — the properties, the quantity table,
  // the size calculator, the artwork box and the delivery time. pageRowsOf is
  // the same rule the dashboard's list is built with, so the list he drags is
  // this column (src/lib/pageOrder.ts). A product he never arranged keeps the
  // old layout, the quantity table wherever quantityAfterFieldId put it.
  const pageRows = pageRowsOf({
    printingFields: product.printingFields,
    areaPriced: uploadRules.areaPriced === true,
    artworkShown: artworkBlockShown,
    quantityAfterFieldId: product.quantityAfterFieldId,
    pageOrder: product.pageOrder,
  });

  return (
    <div className={cn('grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8', className)}>
      {/* Left column — gallery, then whatever the frame wants beneath it. */}
      <div className="lg:col-span-5 space-y-5">
        <NeoProductGallery
          images={product.images}
          alt={localized(product.name, product.nameI18n, language)}
          variant={variant}
          t={t}
          // THE OFFER BADGE BELONGS ON THE PHOTO.
          //
          // This is the exact corner of the exact screen the client circled in
          // his reference: a red "KAMPANJ -15%" over the product picture. It
          // was only on the shop grid; the product page — the one a customer
          // actually lands on from Google or a shared link — showed nothing on
          // the photo at all. Web2Print keeps its slot underneath.
          badge={
            offerPercent > 0 || product.isWeb2Print ? (
              <span className="flex flex-col items-start gap-1">
                {offerPercent > 0 && (
                  <span className="bg-red-600 text-white text-[0.625rem] font-black px-2.5 py-1 rounded-full uppercase tracking-wider shadow-sm">
                    {t('cfgSpecialOffer').replace('{0}', String(offerPercent))}
                  </span>
                )}
                {product.isWeb2Print && (
                  <span className="bg-gradient-to-br from-orange-500 to-orange-700 text-white text-[0.625rem] font-black px-2.5 py-1 rounded-full uppercase tracking-wider shadow-sm">
                    Web2Print
                  </span>
                )}
              </span>
            ) : undefined
          }
        />
        {leftColumn}
      </div>

      {/* Right column — every choice, then quantity, delivery and the total. */}
      <div className="lg:col-span-7 space-y-10">
        {pageRows.map((row) => (
          <React.Fragment key={row}>
            {row === PAGE_BLOCKS.quantity
              ? quantitySection
              : row === PAGE_BLOCKS.size
                ? sizeSection
                : row === PAGE_BLOCKS.artwork
                  ? artworkSection
                  : row === PAGE_BLOCKS.delivery
                    ? deliverySection
                    : (() => {
                        const field = orderedFields.find((f) => f.id === row);
                        return field ? renderField(field) : null;
                      })()}
          </React.Fragment>
        ))}






        {/* Total and add-to-cart.
            In the MODAL it pins to the bottom of the scrolling body, which is
            where it has always been and where a cramped dialog needs it.
            On the PAGE it stays in the flow: pinned, it floated over the top of
            the quantity ladder — the one table the shopper is there to read —
            and the reference shops keep it static for exactly that reason. */}
        <div
          className={cn(
            'px-4 py-4 rounded-3xl space-y-3',
            NEO.card,
            NEO.raised,
            isPage ? '' : 'sticky bottom-0 z-20',
          )}
        >
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="space-y-0.5">
              {/* Two different discounts can be live at once and they mean
                  different things: the offer is a price the owner set on this
                  product, the volume tier is earned by ordering more. Showing
                  them as separate pills is the only way the shopper can tell
                  which one goes away if they order fewer. */}
              {offerPercent > 0 && (
                <span className="inline-block bg-red-100 text-red-700 text-[0.625rem] font-black px-2.5 py-0.5 rounded-full">
                  {/* The same percentage the shop card shows, from the product's
                      own list and offer prices as shown (each lifted to the
                      minimum) — NOT from this line's totals, which also carry
                      option surcharges and the volume tier and would give a
                      different figure for the same product. */}
                  {t('cfgSpecialOffer').replace('{0}', String(offerPercent))}
                </span>
              )}
              {discountPercent > 0 && (
                <span className="inline-block bg-orange-100 text-orange-700 text-[0.625rem] font-black px-2.5 py-0.5 rounded-full ml-1">
                  {t('cfgVolumeDiscount')
                    .replace('{0}', String(discountPercent))
                    .replace('{1}', String(quantity))}
                </span>
              )}
              <span className="text-[0.625rem] text-gray-500 font-bold block">
                {/* formatPrice follows the header's VAT toggle, so the old
                    "(excl. VAT)" label was a lie whenever the toggle was on.
                    The VatTag beside the Total is the one place that states it. */}
                {sizeQtyField ? (
                  // The clothing template: what each size line costs. The start
                  // fee is per basket line, so it is said once per size.
                  sizeLines.length > 0
                    ? `${sizeLines.map((l) => `${labelOf(l.option)}: ${l.qty} × ${formatPrice(l.price.unitPrice)}`).join(' · ')}${
                        setupFee > 0 ? ` + ${t('cfgSetupFee').replace('{0}', formatPrice(setupFee))} × ${sizeLines.length}` : ''
                      }`
                    : null
                ) : <>
                {t('ppUnitPrice')}: {formatPrice(unitPrice)}
                {/* Every figure on this line goes through formatPrice, or the
                    "before discount" and "setup fee" numbers stay raw net SEK
                    beside a converted, VAT-inclusive one. */}
                {discountPercent > 0
                  ? ` ${t('cfgBeforeDiscount').replace('{0}', formatPrice(rawUnitPrice))}`
                  : ''}
                {setupFee > 0 ? ` + ${t('cfgSetupFee').replace('{0}', formatPrice(setupFee))}` : ''}
                {lineOnceCharges > 0 ? ` + ${t('cfgOnceCharges').replace('{0}', formatPrice(lineOnceCharges))}` : ''}
                </>}
              </span>
            </div>

            {/* BOTH FIGURES, ALWAYS — and this is what lets the shop be on Google
                Shopping at all.
                The page printed one number, whichever the header toggle said, and
                the toggle defaults to EX VAT. The feed Google reads quotes the
                gross figure, because an EU consumer offer must; so the same
                product was 161 kr on the page and 201,25 kr in the feed, which
                Merchant Center reads as a price mismatch and disapproves.
                Showing the other figure beside the total costs one muted line and
                changes nothing about what the shop charges or how it presents
                itself: the ex-VAT number stays the headline for the trade
                customers this shop is written for. */}
            <div className="flex items-baseline gap-1.5 ml-auto">
              <span className="text-xs text-gray-500 font-bold">{t('cfgTotal')}</span>
              {/* The "was" price, through formatPrice like every other figure
                  here, so it follows the VAT toggle and the currency the shopper
                  chose. A struck-through number in a different currency to the
                  one beside it is worse than no struck-through number. */}
              {isOnSale && !sizeQtyField && (
                <span className="text-sm font-bold text-gray-400 line-through tracking-tight">
                  {formatPrice(listTotalPrice)}
                </span>
              )}
              {/* Red when it is an offer, as his reference shows. The shop's
                  usual orange is the colour of every ordinary price, so it said
                  nothing about this one — the card already branched, the page
                  did not. */}
              <span className={cn(
                'text-2xl font-black tracking-tight',
                isOnSale ? 'text-red-600' : 'text-orange-600',
              )}>
                {priceInfo.formatted}
              </span>
              <VatTag />
            </div>
          </div>

          {/* The same total in the other VAT mode. Whichever way the toggle is
              set, the figure a crawler needs is on the page. */}
          {shownTotal > 0 && (
            <p className="text-[0.6875rem] font-bold text-gray-400 text-right -mt-1">
              {formatMoney(includeVat ? priceInfo.rawNetSEK : priceInfo.rawGrossSEK)}{' '}
              <VatTag mode={includeVat ? 'excl' : 'incl'} />
            </p>
          )}

          {customSizeInvalid && (
            <p className="text-[0.625rem] font-black text-red-600 text-center">
              {t('cfgCustomSizeInvalid')}
            </p>
          )}
          {/* Say WHY the button will not move. A disabled button with no reason
              is the shop's problem, not the shopper's. */}
          {!customSizeInvalid && artworkMissing && (
            <p className="text-[0.625rem] font-black text-orange-700 text-center" data-rx-artwork-missing>
              {t(designMissing || designStale ? 'dsgNeededToContinue' : 'ppArtworkNeededToContinue')}
            </p>
          )}
          {sizeQtyBlocked && (
            <p className="text-[0.625rem] font-black text-orange-700 text-center" data-rx-size-qty-missing>
              {sizePieces === 0
                ? ({ sv: 'Skriv hur många du vill ha under en storlek.', da: 'Skriv hvor mange du vil have under en størrelse.', no: 'Skriv hvor mange du vil ha under en størrelse.' } as Record<string, string>)[language] ?? 'Type how many you want under a size.'
                : (({ sv: 'Minst {0} st totalt.', da: 'Mindst {0} stk i alt.', no: 'Minst {0} stk totalt.' } as Record<string, string>)[language] ?? 'At least {0} pieces in total.').replace('{0}', String(minQty))}
            </p>
          )}
          {uploadInProgress && (
            <p className="text-[0.625rem] font-black text-gray-500 text-center">
              {t('ppArtworkUploading').replace('{0}', String(uploadProgress ?? 0))}
            </p>
          )}

          <button
            type="button"
            onClick={handleAddToCart}
            disabled={customSizeInvalid || artworkMissing || uploadInProgress || sizeQtyBlocked}
            className={cn(
              'w-full py-3 px-6 rounded-full font-black text-xs text-white uppercase tracking-wider',
              'bg-gradient-to-br from-orange-500 to-orange-700',
              'shadow-[6px_6px_14px_#c9cdd8,-6px_-6px_14px_#ffffff]',
              'transition-all duration-300 flex items-center justify-center space-x-2',
              NEO.ease,
              customSizeInvalid || artworkMissing || uploadInProgress || sizeQtyBlocked
                ? 'opacity-50 cursor-not-allowed'
                : 'cursor-pointer hover:shadow-[10px_10px_22px_#c9cdd8,-10px_-10px_22px_#ffffff] active:scale-95',
            )}
          >
            {addedSuccess ? (
              <>
                <Check className="w-4 h-4" />
                <span>{t('cfgAddedToCart')}</span>
              </>
            ) : (
              <>
                <ShoppingCart className="w-4 h-4" />
                {/* priceInfo, not formatCurrency: the latter is always net and
                    always SEK, so with the header's VAT toggle on — or any other
                    currency picked — the button quoted a different number from
                    the Total printed 40 px above it. */}
                <span>
                  {t('cfgAddToCart')} ({priceInfo.formatted})
                </span>
              </>
            )}
          </button>

          {secondaryAction}
        </div>
      </div>

      {/* The designer, over everything. Rendered into <body>: inside the
          product dialog it would sit in an animated (transformed) box, which a
          fixed-position layer cannot escape. */}
      {designerOpen &&
        designTrim &&
        designSpec &&
        designerStep === 'gallery' &&
        createPortal(
          <DesignerBoundary onFail={handleDesignerFailed}>
            <React.Suspense
              fallback={<DesignerLoading label={t('dsgLoading')} closeLabel={t('dsgCloseAnyway')} onClose={closeDesigner} />}
            >
              <LazyGallery
                productName={localized(product.name, product.nameI18n, language)}
                sizeLabel={formatSizeForShopper(designTrim.wMm, designTrim.hMm)}
                trimMm={designTrim}
                outline={chosenOutline}
                spec={designSpec}
                sides={lineSides.sides}
                kind={designSpec.kind}
                templates={templatesHere}
                onRetryTemplates={retryTemplates}
                order={siteSettings.designTemplateOrder}
                hidden={siteSettings.designTemplateHidden}
                draftSavedAt={deviceDraftAt}
                starters={siteSettings.designerBasicLayouts !== false}
                notice={draftNotice}
                showMisses={user?.role === 'admin'}
                t={t}
                language={language}
                onChoose={(choice: GalleryChoice) => {
                  setDesignerStart('continue' in choice ? null : choice);
                  setDesignerStep('studio');
                }}
                onWithout={laterMarker && !uploadInProgress ? handleAddWithoutDesign : undefined}
                priceLabel={formatPriceWithVat(totalPrice).formatted}
                onClose={closeDesigner}
              />
            </React.Suspense>
          </DesignerBoundary>,
          document.body,
        )}
      {designerOpen &&
        designTrim &&
        designSpec &&
        designerStep === 'studio' &&
        createPortal(
          <DesignerBoundary onFail={handleDesignerFailed}>
            <React.Suspense
              fallback={<DesignerLoading label={t('dsgLoading')} closeLabel={t('dsgCloseAnyway')} onClose={closeDesigner} />}
            >
              <LazyStudio
                key={JSON.stringify(designerStart)}
                start={designerStart}
                productId={product.id}
                trimMm={designTrim}
                outline={chosenOutline}
                sizeLabel={formatSizeForShopper(designTrim.wMm, designTrim.hMm)}
                spec={designSpec}
                sides={lineSides.sides}
                ink={lineSides.ink}
                sameOnBothSides={lineSides.sameOnBothSides}
                draft={designDraftRef.current}
                onDraftChange={(next) => {
                  designDraftRef.current = next;
                }}
                onUse={handleDesignUsed}
                onClose={closeDesigner}
                t={t}
                language={language}
                templates={templatesHere}
                onRetryTemplates={retryTemplates}
                showMisses={user?.role === 'admin'}
                title={localized(product.name, product.nameI18n, language)}
                aiGenerate={siteSettings.designerAiImages === true ? aiGenerate : undefined}
                order={siteSettings.designTemplateOrder}
                hidden={siteSettings.designTemplateHidden}
                starters={siteSettings.designerBasicLayouts !== false}
                priceLabel={formatPriceWithVat(totalPrice).formatted}
                onWithout={laterMarker && !uploadInProgress ? handleAddWithoutDesign : undefined}
              />
            </React.Suspense>
          </DesignerBoundary>,
          document.body,
        )}
    </div>
  );
}
