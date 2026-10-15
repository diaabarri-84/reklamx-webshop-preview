import React, { useState, useEffect, useMemo, useRef } from 'react';
import { withoutUndefined } from '../../lib/withoutUndefined';
import { collection, getDocs, doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useConfirmDialog } from '../ConfirmDialog';
import { useAuth } from '../../App';
import { Product, ProductOption, Category, PrintingField, PrintingFieldOption, LocalizedText } from '../../types';
import { categoryPickList } from '../../lib/categoryTree';
import { INITIAL_PRINTING_FIELDS, OPTION_LIBRARY_DOC } from './PrintingFieldsAdmin';
import { OPTION_CATALOGUE } from './optionCatalogue';
import { productPath, productSlug, slugify as addressSlug, uniqueSlug } from '../../lib/slug';
import { artworkBoxShown } from '../../lib/artwork';
import { designerCanOpenOn, isDesignerMethod } from '../../lib/onlineDesign';
import { KIND_DEFAULTS, cleanSpecOverride, kindOfProduct } from '../../lib/printSpec';
import { isOptionAvailable, withoutUnavailableOptions } from '../../lib/optionAvailability';
import { clothingFields } from '../../lib/clothingTemplate';
import { invalidateShopCache } from '../../lib/invalidateShopCache';
import { MediaPickerModal } from './MediaLibrary';
import ProductsBulkBar from './ProductsBulkBar';
import { DESCRIPTION_LIMIT, TITLE_LIMIT } from '../../lib/seoSettings';
import CompetitorProductAnalyzerModal from './CompetitorProductAnalyzerModal';
import {
  Box,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  DollarSign,
  Edit3,
  ExternalLink,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Info,
  Layers,
  Shirt,
  Link as LinkIcon,
  ListOrdered,
  Package,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  Star,
  Tag,
  Trash2,
  Truck,
  Upload,
  X,
  Zap,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, safeImageSrc } from '../../lib/utils';
import { SUGGESTION_COUNT, cleanPickIds, suggestionModeOf } from '../../lib/suggestions';
import { useSiteSettings } from '../../context/SiteSettingsContext';
import { DEFAULT_ARTWORK_FORMATS } from '../../lib/artworkLimits';
import { PRICING_DEFAULTS } from '../../lib/pricing';
import { QUANTITY_AT_TOP } from '../../lib/optionTree';
import { compressImageFile } from '../../lib/imageCompress';
import { uploadFile } from '../../lib/uploadFile';
import { uploadOptionImage } from '../../lib/uploadOptionImage';
import PrintingFieldEditorBody, { FieldPatch, OptionPatch, LocalizedTextFields } from './PrintingFieldEditorBody';
import SortableList, { DragHandle } from './SortableList';
import ProductOrderModal from './ProductOrderModal';
import { orderByIdList } from '../../lib/ownerOrder';
import { reorderById, reorderByValueIds, reorderSubset, valueIds } from '../../lib/reorder';
import { ARTWORK_METHOD_FIELD_ID, DELIVERY_FIELD_ID, PAGE_BLOCKS, isPageBlock, pageOrderAfterDrop, pageRowsOf, prunePageOrder } from '../../lib/pageOrder';

/**
 * The file types offered as tick-boxes in the product editor.
 *
 * The first nine are DEFAULT_ARTWORK_FORMATS — what a product accepts when its
 * own rules say nothing. The rest are the formats a print shop gets asked about
 * next, offered so the owner can tick them instead of learning that the list is
 * editable at all. Anything outside this list can still be typed in by hand.
 */
const SELECTABLE_ARTWORK_FORMATS = [
  ...DEFAULT_ARTWORK_FORMATS,
  'indd', 'cdr', 'zip', 'webp', 'gif', 'bmp',
];

/** Slugified option value for custom attributes: lowercase, dashes. */
const slugify = (text: string) =>
  text.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const ROLL_LABELS_PRODUCT: Product = {
  id: 'prod-roll-labels',
  name: 'Etiketter på rulle (Roll Labels)',
  description: 'Högkvalitativa etiketter på rulle i olika former, storlekar och ytbehandlingar. Perfekta för varumärkesbyggande, förpackningar eller produktmärkning. Enkla att applicera för hand eller med dispenser.',
  categoryId: 'labels',
  basePrice: 532.99,
  images: [
    '/placeholder-print.svg',
    'https://images.unsplash.com/photo-1572375992501-4b0892d50c69?auto=format&fit=crop&w=1000&q=80',
    'https://images.unsplash.com/photo-1513519245088-0e12902e5a38?auto=format&fit=crop&w=1000&q=80'
  ],
  minQuantity: 100,
  maxQuantity: 100000,
  isWeb2Print: true,
  stock: 100000,
  features: [
    'Lätt att ta bort etikettema från rullen (Easy Peel off Roll)',
    'För varje ändamål, ett material tillgängligt (Multi-material)',
    'Högupplöst 300 DPI fullfärgstryck',
    'Anpassningsbara dispenser och kjärndiameter (40mm / 76mm core)'
  ],
  options: [
    {
      id: 'opt-form',
      name: 'Form (Shape)',
      type: 'select',
      values: [
        { label: 'Rund (Round - ⭕)', priceModifier: 0 },
        { label: 'Fyrkantig (Square - ⏹️)', priceModifier: 0 },
        { label: 'Rektangel (Rectangle - ▭)', priceModifier: 0 },
        { label: 'Oval (Oval - ⬭)', priceModifier: 0 }
      ]
    },
    {
      id: 'opt-storlek',
      name: 'Storlek (Size)',
      type: 'select',
      values: [
        { label: '10 mm', priceModifier: -50 },
        { label: '20 mm', priceModifier: -40 },
        { label: '30 mm', priceModifier: -30 },
        { label: '40 mm', priceModifier: -20 },
        { label: '50 mm', priceModifier: -10 },
        { label: '60 mm', priceModifier: 0 },
        { label: '70 mm', priceModifier: 15 },
        { label: '75 mm (Rekommenderas)', priceModifier: 25 },
        { label: '80 mm', priceModifier: 35 },
        { label: '100 mm', priceModifier: 60 }
      ]
    },
    {
      id: 'opt-utseende',
      name: 'Utseende (Appearance)',
      type: 'select',
      values: [
        { label: 'White film (Rekommenderas)', priceModifier: 0 },
        { label: 'Transparent', priceModifier: 40 },
        { label: 'Paper', priceModifier: -20 },
        { label: 'Special', priceModifier: 75 }
      ]
    },
    {
      id: 'opt-material',
      name: 'Material',
      type: 'select',
      values: [
        { label: 'Gloss Polypropylene (Glossy PP - Rekommenderas)', priceModifier: 0 },
        { label: 'Matt Polypropylene', priceModifier: 20 },
        { label: 'Natureflex White Biodegradable', priceModifier: 60 }
      ]
    },
    {
      id: 'opt-tryck',
      name: 'Tryckalternativ (Printing)',
      type: 'select',
      values: [
        { label: 'Ett lager fullfärgstryck (1 Layer Full Color)', priceModifier: 0 }
      ]
    },
    {
      id: 'opt-dispenser',
      name: 'Alternativ (Dispenser)',
      type: 'select',
      values: [
        { label: 'No dispenser', priceModifier: 0 },
        { label: 'Dispenser per roll (Rekommenderas)', priceModifier: 45 }
      ]
    },
    {
      id: 'opt-rollwinding',
      name: 'Rollwinding',
      type: 'select',
      values: [
        { label: 'Rollwinding 1 (180°)', priceModifier: 0 },
        { label: 'Rollwinding 2 (0°)', priceModifier: 0 },
        { label: 'Rollwinding 3 (90°)', priceModifier: 0 },
        { label: 'Rollwinding 4 (270°)', priceModifier: 0 }
      ]
    },
    {
      id: 'opt-core',
      name: 'Core Diameter',
      type: 'select',
      values: [
        { label: '40 mm core (Rekommenderas)', priceModifier: 0 },
        { label: '76 mm core', priceModifier: 15 }
      ]
    }
  ]
};

const INITIAL_MOCK_PRODUCTS: Product[] = [
  ROLL_LABELS_PRODUCT,
  {
    id: 'prod-001',
    name: 'Premium Business Cards',
    description: 'High-quality 350 GSM heavy cardstock business cards with silky matt or glossy finish.',
    categoryId: 'business-cards',
    basePrice: 199,
    images: ['https://images.unsplash.com/photo-1589829545856-d10d557cf95f?auto=format&fit=crop&w=800&q=80'],
    minQuantity: 100,
    maxQuantity: 10000,
    isWeb2Print: false,
    stock: 50000,
    features: ['350 GSM Silk Cardstock', 'Full Color Both Sides', 'Protective Coating', 'Precision Cut Corners'],
    options: [
      {
        id: 'opt-finish',
        name: 'Finish Type',
        type: 'select',
        values: [
          { label: 'Matt Lamination', priceModifier: 0 },
          { label: 'Gloss Soft Touch', priceModifier: 35 },
          { label: 'Gold Foil Stamping', priceModifier: 120 }
        ]
      }
    ]
  },
  {
    id: 'prod-002',
    name: 'Vinyl Roll Banners & Signs',
    description: 'Durable weather-resistant outdoor vinyl banner printing calculated per linear meter.',
    categoryId: 'large-format',
    basePrice: 249,
    images: ['https://images.unsplash.com/photo-1563986768609-322da13575f3?auto=format&fit=crop&w=800&q=80'],
    minQuantity: 1,
    maxQuantity: 50,
    isWeb2Print: true,
    stock: 200,
    features: ['510 GSM Heavy Duty PVC', 'Waterproof & UV Resistant', 'Reinforced Metal Eyelets Every 50cm'],
    options: []
  },
  {
    id: 'prod-003',
    name: 'Custom Die-Cut Stickers',
    description: 'Custom shaped waterproof vinyl stickers with crack-and-peel backing.',
    categoryId: 'stickers',
    basePrice: 149,
    images: ['https://images.unsplash.com/photo-1572375992501-4b0892d50c69?auto=format&fit=crop&w=800&q=80'],
    minQuantity: 50,
    maxQuantity: 5000,
    isWeb2Print: false,
    stock: 25000,
    features: ['Waterproof & Dishwasher Safe', 'Precision Laser Cut', 'Vibrant UV Resistant Inks'],
    options: []
  }
];

/** Options hidden anywhere in a property — the questions inside its options included. */
function hiddenOptionCount(options: unknown): number {
  let n = 0;
  for (const o of Array.isArray(options) ? options : []) {
    if ((o as { hidden?: unknown })?.hidden === true) n += 1;
    const subs = (o as { subFields?: unknown })?.subFields;
    for (const sub of Array.isArray(subs) ? subs : []) n += hiddenOptionCount((sub as { options?: unknown })?.options);
  }
  return n;
}

/**
 * The rows of "Order on the product page" that are not properties: the blocks
 * the product page draws around them (src/lib/pageOrder.ts). `drag` is the grip's
 * accessible name — the browser suites find the rows by it.
 */
const PAGE_BLOCK_ROWS: Record<string, { label: string; short: string; note?: string; drag: string }> = {
  [PAGE_BLOCKS.quantity]: { label: 'Quantity & price table', short: 'the quantity table', drag: 'Drag the quantity table' },
  [PAGE_BLOCKS.size]: { label: 'Size calculator (width × height)', short: 'the size calculator', note: 'priced per m²', drag: 'Drag the size calculator' },
  [PAGE_BLOCKS.artwork]: { label: 'Artwork upload box', short: 'the artwork box', drag: 'Drag the artwork box' },
  [PAGE_BLOCKS.delivery]: { label: 'Delivery time', short: 'the delivery time', drag: 'Drag the delivery time' },
};

/**
 * The top of the product form — title, template box, clone box — in the admin's
 * language (owner, 2026-10-15: the Swedish panel showed it in English).
 */
const FORM_TOP: Record<string, Record<string, string>> = {
  en: { titleNew: 'Add New Print Product', titleEdit: 'Edit Product Specification', optional: 'Optional', tplTitle: 'Start from a template', tplClothing: 'Clothing (colour + quantity per size)', tplDone: "Added 27 colours and sizes S–5XL with a quantity box under each. Set the name and price, remove colours you don't sell, then Save.", cloneTitle: 'Clone an existing product', cloneLead: 'Fills this whole form from a product you already have — its price, images, delivery speeds, every printing option with its surcharges and translations, the specification table and the FAQ. It is saved as a new, hidden product; the one you copied from is not touched.', cloneSearch: 'Search products by name or SKU…', clonePick: 'Choose a product to clone…', cloneHidden: 'hidden', cloneBtn: 'Clone', cloning: 'Cloning…', cloneDone: 'Form filled from the product you chose. Rename it below, change what differs, then Save.' },
  sv: { titleNew: 'Lägg till ny produkt', titleEdit: 'Redigera produkt', optional: 'Valfritt', tplTitle: 'Börja från en mall', tplClothing: 'Kläder (färg + antal per storlek)', tplDone: 'Lade till 27 färger och storlekarna S–5XL med en antalsruta under varje. Skriv namn och pris, ta bort färger ni inte säljer och spara.', cloneTitle: 'Kopiera en befintlig produkt', cloneLead: 'Fyller hela formuläret från en produkt ni redan har — pris, bilder, leveranstider, alla tryckval med tillägg och översättningar, specifikationstabellen och FAQ. Den sparas som en ny, dold produkt. Produkten ni kopierar från ändras inte.', cloneSearch: 'Sök produkt på namn eller artikelnr…', clonePick: 'Välj en produkt att kopiera…', cloneHidden: 'dold', cloneBtn: 'Kopiera', cloning: 'Kopierar…', cloneDone: 'Formuläret är ifyllt från produkten du valde. Byt namn nedan, ändra det som skiljer och spara.' },
  da: { titleNew: 'Tilføj nyt produkt', titleEdit: 'Rediger produkt', optional: 'Valgfrit', tplTitle: 'Start fra en skabelon', tplClothing: 'Tøj (farve + antal pr. størrelse)', tplDone: 'Tilføjede 27 farver og størrelserne S–5XL med en antalsboks under hver. Skriv navn og pris, fjern farver I ikke sælger, og gem.', cloneTitle: 'Kopiér et eksisterende produkt', cloneLead: 'Udfylder hele formularen fra et produkt, I allerede har — pris, billeder, leveringstider, alle trykvalg med tillæg og oversættelser, specifikationstabellen og FAQ. Det gemmes som et nyt, skjult produkt. Produktet I kopierer fra, ændres ikke.', cloneSearch: 'Søg produkt på navn eller varenr…', clonePick: 'Vælg et produkt at kopiere…', cloneHidden: 'skjult', cloneBtn: 'Kopiér', cloning: 'Kopierer…', cloneDone: 'Formularen er udfyldt fra det valgte produkt. Omdøb det nedenfor, ret det der er anderledes, og gem.' },
  no: { titleNew: 'Legg til nytt produkt', titleEdit: 'Rediger produkt', optional: 'Valgfritt', tplTitle: 'Start fra en mal', tplClothing: 'Klær (farge + antall per størrelse)', tplDone: 'La til 27 farger og størrelsene S–5XL med en antallsboks under hver. Skriv navn og pris, fjern farger dere ikke selger, og lagre.', cloneTitle: 'Kopier et eksisterende produkt', cloneLead: 'Fyller hele skjemaet fra et produkt dere allerede har — pris, bilder, leveringstider, alle trykkvalg med tillegg og oversettelser, spesifikasjonstabellen og FAQ. Det lagres som et nytt, skjult produkt. Produktet dere kopierer fra, endres ikke.', cloneSearch: 'Søk produkt på navn eller varenr…', clonePick: 'Velg et produkt å kopiere…', cloneHidden: 'skjult', cloneBtn: 'Kopier', cloning: 'Kopierer…', cloneDone: 'Skjemaet er fylt ut fra produktet du valgte. Gi det nytt navn nedenfor, endre det som er annerledes, og lagre.' },
};

export default function ProductsAdmin() {
  const { t, language, vatRate, user } = useAuth();
  const ft = FORM_TOP[language] ?? FORM_TOP.en;
  const { settings: siteSettings } = useSiteSettings();
  // In-page dialogs, never window.confirm/alert — a browser that has been told
  // to stop prompting silences those, and the action then does nothing at all.
  const { confirm, notify, dialog: confirmDialog } = useConfirmDialog();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>('all');
  // EVERYTHING IMPORTED ARRIVES HIDDEN, for review — and thousands are coming
  // from the supplier feeds. Without this the owner has to scroll the whole
  // catalogue looking for the grey HIDDEN badge to find his own unpublished
  // work. 'all' | 'visible' | 'hidden'.
  const [visibilityFilter, setVisibilityFilter] = useState<'all' | 'visible' | 'hidden'>('all');
  const [supplierFilter, setSupplierFilter] = useState<string>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isFilterDrawerOpen, setIsFilterDrawerOpen] = useState(false);
  const [filterDrawerSearch, setFilterDrawerSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isAiAnalyzerOpen, setIsAiAnalyzerOpen] = useState(false);

  /*
   * THE ANALYZER HIDES ITSELF WHEN THE SERVER CANNOT RUN IT.
   *
   * This was the first button on the Products screen and every click of it
   * failed: the live shop had no AI key, so /api/analyze-product
   * answers 503 to every request and the owner got an error where a filled-in
   * product should have been. The chat widget hit the same wall and solved it
   * this way — see GeminiChatbot.tsx. /api/health reports one boolean for the
   * key, and it is the same key both endpoints use.
   *
   * `null` means "not asked yet" and draws nothing, so the button never appears
   * and then disappears again. A check that itself fails counts as no: a button
   * that cannot be shown to work is not shown. Put the key on the server and it
   * comes back on its own — there is nothing else to switch on.
   */
  const [aiAnalyzerAvailable, setAiAnalyzerAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/health')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) setAiAnalyzerAvailable(Boolean(d?.chat)); })
      .catch(() => { if (!cancelled) setAiAnalyzerAvailable(false); });
    return () => { cancelled = true; };
  }, []);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [saving, setSaving] = useState(false);
  // Gallery pictures still on their way to Storage — Save waits for them.
  const [imagesUploading, setImagesUploading] = useState(0);
  const [saveSuccess, setSaveSuccess] = useState(false);
  // Its own line, because a bulk change reports a COUNT and the save banner is
  // a fixed sentence — reusing that one would have made it lie about numbers.
  const [bulkNotice, setBulkNotice] = useState<string | null>(null);
  // The category whose page is being dragged into order — ProductOrderModal.
  const [arrangeCategory, setArrangeCategory] = useState<Category | null>(null);

  const handleProductCreatedByAi = (newProduct: Product) => {
    setProducts(prev => {
      const exists = prev.some(p => p.id === newProduct.id);
      if (exists) return prev.map(p => p.id === newProduct.id ? newProduct : p);
      return [newProduct, ...prev];
    });
    setSaveSuccess(true);
    // Straight into the editor, to check what the analyzer made (the old read-only
    // "details view" is gone: VIEW now opens the product as customers see it).
    handleOpenModal(newProduct);
    setTimeout(() => setSaveSuccess(false), 5000);
  };

  // Form State
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  // A product's name and description are shown to the shopper in HIS language,
  // through localized(). Without these the dashboard could only edit the English
  // one, so renaming a product left every Swedish, Danish and Norwegian visitor
  // looking at the old name with no way to tell why.
  const [formNameI18n, setFormNameI18n] = useState<LocalizedText>({});
  const [formDescI18n, setFormDescI18n] = useState<LocalizedText>({});
  // What a search engine and Google Shopping are told about this product. All
  // blank by default — an empty box means "work it out from the name and the
  // description", which is what the page did before any of this existed.
  const [formSeoTitle, setFormSeoTitle] = useState('');
  const [formSeoDescription, setFormSeoDescription] = useState('');
  const [formSeoNoindex, setFormSeoNoindex] = useState(false);
  const [formSeoExcludeFromSitemap, setFormSeoExcludeFromSitemap] = useState(false);
  const [formBrand, setFormBrand] = useState('');
  const [formGtin, setFormGtin] = useState('');
  const [formMpn, setFormMpn] = useState('');
  const [formCondition, setFormCondition] = useState<'new' | 'refurbished' | 'used'>('new');
  const [formGoogleCategory, setFormGoogleCategory] = useState('');
  const [formCategory, setFormCategory] = useState('');
  const [formPrice, setFormPrice] = useState<number>(199);
  // '' rather than 0: an empty box means "no offer", and 0 is a price.
  const [formSalePrice, setFormSalePrice] = useState<number | ''>('');
  // The minimum unit price (code review ADM-14), as typed: see the save below.
  const [formMinPrice, setFormMinPrice] = useState<string>(String(PRICING_DEFAULTS.minPrice));
  const [formImages, setFormImages] = useState<string[]>([]);
  const [newUrlInput, setNewUrlInput] = useState('');
  const [imagePickerOpen, setImagePickerOpen] = useState(false);
  const [formMinQty, setFormMinQty] = useState<number>(1);
  const [formMaxQty, setFormMaxQty] = useState<number>(10000);
  const [formStock, setFormStock] = useState<number>(1000);
  const [formIsWeb2Print, setFormIsWeb2Print] = useState(false);
  // The owner's stock code, printed on the production work order.
  const [formSku, setFormSku] = useState('');
  // Must the shopper attach the print file before buying? The shop's answer is
  // normally no — see Product.artworkRequired.
  // Shown unless he says otherwise: every existing product predates the field.
  // OFF for a new product too. One rule everywhere — "the box appears where I
  // ticked it" — beats a split rule where old products are off and new ones
  // arrive on, which is the kind of difference nobody remembers a week later.
  const [formArtworkEnabled, setFormArtworkEnabled] = useState(false);
  const [formArtworkRequired, setFormArtworkRequired] = useState(false);
  // May customers design this product online (round 16, item 5)? On unless he
  // switches it off: "all products, or the client picks". src/lib/onlineDesign.ts.
  const [formOnlineDesign, setFormOnlineDesign] = useState(true);
  // What ticking "Customers can design it online" changed, so unticking it in the
  // same edit puts the product back as it was (null: the tick changed nothing).
  const designerTickUndo = useRef<{ field: PrintingField | null; onlineDesign: boolean } | null>(null);
  // His own print values for this product (designer v2); '' = the default for its kind.
  const [formPrintSpec, setFormPrintSpec] = useState<Record<'bleed' | 'safe' | 'top' | 'bottom' | 'left' | 'right' | 'target' | 'min', string>>(
    { bleed: '', safe: '', top: '', bottom: '', left: '', right: '', target: '', min: '' },
  );
  // Which of his print values are typed but not usable — said, and the save waits,
  // instead of being dropped without a word ("5 mm", a 60 mm bleed, 1 500 DPI).
  const printSpecBad = (() => {
    const n = (v: string) => (v.trim() === '' ? undefined : Number(v.replace(',', '.')));
    const bad: string[] = [];
    const test = (text: string, label: string, ok: (v: number | undefined) => boolean) => {
      if (text.trim() !== '' && !ok(n(text))) bad.push(label);
    };
    test(formPrintSpec.bleed, 'Bleed', (v) => cleanSpecOverride({ bleedMm: v }).bleedMm !== undefined);
    test(formPrintSpec.safe, 'Keep text inside', (v) => cleanSpecOverride({ safeMm: v }).safeMm !== undefined);
    test(formPrintSpec.target, 'Made at', (v) => cleanSpecOverride({ targetDpi: v }).targetDpi !== undefined);
    test(formPrintSpec.min, 'Never below', (v) => cleanSpecOverride({ minDpi: v }).minDpi !== undefined);
    for (const [k, label] of [['top', 'Hidden at the top'], ['bottom', 'Hidden at the foot'], ['left', 'Hidden on the left'], ['right', 'Hidden on the right']] as const) {
      test(formPrintSpec[k], label, (v) => cleanSpecOverride({ hiddenMm: { [k]: v } }).hiddenMm?.[k] !== undefined);
    }
    return bad;
  })();
  const PRINT_SPEC_RANGES = 'Bleed 0–50 mm, keep text inside 0–500 mm, resolution 50–1 200 DPI, hidden zones 0–2 000 mm. Empty a box to use the usual value.';

  // Which file types the artwork dropzone accepts for THIS product, and how big
  // one file may be. Both live in customUploadRules, whose other half is pricing
  // and must survive untouched when these are saved.
  const [formArtworkFormats, setFormArtworkFormats] = useState<string[]>([...DEFAULT_ARTWORK_FORMATS]);
  const [formArtworkMaxMb, setFormArtworkMaxMb] = useState<number>(100);
  const [formAreaPriced, setFormAreaPriced] = useState<boolean>(false);
  const [formQuantityAfterFieldId, setFormQuantityAfterFieldId] = useState<string | undefined>(undefined);
  // Every row of the product page in his order (src/lib/pageOrder.ts); undefined until he arranges it.
  const [formPageOrder, setFormPageOrder] = useState<string[] | undefined>(undefined);
  // The products suggested under this one, in his order (src/lib/suggestions.ts).
  const [formRelatedIds, setFormRelatedIds] = useState<string[]>([]);
  const [relatedSearch, setRelatedSearch] = useState('');
  // Hidden products stay in the catalogue but leave the shop. Nothing in this
  // screen could set or clear the flag, which turned Duplicate — whose copies
  // arrive hidden on purpose — into a one-way door: the copy could be edited
  // forever and never reach a customer.
  const [formIsHidden, setFormIsHidden] = useState(false);
  
  // Features List State
  const [formFeatures, setFormFeatures] = useState<string[]>([]);
  const [newFeatureInput, setNewFeatureInput] = useState('');

  // Drag ids that travel WITH each photo / line (src/lib/reorder.ts valueIds).
  // Memoised: older products carry their photos inline, and fingerprinting
  // megabytes on every keystroke in this dialog would be noticeable.
  const imageIds = useMemo(() => valueIds(formImages, 'img-'), [formImages]);
  const featureIds = useMemo(() => valueIds(formFeatures, 'feat-'), [formFeatures]);

  // Custom Options State
  const [formOptions, setFormOptions] = useState<ProductOption[]>([]);

  // Product Configurator Printing Fields State
  const [formPrintingFields, setFormPrintingFields] = useState<PrintingField[]>([]);

  // Which custom attribute editors are open in the "Custom attributes" builder
  const [expandedCustomFieldIds, setExpandedCustomFieldIds] = useState<string[]>([]);

  // The option catalogue offered by the toggle grid below. Read from Firestore
  // so fields the owner adds or deletes in Printing Fields show up here too.
  const [libraryFields, setLibraryFields] = useState<PrintingField[]>(INITIAL_PRINTING_FIELDS);
  const [printingFieldSearch, setPrintingFieldSearch] = useState('');
  // "Show me only what is ON." With 178 properties in the catalogue, a product
  // carrying 177 of them cannot be audited by scrolling: the owner photographed
  // exactly that and asked why they were all switched on. This is how he sees
  // the answer without reading every card.
  const [printingFieldsOnlyActive, setPrintingFieldsOnlyActive] = useState(false);

  // Match the group name and its values, so searching "gold foil" finds the
  // finishing field that offers it, not just fields called "foil".
  const printingFieldQuery = printingFieldSearch.trim().toLowerCase();
  const searchedPrintingFields = printingFieldQuery
    ? libraryFields.filter(f =>
        f.name.toLowerCase().includes(printingFieldQuery) ||
        f.id.toLowerCase().includes(printingFieldQuery) ||
        (f.options || []).some(o => o.label.toLowerCase().includes(printingFieldQuery))
      )
    : libraryFields;
  /** On for THIS product — the product's own copy decides, never the library's. */
  const isFieldOnHere = (id: string) =>
    formPrintingFields.some(f => f.id === id && f.enabled);
  const activeLibraryCount = formPrintingFields.filter(
    f => f.enabled && !f.id.startsWith('custom-'),
  ).length;
  const visiblePrintingFields = printingFieldsOnlyActive
    ? searchedPrintingFields.filter(f => isFieldOnHere(f.id))
    : searchedPrintingFields;

  useEffect(() => {
    fetchProductsAndCategories();
  }, []);

  const fetchProductsAndCategories = async () => {
    setLoading(true);
    try {
      // 0. Fetch the admin-edited option catalogue. Falls back to the built-in
      // one until the owner saves his own from the Printing Fields screen.
      try {
        const libSnap = await getDoc(doc(db, 'settings', OPTION_LIBRARY_DOC));
        const saved = libSnap.exists() ? (libSnap.data()?.fields as PrintingField[] | undefined) : undefined;
        if (saved && saved.length > 0) setLibraryFields(saved);
      } catch (libErr) {
        console.warn('Error loading the option library, using the built-in catalogue:', libErr);
      }

      // 1. Fetch Categories
      const catSnap = await getDocs(collection(db, 'categories'));
      const catList = catSnap.docs.map(d => ({ id: d.id, ...d.data() } as Category));
      setCategories(catList);

      // 2. Fetch Products
      const snap = await getDocs(collection(db, 'products'));
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as Product));
      
      // Whatever is stored, exactly as stored — see the note in CategoryAdmin.
      // Seeding the demo catalogue back into Firestore meant the owner could
      // never clear it to enter his own products.
      setProducts(list);
    } catch (err) {
      console.warn('Error loading products/categories from Firestore:', err);
      setProducts([]);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Load a product INTO THE FORM.
   *
   * Pulled out of handleOpenModal so that "Clone" can use it too: cloning is
   * exactly this, minus `setEditingProduct` — the form is filled from an
   * existing product but Save creates a new document instead of overwriting the
   * one it was copied from. Keeping one function means a field added to the form
   * cannot be filled on edit and silently dropped on clone.
   */
  const fillFormFromProduct = (product: Product, defaultCategory: string) => {
      // A form filled afresh (an edit, or "start from another product") has no tick to undo.
      designerTickUndo.current = null;
      setFormName(product.name || '');
      setFormDesc(product.description || '');
      setFormNameI18n(product.nameI18n || {});
      setFormDescI18n(product.descriptionI18n || {});
      setFormSeoTitle(product.seoTitle || '');
      setFormSeoDescription(product.seoDescription || '');
      setFormSeoNoindex(product.seoNoindex === true);
      setFormSeoExcludeFromSitemap(product.seoExcludeFromSitemap === true);
      setFormBrand(product.brand || '');
      setFormGtin(product.gtin || '');
      setFormMpn(product.mpn || '');
      setFormCondition(product.condition || 'new');
      setFormGoogleCategory(product.googleProductCategory || '');
      setFormCategory(product.categoryId || defaultCategory);
      setFormPrice(product.basePrice || 0);
      setFormSalePrice(Number(product.salePrice) > 0 ? Number(product.salePrice) : '');
      // What is stored, or the minimum every product without one is priced at.
      setFormMinPrice(String(product.customUploadRules?.minPrice ?? PRICING_DEFAULTS.minPrice));
      setFormImages(
        product.images && product.images.length > 0 
          ? product.images 
          : ['/placeholder-print.svg']
      );
      setNewUrlInput('');
      setFormMinQty(product.minQuantity ?? 1);
      setFormMaxQty(product.maxQuantity ?? 10000);
      setFormStock(product.stock ?? 1000);
      setFormIsWeb2Print(!!product.isWeb2Print);
      setFormSku(product.sku || '');
      // THE SAME RULE THE SHOP USES, not a second copy of it. The editor must
      // show the owner exactly what a shopper sees; disagreeing would let him
      // open a product, see the tick, save nothing, and believe the box is live
      // when it is not.
      setFormArtworkEnabled(artworkBoxShown(product));
      setFormArtworkRequired(product.artworkRequired === true);
      setFormOnlineDesign(product.onlineDesign !== false);
      {
        const ps = cleanSpecOverride(product.printSpec);
        const str = (v: number | undefined) => (v === undefined ? '' : String(v));
        setFormPrintSpec({
          bleed: str(ps.bleedMm), safe: str(ps.safeMm),
          top: str(ps.hiddenMm?.top), bottom: str(ps.hiddenMm?.bottom), left: str(ps.hiddenMm?.left), right: str(ps.hiddenMm?.right),
          target: str(ps.targetDpi), min: str(ps.minDpi),
        });
      }
      setFormArtworkFormats(
        product.customUploadRules?.allowedFormats?.length
          ? [...product.customUploadRules.allowedFormats]
          : [...DEFAULT_ARTWORK_FORMATS],
      );
      setFormArtworkMaxMb(Number(product.customUploadRules?.maxFileSizeMb) || 100);
      setFormAreaPriced(product.customUploadRules?.areaPriced === true);
      setFormQuantityAfterFieldId(product.quantityAfterFieldId ?? undefined);
      setFormPageOrder(Array.isArray(product.pageOrder) ? product.pageOrder.filter((id): id is string => typeof id === 'string') : undefined);
      // A clone takes the picks of the product it copies, like everything else.
      setFormRelatedIds(cleanPickIds(product.relatedProductIds, product.id));
      setRelatedSearch('');
      setFormIsHidden(product.isHidden === true);
      setFormFeatures(product.features || []);
      setFormOptions(product.options || []);
      setFormPrintingFields(product.printingFields || []);
  };

  const handleOpenModal = (product?: Product) => {
    const defaultCategory = categories.length > 0 ? categories[0].id : 'general';
    // Whatever the last clone carried, this form is not it. Cleared on BOTH
    // paths: opening an edit with a stale carry-over would graft one product's
    // specification table onto another.
    setCloneCarryOver(null);
    setCloneSourceId('');
    setCloneSearch('');
    designerTickUndo.current = null;
    if (product) {
      setEditingProduct(product);
      fillFormFromProduct(product, defaultCategory);
    } else {
      setEditingProduct(null);
      setFormName('');
      setFormDesc('');
      setFormNameI18n({});
      setFormDescI18n({});
      setFormSeoTitle('');
      setFormSeoDescription('');
      setFormSeoNoindex(false);
      setFormSeoExcludeFromSitemap(false);
      setFormBrand('');
      setFormGtin('');
      setFormMpn('');
      setFormCondition('new');
      setFormGoogleCategory('');
      setFormCategory(defaultCategory);
      setFormPrice(199);
      setFormSalePrice('');
      setFormMinPrice(String(PRICING_DEFAULTS.minPrice));
      setFormImages(['/placeholder-print.svg']);
      setNewUrlInput('');
      setFormMinQty(10);
      setFormMaxQty(5000);
      setFormStock(1000);
      setFormIsWeb2Print(false);
      setFormSku('');
      // CLEARED WITH THE REST. Every other artwork field was reset here and this
      // one was not, so `useState(false)` only governed the FIRST dialog after a
      // page load: tick the box on a print product, then press New Product, and
      // the box is already on — which puts "drop your file here" back on the next
      // finished good, the exact complaint this change exists to answer.
      setFormArtworkEnabled(false);
      setFormArtworkRequired(false);
      setFormOnlineDesign(true);
      // Cleared too, or the last product's print values (a roll-up's 120 mm foot) are
      // saved onto the next one, unseen while its artwork box is off.
      setFormPrintSpec({ bleed: '', safe: '', top: '', bottom: '', left: '', right: '', target: '', min: '' });
      setFormArtworkFormats([...DEFAULT_ARTWORK_FORMATS]);
      setFormArtworkMaxMb(100);
      setFormAreaPriced(false);
      setFormQuantityAfterFieldId(undefined);
      setFormPageOrder(undefined);
      // Cleared with the rest, or the last product's picks ride into this one.
      setFormRelatedIds([]);
      setRelatedSearch('');
      setFormIsHidden(false);
      setFormFeatures([]);
      setFormOptions([]);
      setFormPrintingFields([]);
      setTemplateApplied(null);
    }
    setExpandedCustomFieldIds([]);
    setIsModalOpen(true);
  };

  // Multi-image handlers
  const handleImageFilesUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const fileList = Array.from(files);
    let uploadFailed = false;
    let unreadable = false;
    for (const file of fileList) {
      if (!file.type.startsWith('image/')) continue;
      setImagesUploading((n) => n + 1);
      try {
        const compressedDataUrl = await compressImageFile(file, 800, 800, 0.75);
        // TO STORAGE, the product keeps the address (2026-10-09). The free database
        // bills reads BY SIZE, and with its gallery pictures inline the 87 products
        // had grown to ~9 MB: every read of the catalogue cost ~2 230 read units,
        // and the shop's daily limit ran out on that alone.
        //
        // AND ONLY THERE (code review ADM-11). When Storage could not be reached the
        // picture went inside the product after all, with nothing said — the size
        // problem back, one picture at a time. Now it is refused, and he tries again.
        let stored: string;
        try {
          const [, b64 = ''] = compressedDataUrl.split(',');
          const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          const jpeg = new File([bytes], `product-${Date.now()}.jpg`, { type: 'image/jpeg' });
          stored = (await uploadFile(jpeg, { visibility: 'public', folder: 'products', contentType: 'image/jpeg' })).url;
        } catch (uploadErr) {
          console.warn('Product picture upload failed; not added:', uploadErr);
          uploadFailed = true;
          continue;
        }
        setFormImages(prev => [...prev, stored]);
      } catch (err) {
        console.error('Failed to compress image file:', err);
        unreadable = true;
      } finally {
        setImagesUploading((n) => n - 1);
      }
    }
    // Once for the batch, not once per picture — and in the page: a browser told to
    // stop showing this site's alerts showed nothing at all, and the refused picture
    // simply never appeared (code review 2026-10-11, REVIEW-3 #5). Both reasons in
    // one notice: a second would replace the first.
    const refusals = [uploadFailed ? t('caPictureUploadFailed') : '', unreadable ? t('paImageFailed') : ''].filter(Boolean);
    if (refusals.length > 0) void notify({ title: refusals[0], message: refusals[1], tone: 'primary' });
    e.target.value = '';
  };

  /**
   * What is on screen right now, under all three filters.
   *
   * Named once because three things must agree about it: the grid, the
   * select-all tick, and the bulk bar. A second copy of this expression is how
   * "select all" comes to tick products the owner cannot see.
   */
  const filterCategory = selectedCategoryFilter === 'all'
    ? null
    : categories.find(c => c.id === selectedCategoryFilter || c.name === selectedCategoryFilter) ?? null;
  // In the order he arranged that category's page in, when he has — the same
  // order the shop shows (src/lib/ownerOrder.ts).
  const visibleProducts = orderByIdList(products
    .filter(p => selectedCategoryFilter === 'all'
      || p.categoryId === selectedCategoryFilter
      || p.categoryId === categories.find(c => c.id === selectedCategoryFilter)?.name)
    // isHidden is absent on everything created before it existed, so "visible"
    // is "not explicitly hidden", never `isHidden === false`.
    .filter(p => visibilityFilter === 'all'
      || (visibilityFilter === 'hidden' ? p.isHidden === true : p.isHidden !== true))
    // 'own' is its own answer, not the absence of one.
    .filter(p => supplierFilter === 'all'
      || (supplierFilter === 'own' ? !p.supplierName : p.supplierName === supplierFilter)),
    filterCategory?.productOrder);

  /** Only ids still on screen: changing a filter must not act on what it hid. */
  const selectedVisibleIds = visibleProducts.map(p => p.id).filter(id => selectedIds.has(id));

  const toggleSelected = (id: string) => setSelectedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const handleAddImageUrl = () => {
    if (!newUrlInput.trim()) return;
    setFormImages(prev => [...prev, newUrlInput.trim()]);
    setNewUrlInput('');
  };

  const handleRemoveImage = (index: number) => {
    setFormImages(prev => prev.filter((_, i) => i !== index));
  };

  const handleSetPrimaryImage = (index: number) => {
    if (index === 0) return;
    setFormImages(prev => {
      const updated = [...prev];
      const [selected] = updated.splice(index, 1);
      return [selected, ...updated];
    });
  };

  const handleAddFeature = () => {
    if (!newFeatureInput.trim()) return;
    setFormFeatures([...formFeatures, newFeatureInput.trim()]);
    setNewFeatureInput('');
  };

  const handleRemoveFeature = (index: number) => {
    setFormFeatures(formFeatures.filter((_, i) => i !== index));
  };

  /**
   * Switch off every catalogue property on THIS product, in one press.
   *
   * The owner opened a product and found 177 of the 178 catalogue properties
   * switched on — every one of them rendered to the customer, because the
   * configurator shows `printingFields.filter(f => f.enabled)`. They arrive that
   * way from the Printing-fields screen's Update & apply, which writes every
   * property that is on IN THE LIBRARY onto the products it targets (his own
   * request: a new property should reach every product). What was missing was
   * the way back: 177 individual clicks, on a dialog that scrolls.
   *
   * It switches them OFF rather than removing them, exactly as the per-field
   * checkbox does, so any per-product editing of a field survives being turned
   * off — and it leaves `custom-` fields alone, because those are this product's
   * own and were never part of the catalogue that flooded it. Nothing is written
   * until he presses Save.
   */
  const handleTurnAllPrintingFieldsOff = async () => {
    const count = formPrintingFields.filter(f => f.enabled && !f.id.startsWith('custom-')).length;
    if (count === 0) return;
    const ok = await confirm({
      title: t('paTurnAllOffTitle'),
      message: t('paTurnAllOffMsg').replace('{0}', String(count)),
      confirmLabel: t('paTurnAllOff'),
    });
    if (!ok) return;
    setFormPrintingFields(prev =>
      prev.map(f => (f.id.startsWith('custom-') ? f : { ...f, enabled: false })),
    );
    // The "only the ones that are on" filter would now show an empty list and
    // look like the properties themselves had gone.
    setPrintingFieldsOnlyActive(false);
  };

  const handleTogglePrintingField = (fieldId: string) => {
    setFormPrintingFields(prev => {
      const existing = prev.find(f => f.id === fieldId);
      if (existing) {
        return prev.map(f => f.id === fieldId ? { ...f, enabled: !f.enabled } : f);
      } else {
        const template = libraryFields.find(f => f.id === fieldId);
        if (template) {
          return [...prev, { ...template, enabled: true }];
        }
        return prev;
      }
    });
  };

  // ---- The field editors (both the catalogue grid and the custom builder) ----
  // Everything below works on formPrintingFields, which handleSaveProduct writes
  // onto the product. A catalogue field is only IN that array once the product
  // has its own copy — the toggle used to be the only thing that made one, so
  // editing a field the owner had not enabled silently did nothing. Every editor
  // handler now materialises the copy first, in the same state update, so an edit
  // always lands whether or not the property is switched on.

  /** The product's own copy of `fieldId`, created from the library if missing. */
  const withFieldPresent = (prev: PrintingField[], fieldId: string): PrintingField[] => {
    if (prev.some(f => f.id === fieldId)) return prev;
    const template = libraryFields.find(f => f.id === fieldId);
    // enabled:false — opening a property to look at it must not put it on the
    // product page; that is what the checkbox is for.
    return template ? [...prev, { ...template, enabled: false }] : prev;
  };

  /**
   * "Customers can design it online", MADE TRUE (client, 2026-10-07: "online design
   * does not work for the user when I switch the feature on"). The tick alone only
   * stopped the designer being switched OFF; "Design online" appears in the artwork
   * step only through the product's own "Artwork supply method" property, which his
   * products did not have. Ticking now gives the product that property, on, with
   * the designer in it — a fresh copy offers just "Upload a print-ready PDF" beside
   * it (the paid layout and studio choices are his to switch on). The page, the
   * pricing, "design later" and the order labels all work from that real property,
   * exactly as they do on a product set up by hand.
   */
  const withDesignerMethod = (prev: PrintingField[]): PrintingField[] => {
    const existing = prev.find((f) => f.id === ARTWORK_METHOD_FIELD_ID);
    // A copy that is switched OFF was never on the product page, and is set up like a
    // new one: "Turn all off" and opening the property's editor both leave a copy
    // with EVERY choice visible — the paid layout and studio services included.
    const fresh = !existing || existing.enabled === false;
    const template =
      libraryFields.find((f) => f.id === ARTWORK_METHOD_FIELD_ID) ?? OPTION_CATALOGUE.find((f) => f.id === ARTWORK_METHOD_FIELD_ID);
    const catalogueDesigner = OPTION_CATALOGUE.find((f) => f.id === ARTWORK_METHOD_FIELD_ID)?.options.find((o) => isDesignerMethod(o));
    const base = existing ? prev : template ? [...prev, { ...template, enabled: true }] : prev;
    return base.map((f) => {
      if (f.id !== ARTWORK_METHOD_FIELD_ID) return f;
      let options = (f.options ?? []).map((o) =>
        isDesignerMethod(o) ? { ...o, hidden: false } : fresh ? { ...o, hidden: o.id !== 'af-supply-pdf' } : o,
      );
      // A library saved before the designer existed has no such option: put it in.
      if (!options.some((o) => isDesignerMethod(o)) && catalogueDesigner) options = [...options, { ...catalogueDesigner, hidden: false }];
      return { ...f, enabled: true, options };
    });
  };

  // ---- Custom attributes builder (per-product fields, id prefix 'custom-') ----
  // These flow through formPrintingFields and are saved by handleSaveProduct
  // exactly like the global library fields above.

  const toggleCustomFieldExpanded = (fieldId: string) => {
    setExpandedCustomFieldIds(prev =>
      prev.includes(fieldId) ? prev.filter(id => id !== fieldId) : [...prev, fieldId]
    );
  };

  const handleAddCustomAttribute = () => {
    const newField: PrintingField = {
      id: `custom-${Date.now()}`,
      name: '',
      group: 'product_builder',
      enabled: true,
      options: []
    };
    setFormPrintingFields(prev => [...prev, newField]);
    setExpandedCustomFieldIds(prev => [...prev, newField.id]);
  };

  const handleRemoveCustomAttribute = (fieldId: string) => {
    setFormPrintingFields(prev => prev.filter(f => f.id !== fieldId));
    setExpandedCustomFieldIds(prev => prev.filter(id => id !== fieldId));
  };

  // Empty optional values are removed from the object so Firestore never
  // receives explicit `undefined` (same pattern as PrintingFieldsAdmin).
  const handleUpdateCustomAttribute = (
    fieldId: string,
    patch: FieldPatch,
  ) => {
    setFormPrintingFields(prev => withFieldPresent(prev, fieldId).map(f => {
      if (f.id !== fieldId) return f;
      const updated: PrintingField = { ...f, ...patch };
      if (!updated.description) delete updated.description;
      // A cleared translation map is absent, not an empty object — Firestore
      // rejects an explicit undefined and an empty map means the same as none.
      if (!updated.nameI18n || Object.keys(updated.nameI18n).length === 0) delete updated.nameI18n;
      if (!updated.descriptionI18n || Object.keys(updated.descriptionI18n).length === 0) delete updated.descriptionI18n;
      if (!updated.required) delete updated.required;
      if (!updated.allowCustomSize) delete updated.allowCustomSize;
      // Custom-size bounds: only a positive number is a bound; anything else
      // (cleared input, NaN, 0, negative) means "no limit on that side".
      for (const key of ['minWidthCm', 'maxWidthCm', 'minHeightCm', 'maxHeightCm'] as const) {
        const n = updated[key];
        if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) delete updated[key];
      }
      return updated;
    }));
  };

  const handleAddCustomOption = (fieldId: string) => {
    setFormPrintingFields(prev => withFieldPresent(prev, fieldId).map(f => {
      if (f.id !== fieldId) return f;
      const newOpt: PrintingFieldOption = {
        id: `opt-${Date.now()}`,
        label: '',
        value: '',
        priceModifier: 0,
        // First option of a field becomes the pre-selected one.
        ...(f.options.length === 0 ? { isDefault: true } : {})
      };
      return { ...f, options: [...f.options, newOpt] };
    }));
  };

  const handleUpdateCustomOption = (
    fieldId: string,
    optionId: string,
    patch: OptionPatch,
  ) => {
    setFormPrintingFields(prev => withFieldPresent(prev, fieldId).map(f => {
      if (f.id !== fieldId) return f;
      const options = f.options.map(o => {
        if (o.id !== optionId) return o;
        const updated: PrintingFieldOption = { ...o, ...patch };
        // `value` follows the label ONLY while it is still the label's slug.
        //
        // It is not cosmetic: swatchColour() in NeoColorSwatches reads value
        // FIRST when deciding what colour a swatch is, and looksLikeColourField
        // counts how many options resolve. The catalogue ships curated values
        // ('colour_navy_blue', 'silk_coated') that do not match their labels, so
        // regenerating on every keystroke rewrote them — one label edit could
        // turn a colour picker back into plain text cards, or repaint a swatch.
        // A hand-written value is the owner's, and is left alone.
        if (patch.label !== undefined) {
          const wasDerived = !o.value || o.value === slugify(o.label);
          if (wasDerived) updated.value = slugify(patch.label);
        }
        if (!updated.labelI18n || Object.keys(updated.labelI18n).length === 0) delete updated.labelI18n;
        if (!updated.dimensions) delete updated.dimensions;
        if (!updated.recommended) delete updated.recommended;
        if (!updated.imageUrl) delete updated.imageUrl;
        return updated;
      });
      return { ...f, options };
    }));
  };

  /**
   * MOVE ONE CHOICE UP OR DOWN — 15.5.2.
   *
   * "خليه يقدر يترتبهم بكيفه حسب هو عايز" — top to bottom in this array is the
   * order the customer reads, and nothing could change it: every handler here
   * appends to the end, so the order was whatever he happened to type first.
   *
   * Written as an updater over `prev`, like every other option handler in this
   * file and unlike the "move" helpers elsewhere: a map over captured state
   * would silently drop a surcharge typed while the arrow was pressed.
   *
   * It moves the row and NOTHING else. `isDefault` stays on the option that
   * carries it — position must never decide the pre-selection, and
   * optionTree.ts falls back to `options[0]` when prices tie, which is the
   * mechanism behind the 30 %-inflated quote its own comment records.
   */
  const handleMoveCustomOption = (fieldId: string, optionId: string, direction: -1 | 1) => {
    setFormPrintingFields(prev => withFieldPresent(prev, fieldId).map(f => {
      if (f.id !== fieldId) return f;
      const from = f.options.findIndex(o => o.id === optionId);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= f.options.length) return f;
      const options = [...f.options];
      [options[from], options[to]] = [options[to], options[from]];
      // 15.5.7 — from now on this field's order is HIS. The garment-size grid
      // re-sorts its tiles into real size order, which is right until someone
      // has decided an order by hand.
      return { ...f, options, keepOwnerOrder: true };
    }));
  };

  /**
   * "Reset to the library version" — this product's copy of a library property
   * replaced by the library's current one: its own wording, prices and option
   * order go, its on/off for THIS product stays. Undoes per-product edits one
   * property at a time, which "Update products…" in the library can only do in
   * bulk.
   */
  const handleResetFieldToLibrary = async (fieldId: string) => {
    const lib = libraryFields.find((f) => f.id === fieldId);
    if (!lib) return;
    const ok = await confirm({
      title: `Reset "${lib.name}" to the library version?`,
      message: 'Changes made to it on this product are replaced. Nothing is saved until you press Save Product.',
      confirmLabel: t('dlgConfirm'),
    });
    if (!ok) return;
    setFormPrintingFields((prev) => prev.map((f) => (f.id === fieldId ? { ...lib, enabled: f.enabled } : f)));
  };

  /**
   * "Remove from this product" — the product's own copy is deleted, not just
   * switched off: it leaves this product's list, and switching it on again
   * starts from the library version.
   */
  const handleRemoveFieldFromProduct = async (fieldId: string) => {
    const name = formPrintingFields.find((f) => f.id === fieldId)?.name ?? fieldId;
    const ok = await confirm({
      title: `Remove "${name}" from this product?`,
      message: 'What was set on it for this product goes with it. Nothing is saved until you press Save Product.',
      confirmLabel: t('dlgConfirm'),
    });
    if (!ok) return;
    setFormPrintingFields((prev) => prev.filter((f) => f.id !== fieldId));
    setExpandedCustomFieldIds((prev) => prev.filter((id) => id !== fieldId));
  };

  /** The same, from a DRAG: the whole option list in its new order. */
  const handleReorderCustomOptions = (fieldId: string, orderedIds: string[]) => {
    setFormPrintingFields(prev => withFieldPresent(prev, fieldId).map(f =>
      f.id !== fieldId ? f : { ...f, options: reorderById(f.options, orderedIds), keepOwnerOrder: true },
    ));
  };

  /**
   * The ordered lists in this dialog, and the one swap they all use — 15.5.3/6.
   *
   * The bullet features the product page prints top to bottom, and the images
   * — whose FIRST entry is the card image for the whole shop. Both can also be
   * DRAGGED now (SortableList); the arrows stay for one-step moves. (The old
   * option groups this also served are gone — see handleConvertLegacyOptions.)
   */
  const moveInArray = <T,>(list: T[], from: number, direction: -1 | 1): T[] => {
    const to = from + direction;
    if (from < 0 || to < 0 || to >= list.length) return list;
    const next = [...list];
    [next[from], next[to]] = [next[to], next[from]];
    return next;
  };

  // Default is a radio: selecting one clears isDefault on its siblings.
  const handleSetCustomOptionDefault = (fieldId: string, optionId: string) => {
    setFormPrintingFields(prev => withFieldPresent(prev, fieldId).map(f => {
      if (f.id !== fieldId) return f;
      const options = f.options.map(o => {
        const updated: PrintingFieldOption = { ...o };
        if (o.id === optionId) {
          updated.isDefault = true;
        } else {
          delete updated.isDefault;
        }
        return updated;
      });
      return { ...f, options };
    }));
  };

  const handleRemoveCustomOption = (fieldId: string, optionId: string) => {
    setFormPrintingFields(prev => withFieldPresent(prev, fieldId).map(f => {
      if (f.id !== fieldId) return f;
      return { ...f, options: f.options.filter(o => o.id !== optionId) };
    }));
  };

  /** The designer is really on this product's page: the tick, its panel and its save check agree. */
  const designerOffered =
    formOnlineDesign &&
    formPrintingFields.some(
      (f) => f.enabled && f.id === ARTWORK_METHOD_FIELD_ID && (f.options ?? []).some((o) => isDesignerMethod(o) && isOptionAvailable(o)),
    );

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    // A picture still uploading would be saved without it.
    if (imagesUploading > 0) return;

    // Validate quantity bounds and price before saving.
    const finalMin = Number(formMinQty);
    const finalMax = Number(formMaxQty);
    if (!Number.isFinite(finalMin) || !Number.isFinite(finalMax) || finalMin < 1 || finalMax < 1) {
      alert(t('paQtyInvalid'));
      return;
    }
    if (finalMin > finalMax) {
      alert(t('paMinMaxError'));
      return;
    }
    if (Number(formPrice) < 0) {
      alert(t('paNegativePrice'));
      return;
    }
    // An offer that is not below the list price is not an offer. Caught here
    // rather than silently ignored by the pricing code, so the owner learns that
    // the number he typed will do nothing instead of wondering why no badge
    // appeared. (This screen uses alert() throughout; matching its neighbours.)
    if (formSalePrice !== '' && !(Number(formSalePrice) > 0 && Number(formSalePrice) < Number(formPrice))) {
      alert('The special offer price must be greater than 0 and lower than the base price. Leave it empty for no offer.');
      return;
    }
    if (formArtworkEnabled && designerOffered && printSpecBad.length > 0) {
      alert(`The designer's print values for this product: ${printSpecBad.join(', ')} — not a usable number. ${PRINT_SPEC_RANGES}`);
      return;
    }

    setSaving(true);

    const productId = editingProduct ? editingProduct.id : `prod-${Date.now()}`;
    const cleanImages = formImages.filter(img => img.trim() !== '');

    // The product's web address is its NAME, not its id — /products/premium-card
    // rather than /products/prod-1787944572548. It is derived here, on save, and
    // kept unique across the catalogue: two products may legitimately share a
    // name (a duplicate starts as an exact copy) and one address can only point
    // at one of them. Renaming a product moves its address with it.
    const slug = uniqueSlug(
      addressSlug(formName || ''),
      products.filter(p => p.id !== productId).map(p => productSlug(p)).filter(Boolean),
    );

    const newProduct: Product = {
      id: productId,
      name: formName || 'New Product',
      slug: slug || null,
      description: formDesc,
      categoryId: formCategory,
      basePrice: Number(formPrice) || 0,
      images: cleanImages.length > 0 ? cleanImages : ['/placeholder-print.svg'],
      minQuantity: finalMin,
      maxQuantity: finalMax,
      stock: Number(formStock) || 0,
      isWeb2Print: formIsWeb2Print,
      features: formFeatures,
      options: formOptions,
      printingFields: formPrintingFields,
      quantityAfterFieldId: formQuantityAfterFieldId ?? null,
      // Always written: the write is a MERGE, and null is what clears an order
      // stored earlier.
      // Only blocks and properties the product still has — a deleted property's
      // id would otherwise ride along for ever, clones included.
      pageOrder: prunePageOrder(formPageOrder, formPrintingFields.map((f) => f.id)),
      // Always written — the write is a MERGE, and null is what clears the picks.
      // A pick of a product since deleted stays until he removes it: the shop
      // skips it, and a dashboard that failed to load the list must not wipe
      // every pick on Save.
      relatedProductIds: formRelatedIds.length > 0 ? formRelatedIds : null,
      createdAt: editingProduct?.createdAt || new Date().toISOString()
    };

    // Always assign, never omit — the same rule as the SKU below, and for the
    // same reason. The write is a MERGE, so leaving the key out when the owner
    // has cleared the last translation KEEPS the stored one: he emptied the
    // Swedish box, saved, saw it empty, and the old Swedish name went on
    // showing in the shop with no way to remove it. `null` is what deletes it;
    // localized() short-circuits on it exactly as it does on undefined.
    newProduct.nameI18n = Object.keys(formNameI18n).length > 0 ? formNameI18n : null;
    newProduct.descriptionI18n = Object.keys(formDescI18n).length > 0 ? formDescI18n : null;

    newProduct.artworkEnabled = formArtworkEnabled;
    // Required is meaningless with the block off, and leaving it true would stop
    // checkout on a file the shopper is never shown a way to attach.
    newProduct.artworkRequired = formArtworkEnabled && formArtworkRequired;
    // Always written, true or false: the save is a merge, and an absent key
    // would keep yesterday's "off".
    newProduct.onlineDesign = formOnlineDesign;
    // His own print values: what he typed, made safe; nothing typed = null.
    //
    // EVERY KEY IS WRITTEN, null where his box is empty. The save is a MERGE, which
    // merges nested maps too: emptying "Never below" wrote {bleedMm: 5} and the stored
    // 300 survived — the shop kept using it, and it was back in the box after a reload.
    // A hidden zone is per side: an empty side is the usual value for the kind (the
    // roll-up's 30 mm rail), never 0.
    {
      const n = (v: string) => (v.trim() === '' ? undefined : Number(v.replace(',', '.')));
      const clean = cleanSpecOverride({
        bleedMm: n(formPrintSpec.bleed),
        safeMm: n(formPrintSpec.safe),
        targetDpi: n(formPrintSpec.target),
        minDpi: n(formPrintSpec.min),
        hiddenMm: { top: n(formPrintSpec.top), bottom: n(formPrintSpec.bottom), left: n(formPrintSpec.left), right: n(formPrintSpec.right) },
      });
      newProduct.printSpec = Object.keys(clean).length
        ? {
            bleedMm: clean.bleedMm ?? null,
            safeMm: clean.safeMm ?? null,
            targetDpi: clean.targetDpi ?? null,
            minDpi: clean.minDpi ?? null,
            hiddenMm: clean.hiddenMm
              ? {
                  top: clean.hiddenMm.top ?? null,
                  right: clean.hiddenMm.right ?? null,
                  bottom: clean.hiddenMm.bottom ?? null,
                  left: clean.hiddenMm.left ?? null,
                }
              : null,
          }
        : null;
    }
    newProduct.isHidden = formIsHidden;
    // Always assign, never omit. The write is a MERGE, so leaving the key out
    // when the box is empty does not clear the stored code — it keeps it, and
    // the old SKU goes on printing on work orders while the dashboard shows the
    // field as blank.
    newProduct.sku = formSku.trim() || null;

    // Same rule, same reason: a MERGE write that omits this key leaves the old
    // offer live in the shop with an empty box in the form to explain it. null
    // is what clears it — Firestore rejects an explicit undefined, and this
    // screen strips undefined before writing anyway.
    newProduct.salePrice = formSalePrice === '' ? null : Number(formSalePrice);

    // WHAT GOOGLE IS TOLD. Assigned unconditionally, for the same reason the SKU
    // is: the write is a MERGE, so a field left out when the box is cleared keeps
    // its stored value — the owner would delete an SEO title, save, and go on
    // seeing it in the search result with nothing in the form to explain why.
    newProduct.seoTitle = formSeoTitle.trim() || null;
    newProduct.seoDescription = formSeoDescription.trim() || null;
    newProduct.seoNoindex = formSeoNoindex;
    newProduct.seoExcludeFromSitemap = formSeoExcludeFromSitemap;
    newProduct.brand = formBrand.trim() || null;
    // Google matches a GTIN against its own catalogue and rejects the item if the
    // digits are not a real barcode, so the spaces and dashes people paste out of
    // a supplier sheet are stripped rather than sent.
    newProduct.gtin = formGtin.replace(/[\s-]/g, '').trim() || null;
    newProduct.mpn = formMpn.trim() || null;
    newProduct.condition = formCondition;
    newProduct.googleProductCategory = formGoogleCategory.trim() || null;

    // customUploadRules is TWO things wearing one name: the artwork rules edited
    // here, and the per-square-metre pricing the configurator and the server both
    // read. Rebuilding the object from the form alone would silently reset a
    // product's pricing, so the stored rules are spread first and only the two
    // artwork keys are overwritten. The missing pricing keys fall back to
    // PRICING_DEFAULTS inside calcConfiguredItemPrice, on both sides.
    const storedUploadRules = editingProduct?.customUploadRules ?? cloneCarryOver?.customUploadRules;
    // THE MINIMUM UNIT PRICE, a field of its own (code review ADM-14). Every save
    // wrote `stored ?? 149` here with nothing on screen to see or change it, and
    // products priced 64–137 kr were charged 149 a piece. The box opens on what is
    // stored (or that 149), so a product saved without touching it keeps its price;
    // 0 switches it off; anything that is not a number keeps what is stored.
    const typedMinPrice = formMinPrice.trim() === '' ? NaN : Number(formMinPrice.replace(',', '.'));
    newProduct.customUploadRules = {
      ...(storedUploadRules || {}),
      enabled: storedUploadRules?.enabled ?? true,
      minPrice: Number.isFinite(typedMinPrice) && typedMinPrice >= 0 ? typedMinPrice : storedUploadRules?.minPrice ?? PRICING_DEFAULTS.minPrice,
      allowedFormats: formArtworkFormats.length > 0 ? formArtworkFormats : [...DEFAULT_ARTWORK_FORMATS],
      maxFileSizeMb: Number(formArtworkMaxMb) > 0 ? Number(formArtworkMaxMb) : 100,
      areaPriced: formAreaPriced,
    };

    // A CLONE carries the parts of the source the form has no control over —
    // specs, FAQ, per-language features, pricing rules. They go UNDERNEATH, so
    // anything the owner just typed still wins.
    const documentToWrite: Product = editingProduct
      ? newProduct
      : { ...(cloneCarryOver ?? {}), ...newProduct };
    // Firestore rejects an explicit undefined, and a partially-filled source can
    // carry one in.
    for (const key of Object.keys(documentToWrite) as (keyof Product)[]) {
      if (documentToWrite[key] === undefined) delete documentToWrite[key];
    }

    try {
      await setDoc(doc(db, 'products', productId), withoutUndefined(documentToWrite), { merge: true });
      // The storefront is served from the server's cached catalogue, and this
      // write bypassed the server entirely.
      void invalidateShopCache();
      
      setProducts(prev => {
        const exists = prev.some(p => p.id === productId);
        if (exists) {
          return prev.map(p => p.id === productId ? documentToWrite : p);
        }
        return [documentToWrite, ...prev];
      });
      // The clone has been written; the form is no longer holding anybody's
      // leftovers. Leaving this set would attach the source's specs to the NEXT
      // product the owner creates from scratch.
      setCloneCarryOver(null);
      setCloneSourceId('');

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      setIsModalOpen(false);
    } catch (err) {
      console.error('Error saving product to Firestore:', err);
      alert('Could not save product to Firestore.');
    } finally {
      setSaving(false);
    }
  };

  /**
   * Duplicate a product, fields and all.
   *
   * A print shop's catalogue is families of near-identical jobs — the same
   * rollup in four sizes, the same card on three papers — and building each one
   * from an empty form again is how option lists drift apart. So this copies the
   * WHOLE stored document, not the handful of keys the edit form knows about:
   * printingFields with every option, pricing rules, upload rules, images, the
   * sv/da/no text, specs and FAQ. Only three things change.
   *
   * The copy arrives HIDDEN. A duplicate that appeared in the shop the instant
   * it was made would put two identical products in front of customers while the
   * owner is still halfway through renaming one of them.
   */
  const [cloningId, setCloningId] = useState<string | null>(null);

  // ---- CLONE, from inside the Add form -----------------------------------
  // The owner asked for it here, at the top of "Add New Print Product": pick a
  // product, and the form arrives already filled with everything that product
  // has. The copy action on the card below makes the copy straight away; this
  // one lets him change the name and the price BEFORE anything is written, which
  // is what building a family of near-identical products actually looks like.
  const [cloneSourceId, setCloneSourceId] = useState<string>('');
  const [cloneSearch, setCloneSearch] = useState<string>('');
  const [cloneLoading, setCloneLoading] = useState(false);
  /**
   * The half of a product the FORM DOES NOT MODEL.
   *
   * handleSaveProduct builds a document out of the form fields alone. That is
   * correct for editing — the stored document is merged into — but a clone is a
   * NEW document, so anything the form has no control for (the specification
   * table, the FAQ, the per-language feature list, the pricing rules, the
   * square-metre rates hiding inside customUploadRules) would be quietly left
   * behind and the "complete copy" would arrive gutted. It is carried here and
   * merged back underneath the form's own values on save.
   */
  const [cloneCarryOver, setCloneCarryOver] = useState<Partial<Product> | null>(null);
  // Which product template filled the form, for the confirmation line.
  const [templateApplied, setTemplateApplied] = useState<'clothing' | null>(null);

  /** Everything the form owns; anything else on a product is carried over verbatim. */
  const FORM_OWNED_KEYS: (keyof Product)[] = [
    'id', 'name', 'slug', 'description', 'nameI18n', 'descriptionI18n', 'categoryId', 'basePrice', 'salePrice',
    'images', 'minQuantity', 'maxQuantity', 'stock', 'isWeb2Print', 'features',
    // `deliverySpeedOptions` is dead — the form no longer writes it and nothing
    // reads it — but it stays listed so a clone of an older product does not
    // carry the stale speeds into a brand-new document.
    'deliverySpeedOptions', 'options', 'printingFields', 'createdAt', 'artworkRequired', 'artworkEnabled', 'onlineDesign', 'printSpec',
    'isHidden', 'sku', 'customUploadRules', 'quantityAfterFieldId', 'pageOrder', 'relatedProductIds',
    // The search-engine and Shopping fields. Listed so a clone starts from the
    // form's values rather than silently inheriting the original's SEO title —
    // two products sharing one title is exactly the duplicate Google penalises.
    'seoTitle', 'seoDescription', 'seoNoindex', 'seoExcludeFromSitemap',
    'brand', 'gtin', 'mpn', 'condition', 'googleProductCategory',
  ];

  const handleCloneIntoForm = async (sourceId: string) => {
    if (!sourceId) return;
    setCloneLoading(true);
    try {
      // The stored document, not the list's copy: the list is whatever was
      // loaded when this screen opened, and a field written by another screen
      // since then would be missing from the clone.
      const snap = await getDoc(doc(db, 'products', sourceId));
      const listCopy = products.find((p) => p.id === sourceId);
      const source = (snap.exists() ? ({ id: sourceId, ...snap.data() } as Product) : listCopy) as Product | undefined;
      if (!source) {
        alert('That product could not be read. Refresh and try again.');
        return;
      }

      const defaultCategory = categories.length > 0 ? categories[0].id : 'general';
      fillFormFromProduct(source, defaultCategory);

      // A clone is a NEW product, so: a name that says so in every language, a
      // SKU that cannot collide with the original's, and HIDDEN — two identical
      // products must never appear in the shop while one of them is still being
      // renamed.
      setFormName(`${source.name} (copy)`);
      setFormNameI18n(
        source.nameI18n
          ? Object.fromEntries(
              // A cleared language is stored as an explicit null — that is what
              // makes a merge write really delete it — so skip those rather than
              // duplicating the product with a Swedish name of "null (copy)".
              Object.entries(source.nameI18n)
                .filter(([, text]) => typeof text === 'string' && text.trim())
                .map(([lang, text]) => [lang, `${text} (copy)`]),
            )
          : {},
      );
      setFormSku(source.sku ? `${source.sku}-COPY` : '');
      setFormIsHidden(true);

      const carry: Record<string, any> = {};
      for (const [key, value] of Object.entries(source)) {
        if (FORM_OWNED_KEYS.includes(key as keyof Product)) continue;
        if (value !== undefined) carry[key] = value;
      }
      // customUploadRules is form-owned only in its two artwork keys; the pricing
      // half of it has to survive, so the whole object is carried and the save
      // spreads it underneath.
      if (source.customUploadRules) carry.customUploadRules = source.customUploadRules;
      setCloneCarryOver(carry as Partial<Product>);
      setCloneSourceId(sourceId);
    } catch (err) {
      console.error('Error cloning into the form:', err);
      alert('Could not clone that product.');
    } finally {
      setCloneLoading(false);
    }
  };

  const handleCloneProduct = async (product: Product) => {
    if (cloningId) return;
    setCloningId(product.id);
    try {
      // Read the stored document rather than the list's copy: the list is
      // whatever was loaded at page open, and a field added by another screen
      // since then would be dropped from the duplicate.
      const snap = await getDoc(doc(db, 'products', product.id));
      const source = (snap.exists() ? { id: product.id, ...snap.data() } : product) as Product;

      const newId = `prod-${Date.now()}`;
      const copyName = `${source.name} (copy)`;
      const copy: Product = {
        ...source,
        id: newId,
        name: copyName,
        // ITS OWN ADDRESS. The copied slug was the original's: VIEW on the copy opened
        // the original, and where the copy's id sorts first (a supplier product's
        // prod-pmp-… against prod-<millis>) the ORIGINAL's address found the hidden
        // copy and customers got "not found". The same rule as a save.
        slug:
          uniqueSlug(
            addressSlug(copyName),
            products.map((p) => productSlug(p)).filter(Boolean),
          ) || null,
        // Every language gets the marker too, or the Swedish shop would show two
        // products with the identical name once the copy is unhidden.
        //
        // 15.3.10 — AND ONLY THE LANGUAGES THAT HOLD TEXT. A cleared language is
        // stored as an explicit null, because that is what makes a merge write
        // really delete it; this line used to map over EVERY entry, so a product
        // with no Danish name was cloned with a Danish name of the literal
        // string "null (copy)" — written to Firestore, shown to Danish
        // customers, and counted by the dashboard as a translated box, which
        // permanently locked that language out of the Translate button. The
        // sibling path that opens a clone in the form has filtered since it was
        // written; this one, which writes the document, never did.
        nameI18n: source.nameI18n
          ? Object.fromEntries(
              Object.entries(source.nameI18n)
                .filter(([, text]) => typeof text === 'string' && text.trim())
                .map(([lang, text]) => [lang, `${text} (copy)`]),
            )
          : undefined,
        sku: source.sku ? `${source.sku}-COPY` : undefined,
        isHidden: true,
        createdAt: new Date().toISOString(),
      };
      // Firestore rejects an explicit undefined, and spreading `source` can carry
      // one in from a partially-filled document.
      for (const key of Object.keys(copy) as (keyof Product)[]) {
        if (copy[key] === undefined) delete copy[key];
      }

      await setDoc(doc(db, 'products', newId), withoutUndefined(copy));
      void invalidateShopCache();
      setProducts((prev) => [copy, ...prev]);
      // Straight into the editor: the point of a copy is the edit that follows.
      handleOpenModal(copy);
    } catch (err) {
      console.error('Error duplicating product:', err);
      alert('Could not duplicate this product.');
    } finally {
      setCloningId(null);
    }
  };

  const handleDeleteProduct = async (id: string) => {
    const ok = await confirm({
      title: 'Delete this product?',
      message: 'This cannot be undone.',
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    try {
      await deleteDoc(doc(db, 'products', id));
      void invalidateShopCache();
      setProducts(prev => prev.filter(p => p.id !== id));
    } catch (err) {
      console.error('Error deleting product:', err);
      // The row vanished from the table on failure too, so the product looked
      // deleted until the next reload brought it back.
      void notify({ title: t('paDeleteFailed'), tone: 'primary' });
    }
  };

  // Per-product custom attributes get the full editor; global library fields
  // (everything else in formPrintingFields) keep the toggle-only cards above.
  const customAttributeFields = formPrintingFields.filter(f => f.id.startsWith('custom-'));

  /**
   * PAGE ORDER.
   *
   * The product page renders `printingFields` in array order, so reordering the
   * array IS reordering the page. Two fields sit this out because the page draws
   * them in fixed places of their own rather than in the list.
   */
  const ORDER_EXEMPT_FIELD_IDS = [DELIVERY_FIELD_ID, ARTWORK_METHOD_FIELD_ID];
  const orderableFields = formPrintingFields.filter(
    (f) => f.enabled && !ORDER_EXEMPT_FIELD_IDS.includes(f.id),
  );

  /**
   * THE PAGE, ROW BY ROW — the properties and the four blocks the page draws
   * around them: the quantity table, the size calculator (priced per m²), the
   * artwork box and the delivery time. "ما قادر اتحكم فيها جميعها": the blocks
   * used to stay nailed below the properties. Every row drags now.
   *
   * Built by pageRowsOf — the very function the product page builds its column
   * with — so this list is the page: a property whose every option is hidden is
   * not a row here either, and nor is the delivery time with every speed hidden
   * (src/lib/pageOrder.ts).
   */
  const pageOrderIds = pageRowsOf({
    printingFields: formPrintingFields,
    areaPriced: formAreaPriced,
    artworkShown: formArtworkEnabled,
    quantityAfterFieldId: formQuantityAfterFieldId,
    pageOrder: formPageOrder,
  });

  /**
   * A drop, or an arrow (pageOrderAfterDrop says what each write is for): the
   * row order, remembering rows placed earlier that are not on screen now; the
   * properties in that same order, switched-off ones included, so printingFields
   * and the page agree where a property comes back; and the property the
   * quantity table follows.
   */
  const handleReorderPage = (orderedIds: string[]) => {
    const { pageOrder, fieldOrder, quantityAnchor } = pageOrderAfterDrop(orderedIds, formPageOrder);
    const named = new Set(fieldOrder);
    setFormPrintingFields((prev) =>
      reorderSubset(prev, (f) => named.has(f.id) && !ORDER_EXEMPT_FIELD_IDS.includes(f.id), fieldOrder),
    );
    setFormQuantityAfterFieldId(quantityAnchor);
    setFormPageOrder(pageOrder);
  };

  /**
   * SUGGESTED PRODUCTS — the products he picks for under this one (round 16,
   * item 10). Searched among the products this screen already holds, so picking
   * costs no read; visible products first, because imports arrive hidden.
   */
  const relatedName = (id: string) => products.find((p) => p.id === id)?.name?.trim() || 'Deleted product';
  const relatedMatches = (() => {
    const q = relatedSearch.trim().toLowerCase();
    if (!q) return [];
    return products
      .filter((p) => p.id !== editingProduct?.id && !formRelatedIds.includes(p.id))
      .filter((p) => (p.name || '').toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q))
      .sort((a, b) => Number(a.isHidden === true) - Number(b.isHidden === true) || (a.name || '').localeCompare(b.name || ''));
  })();
  const addRelated = (id: string) => {
    setFormRelatedIds((prev) => (prev.includes(id) || prev.length >= SUGGESTION_COUNT ? prev : [...prev, id]));
    setRelatedSearch('');
  };
  const suggestionMode = suggestionModeOf(siteSettings.productSuggestions);

  /** One row, one place up or down — the arrows, for when a drag is fiddly. */
  const movePageRow = (rowId: string, direction: -1 | 1) => {
    const from = pageOrderIds.indexOf(rowId);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= pageOrderIds.length) return;
    const next = [...pageOrderIds];
    [next[from], next[to]] = [next[to], next[from]];
    handleReorderPage(next);
  };

  /**
   * THE OLD "CUSTOM PRODUCT OPTIONS" — `product.options`.
   *
   * Nothing in the shop or on the server has ever read this array: the product
   * page renders `printingFields`. So whatever was typed into that section never
   * reached a customer and was never priced, while it looked fully editable.
   * The section is gone; what a product still carries there is offered as real
   * properties instead. A group the AI analyzer already turned into a property
   * (`custom-ai-<group id>`) is not offered twice.
   */
  const legacyGroupsAlreadyProperties = formOptions.filter((g) =>
    formPrintingFields.some((f) => f.id === `custom-ai-${g.id}`),
  );
  // String(...) throughout: this is old data no rule ever validated, and a
  // non-string here would take the whole Products screen down at render.
  const legacyGroupsToConvert = formOptions.filter(
    (g) =>
      !legacyGroupsAlreadyProperties.includes(g) &&
      String(g?.name ?? '').trim() &&
      Array.isArray(g?.values) &&
      g.values.some((v) => String(v?.label ?? '').trim()),
  );
  /** Groups with no name or no named choice — nothing to turn into a property. */
  const legacyGroupsEmpty = formOptions.length - legacyGroupsAlreadyProperties.length - legacyGroupsToConvert.length;
  const handleConvertLegacyOptions = () => {
    const seed = Date.now();
    const converted: PrintingField[] = legacyGroupsToConvert.map((group, gIdx) => {
      const fieldId = `custom-${seed}-${gIdx}`;
      return {
        id: fieldId,
        name: String(group.name).trim(),
        group: 'product_builder',
        // OFF until he has looked at it: these never reached the shop, and
        // switching them on is the moment they start costing customers money.
        enabled: false,
        options: group.values
          .filter((v) => String(v?.label ?? '').trim())
          .map((v, vIdx) => ({
            id: `${fieldId}-${vIdx}`,
            label: String(v.label).trim(),
            value: slugify(String(v.label)),
            priceModifier: Number(v.priceModifier) || 0,
            ...(vIdx === 0 ? { isDefault: true } : {}),
          })),
      };
    });
    setFormPrintingFields((prev) => [...prev, ...converted]);
    setExpandedCustomFieldIds((prev) => [...prev, ...converted.map((f) => f.id)]);
    setFormOptions([]);
  };
  const handleDropLegacyOptions = async () => {
    const ok = await confirm({
      title: 'Remove the old option groups?',
      message: `${formOptions.length} old option group(s) will be removed from this product when you save. They were never shown in the shop.`,
      confirmLabel: 'Remove',
    });
    if (ok) setFormOptions([]);
  };

  return (
    <div className="space-y-8">
      {/* Header Bar */}
      <div className="bg-white rounded-3xl p-6 md:p-8 border border-gray-100 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="inline-flex items-center px-3 py-1 bg-blue-50 text-blue-700 text-xs font-bold rounded-full mb-2">
            <Package className="w-3.5 h-3.5 mr-1.5" />
            {t('tabProducts')}
          </div>
          <h2 className="text-2xl font-black text-gray-900">
            Product Catalog & Pricing Rules
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            Manage product listings, allowed quantities, delivery speeds, features, and base prices.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {aiAnalyzerAvailable && (
            <button
              onClick={() => setIsAiAnalyzerOpen(true)}
              className="bg-gradient-to-r from-purple-600 via-indigo-600 to-blue-600 text-white font-extrabold text-xs md:text-sm px-5 py-3 rounded-2xl hover:opacity-95 transition-all shadow-md shadow-indigo-500/20 flex items-center space-x-2 rtl:space-x-reverse active:scale-95"
            >
              <Sparkles className="w-4 h-4 text-amber-300 animate-pulse" />
              <span>{'AI Competitor Product Analyzer'}</span>
            </button>
          )}

          <button
            onClick={() => handleOpenModal()}
            className="bg-blue-600 text-white font-bold text-xs md:text-sm px-5 py-3 rounded-2xl hover:bg-blue-700 transition-all shadow-md shadow-blue-500/20 flex items-center space-x-2 active:scale-95"
          >
            <Plus className="w-4 h-4" />
            <span>{t('addProduct')}</span>
          </button>
        </div>
      </div>

      {/* Success Notification */}
      {saveSuccess && (
        <div className="bg-green-50 border border-green-200 text-green-800 p-4 rounded-2xl flex items-center space-x-3 text-sm font-bold animate-fade-in">
          <Check className="w-5 h-5 text-green-600" />
          <span>Product updated and synchronized successfully!</span>
        </div>
      )}

      {/* Category Side Drawer Bar */}
      <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-gray-100 shadow-xs flex items-center justify-between gap-3">
        <div className="flex items-center space-x-2 space-x-reverse">
          <button
            onClick={() => setIsFilterDrawerOpen(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black transition-all flex items-center space-x-2 space-x-reverse shadow-xs cursor-pointer"
          >
            <SlidersHorizontal className="w-4 h-4" />
            <span>{t('paCategoryDrawer')}</span>
            <span className="bg-white/20 text-white text-[0.625rem] px-2 py-0.5 rounded-full">
              {selectedCategoryFilter === 'all' ? t('paAll') : categories.find(c => c.id === selectedCategoryFilter || c.name === selectedCategoryFilter)?.name || selectedCategoryFilter}
            </span>
          </button>

          {/* Visible / hidden. The count on each is of what that button WOULD
              show under the category filter already in force, so the two filters
              never contradict each other on screen. */}
          {([
            ['all', t('paVisAll')],
            ['visible', t('paVisVisible')],
            ['hidden', t('paVisHidden')],
          ] as const).map(([key, text]) => {
            const inCategory = products.filter(p =>
              selectedCategoryFilter === 'all'
              || p.categoryId === selectedCategoryFilter
              || p.categoryId === categories.find(c => c.id === selectedCategoryFilter)?.name);
            const count = key === 'all'
              ? inCategory.length
              : key === 'hidden'
                ? inCategory.filter(p => p.isHidden === true).length
                : inCategory.filter(p => p.isHidden !== true).length;
            return (
              <button
                key={key}
                onClick={() => setVisibilityFilter(key)}
                className={cn(
                  'px-3 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 cursor-pointer border',
                  visibilityFilter === key
                    ? 'bg-gray-900 text-white border-gray-900'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400',
                )}
              >
                {key === 'hidden' ? <EyeOff className="w-3.5 h-3.5" /> : key === 'visible' ? <Eye className="w-3.5 h-3.5" /> : null}
                <span>{text}</span>
                <span className={cn(
                  'text-[0.625rem] px-1.5 py-0.5 rounded-full',
                  visibilityFilter === key ? 'bg-white/20' : 'bg-gray-100',
                )}>
                  {count}
                </span>
              </button>
            );
          })}

          {/* WHERE IT CAME FROM. Built only from the names actually present, so
              a supplier that has never been imported is never offered — an empty
              filter is a dead end the owner has to discover by trying it. Hidden
              entirely until there is more than one answer to give. */}
          {(() => {
            const names = [...new Set(products.map((p) => p.supplierName).filter(Boolean))].sort() as string[];
            const ownCount = products.filter((p) => !p.supplierName).length;
            if (names.length === 0) return null;
            return (
              <select
                value={supplierFilter}
                onChange={(e) => setSupplierFilter(e.target.value)}
                className="px-3 py-2 rounded-xl text-xs font-black border border-gray-200 bg-white text-gray-700 cursor-pointer hover:border-gray-400 transition-colors"
              >
                <option value="all">{t('paSupplierAll')}</option>
                {ownCount > 0 && <option value="own">{t('paSupplierOwn')} ({ownCount})</option>}
                {names.map((n) => (
                  <option key={n} value={n}>
                    {n} ({products.filter((p) => p.supplierName === n).length})
                  </option>
                ))}
              </select>
            );
          })()}

          {/* Admin only: the order is saved on the category, which Firestore's
              rules let only an admin write. */}
          {filterCategory && user?.role === 'admin' && (
            <button
              type="button"
              onClick={() => setArrangeCategory(filterCategory)}
              className="px-3 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 cursor-pointer border border-blue-200"
              title="Drag this category's products into the order the shop shows them in"
            >
              <ListOrdered className="w-3.5 h-3.5" />
              <span>Arrange this category</span>
            </button>
          )}

          {selectedCategoryFilter !== 'all' && (
            <button
              onClick={() => setSelectedCategoryFilter('all')}
              className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-bold transition-all flex items-center space-x-1 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
              <span>{t('paClearFilter')}</span>
            </button>
          )}
        </div>
      </div>

      {arrangeCategory && (
        <ProductOrderModal
          category={arrangeCategory}
          categories={categories}
          products={products}
          onClose={() => setArrangeCategory(null)}
          onSaved={(productOrder) => {
            const id = arrangeCategory.id;
            setCategories((prev) => prev.map((c) => {
              if (c.id !== id) return c;
              const next = { ...c };
              if (productOrder) next.productOrder = productOrder;
              else delete next.productOrder;
              return next;
            }));
            setArrangeCategory(null);
            setBulkNotice(productOrder ? 'The new order is saved — the shop shows it now.' : 'Back to A–Ö.');
          }}
        />
      )}

      {/* ADMIN CATEGORY FILTER SIDE DRAWER */}
      <AnimatePresence>
        {isFilterDrawerOpen && (
          <div className="fixed inset-0 z-50 overflow-hidden flex justify-end">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsFilterDrawerOpen(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity"
            />

            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 220 }}
              className="relative w-full max-w-sm bg-white h-full shadow-2xl flex flex-col z-10 border-l border-gray-200"
            >
              <div className="p-5 border-b border-gray-100 flex items-center justify-between bg-blue-50/50">
                <div className="flex items-center space-x-3 space-x-reverse">
                  <div className="p-2.5 bg-blue-600 text-white rounded-2xl shadow-xs">
                    <SlidersHorizontal className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-base font-black text-gray-900">
                      {t('paCategorySidebar')}
                    </h2>
                    <p className="text-xs text-gray-500 font-medium">
                      Category Side Drawer
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => setIsFilterDrawerOpen(false)}
                  className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-2xl transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Drawer Search */}
              <div className="p-4 border-b border-gray-100 bg-gray-50/50">
                <div className="relative">
                  <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={filterDrawerSearch}
                    onChange={(e) => setFilterDrawerSearch(e.target.value)}
                    placeholder={t('paSearchCategories')}
                    className="w-full pl-10 pr-4 py-2.5 bg-white rounded-xl text-xs font-bold border border-gray-200 shadow-2xs focus:outline-hidden focus:border-blue-500 transition-colors"
                  />
                  {filterDrawerSearch && (
                    <button 
                      onClick={() => setFilterDrawerSearch('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Category List */}
              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                <button
                  onClick={() => {
                    setSelectedCategoryFilter('all');
                    setIsFilterDrawerOpen(false);
                  }}
                  className={cn(
                    "w-full p-3.5 rounded-2xl border text-left flex items-center justify-between transition-all cursor-pointer",
                    selectedCategoryFilter === 'all'
                      ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                      : "bg-white hover:bg-blue-50/50 border-gray-200 text-gray-800"
                  )}
                >
                  <div className="flex items-center space-x-3 space-x-reverse">
                    <div className={cn(
                      "p-2 rounded-xl",
                      selectedCategoryFilter === 'all' ? "bg-white/20 text-white" : "bg-blue-100 text-blue-600"
                    )}>
                      <Layers className="w-5 h-5" />
                    </div>
                    <div>
                      <span className="font-extrabold text-sm block">All Categories</span>
                      <span className={cn(
                        "text-xs block font-medium mt-0.5",
                        selectedCategoryFilter === 'all' ? "text-white/80" : "text-gray-400"
                      )}>
                        {products.length} {t('paProductsWord')}
                      </span>
                    </div>
                  </div>
                  {selectedCategoryFilter === 'all' && (
                    <CheckCircle2 className="w-5 h-5 text-white shrink-0 ml-2" />
                  )}
                </button>

                {/* Tree order, and each child carries its indent: the drawer used
                    to be a flat alphabetical list in which a sub-category and its
                    parent looked exactly the same. */}
                {categoryPickList(categories)
                  .filter(({ category: cat }) => !filterDrawerSearch.trim() || cat.name.toLowerCase().includes(filterDrawerSearch.toLowerCase()) || cat.id.toLowerCase().includes(filterDrawerSearch.toLowerCase()))
                  .map(({ category: cat, indent }) => {
                    const count = products.filter(p => p.categoryId === cat.id || p.categoryId === cat.name).length;
                    const isSel = selectedCategoryFilter === cat.id || selectedCategoryFilter === cat.name;

                    return (
                      <button
                        key={cat.id}
                        onClick={() => {
                          setSelectedCategoryFilter(cat.id);
                          setIsFilterDrawerOpen(false);
                        }}
                        className={cn(
                          "w-full p-3.5 rounded-2xl border text-left flex items-center justify-between transition-all cursor-pointer",
                          isSel
                            ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                            : "bg-white hover:bg-blue-50/50 border-gray-200 text-gray-800"
                        )}
                      >
                        <div className="flex items-center space-x-3 space-x-reverse">
                          <div className={cn(
                            "p-2 rounded-xl shrink-0",
                            isSel ? "bg-white/20 text-white" : "bg-gray-100 text-gray-600"
                          )}>
                            <Layers className="w-5 h-5" />
                          </div>
                          <div>
                            <span className="font-extrabold text-sm block">{indent}{cat.name}</span>
                            <span className={cn(
                              "text-xs block font-medium mt-0.5",
                              isSel ? "text-white/80" : "text-gray-400"
                            )}>
                              {count} {t('paProductsWord')}
                            </span>
                          </div>
                        </div>
                        {isSel && (
                          <CheckCircle2 className="w-5 h-5 text-white shrink-0 ml-2" />
                        )}
                      </button>
                    );
                  })}
              </div>

              {/* Footer */}
              <div className="p-4 border-t border-gray-100 bg-gray-50 flex items-center gap-2">
                <button
                  onClick={() => {
                    setSelectedCategoryFilter('all');
                    setIsFilterDrawerOpen(false);
                  }}
                  className="flex-1 py-2.5 bg-white border border-gray-200 text-gray-700 rounded-xl text-xs font-bold"
                >
                  {t('paShowAll')}
                </button>
                <button
                  onClick={() => setIsFilterDrawerOpen(false)}
                  className="flex-1 py-2.5 bg-gray-900 text-white rounded-xl text-xs font-bold"
                >
                  {t('paClose')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Product List Grid */}
      {loading ? (
        <div className="text-center py-12 text-gray-400 font-bold text-sm">
          Loading catalog items...
        </div>
      ) : products.length === 0 ? (
        <div className="bg-white rounded-3xl p-12 text-center border border-gray-100">
          <Box className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-600 font-bold">No products found</p>
          <p className="text-xs text-gray-400 mt-1">Click "Add New Product" to create your first listing.</p>
        </div>
      ) : (
        <>
        {bulkNotice && (
          <div className="bg-green-50 border border-green-200 text-green-800 p-3 rounded-2xl text-xs font-bold">
            {bulkNotice}
          </div>
        )}

        <ProductsBulkBar
          ids={selectedVisibleIds}
          categories={categories}
          onClear={() => setSelectedIds(new Set())}
          onDone={(result) => {
            setSelectedIds(new Set());
            // Re-read rather than patch the list in place: a bulk change can
            // move a product out of the filter that is showing it, and a patched
            // list would keep displaying it with its old values.
            void fetchProductsAndCategories();
            setBulkNotice(
              result.missing
                ? t('pbDoneMissing').replace('{0}', String(result.changed)).replace('{1}', String(result.missing))
                : t('pbDone').replace('{0}', String(result.changed)),
            );
            setTimeout(() => setBulkNotice(null), 5000);
          }}
        />

        {visibleProducts.length > 0 && (
          <label className="flex items-center gap-2 px-1 cursor-pointer w-fit">
            <input
              type="checkbox"
              checked={selectedVisibleIds.length === visibleProducts.length && visibleProducts.length > 0}
              onChange={(e) => setSelectedIds(e.target.checked
                ? new Set(visibleProducts.map((p) => p.id))
                // Only what is ON SCREEN is cleared: a product hidden by the
                // current filter but ticked under a previous one stays ticked,
                // which is what the count in the bar is counting.
                : new Set([...selectedIds].filter((id) => !visibleProducts.some((p) => p.id === id))))}
              className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
            />
            <span className="text-xs font-black text-gray-600">{t('pbSelectAll')}</span>
          </label>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {visibleProducts
            .map((p) => {
              const matchedCat = categories.find(c => c.id === p.categoryId || c.name === p.categoryId);
              const catDisplayName = matchedCat ? matchedCat.name : (p.categoryId || 'General');

              return (
            <motion.div
              key={p.id}
              layout
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-3xl border border-gray-100 shadow-sm hover:shadow-md transition-all overflow-hidden flex flex-col justify-between"
            >
              <div>
                {/* Product Image Header */}
                <div className="relative h-48 bg-gray-100 overflow-hidden">
                  <label
                    className="absolute top-3 left-3 z-10 bg-white/90 backdrop-blur-md rounded-lg p-1.5 shadow-sm cursor-pointer"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.has(p.id)}
                      onChange={() => toggleSelected(p.id)}
                      className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 block"
                    />
                  </label>
                  <img
                    src={p.images?.[0] || '/placeholder-print.svg'}
                    alt={p.name}
                    className="w-full h-full object-cover"
                  />
                  {/* The price badge says what the shop is CHARGING. An
                      offer is shown as the live price with the list price
                      struck through beside it — the owner has to be able to
                      spot a discounted product without opening it. */}
                  <div className="absolute top-3 right-3 bg-white/90 backdrop-blur-md px-3 py-1 rounded-full text-xs font-black shadow-sm border border-white/50 flex items-baseline gap-1.5">
                    {Number(p.salePrice) > 0 && Number(p.salePrice) < Number(p.basePrice) ? (
                      <>
                        <span className="text-red-600">{p.salePrice} SEK</span>
                        <span className="text-gray-400 line-through text-[0.625rem]">{p.basePrice}</span>
                      </>
                    ) : (
                      <span className="text-blue-700">{p.basePrice} SEK</span>
                    )}
                  </div>

                  {/* A hidden product looked exactly like a live one here, so a
                      duplicate could sit in this grid for weeks while no
                      customer could reach it. */}
                  {p.isHidden === true ? (
                    <div className="absolute top-3 left-3 bg-amber-500/95 text-white backdrop-blur-md px-2.5 py-1 rounded-full text-[0.625rem] font-black uppercase tracking-wider shadow-sm flex items-center space-x-1">
                      <EyeOff className="w-3 h-3" />
                      <span>Hidden</span>
                    </div>
                  ) : p.isWeb2Print ? (
                    <div className="absolute top-3 left-3 bg-purple-600/90 text-white backdrop-blur-md px-2.5 py-1 rounded-full text-[0.625rem] font-black uppercase tracking-wider shadow-sm flex items-center space-x-1">
                      <Zap className="w-3 h-3 fill-current" />
                      <span>Web2Print</span>
                    </div>
                  ) : null}

                  {p.images && p.images.length > 1 && (
                    <div className="absolute bottom-3 left-3 bg-black/75 text-white backdrop-blur-md px-2.5 py-1 rounded-full text-[0.625rem] font-extrabold flex items-center space-x-1 shadow-sm">
                      <ImageIcon className="w-3 h-3" />
                      <span>{p.images.length} Photos</span>
                    </div>
                  )}
                </div>

                {/* Content */}
                <div className="p-5 space-y-4">
                  <div>
                    <div className="flex items-center space-x-2 space-x-reverse mb-1">
                      <span className="px-2.5 py-0.5 bg-orange-50 text-orange-700 border border-orange-200/60 rounded-lg text-[0.625rem] font-black flex items-center">
                        <Layers className="w-3 h-3 mr-1" />
                        {t('paCategoryLabel')}: {catDisplayName}
                      </span>
                      {/* WHERE IT CAME FROM — "يجب وضع اسم Supplier". A product
                          the owner built himself carries no supplier and gets no
                          badge, which is the difference he needs to see. */}
                      {p.supplierName && (
                        <span
                          className="text-[0.625rem] font-black px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-100"
                          title={p.supplierOfferId ? `${p.supplierName} · ${p.supplierOfferId}` : String(p.supplierName)}
                        >
                          {p.supplierName}
                        </span>
                      )}
                    </div>
                    <h3 className="text-lg font-black text-gray-900 leading-tight">{p.name}</h3>
                    <p className="text-xs text-gray-500 line-clamp-2 mt-1">{p.description}</p>
                  </div>

                  {/* Quantity Limits & Stock */}
                  <div className="grid grid-cols-2 gap-2 bg-gray-50 p-3 rounded-2xl border border-gray-100/80 text-xs">
                    <div>
                      <span className="text-gray-400 font-bold block text-[0.625rem] uppercase">Allowed Quantity</span>
                      <span className="font-extrabold text-gray-800">
                        {p.minQuantity ?? 1} - {p.maxQuantity ?? '∞'} units
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-400 font-bold block text-[0.625rem] uppercase">Stock Level</span>
                      <span className="font-extrabold text-gray-800">{p.stock ?? '\u2014'} pcs</span>
                    </div>
                  </div>

                  {/* Features */}
                  {p.features && p.features.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {p.features.slice(0, 3).map((feat, idx) => (
                        <span key={idx} className="text-[0.625rem] bg-gray-100 text-gray-600 font-bold px-2 py-0.5 rounded-lg">
                          • {feat}
                        </span>
                      ))}
                      {p.features.length > 3 && (
                        <span className="text-[0.625rem] bg-gray-100 text-gray-400 font-bold px-2 py-0.5 rounded-lg">
                          +{p.features.length - 3} more
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="p-4 bg-gray-50/50 border-t border-gray-100 flex items-center justify-between gap-2">
                <div className="flex items-center space-x-2 space-x-reverse">
                  {/* THE PRODUCT AS CUSTOMERS SEE IT (client, 2026-10-07: "VIEW must show
                      the user interface, not this"), in a new tab — a hidden one too,
                      for an admin, with a note that only he sees it. */}
                  <a
                    href={productPath(p)}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-rx-product-view={p.id}
                    className="text-xs font-extrabold text-indigo-600 hover:text-indigo-800 flex items-center space-x-1 space-x-reverse px-3 py-1.5 rounded-xl bg-indigo-50/80 hover:bg-indigo-100 transition-colors shadow-2xs"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>{'View Product'}</span>
                  </a>

                  <button
                    onClick={() => handleOpenModal(p)}
                    className="text-xs font-extrabold text-blue-600 hover:text-blue-800 flex items-center space-x-1 space-x-reverse px-3 py-1.5 rounded-xl hover:bg-blue-50 transition-colors"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>{'Edit'}</span>
                  </button>

                  <button
                    onClick={() => handleCloneProduct(p)}
                    disabled={cloningId === p.id}
                    title={t('paCloneTip')}
                    className="text-xs font-extrabold text-emerald-700 hover:text-emerald-900 flex items-center space-x-1 space-x-reverse px-3 py-1.5 rounded-xl hover:bg-emerald-50 transition-colors disabled:opacity-50 disabled:cursor-wait"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>{cloningId === p.id ? t('paCloning') : t('paClone')}</span>
                  </button>
                </div>

                <button
                  onClick={() => handleDeleteProduct(p.id)}
                  className="text-xs font-extrabold text-red-500 hover:text-red-700 p-1.5 rounded-xl hover:bg-red-50 transition-colors"
                  title={'Delete Product'}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </motion.div>
              );
            })}
        </div>
        </>
      )}

      {/* Product Edit / Create Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full max-w-3xl rounded-3xl shadow-2xl border border-gray-100 overflow-hidden my-8"
            >
              {/* Modal Header */}
              <div className="px-8 py-5 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                <div>
                  <h3 className="text-xl font-black text-gray-900">
                    {editingProduct ? ft.titleEdit : ft.titleNew}
                  </h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Configure basic information, quantity limits, delivery speeds, and characteristics.
                  </p>
                </div>
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="p-2 rounded-full hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Modal Body / Form */}
              <form onSubmit={handleSaveProduct} className="p-8 space-y-8 max-h-[75vh] overflow-y-auto">
                {/* 0. CLONE — first thing on the form, on purpose.
                    A print shop's catalogue is families of near-identical jobs:
                    the same rollup in four sizes, the same card on three papers.
                    Starting each one from an empty form is how option lists drift
                    apart. Pick the product it is LIKE, then change what differs. */}
                {/* START FROM A TEMPLATE (2026-10-15). Clothing: every colour as
                    a swatch grid, and a quantity box under each size S–5XL — each
                    size becomes its own basket line (src/lib/clothingTemplate.ts). */}
                {!editingProduct && (
                  <div className="space-y-3 p-4 rounded-2xl border border-sky-200 bg-sky-50/50">
                    <div className="flex items-center space-x-2 text-sky-800 font-extrabold text-sm">
                      <Layers className="w-4 h-4" />
                      <span>{ft.tplTitle}</span>
                      <span className="text-[0.625rem] font-bold text-sky-700 bg-white border border-sky-200 px-2 py-0.5 rounded-full uppercase">
                        {ft.optional}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const fields = clothingFields();
                          const ids = new Set(fields.map((f) => f.id));
                          setFormPrintingFields((prev) => [...prev.filter((f) => !ids.has(f.id)), ...fields]);
                          setFormMinQty(1);
                          setTemplateApplied('clothing');
                        }}
                        className="px-4 py-2 bg-sky-700 text-white rounded-xl text-xs font-black hover:bg-sky-800 transition-colors flex items-center gap-1.5"
                      >
                        <Shirt className="w-3.5 h-3.5" />
                        {ft.tplClothing}
                      </button>
                    </div>
                    {templateApplied === 'clothing' && (
                      <p className="text-[0.6875rem] font-black text-sky-900 bg-white border border-sky-200 rounded-xl px-3 py-2 flex items-center gap-1.5">
                        <Check className="w-3.5 h-3.5 text-sky-700" />
                        {ft.tplDone}
                      </p>
                    )}
                  </div>
                )}

                {!editingProduct && (
                  <div className="space-y-3 p-4 rounded-2xl border border-emerald-200 bg-emerald-50/50">
                    <div className="flex items-center space-x-2 text-emerald-700 font-extrabold text-sm">
                      <Copy className="w-4 h-4" />
                      <span>{ft.cloneTitle}</span>
                      <span className="text-[0.625rem] font-bold text-emerald-600 bg-white border border-emerald-200 px-2 py-0.5 rounded-full uppercase">
                        {ft.optional}
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 font-bold">
                      {ft.cloneLead}
                    </p>

                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="text"
                        value={cloneSearch}
                        onChange={(e) => setCloneSearch(e.target.value)}
                        placeholder={ft.cloneSearch}
                        className="sm:w-56 px-3 py-2 border border-gray-200 rounded-xl text-xs font-bold bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                      <select
                        value={cloneSourceId}
                        onChange={(e) => setCloneSourceId(e.target.value)}
                        className="flex-1 min-w-0 px-3 py-2 border border-gray-200 rounded-xl text-xs font-bold bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      >
                        <option value="">{ft.clonePick}</option>
                        {products
                          .filter((p) => {
                            const q = cloneSearch.trim().toLowerCase();
                            if (!q) return true;
                            return (
                              (p.name || '').toLowerCase().includes(q) ||
                              (p.sku || '').toLowerCase().includes(q)
                            );
                          })
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                              {p.sku ? ` — ${p.sku}` : ''}
                              {p.isHidden ? ` (${ft.cloneHidden})` : ''}
                            </option>
                          ))}
                      </select>
                      <button
                        type="button"
                        disabled={!cloneSourceId || cloneLoading}
                        onClick={() => handleCloneIntoForm(cloneSourceId)}
                        className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-black hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 shrink-0"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        {cloneLoading ? ft.cloning : ft.cloneBtn}
                      </button>
                    </div>

                    {cloneCarryOver && (
                      <p className="text-[0.6875rem] font-black text-emerald-800 bg-white border border-emerald-200 rounded-xl px-3 py-2 flex items-center gap-1.5">
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        {ft.cloneDone}
                      </p>
                    )}
                  </div>
                )}

                {/* 1. Basic Information */}
                <div className="space-y-4">
                  <div className="flex items-center space-x-2 text-blue-600 font-extrabold text-sm border-b border-gray-100 pb-2">
                    <Package className="w-4 h-4" />
                    <span>Basic Information</span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Visible or not. A duplicated product arrives hidden on
                        purpose, and until this existed there was no way to put
                        it in the shop afterwards. */}
                    <label
                      className={cn(
                        'md:col-span-2 flex items-start space-x-2.5 cursor-pointer p-3 rounded-2xl border',
                        formIsHidden
                          ? 'bg-amber-50 border-amber-200'
                          : 'bg-emerald-50/60 border-emerald-200',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={!formIsHidden}
                        onChange={(e) => setFormIsHidden(!e.target.checked)}
                        className="w-4 h-4 mt-0.5 text-emerald-600 rounded focus:ring-emerald-500"
                      />
                      <span>
                        <span className="block text-xs font-black text-gray-900">
                          {formIsHidden ? 'Hidden from the shop' : 'Visible in the shop'}
                        </span>
                        <span className="block text-[0.625rem] text-gray-500 font-bold mt-0.5">
                          {formIsHidden
                            ? 'Customers cannot see this product or open its page. Tick the box to publish it.'
                            : 'Customers can find and buy this product.'}
                        </span>
                      </span>
                    </label>

                    <div className="md:col-span-2">
                      <label className="block text-xs font-extrabold text-gray-700 mb-1">
                        Product Title / Name *
                      </label>
                      <input
                        type="text"
                        required
                        value={formName}
                        onChange={(e) => setFormName(e.target.value)}
                        placeholder="e.g. Premium Business Cards 350GSM"
                        className="w-full px-4 py-2.5 border border-gray-200 rounded-2xl text-sm font-bold text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none"
                      />
                      {/* The name is the address. Showing it here is the only
                          way the owner learns that renaming a product also
                          moves its link. */}
                      <p className="text-[0.625rem] font-bold text-gray-500 mt-1">
                        Web address:{' '}
                        <span className="font-black text-gray-700">
                          /products/{addressSlug(formName) || (editingProduct?.id ?? 'prod-…')}
                        </span>
                      </p>
                      <LocalizedTextFields
                        label="Product name"
                        fallback={formName}
                        value={formNameI18n}
                        onChange={setFormNameI18n}
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-extrabold text-gray-700 mb-1">
                        {t('paCategoryField')}
                      </label>
                      <select
                        value={formCategory}
                        onChange={(e) => setFormCategory(e.target.value)}
                        className="w-full px-4 py-2.5 border border-gray-200 rounded-2xl text-sm font-bold text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none"
                      >
                        {categories.length > 0 ? (
                          /* Indented, in tree order. A product can be filed in a
                             sub-category — it always could — but a flat list gave
                             him no way to see which of these IS one. */
                          categoryPickList(categories).map(({ category: cat, indent }) => (
                            <option key={cat.id} value={cat.id}>
                              {indent}{cat.name}
                            </option>
                          ))
                        ) : (
                          <>
                            <option value="labels">Etiketter & Labels</option>
                            <option value="business-cards">Business Cards</option>
                            <option value="large-format">Large Format & Banners</option>
                            <option value="stickers">Stickers & Labels</option>
                            <option value="general">General Printing</option>
                          </>
                        )}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-extrabold text-gray-700 mb-1">
                        Base Price (SEK, excl. VAT) *
                      </label>
                      <input
                        type="number"
                        required
                        min="0"
                        value={formPrice}
                        onChange={(e) => setFormPrice(Number(e.target.value))}
                        className="w-full px-4 py-2.5 border border-gray-200 rounded-2xl text-sm font-bold text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none"
                      />

                      {/* Prices are entered NET. The owner asked for the plain
                          number with a label rather than a three-line breakdown —
                          what the customer sees is governed by the incl./excl. VAT
                          switch in the header. */}
                      <p className="text-[0.6875rem] font-bold text-gray-400 mt-1.5">
                        {t('paPriceExclVatNote').replace('{0}', String(Math.round(vatRate * 1000) / 10))}
                      </p>
                    </div>

                    {/* THE SPECIAL OFFER PRICE.
                        Sits directly under the base price because the two are
                        read together: the shop strikes one through and charges
                        the other. Labels here are hard-coded English like their
                        neighbours above — this screen is admin-only and its
                        immediate siblings are not translated. */}
                    <div>
                      <label className="block text-xs font-extrabold text-gray-700 mb-1">
                        Special Offer Price (SEK, excl. VAT)
                      </label>
                      <input
                        type="number"
                        min="0"
                        placeholder="No offer"
                        value={formSalePrice}
                        onChange={(e) => setFormSalePrice(e.target.value === '' ? '' : Number(e.target.value))}
                        className="w-full px-4 py-2.5 border border-gray-200 rounded-2xl text-sm font-bold text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none"
                      />
                      <p className="text-[0.6875rem] font-bold text-gray-400 mt-1.5">
                        Leave empty for no offer. Must be lower than the base price.
                        The shop shows an OFFER badge and strikes through the old price.
                        A product on offer cannot also be discounted with a coupon code.
                      </p>
                      {formSalePrice !== '' && Number(formSalePrice) > 0 && Number(formSalePrice) < Number(formPrice) && (
                        <p className="text-[0.6875rem] font-black text-red-600 mt-1">
                          −{Math.round((1 - Number(formSalePrice) / Number(formPrice)) * 100)}% off
                        </p>
                      )}
                    </div>

                    {/* THE MINIMUM UNIT PRICE (code review ADM-14). It was a hidden 149
                        kr in the save: a product priced under it was charged it, with
                        nothing here to say so. Now it is shown, his to change. */}
                    <div>
                      <label htmlFor="pa-min-price" className="block text-xs font-extrabold text-gray-700 mb-1">
                        Minimum unit price (kr)
                      </label>
                      <input
                        id="pa-min-price"
                        type="number"
                        min="0"
                        step="1"
                        value={formMinPrice}
                        onChange={(e) => setFormMinPrice(e.target.value)}
                        data-rx-product-min-price
                        className="w-full px-4 py-2.5 border border-gray-200 rounded-2xl text-sm font-bold text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none"
                      />
                      {/* An empty box KEEPS the minimum (the save treats it as "not a number");
                          it said "0 = no minimum" and nothing about that, so an owner who
                          emptied it to remove the minimum kept 149 (code review 2026-10-11). */}
                      <p className="text-[0.6875rem] font-bold text-gray-400 mt-1.5" data-rx-product-min-price-hint>
                        A piece that adds up to less is charged this instead, before quantity discounts — on the product
                        page, in the shop&rsquo;s cards and at the checkout. 0 removes the minimum; left empty, the box
                        keeps the product&rsquo;s current one. The shop&rsquo;s default is {PRICING_DEFAULTS.minPrice} kr.
                      </p>
                      {(() => {
                        // The minimum the save will keep, read as the save reads it: the
                        // number typed, or — empty, or not a number — what the product has.
                        const typed = formMinPrice.trim() === '' ? NaN : Number(formMinPrice.replace(',', '.'));
                        const kept = (editingProduct?.customUploadRules ?? cloneCarryOver?.customUploadRules)?.minPrice;
                        const min = Number.isFinite(typed) && typed >= 0 ? typed : Number(kept ?? PRICING_DEFAULTS.minPrice) || 0;
                        const offer = formSalePrice !== '' && Number(formSalePrice) > 0 && Number(formSalePrice) < Number(formPrice);
                        const piece = offer ? Number(formSalePrice) : Number(formPrice);
                        return min > 0 && piece < min ? (
                          <p className="text-[0.6875rem] font-black text-amber-700 mt-1" data-rx-product-min-price-lifts>
                            At {piece} kr this product is under the minimum: customers are charged {min} kr a piece (before quantity discounts).
                          </p>
                        ) : null;
                      })()}
                    </div>

                    <div className="md:col-span-2">
                      <label className="block text-xs font-extrabold text-gray-700 mb-1">
                        Description
                      </label>
                      <textarea
                        rows={3}
                        value={formDesc}
                        onChange={(e) => setFormDesc(e.target.value)}
                        placeholder="Detailed description of materials, finishes, and specs..."
                        className="w-full px-4 py-2.5 border border-gray-200 rounded-2xl text-sm font-bold text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                      />
                      <LocalizedTextFields
                        label="Description"
                        fallback={formDesc}
                        value={formDescI18n}
                        onChange={setFormDescI18n}
                        multiline
                      />
                    </div>
                  </div>
                </div>

                {/* 1b. WHAT GOOGLE SEES.
                    Kept next to the description on purpose: this is the screen
                    where a product gets its words, and the sentence Google shows
                    is one of them. Everything here is optional — an empty box
                    means "work it out from the name and the description above",
                    which is exactly what the page did before these fields
                    existed. */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between text-blue-600 font-extrabold text-sm border-b border-gray-100 pb-2">
                    <div className="flex items-center space-x-2">
                      <Search className="w-4 h-4" />
                      <span>Google — search result &amp; Shopping</span>
                    </div>
                    <span className="text-[0.625rem] font-bold text-gray-400 normal-case">All optional</span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="md:col-span-2">
                      <label className="block text-xs font-extrabold text-gray-700 mb-1">
                        Search-result title
                      </label>
                      <input
                        type="text"
                        value={formSeoTitle}
                        onChange={(e) => setFormSeoTitle(e.target.value)}
                        placeholder={formName || 'Leave empty to use the product name'}
                        className="w-full px-4 py-2.5 border border-gray-200 rounded-2xl text-sm font-bold text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none"
                      />
                      <p
                        className={cn(
                          'text-[0.6875rem] font-bold mt-1',
                          formSeoTitle.trim().length > TITLE_LIMIT ? 'text-amber-600' : 'text-gray-400',
                        )}
                      >
                        {formSeoTitle.trim().length}/{TITLE_LIMIT} characters
                        {formSeoTitle.trim().length > TITLE_LIMIT
                          ? ' — Google will cut this off mid-word.'
                          : ' — empty uses the product name.'}
                      </p>
                    </div>

                    <div className="md:col-span-2">
                      <label className="block text-xs font-extrabold text-gray-700 mb-1">
                        Search-result description
                      </label>
                      <textarea
                        rows={2}
                        value={formSeoDescription}
                        onChange={(e) => setFormSeoDescription(e.target.value)}
                        placeholder="The two lines under the blue link in Google. Write the words a customer actually searches for."
                        className="w-full px-4 py-2.5 border border-gray-200 rounded-2xl text-sm font-bold text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                      />
                      <p
                        className={cn(
                          'text-[0.6875rem] font-bold mt-1',
                          formSeoDescription.trim().length > DESCRIPTION_LIMIT ? 'text-amber-600' : 'text-gray-400',
                        )}
                      >
                        {formSeoDescription.trim().length}/{DESCRIPTION_LIMIT} characters
                        {formSeoDescription.trim().length > DESCRIPTION_LIMIT
                          ? ' — Google will cut this off mid-word.'
                          : ' — empty uses the description above.'}
                      </p>
                    </div>

                    {/* A LIVE RESULT, not a promise. The owner has asked more than
                        once why a product "has no description" when the page shows
                        one: what he was reading was the generic fallback, the same
                        sentence on every product. Seeing the real thing next to the
                        boxes is the answer. */}
                    <div className="md:col-span-2 bg-gray-50 border border-gray-100 rounded-2xl p-4">
                      <p className="text-[0.625rem] font-black uppercase tracking-wider text-gray-400 mb-2">
                        How it looks in Google
                      </p>
                      <p className="text-[0.6875rem] text-emerald-800 font-bold truncate">
                        shop.reklamx.se › products › {addressSlug(formName || '') || 'product'}
                      </p>
                      <p className="text-[0.9375rem] leading-snug text-blue-800 font-bold truncate">
                        {(formSeoTitle.trim() || formName || 'Product name') + ' | ReklamX'}
                      </p>
                      <p className="text-[0.75rem] leading-relaxed text-gray-600 font-semibold line-clamp-2">
                        {formSeoDescription.trim() ||
                          formDesc.replace(/<[^>]*>/g, ' ').trim() ||
                          'High-quality printing with modern technology and vivid colours for any use.'}
                      </p>
                      {!formSeoDescription.trim() && !formDesc.trim() && (
                        <p className="text-[0.6875rem] font-bold text-amber-600 mt-2">
                          This is the shop's generic sentence — every product with an empty description shows the
                          same one, and Google does not rank a page it has already read nine times.
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="block text-xs font-extrabold text-gray-700 mb-1">Brand</label>
                      <input
                        type="text"
                        value={formBrand}
                        onChange={(e) => setFormBrand(e.target.value)}
                        placeholder="Leave empty to use the shop's name"
                        className="w-full px-4 py-2.5 border border-gray-200 rounded-2xl text-sm font-bold text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-extrabold text-gray-700 mb-1">Condition</label>
                      <select
                        value={formCondition}
                        onChange={(e) => setFormCondition(e.target.value as 'new' | 'refurbished' | 'used')}
                        className="w-full px-4 py-2.5 border border-gray-200 rounded-2xl text-sm font-bold text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                      >
                        <option value="new">New</option>
                        <option value="refurbished">Refurbished</option>
                        <option value="used">Used</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-extrabold text-gray-700 mb-1">
                        GTIN / barcode
                      </label>
                      <input
                        type="text"
                        value={formGtin}
                        onChange={(e) => setFormGtin(e.target.value)}
                        placeholder="Usually empty for custom print"
                        className="w-full px-4 py-2.5 border border-gray-200 rounded-2xl text-sm font-mono font-bold text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none"
                      />
                      <p className="text-[0.6875rem] font-bold text-gray-400 mt-1">
                        No barcode is a valid answer — the feed then tells Google none exists.
                      </p>
                    </div>

                    <div>
                      <label className="block text-xs font-extrabold text-gray-700 mb-1">MPN</label>
                      <input
                        type="text"
                        value={formMpn}
                        onChange={(e) => setFormMpn(e.target.value)}
                        placeholder="Your own article number, if you use one"
                        className="w-full px-4 py-2.5 border border-gray-200 rounded-2xl text-sm font-mono font-bold text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none"
                      />
                    </div>

                    <div className="md:col-span-2">
                      <label className="block text-xs font-extrabold text-gray-700 mb-1">
                        Google product category
                      </label>
                      <input
                        type="text"
                        value={formGoogleCategory}
                        onChange={(e) => setFormGoogleCategory(e.target.value)}
                        placeholder="e.g. Business & Industrial > Signage > Business Signs"
                        className="w-full px-4 py-2.5 border border-gray-200 rounded-2xl text-sm font-bold text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none"
                      />
                      <p className="text-[0.6875rem] font-bold text-gray-400 mt-1">
                        Leave empty to use the shop-wide default from the Google tab.
                      </p>
                    </div>

                    <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <label className="flex items-start gap-2.5 p-3 bg-gray-50 border border-gray-100 rounded-2xl cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formSeoNoindex}
                          onChange={(e) => setFormSeoNoindex(e.target.checked)}
                          className="mt-0.5 w-4 h-4 accent-blue-600"
                        />
                        <span className="text-[0.75rem] font-bold text-gray-700 leading-snug">
                          Hide from Google
                          <span className="block text-[0.6875rem] font-semibold text-gray-400">
                            Still on sale, still reachable by link — just not in search results.
                          </span>
                        </span>
                      </label>

                      <label className="flex items-start gap-2.5 p-3 bg-gray-50 border border-gray-100 rounded-2xl cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formSeoExcludeFromSitemap}
                          onChange={(e) => setFormSeoExcludeFromSitemap(e.target.checked)}
                          className="mt-0.5 w-4 h-4 accent-blue-600"
                        />
                        <span className="text-[0.75rem] font-bold text-gray-700 leading-snug">
                          Keep out of the sitemap
                          <span className="block text-[0.6875rem] font-semibold text-gray-400">
                            Not offered to Google, but Google may still find it on its own.
                          </span>
                        </span>
                      </label>
                    </div>
                  </div>
                </div>

                {/* 2. Product Images Gallery & Upload */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between text-blue-600 font-extrabold text-sm border-b border-gray-100 pb-2">
                    <div className="flex items-center space-x-2">
                      <ImageIcon className="w-4 h-4" />
                      <span>Product Images & Gallery</span>
                    </div>
                    <span className="text-xs font-bold text-gray-500 bg-gray-100 px-2.5 py-0.5 rounded-full">
                      {formImages.length} {formImages.length === 1 ? 'Image' : 'Images'}
                    </span>
                  </div>

                  {/* Upload File or Add URL Controls */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-gray-50 p-4 rounded-2xl border border-gray-100">
                    {/* File Upload Option */}
                    <div>
                      <label className="block text-xs font-extrabold text-gray-700 mb-1.5 flex items-center">
                        <Upload className="w-3.5 h-3.5 mr-1 text-blue-600" />
                        <span>Upload Image File</span>
                      </label>
                      <label className="flex flex-col items-center justify-center p-3 border-2 border-dashed border-gray-300 hover:border-blue-500 bg-white rounded-2xl cursor-pointer transition-all hover:bg-blue-50/30 text-center">
                        <Upload className="w-5 h-5 text-gray-400 mb-1" />
                        <span className="text-xs font-bold text-gray-700">Choose Files / Drag & Drop</span>
                        <span className="text-[0.625rem] text-gray-400 mt-0.5">PNG, JPG, WEBP, GIF</span>
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          onChange={handleImageFilesUpload}
                          data-rx-product-picture-file
                          className="hidden"
                        />
                      </label>
                    </div>

                    {/* URL Input Option */}
                    <div>
                      <label className="block text-xs font-extrabold text-gray-700 mb-1.5 flex items-center">
                        <LinkIcon className="w-3.5 h-3.5 mr-1 text-blue-600" />
                        <span>Add Image URL</span>
                      </label>
                      <div className="space-y-2">
                        <div className="flex space-x-2">
                          <input
                            type="url"
                            value={newUrlInput}
                            onChange={(e) => setNewUrlInput(e.target.value)}
                            placeholder="https://images.unsplash.com/..."
                            className="flex-1 px-3.5 py-2 border border-gray-200 rounded-2xl text-xs font-bold text-gray-900 bg-white outline-none focus:ring-2 focus:ring-blue-500"
                          />
                          <button
                            type="button"
                            onClick={handleAddImageUrl}
                            className="bg-blue-600 text-white font-bold text-xs px-4 py-2 rounded-2xl hover:bg-blue-700 transition-colors shadow-sm"
                          >
                            Add URL
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => setImagePickerOpen(true)}
                          className="w-full px-4 py-2 bg-gray-100 text-gray-800 text-xs font-black rounded-2xl hover:bg-gray-200 transition-colors"
                        >
                          {t('mlChoose')}
                        </button>
                        <p className="text-[0.625rem] text-gray-400">
                          Paste image links from Unsplash, Cloudinary, or any CDN.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Image Thumbnails List */}
                  {formImages.length > 0 && (
                    <div className="space-y-2 pt-1">
                      <label className="block text-xs font-extrabold text-gray-600">
                        Uploaded Gallery (First photo is the main cover — drag a photo by its grip to reorder)
                      </label>
                      <SortableList
                        layout="grid"
                        ids={imageIds}
                        onReorder={(orderedIds) => setFormImages((prev) => reorderByValueIds(prev, orderedIds, 'img-'))}
                        className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-3"
                        renderItem={(_id, { handle, index: idx }) => {
                          const img = formImages[idx];
                          if (img === undefined) return null;
                          return (
                          <div
                            className={cn(
                              "relative rounded-2xl overflow-hidden border-2 h-28 group bg-gray-100 transition-all shadow-sm",
                              idx === 0 ? "border-blue-600 ring-2 ring-blue-500/20" : "border-gray-200"
                            )}
                          >
                            <img src={img} alt={`Product ${idx}`} className="w-full h-full object-cover" />
                            {/* Above the hover overlay, so the grip can always be taken. */}
                            <DragHandle
                              handle={handle}
                              label="Drag this photo"
                              className="absolute top-1.5 right-1.5 z-10 bg-white/90 text-gray-700 shadow-sm hover:bg-white"
                            />
                            
                            {/* Primary badge */}
                            {idx === 0 && (
                              <span className="absolute top-1.5 left-1.5 bg-blue-600 text-white text-[0.5625rem] font-black px-2 py-0.5 rounded-md shadow-md">
                                Cover
                              </span>
                            )}

                            {/* Hover Actions Overlay */}
                            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center space-x-1.5">
                              {idx !== 0 && (
                                <button
                                  type="button"
                                  onClick={() => handleSetPrimaryImage(idx)}
                                  title="Set as Main Cover"
                                  className="p-1.5 bg-white text-amber-600 rounded-full hover:bg-amber-50 transition-colors shadow-sm"
                                >
                                  <Star className="w-3.5 h-3.5 fill-current" />
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => handleRemoveImage(idx)}
                                title="Remove Image"
                                className="p-1.5 bg-red-600 text-white rounded-full hover:bg-red-700 transition-colors shadow-sm"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                          );
                        }}
                      />
                    </div>
                  )}
                </div>

                {/* 2. Quantity & Delivery Speed */}
                <div className="space-y-4">
                  <div className="flex items-center space-x-2 text-blue-600 font-extrabold text-sm border-b border-gray-100 pb-2">
                    <SlidersHorizontal className="w-4 h-4" />
                    <span>Quantity & Delivery Speed</span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-gray-50 p-4 rounded-2xl border border-gray-100">
                    <div>
                      <label className="block text-[0.6875rem] font-extrabold text-gray-600 mb-1">
                        {t('paMinQty')}
                      </label>
                      <input
                        type="number"
                        min="1"
                        value={formMinQty}
                        onChange={(e) => setFormMinQty(Number(e.target.value))}
                        className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm font-black bg-white"
                      />
                    </div>

                    <div>
                      <label className="block text-[0.6875rem] font-extrabold text-gray-600 mb-1">
                        {t('paMaxQty')}
                      </label>
                      <input
                        type="number"
                        min="1"
                        value={formMaxQty}
                        onChange={(e) => setFormMaxQty(Number(e.target.value))}
                        className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm font-black bg-white"
                      />
                    </div>

                    <div>
                      <label className="block text-[0.6875rem] font-extrabold text-gray-600 mb-1">
                        Stock Level / Capacity
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={formStock}
                        onChange={(e) => setFormStock(Number(e.target.value))}
                        className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm font-black bg-white"
                      />
                    </div>
                  </div>

                  {/* Nothing in the shop ever read the speeds typed in here.
                      This panel wrote them to the product as `deliverySpeedOptions`
                      and no storefront code — not the configurator, not
                      /api/checkout/quote — ever looked at that field, so an
                      express surcharge the owner set was never offered to a
                      customer and never charged. The speeds that ARE offered and
                      priced come from the shared printing field, so point him at
                      that instead of collecting numbers nobody honours. */}
                  <div className="flex items-start gap-2 bg-blue-50/60 border border-blue-100 rounded-2xl p-3">
                    <Truck className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                    <p className="text-[0.6875rem] font-bold text-blue-900 leading-relaxed">
                      Delivery speeds and their surcharges are set in &ldquo;Product Printing Fields &amp; Options&rdquo; below: switch on &ldquo;Production &amp; delivery speed&rdquo; and edit its choices there. That is the field the shop shows the customer and charges for.
                    </p>
                  </div>
                </div>

                {/* 2.6. Artwork, files and stock code */}
                <div className="space-y-4">
                  <div className="flex items-center space-x-2 text-blue-600 font-extrabold text-sm border-b border-gray-100 pb-2">
                    <Upload className="w-4 h-4" />
                    <span>Artwork, Files & Stock Code</span>
                  </div>

                  <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[0.6875rem] font-extrabold text-gray-600 mb-1">
                          SKU / stock code
                        </label>
                        <input
                          type="text"
                          value={formSku}
                          onChange={(e) => setFormSku(e.target.value)}
                          placeholder="RO-FRONTEB-850x2150"
                          className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm font-black bg-white"
                        />
                        <p className="text-[0.625rem] text-gray-500 mt-1 font-bold">
                          Printed on the production work order beside the item.
                        </p>
                      </div>

                      <div>
                        <label className="block text-[0.6875rem] font-extrabold text-gray-600 mb-1">
                          Largest single file (MB)
                        </label>
                        <input
                          type="number"
                          min="1"
                          value={formArtworkMaxMb}
                          onChange={(e) => setFormArtworkMaxMb(Number(e.target.value))}
                          className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm font-black bg-white"
                        />
                        <p className="text-[0.625rem] text-gray-500 mt-1 font-bold">
                          Files go to cloud storage, so this is a house rule rather than a technical ceiling.
                        </p>
                      </div>
                    </div>

                    {/* Area pricing — off unless the owner turns it on.
                        This was previously implied by the artwork rules existing at
                        all, so products with a flat price were charging a square-metre
                        surcharge and showing a size calculator nobody had asked for. */}
                    <label className="flex items-start space-x-2.5 cursor-pointer p-3 rounded-xl bg-white border border-gray-200">
                      <input
                        type="checkbox"
                        checked={formAreaPriced}
                        onChange={(e) => setFormAreaPriced(e.target.checked)}
                        className="mt-0.5 w-4 h-4 accent-orange-600"
                      />
                      <span>
                        <span className="block text-[0.75rem] font-black text-gray-900">
                          Price this product by the square metre
                        </span>
                        <span className="block text-[0.625rem] text-gray-500 font-bold mt-0.5">
                          Adds the size calculator to the product page and charges area × rate on
                          top of the base price. Leave off for anything sold at a fixed price.
                        </span>
                      </span>
                    </label>

                    {/* THE BLOCK ITSELF, on or off. He circled "YOUR ARTWORK
                        (OPTIONAL) — order now and send the file later" and asked
                        to decide per product: some of what he sells is finished
                        goods, where asking for a print file is a question with no
                        answer. */}
                    <label className="flex items-start space-x-2.5 cursor-pointer p-3 rounded-xl bg-white border border-gray-200">
                      <input
                        type="checkbox"
                        checked={formArtworkEnabled}
                        onChange={(e) => setFormArtworkEnabled(e.target.checked)}
                        className="w-4 h-4 mt-0.5 text-blue-600 rounded focus:ring-blue-500"
                      />
                      <span>
                        <span className="block text-xs font-black text-gray-900">
                          Show the artwork upload block on this product
                        </span>
                        <span className="block text-[0.625rem] text-gray-500 font-bold mt-0.5">
                          On for everything that gets printed. Turn it off for finished goods the
                          customer does not send a file for — the whole upload section disappears
                          from the product page.
                        </span>
                      </span>
                    </label>

                    {/* Optional vs required artwork. Optional is the shop's default.
                        Hidden entirely when the block above is off: a required-file
                        setting for a block nobody sees is a trap. */}
                    {formArtworkEnabled && (
                    <label className="flex items-start space-x-2.5 cursor-pointer p-3 rounded-xl bg-white border border-gray-200">
                      <input
                        type="checkbox"
                        checked={formArtworkRequired}
                        onChange={(e) => setFormArtworkRequired(e.target.checked)}
                        className="w-4 h-4 mt-0.5 text-blue-600 rounded focus:ring-blue-500"
                      />
                      <span>
                        <span className="block text-xs font-black text-gray-900">
                          The customer must attach the print file before ordering
                        </span>
                        <span className="block text-[0.625rem] text-gray-500 font-bold mt-0.5">
                          Leave this off — the default — and the order goes through without a file. The line is
                          flagged &ldquo;waiting for artwork&rdquo; on the production screen and the customer is asked for it afterwards.
                        </span>
                      </span>
                    </label>
                    )}

                    {/* ROUND 16, ITEM 5 — the online designer. On by default
                        wherever the upload box is ("all products, or the client
                        picks"); this is where he takes it off one product. The
                        note under it says plainly when the product cannot offer it
                        anyway, with the same rule the shop uses
                        (src/lib/onlineDesign.ts), so the tick never claims
                        something the product page does not do. */}
                    {formArtworkEnabled && (() => {
                      const enabledFields = formPrintingFields.filter((f) => f.enabled);
                      const method = enabledFields.find((f) => f.id === ARTWORK_METHOD_FIELD_ID);
                      const hasOption = !!method && (method.options ?? []).some((o) => isDesignerMethod(o) && isOptionAvailable(o));
                      const hasSize = designerCanOpenOn(withoutUnavailableOptions(enabledFields), formAreaPriced);
                      // The tick says what the product page will do: ticked only when the
                      // designer is really offered. Ticking it on a product without the
                      // property adds the property (withDesignerMethod).
                      const offered = designerOffered;
                      return (
                        <label className="flex items-start space-x-2.5 cursor-pointer p-3 rounded-xl bg-white border border-gray-200" data-rx-online-design-setting>
                          <input
                            type="checkbox"
                            checked={offered}
                            onChange={(e) => {
                              if (e.target.checked) {
                                if (!hasOption) {
                                  designerTickUndo.current = {
                                    field: formPrintingFields.find((f) => f.id === ARTWORK_METHOD_FIELD_ID) ?? null,
                                    onlineDesign: formOnlineDesign,
                                  };
                                  setFormPrintingFields(withDesignerMethod);
                                }
                                setFormOnlineDesign(true);
                              } else {
                                // Unticked in the same edit: the property goes back as it
                                // was — a one-choice "Upload a print-ready PDF" question
                                // left behind would be new on his product page.
                                const undo = designerTickUndo.current;
                                designerTickUndo.current = null;
                                if (undo) {
                                  setFormPrintingFields((prev) =>
                                    undo.field
                                      ? prev.map((f) => (f.id === ARTWORK_METHOD_FIELD_ID ? undo.field! : f))
                                      : prev.filter((f) => f.id !== ARTWORK_METHOD_FIELD_ID),
                                  );
                                  setFormOnlineDesign(undo.onlineDesign);
                                } else {
                                  setFormOnlineDesign(false);
                                }
                              }
                            }}
                            className="w-4 h-4 mt-0.5 text-blue-600 rounded focus:ring-blue-500"
                          />
                          <span>
                            <span className="block text-xs font-black text-gray-900">
                              Customers can design it online
                            </span>
                            <span className="block text-[0.625rem] text-gray-500 font-bold mt-0.5">
                              &ldquo;Design online from a ready-made template&rdquo; in the artwork step opens the design gallery and
                              the designer at the exact size and shape the customer chose. The print file it makes is attached
                              to the order like an upload — a PNG for one side that fits one picture, else a PDF of every page —
                              at the resolution of your table in Design templates, with the bleed below, whatever file types
                              you accept for uploads.
                            </span>
                            {!offered && (
                              <span className="block text-[0.625rem] text-gray-500 font-bold mt-1" data-rx-online-design-note="off">
                                Tick it and &ldquo;Design online&rdquo; is added to this product&rsquo;s artwork step, beside
                                &ldquo;Upload a print-ready PDF&rdquo; (the &ldquo;Artwork supply method&rdquo; property below is
                                switched on for you). Save the product to put it on the shop.
                              </span>
                            )}
                            {offered && !hasSize && (
                              <span className="block text-[0.625rem] text-amber-800 font-bold mt-1" data-rx-online-design-note="no-size">
                                Not offered on this product: none of its sizes can be designed online. They are not written
                                as a measurement (for example 85 × 55 mm or A4), they are all larger than the designer can
                                make (5 m a side), or the only cut is the customer&rsquo;s own shape.
                              </span>
                            )}
                          </span>
                        </label>
                      );
                    })()}

                    {/* Designer v2: his own print values for THIS product — empty = the
                        trade's default for its kind (placeholder), and the resolution of
                        his table by size (Design templates). */}
                    {formArtworkEnabled && designerOffered && (() => {
                      const ids: string[] = [];
                      const walk = (list: typeof formPrintingFields, depth: number) => {
                        for (const f of list ?? []) {
                          if (!f.enabled) continue;
                          ids.push(f.id);
                          if (depth < 4) for (const o of f.options ?? []) walk(o.subFields ?? [], depth + 1);
                        }
                      };
                      walk(formPrintingFields, 0);
                      const kind = kindOfProduct(ids);
                      const def = KIND_DEFAULTS[kind];
                      const box = 'w-full px-2.5 py-1.5 rounded-lg border border-gray-200 text-xs font-bold bg-white tabular-nums';
                      const cell = (k: keyof typeof formPrintSpec, label: string, placeholder: string) => (
                        <label className="block space-y-0.5">
                          <span className="block text-[0.625rem] font-black text-gray-500">{label}</span>
                          <input
                            className={box}
                            inputMode="decimal"
                            value={formPrintSpec[k]}
                            placeholder={placeholder}
                            onChange={(e) => setFormPrintSpec({ ...formPrintSpec, [k]: e.target.value })}
                            data-rx-print-spec={k}
                          />
                        </label>
                      );
                      return (
                        <div className="p-3 rounded-xl bg-white border border-gray-200 space-y-2.5" data-rx-print-spec-editor>
                          <span className="block text-xs font-black text-gray-900">The designer&rsquo;s print file for this product</span>
                          <span className="block text-[0.625rem] text-gray-500 font-bold">
                            Empty boxes use the usual values for this kind of product ({kind}) — shown greyed. Hidden zones are the
                            parts nobody sees once it is mounted (a roll-up&rsquo;s foot in its cassette, a flag&rsquo;s sleeve):
                            the designer keeps words out of them.
                          </span>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            {cell('bleed', 'Bleed (mm)', String(def.bleedMm))}
                            {cell('safe', 'Keep text inside (mm)', String(def.safeMm))}
                            {cell('target', 'Made at (DPI)', 'by size')}
                            {cell('min', 'Never below (DPI)', 'by size')}
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            {cell('top', 'Hidden at the top (mm)', String(def.hiddenMm.top))}
                            {cell('bottom', 'Hidden at the foot (mm)', String(def.hiddenMm.bottom))}
                            {cell('left', 'Hidden on the left (mm)', String(def.hiddenMm.left))}
                            {cell('right', 'Hidden on the right (mm)', String(def.hiddenMm.right))}
                          </div>
                          {printSpecBad.length > 0 && (
                            <p className="text-[0.6875rem] font-black text-red-700" data-rx-print-spec-bad>
                              Not a usable number: {printSpecBad.join(', ')}. {PRINT_SPEC_RANGES}
                            </p>
                          )}
                        </div>
                      );
                    })()}

                    {/* Which extensions the dropzone accepts for this product. */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="block text-[0.6875rem] font-extrabold text-gray-600">
                          Accepted file types
                        </label>
                        <span className="text-[0.625rem] font-black text-gray-500">
                          {formArtworkFormats.length} selected
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {Array.from(new Set([...SELECTABLE_ARTWORK_FORMATS, ...formArtworkFormats])).map((fmt) => {
                          const on = formArtworkFormats.includes(fmt);
                          return (
                            <button
                              key={fmt}
                              type="button"
                              onClick={() =>
                                setFormArtworkFormats((prev) =>
                                  prev.includes(fmt) ? prev.filter((f) => f !== fmt) : [...prev, fmt],
                                )
                              }
                              className={cn(
                                'px-2.5 py-1.5 rounded-lg text-[0.6875rem] font-black uppercase transition-colors border',
                                on
                                  ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                                  : 'bg-white text-gray-500 border-gray-200 hover:border-blue-400',
                              )}
                            >
                              {fmt}
                            </button>
                          );
                        })}
                      </div>
                      {formArtworkFormats.length === 0 && (
                        <p className="text-[0.625rem] font-black text-amber-700 mt-2">
                          Nothing selected — the shop&rsquo;s default list will be used instead of accepting nothing.
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {/* 2.5. Product Configurator Printing Fields Enable/Disable Toggle Section */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between text-blue-600 font-extrabold text-sm border-b border-gray-100 pb-2">
                    <div className="flex items-center space-x-2 space-x-reverse">
                      <SlidersHorizontal className="w-4 h-4" />
                      <span>Product Printing Fields & Options</span>
                    </div>
                    <span className="text-[0.6875rem] font-bold text-gray-500">
                      {t('paEnabledCount')}: {activeLibraryCount} / {libraryFields.length}
                    </span>
                  </div>

                  <p className="text-xs text-gray-500">
                    {t('paOptionsOffNote')}
                  </p>

                  {/* SEEING WHAT IS ON, AND UNDOING IT IN ONE PRESS.
                      A product that came through Update & apply carries the whole
                      catalogue switched on, and every one of those renders to the
                      customer. Auditing that by scrolling 178 cards is not a
                      thing anyone does; both controls exist for that one case and
                      disappear when the product has nothing switched on. */}
                  {activeLibraryCount > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setPrintingFieldsOnlyActive(v => !v)}
                        aria-pressed={printingFieldsOnlyActive}
                        className={cn(
                          'px-3 py-1.5 rounded-xl border text-[0.6875rem] font-black transition-colors',
                          printingFieldsOnlyActive
                            ? 'border-blue-400 bg-blue-50 text-blue-700'
                            : 'border-gray-200 bg-white text-gray-600 hover:border-blue-300',
                        )}
                      >
                        {printingFieldsOnlyActive
                          ? t('paShowAllOptions').replace('{0}', String(libraryFields.length))
                          : t('paOnlyActive').replace('{0}', String(activeLibraryCount))}
                      </button>
                      <button
                        type="button"
                        onClick={handleTurnAllPrintingFieldsOff}
                        className="px-3 py-1.5 rounded-xl border border-red-200 bg-red-50 text-red-700 text-[0.6875rem] font-black hover:border-red-400 transition-colors"
                      >
                        {t('paTurnAllOff')} ({activeLibraryCount})
                      </button>
                    </div>
                  )}

                  {/* The catalogue is long, so let the owner jump to a property
                      instead of scrolling the whole list. */}
                  <input
                    type="text"
                    value={printingFieldSearch}
                    onChange={(e) => setPrintingFieldSearch(e.target.value)}
                    placeholder="Search properties (paper, size, lamination, flag base...)"
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-xs font-bold text-gray-900 placeholder:text-gray-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                  />

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[35rem] overflow-y-auto pr-1 items-start">
                    {visiblePrintingFields.map(field => {
                      const activeField = formPrintingFields.find(f => f.id === field.id);
                      const isEnabled = !!(activeField && activeField.enabled);
                      // The product's own copy is the truth once it exists — that
                      // is what the shop renders and what an edit here changes.
                      const editable = activeField ?? field;
                      const expanded = expandedCustomFieldIds.includes(field.id);
                      const options = editable.options || [];
                      // The card used to say "3 options available" and stop there,
                      // so the values were invisible without leaving the product.
                      const preview = options.slice(0, 3).map(o => o.label).filter(Boolean).join(' · ');
                      // Questions hidden inside an option are invisible from the
                      // outside — the card is the only place the owner would ever
                      // find out this property has a second layer.
                      const nestedCount = options.reduce(
                        (sum, o) => sum + ((o.subFields ?? []).length),
                        0,
                      );

                      return (
                        <div
                          key={field.id}
                          className={cn(
                            "rounded-2xl border transition-all",
                            expanded && "sm:col-span-2",
                            isEnabled
                              ? "bg-blue-50/80 border-blue-400 ring-2 ring-blue-500/20 shadow-xs"
                              : expanded
                                ? "bg-gray-50 border-gray-300"
                                : "bg-gray-50 border-gray-200 opacity-70 hover:opacity-100"
                          )}
                        >
                          <div className="p-3 flex items-center gap-2.5">
                            {/* The checkbox is the ON/OFF switch. It used to be the
                                whole card, which left no way to look inside. */}
                            <button
                              type="button"
                              onClick={() => handleTogglePrintingField(field.id)}
                              title={isEnabled ? 'Turn this property off for this product' : 'Turn this property on for this product'}
                              aria-pressed={isEnabled}
                              className={cn(
                                "w-5 h-5 rounded-md flex items-center justify-center transition-colors shrink-0",
                                isEnabled ? "bg-blue-600 text-white" : "bg-gray-200 text-transparent hover:bg-gray-300"
                              )}
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>

                            {/* The rest of the row opens the editor. */}
                            <button
                              type="button"
                              onClick={() => toggleCustomFieldExpanded(field.id)}
                              aria-expanded={expanded}
                              className="flex-1 min-w-0 text-left cursor-pointer"
                            >
                              <span className="text-xs font-black text-gray-900 block truncate">{editable.name}</span>
                              <span className="text-[0.625rem] font-bold text-gray-400 block truncate">
                                {options.length > 0
                                  ? `${t('paOptionsAvailable').replace('{0}', String(options.length))}${
                                      // Hidden ones still counted, and said so — inside
                                      // the questions of an option too.
                                      hiddenOptionCount(options) > 0 ? ` (${hiddenOptionCount(options)} hidden)` : ''
                                    }${preview ? ` — ${preview}${options.length > 3 ? '…' : ''}` : ''}`
                                  : 'No options yet'}
                              </span>
                              {nestedCount > 0 && (
                                <span className="text-[0.625rem] font-black text-emerald-700 block truncate">
                                  {t('paNestedQuestions').replace('{0}', String(nestedCount))}
                                </span>
                              )}
                            </button>

                            <button
                              type="button"
                              onClick={() => handleTogglePrintingField(field.id)}
                              className={cn(
                                "text-[0.625rem] font-black px-2.5 py-0.5 rounded-full shrink-0 transition-colors",
                                isEnabled ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-600 hover:bg-gray-300"
                              )}
                            >
                              {isEnabled ? t('paEnabled') : t('paDisabled')}
                            </button>

                            <button
                              type="button"
                              onClick={() => toggleCustomFieldExpanded(field.id)}
                              aria-label={expanded ? 'Hide the options' : 'Show and edit the options'}
                              className="text-gray-400 hover:text-blue-600 p-0.5 shrink-0"
                            >
                              <ChevronDown className={cn("w-4 h-4 transition-transform", expanded && "rotate-180")} />
                            </button>
                          </div>

                          {expanded && (
                            <div className="px-3 pb-3 pt-1 border-t border-gray-200/80 bg-white/50 rounded-b-2xl">
                              {activeField && (
                                <div className="flex flex-wrap gap-2 py-2">
                                  <button
                                    type="button"
                                    onClick={() => void handleResetFieldToLibrary(field.id)}
                                    className="px-2.5 py-1 rounded-lg border border-gray-200 bg-white text-[0.625rem] font-black text-gray-600 hover:border-blue-400 hover:text-blue-700"
                                  >
                                    Reset to the library version
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleRemoveFieldFromProduct(field.id)}
                                    className="px-2.5 py-1 rounded-lg border border-red-200 bg-white text-[0.625rem] font-black text-red-600 hover:bg-red-50"
                                  >
                                    Remove from this product
                                  </button>
                                </div>
                              )}
                              <PrintingFieldEditorBody
                                field={editable}
                                productCopy
                                scopeNote="Changes here apply to THIS PRODUCT only. To change a property for every product, use the Printing fields screen."
                                onUpdateField={(patch) => handleUpdateCustomAttribute(field.id, patch)}
                                onAddOption={() => handleAddCustomOption(field.id)}
                                onUpdateOption={(optionId, patch) => handleUpdateCustomOption(field.id, optionId, patch)}
                                onSetDefault={(optionId) => handleSetCustomOptionDefault(field.id, optionId)}
                                onRemoveOption={(optionId) => handleRemoveCustomOption(field.id, optionId)}
                                onMoveOption={(optionId, direction) => handleMoveCustomOption(field.id, optionId, direction)}
                                onReorderOptions={(orderedIds) => handleReorderCustomOptions(field.id, orderedIds)}
                                onUploadOptionImage={async (file) => (await uploadOptionImage(file)).url}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {visiblePrintingFields.length === 0 && (
                    <p className="text-xs font-bold text-gray-400 text-center py-4">
                      No property matches "{printingFieldSearch}".
                    </p>
                  )}

                  {/* Custom attributes builder — per-product option groups */}
                  <div className="space-y-3 pt-2">
                    <div className="flex items-center justify-between border-b border-gray-100 pb-2 gap-3">
                      <div>
                        <span className="text-xs font-extrabold text-gray-900 block">Custom attributes</span>
                        <span className="text-[0.6875rem] font-bold text-gray-400">
                          Build your own option groups for this product only (e.g. T-shirt Colour, Banner Size, Flag Material).
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={handleAddCustomAttribute}
                        className="px-3 py-1 bg-blue-50 text-blue-700 hover:bg-blue-100 text-xs font-black rounded-xl transition-all flex items-center shrink-0"
                      >
                        <Plus className="w-3.5 h-3.5 mr-1" />
                        Add attribute
                      </button>
                    </div>

                    {customAttributeFields.length === 0 ? (
                      <div className="p-4 bg-gray-50 rounded-2xl border border-dashed border-gray-200 text-center text-xs text-gray-500">
                        No custom attributes yet. Click &quot;Add attribute&quot; to create option groups specific to this product, with your own choices and price modifiers.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {customAttributeFields.map(field => {
                          const isExpanded = expandedCustomFieldIds.includes(field.id);
                          return (
                            <div key={field.id} className="bg-gray-50 rounded-2xl border border-gray-200 overflow-hidden">
                              {/* Attribute card header */}
                              <div className="flex items-center justify-between px-4 py-3">
                                <button
                                  type="button"
                                  onClick={() => toggleCustomFieldExpanded(field.id)}
                                  className="flex items-center space-x-2 text-left flex-1 min-w-0"
                                >
                                  <ChevronDown className={cn(
                                    "w-4 h-4 text-gray-400 transition-transform shrink-0",
                                    isExpanded && "rotate-180"
                                  )} />
                                  <span className="text-xs font-black text-gray-900 truncate">
                                    {field.name.trim() || 'Untitled attribute'}
                                  </span>
                                  <span className="text-[0.625rem] font-bold text-gray-400 shrink-0">
                                    {field.options.length} {field.options.length === 1 ? 'option' : 'options'}
                                    {hiddenOptionCount(field.options) > 0 ? ` (${hiddenOptionCount(field.options)} hidden)` : ''}
                                  </span>
                                  {field.required && (
                                    <span className="text-[0.5625rem] font-black uppercase bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-md shrink-0">
                                      Required
                                    </span>
                                  )}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveCustomAttribute(field.id)}
                                  title="Delete attribute"
                                  className="text-gray-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50 transition-colors shrink-0 ml-2"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>

                              {isExpanded && (
                                <div className="px-4 pb-4 pt-3 border-t border-gray-200/70">
                                  {/* The very same editor the catalogue properties
                                      above use — one editor, so the two kinds of
                                      property can never drift apart in what they
                                      let the owner do. */}
                                  <PrintingFieldEditorBody
                                    field={field}
                                    productCopy
                                    onUpdateField={(patch) => handleUpdateCustomAttribute(field.id, patch)}
                                    onAddOption={() => handleAddCustomOption(field.id)}
                                    onUpdateOption={(optionId, patch) => handleUpdateCustomOption(field.id, optionId, patch)}
                                    onSetDefault={(optionId) => handleSetCustomOptionDefault(field.id, optionId)}
                                    onRemoveOption={(optionId) => handleRemoveCustomOption(field.id, optionId)}
                                    onMoveOption={(optionId, direction) => handleMoveCustomOption(field.id, optionId, direction)}
                                    onReorderOptions={(orderedIds) => handleReorderCustomOptions(field.id, orderedIds)}
                                    onUploadOptionImage={async (file) => (await uploadOptionImage(file)).url}
                                  />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {/* 2.6. The order the shopper meets these questions in. */}
                <div className="space-y-4">
                  <div className="flex items-center space-x-2 text-blue-600 font-extrabold text-sm border-b border-gray-100 pb-2">
                    <ListOrdered className="w-4 h-4" />
                    <span>Order on the product page</span>
                  </div>

                  <p className="text-xs text-gray-500">
                    Top to bottom, this is what the customer sees. Drag any row by its grip to put it
                    anywhere{(() => {
                      const blocks = pageOrderIds.filter(isPageBlock).map((id) => PAGE_BLOCK_ROWS[id]?.short).filter(Boolean);
                      if (blocks.length === 0) return '';
                      const list = blocks.length === 1 ? blocks[0] : `${blocks.slice(0, -1).join(', ')} and ${blocks[blocks.length - 1]}`;
                      return ` — ${list} too —`;
                    })()} or use the arrows. Saved with the product.
                  </p>

                  {pageOrderIds.length < 2 ? (
                    <p className="text-xs font-bold text-gray-400 p-3 rounded-xl bg-gray-50 border border-gray-200">
                      Turn a property on above and it appears here.
                    </p>
                  ) : (
                    <SortableList
                      ids={pageOrderIds}
                      onReorder={handleReorderPage}
                      labelOf={(id) => PAGE_BLOCK_ROWS[id]?.label ?? (orderableFields.find((f) => f.id === id)?.name?.trim() || 'Untitled property')}
                      className="rounded-2xl border border-gray-200 divide-y divide-gray-100 overflow-hidden"
                      renderItem={(rowId, { handle, index: slot }) => {
                        const rows = pageOrderIds.length;
                        const block = PAGE_BLOCK_ROWS[rowId];
                        const field = block ? null : orderableFields.find((f) => f.id === rowId);
                        if (!block && !field) return null;
                        const label = block ? block.label : field!.name?.trim() || 'Untitled property';
                        const tone = block ? 'text-orange-700 hover:bg-orange-100' : 'text-gray-600 hover:bg-gray-100';
                        return (
                          <div className={cn('flex items-center gap-2 p-3', block ? 'bg-orange-50' : 'bg-white')} data-page-row={rowId}>
                            <DragHandle handle={handle} label={block ? block.drag : `Drag "${label}"`} />
                            <span className={cn('w-6 text-[0.6875rem] font-black tabular-nums', block ? 'text-orange-500' : 'text-gray-400')}>
                              {slot + 1}
                            </span>
                            <span className={cn('flex-1 text-xs font-black truncate', block ? 'text-orange-900' : 'text-gray-800')}>
                              {label}
                              {block?.note && <span className="ml-1.5 text-[0.625rem] font-bold text-orange-600">{block.note}</span>}
                            </span>
                            <button
                              type="button"
                              onClick={() => movePageRow(rowId, -1)}
                              disabled={slot === 0}
                              title="Move up"
                              aria-label={`Move ${label} up`}
                              className={cn('p-1.5 rounded-lg disabled:opacity-25 disabled:hover:bg-transparent', tone)}
                            >
                              <ChevronUp className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => movePageRow(rowId, 1)}
                              disabled={slot === rows - 1}
                              title="Move down"
                              aria-label={`Move ${label} down`}
                              className={cn('p-1.5 rounded-lg disabled:opacity-25 disabled:hover:bg-transparent', tone)}
                            >
                              <ChevronDown className="w-4 h-4" />
                            </button>
                          </div>
                        );
                      }}
                    />
                  )}
                </div>

                {/* 2.7. SUGGESTED PRODUCTS — round 16, item 10: the row under this
                    product on the shop, his picks in his order. Every button here
                    is type="button" and Enter in the search picks, never submits:
                    the whole dialog is one form, and a stray submit saves it. */}
                <div className="space-y-3" data-rx-suggested-editor>
                  <div className="flex items-center space-x-2 text-blue-600 font-extrabold text-sm border-b border-gray-100 pb-2">
                    <Sparkles className="w-4 h-4" />
                    <span>Suggested products</span>
                  </div>
                  <p className="text-xs text-gray-500">
                    Up to {SUGGESTION_COUNT} products shown under this one, in this order — drag to arrange.{' '}
                    {suggestionMode === 'fill'
                      ? `With fewer than ${SUGGESTION_COUNT}, the shop fills the row with the products after this one in its category.`
                      : suggestionMode === 'picks'
                        ? 'Only the ones you pick are shown (UI Customizer → Page Sections).'
                        : 'Suggestions are switched OFF in UI Customizer → Page Sections: nothing is shown until you switch them on.'}
                  </p>

                  {formRelatedIds.length > 0 && (
                    <SortableList
                      ids={formRelatedIds}
                      onReorder={setFormRelatedIds}
                      labelOf={relatedName}
                      className="rounded-2xl border border-gray-200 divide-y divide-gray-100 overflow-hidden"
                      renderItem={(id, { handle, index }) => {
                        const picked = products.find((p) => p.id === id);
                        const name = relatedName(id);
                        return (
                          <div className="flex items-center gap-2 p-2.5 bg-white" data-related-row={id}>
                            <DragHandle handle={handle} label={`Drag "${name}"`} />
                            <span className="w-5 text-[0.6875rem] font-black text-gray-400 tabular-nums">{index + 1}</span>
                            {picked ? (
                              <img
                                src={safeImageSrc(picked.images?.[0]) ?? '/placeholder-print.svg'}
                                alt=""
                                className="w-9 h-9 rounded-lg object-contain bg-gray-50 border border-gray-200 shrink-0"
                              />
                            ) : (
                              <span className="w-9 h-9 rounded-lg bg-gray-100 border border-dashed border-gray-300 shrink-0" />
                            )}
                            <span className={cn('flex-1 min-w-0 text-xs font-black truncate', picked ? 'text-gray-800' : 'text-gray-400 italic')}>
                              {name}
                            </span>
                            {picked?.isHidden && (
                              <span className="shrink-0 text-[0.625rem] font-black text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                                hidden — not shown
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => setFormRelatedIds((prev) => prev.filter((x) => x !== id))}
                              aria-label={`Remove ${name}`}
                              title="Remove"
                              className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 shrink-0"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        );
                      }}
                    />
                  )}

                  {formRelatedIds.length < SUGGESTION_COUNT ? (
                    <div className="space-y-2">
                      <input
                        type="search"
                        value={relatedSearch}
                        onChange={(e) => setRelatedSearch(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter') return;
                          e.preventDefault();
                          if (relatedMatches[0]) addRelated(relatedMatches[0].id);
                        }}
                        placeholder="Add a product — search by name or SKU…"
                        aria-label="Add a suggested product"
                        data-related-search
                        className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs font-bold bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      {relatedSearch.trim() && (
                        <ul className="max-h-56 overflow-y-auto rounded-2xl border border-gray-200 divide-y divide-gray-100 bg-white">
                          {relatedMatches.slice(0, 8).map((p) => (
                            <li key={p.id}>
                              <button
                                type="button"
                                onClick={() => addRelated(p.id)}
                                data-related-add={p.id}
                                className="w-full flex items-center gap-2 p-2 text-left hover:bg-blue-50 transition-colors"
                              >
                                <img
                                  src={safeImageSrc(p.images?.[0]) ?? '/placeholder-print.svg'}
                                  alt=""
                                  className="w-8 h-8 rounded-lg object-contain bg-gray-50 border border-gray-200 shrink-0"
                                />
                                <span className="flex-1 min-w-0 text-xs font-black text-gray-800 truncate">
                                  {p.name}
                                  {p.sku ? <span className="font-bold text-gray-400"> · {p.sku}</span> : null}
                                </span>
                                {p.isHidden && <span className="text-[0.625rem] font-black text-amber-700">hidden</span>}
                                <Plus className="w-4 h-4 text-blue-600 shrink-0" />
                              </button>
                            </li>
                          ))}
                          {relatedMatches.length === 0 && (
                            <li className="p-3 text-xs font-bold text-gray-400">No product matches.</li>
                          )}
                        </ul>
                      )}
                    </div>
                  ) : (
                    <p className="text-[0.6875rem] font-bold text-gray-500">
                      {SUGGESTION_COUNT} picked — remove one to pick another.
                    </p>
                  )}
                </div>

                {/* 3. The old "Custom Product Options" — see handleConvertLegacyOptions.
                    Shown only to a product that still carries some, as an offer to
                    turn them into real properties; there is nothing to edit here. */}
                {formOptions.length > 0 && (
                  <div className="p-4 rounded-2xl border border-amber-300 bg-amber-50 space-y-3">
                    <p className="text-xs font-black text-amber-900">
                      This product has {formOptions.length} option group{formOptions.length === 1 ? '' : 's'} from the old
                      &ldquo;Custom Product Options&rdquo; editor. Customers never saw them and they were never priced —
                      the shop only shows the properties above.
                    </p>
                    {legacyGroupsEmpty > 0 && (
                      <p className="text-[0.6875rem] font-bold text-amber-800">
                        {legacyGroupsEmpty} of them have no name or no named choice — there is nothing in them to keep,
                        and they go with the old groups.
                      </p>
                    )}
                    {legacyGroupsAlreadyProperties.length > 0 && (
                      <p className="text-[0.6875rem] font-bold text-amber-800">
                        {legacyGroupsAlreadyProperties.length} of them already exist as properties of this product
                        (made by the AI analyzer) — only the old copy is left over.
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {legacyGroupsToConvert.length > 0 && (
                        <button
                          type="button"
                          onClick={handleConvertLegacyOptions}
                          className="px-3 py-1.5 rounded-xl bg-amber-600 text-white text-[0.6875rem] font-black hover:bg-amber-700"
                        >
                          Turn {legacyGroupsToConvert.length} into properties (switched off, for you to check)
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleDropLegacyOptions}
                        className="px-3 py-1.5 rounded-xl border border-amber-400 bg-white text-amber-800 text-[0.6875rem] font-black hover:bg-amber-100"
                      >
                        Remove the old groups
                      </button>
                    </div>
                  </div>
                )}

                {/* 4. Product Features & Characteristics */}
                <div className="space-y-4">
                  <div className="flex items-center space-x-2 text-blue-600 font-extrabold text-sm border-b border-gray-100 pb-2">
                    <Tag className="w-4 h-4" />
                    <span>Product Features & Specifications</span>
                  </div>

                  <div className="space-y-2">
                    <div className="flex space-x-2">
                      <input
                        type="text"
                        value={newFeatureInput}
                        onChange={(e) => setNewFeatureInput(e.target.value)}
                        placeholder="Add a product feature (e.g., '350 GSM Heavy Cardstock')"
                        className="flex-1 px-4 py-2 border border-gray-200 rounded-2xl text-sm font-bold text-gray-900 outline-none"
                      />
                      <button
                        type="button"
                        onClick={handleAddFeature}
                        className="bg-gray-900 text-white font-bold text-xs px-4 py-2 rounded-2xl hover:bg-gray-800 transition-colors"
                      >
                        Add
                      </button>
                    </div>

                    <SortableList
                      layout="grid"
                      ids={featureIds}
                      onReorder={(orderedIds) => setFormFeatures((prev) => reorderByValueIds(prev, orderedIds, 'feat-'))}
                      className="flex flex-wrap gap-2 pt-2"
                      renderItem={(_id, { handle, index: idx }) => {
                        const feat = formFeatures[idx];
                        if (feat === undefined) return null;
                        return (
                        <span
                          className="inline-flex items-center space-x-1.5 bg-blue-50 text-blue-800 text-xs font-bold px-3 py-1.5 rounded-full border border-blue-100"
                        >
                          <DragHandle handle={handle} label="Drag this line" className="p-0.5 text-blue-400 hover:text-blue-800 hover:bg-transparent" />
                          <span>{feat}</span>
                          {/* 15.5.6 — the product page prints these in this
                              order, so the first one is what a customer reads
                              first. Left and right, not up and down: they are
                              laid out as a row of chips. */}
                          <button
                            type="button"
                            onClick={() => setFormFeatures(prev => moveInArray(prev, idx, -1))}
                            disabled={idx === 0}
                            title="Move earlier"
                            className="hover:text-blue-900 transition-colors disabled:opacity-25"
                          >
                            <ChevronLeft className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setFormFeatures(prev => moveInArray(prev, idx, 1))}
                            disabled={idx === formFeatures.length - 1}
                            title="Move later"
                            className="hover:text-blue-900 transition-colors disabled:opacity-25"
                          >
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoveFeature(idx)}
                            className="hover:text-red-600 transition-colors ml-1"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </span>
                        );
                      }}
                    />
                  </div>
                </div>

                {/* Footer buttons */}
                <div className="pt-4 border-t border-gray-100 flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="px-5 py-2.5 rounded-2xl text-xs font-bold text-gray-600 hover:bg-gray-100 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving || imagesUploading > 0}
                    data-rx-product-save
                    className="px-6 py-2.5 rounded-2xl text-xs font-extrabold bg-blue-600 text-white hover:bg-blue-700 transition-all shadow-md shadow-blue-500/20 active:scale-95 disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : imagesUploading > 0 ? 'Uploading pictures…' : 'Save Product'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <CompetitorProductAnalyzerModal
        isOpen={isAiAnalyzerOpen}
        onClose={() => setIsAiAnalyzerOpen(false)}
        categories={categories}
        onProductCreated={handleProductCreatedByAi}
      />

      {confirmDialog}

      {/* Adds to the gallery, it does not replace it — the same thing Add URL
          does, so the first picture stays the primary one unless he moves it. */}
      <MediaPickerModal
        open={imagePickerOpen}
        onClose={() => setImagePickerOpen(false)}
        onPick={(url) => setFormImages((prev) => (prev.includes(url) ? prev : [...prev, url]))}
      />
    </div>
  );
}
