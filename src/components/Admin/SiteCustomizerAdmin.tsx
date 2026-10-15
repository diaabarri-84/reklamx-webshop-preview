import React, { useState, useRef, useEffect } from 'react';
import {
  useSiteSettings,
  SiteSettings,
  BuiltinPaymentIcon,
  PaymentIconEntry,
  OpeningHoursRow,
} from '../../context/SiteSettingsContext';
import PaymentIcons, { PaymentIconBadge, BUILTIN_PAYMENT_ICON_LABELS } from '../PaymentIcons';
import {
  Palette,
  Image as ImageIcon,
  Type,
  Layout,
  Upload,
  Check,
  RotateCcw,
  Eye,
  Sparkles,
  Layers,
  Save,
  Printer,
  Globe,
  Sliders,
  CheckCircle2,
  Megaphone,
  X,
  FileImage,
  Sun,
  Moon,
  Brush,
  Plus,
  Trash2,
  Link as LinkIcon,
  Building2,
  MapPin,
  Clock,
  CreditCard,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../lib/utils';
import { suggestionModeOf } from '../../lib/suggestions';
import { promisedDay } from '../../lib/productionSpeed';
import { useConfirmDialog } from '../ConfirmDialog';
import { useAuth } from '../../App';
import { LocalizedTextFields } from './LocalizedTextFields';
import type { LocalizedText } from '../../types';
import { MediaPickerModal } from './MediaLibrary';
import { uploadFile } from '../../lib/uploadFile';
import SortableList, { DragHandle } from './SortableList';
import { homeSectionOrder, type HomeSectionId } from '../../lib/homeSections';

/** The home page's sections as he knows them, for the order list (Page Sections). */
const HOME_SECTION_LABELS: Record<HomeSectionId, { label: string; desc: string }> = {
  hero: { label: 'Hero & category cards', desc: 'The big banner and the cards beside it' },
  categories: { label: 'Product categories', desc: 'The grid of categories' },
  inspiration: { label: 'Inspiration', desc: 'The three inspiration cards' },
  benefits: { label: 'Benefits bar', desc: 'The 24/7, 450+ and lead-time row' },
  news: { label: 'News', desc: 'The latest posts' },
};

// Images are stored as base64 INSIDE a Firestore document, and Firestore
// rejects any document over 1 MiB. Base64 inflates a file by about 37%, and the
// document holds more than just the image, so the practical ceiling is far below
// the 5 MB this used to advertise — a 4 MB upload passed the check and then failed
// to save, with no explanation. Raise this once uploads move to object storage.
const MAX_INLINE_IMAGE_BYTES = 700 * 1024;

// THE LOGO IS THE ONLY PICTURE KEPT INSIDE THE SETTINGS (2026-10-08). The order
// e-mails attach it from its data: URL (src/lib/email.ts parseLogo, ≤ 512 KB), so
// it stays inline — capped well below that. Every other picture goes to Storage:
// the free database bills reads BY SIZE, and with the slides and cards inline the
// settings document reached ~800 KB, ~209 read units each time anyone read it —
// which is what ran the shop's daily read limit out (see /api/site-settings).
const MAX_INLINE_LOGO_BYTES = 256 * 1024;
/** A slide or card picture, uploaded to Storage — it is shown full width. */
const MAX_PICTURE_BYTES = 10 * 1024 * 1024;

// Firestore rejects any document larger than 1 MiB, and every inline base64
// image in the settings counts toward it. Block the save slightly below the
// hard ceiling so field-name and encoding overhead cannot push it over.
const MAX_SETTINGS_DOC_BYTES = 1000 * 1024;

const DEFAULT_BENTO_CARDS = [
  { id: 'b1', title: 'GIFT BOXES', imageUrl: 'https://images.unsplash.com/photo-1513519245088-0e12902e5a38?auto=format&fit=crop&q=80&w=700' },
  { id: 'b2', title: 'CUSTOM LABELS', imageUrl: '/placeholder-print.svg' },
  { id: 'b3', title: 'EXHIBITION STANDS', imageUrl: '/placeholder-print.svg' },
  { id: 'b4', title: 'PAPER CUPS', imageUrl: 'https://images.unsplash.com/photo-1517256064527-09c73fc73e38?auto=format&fit=crop&q=80&w=700' },
  { id: 'b5', title: 'DOYPACKS', imageUrl: '/placeholder-print.svg' },
  { id: 'b6', title: 'ILLUMINATED AD', imageUrl: 'https://images.unsplash.com/photo-1572949645841-094f3a9c4c94?auto=format&fit=crop&q=80&w=700' }
];

// The editors below mutate formState.heroSlides / formState.bentoCards by index.
// Seed both arrays up front so edits always target real state — rendering a
// placeholder while the state stayed empty made every edit a silent no-op.
const seedEditablePlaceholders = (s: SiteSettings): SiteSettings => ({
  ...s,
  heroSlides: s.heroSlides && s.heroSlides.length > 0
    ? s.heroSlides
    : [
        {
          id: 's1',
          imageUrl: s.heroImageUrl || 'https://images.unsplash.com/photo-1562654501-a0ccc0fc3fb1?auto=format&fit=crop&q=80&w=2000',
          title: 'NEW REVOLUTION',
          subtitle: '300 DPI High Precision Print',
          badge: 'NEW PRODUCTS FOR THE EVENT AND TRADE SHOW SEASON'
        }
      ],
  bentoCards: s.bentoCards && s.bentoCards.length > 0 ? s.bentoCards : DEFAULT_BENTO_CARDS,
});

// Color Palette Presets
const PRIMARY_COLOR_PRESETS = [
  { name: 'Luxury Gold', hex: '#bb965b' },
  { name: 'Royal Blue', hex: '#2563eb' },
  { name: 'Emerald Green', hex: '#059669' },
  { name: 'Royal Purple', hex: '#7c3aed' },
  { name: 'Crimson Red', hex: '#dc2626' },
  { name: 'Midnight Black', hex: '#111827' },
  { name: 'Amber Gold', hex: '#d97706' },
  { name: 'Cyan Blue', hex: '#0284c7' },
];

const STOCK_HERO_IMAGES = [
  { label: 'Professional Offset Press', url: 'https://images.unsplash.com/photo-1562654501-a0ccc0fc3fb1?auto=format&fit=crop&q=80&w=2000' },
  { label: 'Design & Print Studio', url: '/placeholder-print.svg' },
  { label: 'High Quality Paper Materials', url: '/placeholder-print.svg' },
  { label: 'Luxury Packaging Boxes', url: 'https://images.unsplash.com/photo-1513519245088-0e12902e5a38?auto=format&fit=crop&q=80&w=2000' },
];

export default function SiteCustomizerAdmin() {
  const { settings, updateSettings, resetToDefault } = useSiteSettings();
  const { t } = useAuth();
  // In-page dialogs, never window.confirm/alert — a browser that has been told
  // to stop prompting silences those, and the action then does nothing at all.
  const { confirm, notify, dialog: confirmDialog } = useConfirmDialog();

  const [formState, setFormState] = useState<SiteSettings>(() => seedEditablePlaceholders(settings));

  // One picker for the whole screen, told where to put what it returns. A

  // picker per slot would be eleven mounted modals on a page that shows one.

  const [picker, setPicker] = useState<{ kind: 'hero' | 'bento'; index: number } | null>(null);
  const [activeTab, setActiveTab] = useState<
    'branding' | 'colors' | 'texts' | 'images' | 'layout' | 'pages' | 'delivery'
  >('branding');
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // What the form was last filled from. Save writes only the top-level keys that
  // differ from it — what the owner changed here — so a key another screen or tab
  // wrote meanwhile is never put back by this one (code review ADM-05).
  const seededRef = useRef<SiteSettings>(formState);
  // Keys a Save tried and failed to write. updateSettings shows a change at once,
  // before the database has it, and the form is then re-filled from that: without
  // this, pressing Save again found nothing changed, wrote nothing — and said saved.
  const unsavedKeysRef = useRef<Set<string>>(new Set());

  // Settings load asynchronously (Firestore snapshot). Keep the editable form in sync
  // with them, otherwise Save would write back stale/default values and clobber the
  // real config. Also refreshes the form to defaults after a reset.
  useEffect(() => {
    const seeded = seedEditablePlaceholders(settings);
    seededRef.current = seeded;
    setFormState(seeded);
  }, [settings]);

  // File upload refs
  const logoFileInputRef = useRef<HTMLInputElement>(null);
  const heroFileInputRef = useRef<HTMLInputElement>(null);

  // Payment icons (footer) — the add-row's own scratch state. The list itself
  // lives in formState.footerPaymentIcons and is saved by the same
  // "Save & Apply" button as everything else on this screen.
  const [builtinIconToAdd, setBuiltinIconToAdd] = useState<BuiltinPaymentIcon | ''>('');
  const [customIconLabel, setCustomIconLabel] = useState('');
  const [customIconUrl, setCustomIconUrl] = useState('');

  const availableBuiltinIcons = (Object.keys(BUILTIN_PAYMENT_ICON_LABELS) as BuiltinPaymentIcon[])
    .filter((b) => !(formState.footerPaymentIcons || []).some((e) => e.builtin === b));

  const movePaymentIcon = (idx: number, dir: -1 | 1) => {
    const icons = [...(formState.footerPaymentIcons || [])];
    const target = idx + dir;
    if (target < 0 || target >= icons.length) return;
    [icons[idx], icons[target]] = [icons[target], icons[idx]];
    setFormState({ ...formState, footerPaymentIcons: icons });
  };

  const removePaymentIcon = (idx: number) => {
    const icons = (formState.footerPaymentIcons || []).filter((_, i) => i !== idx);
    setFormState({ ...formState, footerPaymentIcons: icons });
  };

  const addBuiltinPaymentIcon = () => {
    if (!builtinIconToAdd) return;
    const entry: PaymentIconEntry = { id: 'pay-' + builtinIconToAdd, builtin: builtinIconToAdd };
    setFormState({ ...formState, footerPaymentIcons: [...(formState.footerPaymentIcons || []), entry] });
    setBuiltinIconToAdd('');
  };

  const addCustomPaymentIcon = () => {
    if (!customIconUrl.trim()) return;
    const label = customIconLabel.trim();
    // Never store `undefined`: Firestore rejects documents containing it,
    // which would make Save & Apply fail for the whole settings screen.
    const entry: PaymentIconEntry = {
      id: 'pay-custom-' + Date.now(),
      imageUrl: customIconUrl.trim(),
      ...(label ? { label } : {}),
    };
    setFormState({ ...formState, footerPaymentIcons: [...(formState.footerPaymentIcons || []), entry] });
    setCustomIconLabel('');
    setCustomIconUrl('');
  };

  // ---- pickup location & delivery promise --------------------------------
  // Both live in the same settings document as everything else on this screen,
  // so they are saved by the same "Save & Apply" button.
  const pickup = formState.pickupLocation ?? {
    enabled: false,
    companyName: '',
    address: '',
    phone: '',
    mapsUrl: '',
    openingHours: [],
    note: '',
  };
  const promise = formState.deliveryPromise ?? {
    productionDays: 3,
    shippingDaysZone: 2,
    shippingDaysWeekday: 1,
    shippingDaysPickup: 0,
    skipWeekends: true,
  };

  const patchPickup = (change: Partial<typeof pickup>) =>
    setFormState({ ...formState, pickupLocation: { ...pickup, ...change } });

  const patchPromise = (change: Partial<typeof promise>) =>
    setFormState({ ...formState, deliveryPromise: { ...promise, ...change } });

  // ---- automatic production stages ---------------------------------------
  // Hours, not days: a small shop moves a job from design to press in an
  // afternoon, and a scale in days cannot say that.
  const autoStages = formState.autoStages ?? {
    enabled: true,
    hours: { in_design: 4, in_print: 20, finishing: 24, shipped: 24, completed: 48 },
    skipWeekends: true,
  };

  const patchAutoStages = (change: Partial<typeof autoStages>) =>
    setFormState({ ...formState, autoStages: { ...autoStages, ...change } });

  const patchStageHours = (key: keyof typeof autoStages.hours, value: number) =>
    patchAutoStages({ hours: { ...autoStages.hours, [key]: Math.max(0, value) } });

  /** The whole schedule in words, so the owner can see what he just typed. */
  const autoStageSummary = () => {
    let hours = 0;
    for (const key of ['in_design', 'in_print', 'finishing', 'shipped', 'completed'] as const) {
      hours += Number(autoStages.hours[key]) || 0;
    }
    const days = Math.round((hours / 24) * 10) / 10;
    return { hours, days };
  };

  const patchHoursRow = (id: string, change: Partial<OpeningHoursRow>) =>
    patchPickup({
      openingHours: (pickup.openingHours ?? []).map((row) =>
        row.id === id ? { ...row, ...change } : row,
      ),
    });

  const addHoursRow = () =>
    patchPickup({
      openingHours: [
        ...(pickup.openingHours ?? []),
        { id: `oh-${Date.now()}`, days: '', hours: '' },
      ],
    });

  const removeHoursRow = (id: string) =>
    patchPickup({ openingHours: (pickup.openingHours ?? []).filter((row) => row.id !== id) });

  const handleSave = async () => {
    const docBytes = new Blob([JSON.stringify(formState)]).size;
    if (docBytes > MAX_SETTINGS_DOC_BYTES) {
      setSaveError(t('scConfigTooLarge').replace('{0}', String(Math.round(docBytes / 1024))));
      return;
    }
    setSaving(true);
    setSaveError(null);
    const seeded = seededRef.current as unknown as Record<string, unknown>;
    const changed = Object.fromEntries(
      Object.entries(formState).filter(([key, value]) =>
        value !== undefined && (unsavedKeysRef.current.has(key) || JSON.stringify(value) !== JSON.stringify(seeded[key]))),
    ) as Partial<SiteSettings>;
    try {
      // Nothing changed: nothing to write (and no reason to make the server re-read the shop).
      if (Object.keys(changed).length > 0) await updateSettings(changed);
      unsavedKeysRef.current.clear();
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
    } catch (err: any) {
      for (const key of Object.keys(changed)) unsavedKeysRef.current.add(key);
      // The green tick used to appear whatever happened, so a write rejected by
      // security rules looked identical to a successful one — until the page
      // reloaded and the change was gone.
      setSaveError(err?.message || 'The settings could not be saved. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    // Said as it is: the look goes back, the rest stays (resetToDefault, ADM-05).
    if (await confirm({
      title: 'Reset the look of the shop to the defaults?',
      message:
        'The name and logo, colours, home page texts and pictures, which home sections show, the suggested products and the footer go back to the shipped defaults. ' +
        'The order of the home sections, your company and contact details, the About, Services and Contact pages, pickup and ' +
        'delivery, SEO, marketing and the designer settings are kept.',
      confirmLabel: 'Reset',
    })) {
      setSaveError(null);
      try {
        // resetToDefault writes the defaults to Firestore; `settings` takes them, and
        // the sync effect above refreshes the form to them.
        await resetToDefault();
      } catch (err: any) {
        setSaveError(err?.message || 'The settings could not be reset. Check your connection and try again.');
      }
    }
  };

  // THE LOGO: inline, as a data: URL — the order e-mails attach it from there.
  const handleLogoFile = (file: File, callback: (dataUrl: string) => void) => {
    if (!file) return;
    if (file.size > MAX_INLINE_LOGO_BYTES) {
      alert(t('caLogoTooLarge'));
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target?.result) {
        callback(e.target.result as string);
      }
    };
    reader.readAsDataURL(file);
  };

  // A SLIDE OR CARD PICTURE: to Storage (public/site/), and the settings keep its
  // ~250-byte address. The callback receives the address once the upload is done;
  // Save waits for every upload still running.
  const [uploading, setUploading] = useState(0);
  const handlePictureFile = async (file: File, callback: (url: string) => void) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert(t('caPictureNotImage'));
      return;
    }
    if (file.size > MAX_PICTURE_BYTES) {
      alert(t('caPictureTooLarge'));
      return;
    }
    setUploading((n) => n + 1);
    try {
      const { url } = await uploadFile(file, { visibility: 'public', folder: 'site', contentType: file.type });
      callback(url);
    } catch (err) {
      console.error('Uploading the picture failed:', err);
      alert(t('caPictureUploadFailed'));
    } finally {
      setUploading((n) => n - 1);
    }
  };

  return (
    <div className="space-y-8 animate-fade-in" dir="ltr">
      {/* Top Header & Save Actions */}
      <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="inline-flex items-center px-3 py-1 bg-purple-50 text-purple-700 text-xs font-black rounded-full mb-2">
            <Brush className="w-3.5 h-3.5 mr-1.5" />
            Super Admin Theme Engine
          </div>
          <h2 className="text-2xl font-black text-gray-900">Site Customization & Appearance</h2>
          <p className="text-xs text-gray-500 mt-1">
            Control brand colors, logo, texts, images, and section visibilities directly.
          </p>
        </div>

        <div className="flex items-center space-x-3 w-full md:w-auto justify-end">
          <button
            type="button"
            onClick={handleReset}
            className="px-4 py-2.5 text-xs font-bold text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all border border-gray-200 flex items-center"
          >
            <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
            Reset Defaults
          </button>

          <button
            type="button"
            onClick={handleSave}
            disabled={saving || uploading > 0}
            data-rx-customizer-save
            title={uploading > 0 ? t('caPictureUploading') : undefined}
            className="px-6 py-2.5 bg-blue-600 text-white text-xs font-black rounded-xl hover:bg-blue-700 transition-all shadow-md shadow-blue-500/20 flex items-center disabled:opacity-50"
          >
            {saving ? (
              <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full mr-2" />
            ) : (
              <Save className="w-4 h-4 mr-2" />
            )}
            Save & Apply
          </button>
        </div>
      </div>
      {uploading > 0 && (
        <p className="text-[0.6875rem] font-bold text-blue-700 -mt-6" role="status" data-rx-customizer-uploading>
          {t('caPictureUploading')}
        </p>
      )}

      {saveError && (

        <div role="alert" className="mb-4 flex items-start gap-2.5 bg-red-50 border border-red-200 text-red-800 rounded-2xl px-4 py-3">

          <X className="w-4 h-4 mt-0.5 shrink-0" />

          <p className="text-xs font-bold leading-relaxed">{saveError}</p>

        </div>

      )}


      {savedSuccess && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-5 py-3.5 rounded-2xl flex items-center justify-between text-xs font-black shadow-sm"
        >
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            <span>Theme settings saved and applied successfully site-wide!</span>
          </div>
          <button onClick={() => setSavedSuccess(false)} className="text-emerald-600 hover:text-emerald-900">
            <X className="w-4 h-4" />
          </button>
        </motion.div>
      )}

      {/* Main Grid: Customizer Sidebar Controls & Live Preview Card */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Column: Category Tabs & Form Controls (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          
          {/* THE SECTIONS OF THIS PAGE, ALL IN VIEW (client, 2026-10-07: "lay out the
              pages and order them") — seven tabs squeezed into one scrolling row,
              the last cut off under a scrollbar. Now a grid, in working order. */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 bg-gray-100 p-1.5 rounded-2xl border border-gray-200" data-rx-customizer-tabs>
            {([
              ['branding', 'Branding & Logo', Sparkles, 'text-blue-600'],
              ['colors', 'Colors & Theme', Palette, 'text-purple-600'],
              ['texts', 'Site Texts', Type, 'text-emerald-600'],
              ['images', 'Images & Banners', ImageIcon, 'text-amber-600'],
              ['layout', 'Page Sections', Layout, 'text-rose-600'],
              ['pages', 'Custom Pages', Globe, 'text-orange-600'],
              ['delivery', 'Pickup & Delivery', MapPin, 'text-amber-600'],
            ] as const).map(([id, label, Icon, tint]) => (
              <button
                key={id}
                type="button"
                aria-pressed={activeTab === id}
                onClick={() => setActiveTab(id)}
                title={id === 'pages' ? 'Services, About us and Contact' : undefined}
                data-rx-customizer-tab={id}
                className={cn(
                  'px-3 py-2 rounded-xl text-xs font-black leading-tight transition-all flex items-center gap-1.5 text-left min-w-0',
                  activeTab === id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900 hover:bg-white/60',
                )}
              >
                <Icon className={cn('w-3.5 h-3.5 shrink-0', tint)} />
                <span className="min-w-0">{label}</span>
              </button>
            ))}
          </div>

          {/* TAB 7: PICKUP LOCATION & DELIVERY TIMES */}
          {activeTab === 'delivery' && (
            <div className="space-y-6">
              <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-5">
                <h3 className="text-base font-black text-gray-900 flex items-center border-b border-gray-100 pb-3">
                  <MapPin className="w-4 h-4 mr-2 text-amber-600" />
                  Pickup location
                </h3>
                <p className="text-xs text-gray-500 font-bold -mt-2">
                  Shown to the customer the moment they choose &ldquo;Pickup&rdquo; at checkout, and repeated in the
                  order confirmation email. Leave it empty and nothing extra is shown.
                </p>

                <label className="flex items-center space-x-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pickup.enabled !== false}
                    onChange={(e) => patchPickup({ enabled: e.target.checked })}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                  />
                  <span className="text-xs font-black text-gray-900">
                    Show these details under the Pickup option
                  </span>
                </label>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[0.6875rem] font-extrabold text-gray-600 mb-1">Company name</label>
                    <input
                      type="text"
                      value={pickup.companyName}
                      onChange={(e) => patchPickup({ companyName: e.target.value })}
                      placeholder="ReklamX AB"
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm font-bold bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[0.6875rem] font-extrabold text-gray-600 mb-1">Phone</label>
                    <input
                      type="tel"
                      value={pickup.phone}
                      onChange={(e) => patchPickup({ phone: e.target.value })}
                      placeholder="+46 70 000 00 00"
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm font-bold bg-white"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-[0.6875rem] font-extrabold text-gray-600 mb-1">
                      Address — one line per row
                    </label>
                    <textarea
                      rows={3}
                      value={pickup.address}
                      onChange={(e) => patchPickup({ address: e.target.value })}
                      placeholder={'Spånehusvägen 62B\n214 39 Malmö\nSweden'}
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm font-bold bg-white"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-[0.6875rem] font-extrabold text-gray-600 mb-1">
                      Map link (optional)
                    </label>
                    <input
                      type="url"
                      value={pickup.mapsUrl}
                      onChange={(e) => patchPickup({ mapsUrl: e.target.value })}
                      placeholder="https://maps.google.com/…"
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm font-bold bg-white"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-[0.6875rem] font-extrabold text-gray-600 mb-1">
                      Note for the customer (optional)
                    </label>
                    <input
                      type="text"
                      value={pickup.note}
                      onChange={(e) => patchPickup({ note: e.target.value })}
                      placeholder="Ring the bell marked Print — the entrance is at the back."
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm font-bold bg-white"
                    />
                  </div>
                </div>

                <div className="pt-2 border-t border-gray-100">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[0.6875rem] font-extrabold text-gray-600 flex items-center">
                      <Clock className="w-3.5 h-3.5 mr-1.5 text-amber-600" />
                      Opening hours
                    </span>
                    <button
                      type="button"
                      onClick={addHoursRow}
                      className="text-[0.6875rem] font-black text-blue-600 hover:text-blue-800 flex items-center"
                    >
                      <Plus className="w-3.5 h-3.5 mr-1" />
                      Add a row
                    </button>
                  </div>

                  {(pickup.openingHours ?? []).length === 0 && (
                    <p className="text-[0.6875rem] text-gray-400 font-bold">
                      No hours yet. Add rows like &ldquo;Mon–Fri&rdquo; / &ldquo;09:00–17:00&rdquo;.
                    </p>
                  )}

                  <div className="space-y-2">
                    {(pickup.openingHours ?? []).map((row) => (
                      <div key={row.id} className="flex items-center gap-2">
                        <input
                          type="text"
                          value={row.days}
                          onChange={(e) => patchHoursRow(row.id, { days: e.target.value })}
                          placeholder="Mon–Fri"
                          className="w-1/3 px-3 py-1.5 border border-gray-200 rounded-xl text-xs font-bold bg-white"
                        />
                        <input
                          type="text"
                          value={row.hours}
                          onChange={(e) => patchHoursRow(row.id, { hours: e.target.value })}
                          placeholder="09:00–17:00"
                          className="flex-1 px-3 py-1.5 border border-gray-200 rounded-xl text-xs font-bold bg-white"
                        />
                        <button
                          type="button"
                          onClick={() => removeHoursRow(row.id)}
                          className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Remove this row"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-5">
                <h3 className="text-base font-black text-gray-900 flex items-center border-b border-gray-100 pb-3">
                  <Clock className="w-4 h-4 mr-2 text-blue-600" />
                  Delivery times
                </h3>
                <p className="text-xs text-gray-500 font-bold -mt-2">
                  Every new order gets a promised date from these numbers: production days plus the transit days of
                  the method the customer chose. Staff can move an individual order&rsquo;s date afterwards. On a
                  product that offers a production speed (Standard / Fast / Express / Next day), the speed the
                  customer picked sets the production days instead &mdash; the working days written in that option.
                </p>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {(
                    [
                      { key: 'productionDays', label: 'Production days' },
                      // Named after the methods checkout offers (the stored
                      // keys are from when the carrier was DSV). The prices are
                      // in the admin's Shipping tab.
                      { key: 'shippingDaysZone', label: 'Transit — Standard delivery' },
                      { key: 'shippingDaysWeekday', label: 'Transit — Express delivery' },
                      { key: 'shippingDaysPickup', label: 'Pickup — extra days' },
                    ] as const
                  ).map(({ key, label }) => (
                    <div key={key}>
                      <label className="block text-[0.6875rem] font-extrabold text-gray-600 mb-1">{label}</label>
                      <input
                        type="number"
                        min="0"
                        value={promise[key]}
                        onChange={(e) => patchPromise({ [key]: Math.max(0, Number(e.target.value) || 0) })}
                        className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm font-black bg-white"
                      />
                    </div>
                  ))}
                </div>

                <label className="flex items-center space-x-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={promise.skipWeekends !== false}
                    onChange={(e) => patchPromise({ skipWeekends: e.target.checked })}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                  />
                  <span className="text-xs font-black text-gray-900">
                    Count working days only — skip Saturdays and Sundays
                  </span>
                </label>

                {(() => {
                  // Counted exactly as the order is (src/lib/productionSpeed.ts), on the
                  // shop's calendar: production days — or a speed's own days — plus the
                  // Standard-delivery transit.
                  const promisedFor = (productionDays: number) =>
                    promisedDay(
                      new Date(),
                      productionDays + (Number(promise.shippingDaysZone) || 0),
                      promise.skipWeekends !== false,
                    );
                  return (
                    <p
                      data-rx-promise-preview
                      className="text-[0.6875rem] font-bold text-gray-500 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2"
                    >
                      An order placed today and sent with Standard delivery would be promised for{' '}
                      <span className="text-gray-900">{promisedFor(Number(promise.productionDays) || 0)}</span>. On a
                      product with a production speed, the speed the customer picks replaces the production days:
                      &ldquo;Standard &mdash; 5 working days&rdquo; would be promised for{' '}
                      <span className="text-gray-900">{promisedFor(5)}</span>, &ldquo;Next day&rdquo; for{' '}
                      <span className="text-gray-900">{promisedFor(1)}</span>.
                    </p>
                  );
                })()}
              </div>

              {/* AUTOMATIC PRODUCTION STAGES.
                  The owner asked for the tracker to move by itself. These are the
                  numbers it moves by; the sweep that reads them lives in
                  server.ts and the schedule itself in src/lib/orderStages.ts. */}
              <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-5">
                <h3 className="text-base font-black text-gray-900 flex items-center border-b border-gray-100 pb-3">
                  <Clock className="w-4 h-4 mr-2 text-emerald-600" />
                  Automatic production stages
                </h3>
                <p className="text-xs text-gray-500 font-bold -mt-2">
                  A paid order walks itself through the stages on this schedule, and the customer watches it happen.
                  Each number is the hours spent in the stage BEFORE the next one begins, counted from the moment the
                  order was paid. Staff moving a job by hand always wins &mdash; the rest of the schedule is then
                  re-measured from that moment. For an order with a production speed, these hours are proportions: the
                  job is dispatched on the speed&rsquo;s working day, and the stages before it share that time.
                </p>

                <label className="flex items-start space-x-2.5 cursor-pointer p-3 rounded-2xl border border-emerald-200 bg-emerald-50/60">
                  <input
                    type="checkbox"
                    checked={autoStages.enabled !== false}
                    onChange={(e) => patchAutoStages({ enabled: e.target.checked })}
                    className="w-4 h-4 mt-0.5 text-emerald-600 rounded focus:ring-emerald-500"
                  />
                  <span>
                    <span className="block text-xs font-black text-gray-900">
                      Move orders through the stages automatically
                    </span>
                    <span className="block text-[0.6875rem] font-bold text-gray-500 mt-0.5">
                      Switch this off and an order only ever moves when a member of staff moves it.
                    </span>
                  </span>
                </label>

                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  {(
                    [
                      { key: 'in_design', label: 'Hours to In Design' },
                      { key: 'in_print', label: 'Hours to In Print' },
                      { key: 'finishing', label: 'Hours to Finishing' },
                      { key: 'shipped', label: 'Hours to Shipped' },
                      { key: 'completed', label: 'Hours to Delivered' },
                    ] as const
                  ).map(({ key, label }) => (
                    <div key={key}>
                      <label className="block text-[0.6875rem] font-extrabold text-gray-600 mb-1">{label}</label>
                      <input
                        type="number"
                        min="0"
                        disabled={autoStages.enabled === false}
                        value={autoStages.hours[key]}
                        onChange={(e) => patchStageHours(key, Number(e.target.value) || 0)}
                        className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm font-black bg-white disabled:opacity-50 disabled:bg-gray-50"
                      />
                    </div>
                  ))}
                </div>

                <label className="flex items-center space-x-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoStages.skipWeekends !== false}
                    disabled={autoStages.enabled === false}
                    onChange={(e) => patchAutoStages({ skipWeekends: e.target.checked })}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500 disabled:opacity-50"
                  />
                  <span className="text-xs font-black text-gray-900">
                    Never land a stage on a Saturday or Sunday &mdash; push it to the Monday
                  </span>
                </label>

                <p className="text-[0.6875rem] font-bold text-gray-500 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
                  Paid to delivered: <span className="text-gray-900">{autoStageSummary().hours} hours</span> (about{' '}
                  <span className="text-gray-900">{autoStageSummary().days} days</span>). Two rules the schedule never
                  breaks: an <span className="text-gray-900">unpaid</span> order never moves, and an order whose{' '}
                  <span className="text-gray-900">artwork has not arrived</span> stops at In Design and waits for a
                  human.
                </p>
              </div>
            </div>
          )}

          {/* TAB 1: BRANDING & LOGO */}
          {activeTab === 'branding' && (
            <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-6">
              <h3 className="text-base font-black text-gray-900 flex items-center border-b border-gray-100 pb-3">
                <Sparkles className="w-4 h-4 mr-2 text-blue-600" />
                Branding & Logo Settings
              </h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-black text-gray-700 mb-1">Site Name</label>
                  <input
                    type="text"
                    value={formState.siteName}
                    onChange={(e) => setFormState({ ...formState, siteName: e.target.value })}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-xs font-bold text-gray-900 outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-black text-gray-700 mb-1">Site Tagline</label>
                  <input
                    type="text"
                    value={formState.siteTagline}
                    onChange={(e) => setFormState({ ...formState, siteTagline: e.target.value })}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-xs font-bold text-gray-900 outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <LocalizedTextFields
                    label={t('scTaglineTranslations')}
                    fallback={formState.siteTagline}
                    value={(formState.siteTaglineI18n || {}) as LocalizedText}
                    onChange={(next) => setFormState((prev) => ({ ...prev, siteTaglineI18n: Object.keys(next).length ? next : null }))}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-black text-gray-700 mb-1">Contact Phone Number</label>
                    <input
                      type="text"
                      value={formState.contactPhone || ''}
                      onChange={(e) => setFormState({ ...formState, contactPhone: e.target.value })}
                      placeholder="+46 40 614 30 30"
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-xs font-bold text-gray-900 outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-black text-gray-700 mb-1">Contact Email</label>
                    <input
                      type="text"
                      value={formState.contactEmail || ''}
                      onChange={(e) => setFormState({ ...formState, contactEmail: e.target.value })}
                      placeholder="info@reklamx.se"
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-xs font-bold text-gray-900 outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                {/* Registered company identity.
                    These print on every invoice and on the privacy and terms
                    pages, where Swedish law requires them. They had no field
                    anywhere, so they could only be set from outside the app —
                    which meant the owner could not correct his own address. */}
                <div className="pt-6 mt-6 border-t border-gray-200">
                  <div className="flex items-center gap-2 mb-1">
                    <Building2 className="w-4 h-4 text-blue-600" />
                    <h3 className="text-sm font-black text-gray-900">Registered company details</h3>
                  </div>
                  <p className="text-[0.6875rem] text-gray-500 mb-4">
                    Printed on every invoice and on the legal pages. Required by Swedish invoicing rules — leave nothing blank.
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-black text-gray-700 mb-1">Legal company name</label>
                    <input
                      type="text"
                      value={formState.companyLegalName || ''}
                      onChange={(e) => setFormState({ ...formState, companyLegalName: e.target.value })}
                      placeholder="ReklamX AB"
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-xs font-bold text-gray-900 outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    
                  </div>
                  <div>
                    <label className="block text-xs font-black text-gray-700 mb-1">Registered address</label>
                    <input
                      type="text"
                      value={formState.companyAddress || ''}
                      onChange={(e) => setFormState({ ...formState, companyAddress: e.target.value })}
                      placeholder="Flintyxegatan 9, 213 76 Malmö, Sverige"
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-xs font-bold text-gray-900 outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    
                  </div>
                  <div>
                    <label className="block text-xs font-black text-gray-700 mb-1">Organisationsnummer</label>
                    <input
                      type="text"
                      value={formState.orgNumber || ''}
                      onChange={(e) => setFormState({ ...formState, orgNumber: e.target.value })}
                      placeholder="559515-3791"
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-xs font-bold text-gray-900 outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    
                  </div>
                  <div>
                    <label className="block text-xs font-black text-gray-700 mb-1">Momsregistreringsnummer</label>
                    <input
                      type="text"
                      value={formState.vatNumber || ''}
                      onChange={(e) => setFormState({ ...formState, vatNumber: e.target.value })}
                      placeholder="SE559515-3791"
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-xs font-bold text-gray-900 outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    
                  </div>
                  <div>
                    <label className="block text-xs font-black text-gray-700 mb-1">Bankgiro / IBAN</label>
                    <input
                      type="text"
                      value={formState.bankgiro || ''}
                      onChange={(e) => setFormState({ ...formState, bankgiro: e.target.value })}
                      placeholder=""
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-xs font-bold text-gray-900 outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <p className="text-[0.625rem] text-gray-400 mt-1">Only needed if customers pay by bank transfer.</p>
                  </div>

                    <div className="flex items-end">
                      <label className="flex items-center gap-2.5 cursor-pointer select-none pb-2.5">
                        <input
                          type="checkbox"
                          checked={Boolean(formState.hasFSkatt)}
                          onChange={(e) => setFormState({ ...formState, hasFSkatt: e.target.checked })}
                          className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-2 focus:ring-blue-500 cursor-pointer"
                        />
                        <span className="text-xs font-black text-gray-700">Registered for F-skatt</span>
                      </label>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-black text-gray-700 mb-2">Logo Type</label>
                  <div className="grid grid-cols-3 gap-3">
                    <button
                      type="button"
                      onClick={() => setFormState({ ...formState, logoType: 'text_and_icon' })}
                      className={cn(
                        "p-3 rounded-2xl border text-center text-xs font-bold transition-all",
                        formState.logoType === 'text_and_icon' ? "border-blue-600 bg-blue-50/50 text-blue-700 font-black" : "border-gray-200 text-gray-600"
                      )}
                    >
                      <Printer className="w-5 h-5 mx-auto mb-1 text-blue-600" />
                      Icon + Name
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormState({ ...formState, logoType: 'image' })}
                      className={cn(
                        "p-3 rounded-2xl border text-center text-xs font-bold transition-all",
                        formState.logoType === 'image' ? "border-blue-600 bg-blue-50/50 text-blue-700 font-black" : "border-gray-200 text-gray-600"
                      )}
                    >
                      <FileImage className="w-5 h-5 mx-auto mb-1 text-purple-600" />
                      Custom Image Logo
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormState({ ...formState, logoType: 'text_only' })}
                      className={cn(
                        "p-3 rounded-2xl border text-center text-xs font-bold transition-all",
                        formState.logoType === 'text_only' ? "border-blue-600 bg-blue-50/50 text-blue-700 font-black" : "border-gray-200 text-gray-600"
                      )}
                    >
                      <Type className="w-5 h-5 mx-auto mb-1 text-emerald-600" />
                      Text Only
                    </button>
                  </div>
                </div>

                {/* Logo Image Upload / URL */}
                {formState.logoType === 'image' && (
                  <div className="p-4 bg-gray-50 rounded-2xl border border-gray-200 space-y-3">
                    <span className="block text-xs font-black text-gray-800">Upload Custom Logo</span>
                    
                    <div className="flex items-center space-x-4">
                      {formState.logoUrl ? (
                        <div className="w-16 h-16 bg-white rounded-xl border border-gray-200 p-1 flex items-center justify-center overflow-hidden shrink-0">
                          <img src={formState.logoUrl} alt="Logo preview" className="max-w-full max-h-full object-contain" />
                        </div>
                      ) : (
                        <div className="w-16 h-16 bg-gray-200 rounded-xl flex items-center justify-center text-gray-400 shrink-0">
                          <FileImage className="w-6 h-6" />
                        </div>
                      )}

                      <div className="flex-1 space-y-2">
                        <input
                          type="file"
                          ref={logoFileInputRef}
                          accept="image/*"
                          data-rx-logo-file
                          className="hidden"
                          onChange={(e) => {
                            if (e.target.files?.[0]) {
                              handleLogoFile(e.target.files[0], (dataUrl) => {
                                setFormState((prev) => ({ ...prev, logoUrl: dataUrl }));
                              });
                            }
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => logoFileInputRef.current?.click()}
                          className="px-4 py-2 bg-gray-900 text-white text-xs font-bold rounded-xl hover:bg-gray-800 transition-all flex items-center"
                        >
                          <Upload className="w-3.5 h-3.5 mr-1.5" />
                          Upload File
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="block text-[0.6875rem] font-bold text-gray-500 mb-1">Direct Image URL</label>
                      <input
                        type="text"
                        value={formState.logoUrl || ''}
                        onChange={(e) => setFormState({ ...formState, logoUrl: e.target.value })}
                        placeholder="https://..."
                        className="w-full px-3 py-1.5 border border-gray-200 rounded-xl text-xs bg-white"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: COLORS & THEME */}
          {activeTab === 'colors' && (
            <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-6">
              <h3 className="text-base font-black text-gray-900 flex items-center border-b border-gray-100 pb-3">
                <Palette className="w-4 h-4 mr-2 text-purple-600" />
                Theme Colors & Styles
              </h3>

              <div className="space-y-6">
                {/* Primary Theme Color */}
                <div>
                  <label className="block text-xs font-black text-gray-800 mb-2">Primary Accent Color</label>
                  
                  {/* Preset Colors */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-3">
                    {PRIMARY_COLOR_PRESETS.map((p) => (
                      <button
                        key={p.hex}
                        type="button"
                        onClick={() => setFormState({ ...formState, primaryColor: p.hex })}
                        className={cn(
                          "p-2 rounded-xl border flex items-center space-x-2 text-xs font-extrabold transition-all",
                          formState.primaryColor.toLowerCase() === p.hex.toLowerCase()
                            ? "border-gray-900 bg-gray-50 shadow-xs"
                            : "border-gray-200 hover:bg-gray-50"
                        )}
                      >
                        <span className="w-4 h-4 rounded-full shrink-0 shadow-xs" style={{ backgroundColor: p.hex }} />
                        <span className="truncate text-[0.6875rem]">{p.name}</span>
                      </button>
                    ))}
                  </div>

                  {/* Custom Hex Picker */}
                  <div className="flex items-center space-x-3 bg-gray-50 p-3 rounded-2xl border border-gray-200">
                    <input
                      type="color"
                      value={formState.primaryColor}
                      onChange={(e) => setFormState({ ...formState, primaryColor: e.target.value })}
                      className="w-9 h-9 rounded-xl border border-gray-300 cursor-pointer p-0.5 bg-white"
                    />
                    <div className="flex-1">
                      <span className="block text-[0.6875rem] font-bold text-gray-500">Custom Hex Code</span>
                      <input
                        type="text"
                        value={formState.primaryColor}
                        onChange={(e) => setFormState({ ...formState, primaryColor: e.target.value })}
                        className="px-2 py-0.5 border border-gray-200 rounded-lg text-xs font-mono font-bold bg-white uppercase w-28"
                      />
                    </div>
                  </div>
                </div>

                {/* Navbar Background Style */}
                <div>
                  <label className="block text-xs font-black text-gray-800 mb-2">Navbar Background</label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setFormState({ ...formState, navbarBg: 'white' })}
                      className={cn(
                        "p-3 rounded-2xl border text-center text-xs font-bold transition-all flex flex-col items-center justify-center space-y-1",
                        formState.navbarBg === 'white' ? "border-blue-600 bg-blue-50/50 text-blue-900 font-black" : "border-gray-200 text-gray-600"
                      )}
                    >
                      <Sun className="w-5 h-5 text-amber-500" />
                      <span>White</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormState({ ...formState, navbarBg: 'dark' })}
                      className={cn(
                        "p-3 rounded-2xl border text-center text-xs font-bold transition-all flex flex-col items-center justify-center space-y-1",
                        formState.navbarBg === 'dark' ? "border-blue-600 bg-gray-900 text-white font-black" : "border-gray-200 text-gray-600"
                      )}
                    >
                      <Moon className="w-5 h-5 text-purple-400" />
                      <span>Dark</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: TEXTS & COPY */}
          {activeTab === 'texts' && (
            <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-6">
              <h3 className="text-base font-black text-gray-900 flex items-center border-b border-gray-100 pb-3">
                <Type className="w-4 h-4 mr-2 text-emerald-600" />
                Homepage Texts & Copy
              </h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-black text-gray-700 mb-1">Announcement Bar Text</label>
                  <input
                    type="text"
                    value={formState.announcementText}
                    onChange={(e) => setFormState({ ...formState, announcementText: e.target.value })}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-xs font-bold text-gray-900 outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {/* The first line of text on every page in the shop. It was
                      English on a Swedish storefront. */}
                  <LocalizedTextFields
                    label={t('scAnnouncementTranslations')}
                    fallback={formState.announcementText}
                    value={(formState.announcementTextI18n || {}) as LocalizedText}
                    onChange={(next) => setFormState((prev) => ({ ...prev, announcementTextI18n: Object.keys(next).length ? next : null }))}
                  />
                </div>

                {/* "Hero Title" and the two CTA button labels used to sit here.
                    The home page hero takes its wording from the carousel slides
                    (Images tab -> Main hero carousel slides: title, subtitle and
                    badge, one set per slide) and it has no CTA buttons at all, so
                    everything typed into those three boxes was saved and never
                    shown. Edit the hero on the Images tab instead.

                    Hero Subtitle stayed, under an honest label: it is not on the
                    page either, but it is the description search engines print
                    under the home page, so it is a real control. */}
                <div>
                  <label className="block text-xs font-black text-gray-700 mb-1">Home page search description</label>
                  <textarea
                    rows={2}
                    value={formState.heroSubtitle}
                    onChange={(e) => setFormState({ ...formState, heroSubtitle: e.target.value })}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-xs font-bold text-gray-900 outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-[0.6875rem] font-bold text-gray-500 mt-1">
                    The sentence shown under the site name in a browser tab and a link preview. It is not printed on the page. For what a search engine is served, use the Google tab.
                  </p>
                  {/* THE SENTENCE A SWEDE READS UNDER THE SITE NAME — 15.4.7.
                      heroSubtitleI18n was declared in SiteSettings when the site
                      copy was translated and no screen ever grew a box for it,
                      so the one line that introduces this shop could only ever
                      be English. src/App.tsx reads it through localized() now
                      (15.4.10) — this box and that line are the two halves of
                      one change, and either alone does nothing.

                      What it controls is the meta description the BROWSER
                      renders. The copy a crawler is served comes from the Google
                      tab, which has its own four-language boxes per page. */}
                  <LocalizedTextFields
                    label={t('scSearchDescriptionTranslations')}
                    fallback={formState.heroSubtitle}
                    value={(formState.heroSubtitleI18n || {}) as LocalizedText}
                    onChange={(next) => setFormState((prev) => ({ ...prev, heroSubtitleI18n: Object.keys(next).length ? next : null }))}
                    multiline
                  />
                </div>

                <div>
                  <label className="block text-xs font-black text-gray-700 mb-1">Footer Copyright</label>
                  <input
                    type="text"
                    value={formState.footerText}
                    onChange={(e) => setFormState({ ...formState, footerText: e.target.value })}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-xs font-bold text-gray-900"
                  />
                  <LocalizedTextFields
                    label={t('scFooterTranslations')}
                    fallback={formState.footerText}
                    value={(formState.footerTextI18n || {}) as LocalizedText}
                    onChange={(next) => setFormState((prev) => ({ ...prev, footerTextI18n: Object.keys(next).length ? next : null }))}
                  />
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: IMAGES & BANNERS */}
          {activeTab === 'images' && (
            <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-8">
              <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                <h3 className="text-base font-black text-gray-900 flex items-center">
                  <ImageIcon className="w-5 h-5 mr-2 text-amber-600" />
                  Homepage Hero Banners & Images Customizer
                </h3>
                <span className="text-xs font-bold bg-amber-50 text-amber-700 px-3 py-1 rounded-full">
                  Admin & Staff Access
                </span>
              </div>

              {/* 1. Hero Carousel Slider Images */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="block text-xs font-black text-gray-900 uppercase tracking-wider">
                      1. Main hero carousel slides
                    </span>
                    <p className="text-[0.6875rem] text-gray-500">
                      Upload or replace images for the main hero slider. Images stretch to fit 100% of the display card.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const newSlide = {
                        id: 's_' + Date.now(),
                        imageUrl: 'https://images.unsplash.com/photo-1562654501-a0ccc0fc3fb1?auto=format&fit=crop&q=80&w=2000',
                        title: 'NEW BANNER SLIDE',
                        subtitle: 'Custom High Resolution Print',
                        badge: 'LIMITED TIME PROMOTION'
                      };
                      const current = formState.heroSlides || [];
                      setFormState({ ...formState, heroSlides: [...current, newSlide] });
                    }}
                    className="px-3.5 py-2 bg-orange-600 text-white text-xs font-black rounded-xl hover:bg-orange-500 transition-all flex items-center shadow-xs"
                  >
                    <Plus className="w-3.5 h-3.5 mr-1" />
                    Add Slide
                  </button>
                </div>

                <div className="space-y-4">
                  {(formState.heroSlides || []).map((slide, idx) => (
                    <div key={slide.id || idx} className="p-4 rounded-2xl border border-gray-200 bg-gray-50/50 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-black text-gray-800">
                          Slide #{idx + 1}
                        </span>
                        {(formState.heroSlides?.length || 1) > 1 && (
                          <button
                            type="button"
                            onClick={() => {
                              const updated = (formState.heroSlides || []).filter((_, i) => i !== idx);
                              setFormState({ ...formState, heroSlides: updated });
                            }}
                            className="text-red-500 hover:text-red-700 text-xs font-bold flex items-center"
                          >
                            <Trash2 className="w-3.5 h-3.5 mr-1" />
                            Remove
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
                        {/* Slide Image Preview & Upload */}
                        <div className="md:col-span-5 relative aspect-video rounded-xl overflow-hidden bg-gray-900 border border-gray-200 group">
                          <img src={slide.imageUrl} alt={`Slide ${idx + 1}`} className="w-full h-full object-cover" />
                          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center p-2 gap-2">
                            <label className="cursor-pointer px-3 py-1.5 bg-white text-gray-900 rounded-lg text-xs font-black hover:bg-gray-100 shadow-md flex items-center">
                              <Upload className="w-3.5 h-3.5 mr-1 text-orange-600" />
                              Upload Image
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                data-rx-slide-file={idx}
                                onChange={(e) => {
                                  if (e.target.files?.[0]) {
                                    void handlePictureFile(e.target.files[0], (url) => {
                                      setFormState((prev) => {
                                        const slides = [...(prev.heroSlides || [])];
                                        if (!slides[idx]) return prev;
                                        slides[idx] = { ...slides[idx], imageUrl: url };
                                        return { ...prev, heroSlides: slides, heroImageUrl: idx === 0 ? url : prev.heroImageUrl };
                                      });
                                    });
                                  }
                                }}
                              />
                            </label>
                          </div>
                        </div>

                        {/* Slide Content Fields */}
                        <div className="md:col-span-7 space-y-2">
                          <div>
                            <label className="block text-[0.6875rem] font-bold text-gray-600">Image Direct URL</label>
                            <input
                              type="text"
                              value={slide.imageUrl}
                              onChange={(e) => {
                                const newUrl = e.target.value;
                                const slides = [...(formState.heroSlides || [])];
                                if (slides[idx]) {
                                  slides[idx] = { ...slides[idx], imageUrl: newUrl };
                                  setFormState({ ...formState, heroSlides: slides, heroImageUrl: idx === 0 ? newUrl : formState.heroImageUrl });
                                }
                              }}
                              className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs font-mono bg-white"
                              placeholder="https://..."
                            />
                            <button
                              type="button"
                              onClick={() => setPicker({ kind: 'hero', index: idx })}
                              className="mt-1.5 px-3 py-1.5 bg-gray-100 text-gray-800 text-[0.6875rem] font-black rounded-lg hover:bg-gray-200 transition-colors"
                            >
                              {t('mlChoose')}
                            </button>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-[0.6875rem] font-bold text-gray-600">Slide Title</label>
                              <input
                                type="text"
                                value={slide.title || ''}
                                onChange={(e) => {
                                  const slides = [...(formState.heroSlides || [])];
                                  if (slides[idx]) {
                                    slides[idx] = { ...slides[idx], title: e.target.value };
                                    setFormState({ ...formState, heroSlides: slides });
                                  }
                                }}
                                className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs font-bold bg-white"
                              />
                              <LocalizedTextFields
                                label={t('scSlideTitleTranslations')}
                                fallback={slide.title || ''}
                                value={(slide.titleI18n || {}) as LocalizedText}
                                onChange={(next) => {
                                  // The updater form, because the AI button can
                                  // deliver this seconds after the click and a
                                  // captured formState would revert whatever was
                                  // typed in the meantime.
                                  setFormState((prev) => {
                                    const slides = [...(prev.heroSlides || [])];
                                    if (!slides[idx]) return prev;
                                    slides[idx] = { ...slides[idx], titleI18n: Object.keys(next).length ? next : null };
                                    return { ...prev, heroSlides: slides };
                                  });
                                }}
                              />
                            </div>
                            <div>
                              <label className="block text-[0.6875rem] font-bold text-gray-600">Eyebrow (small line above the title)</label>
                              <input
                                type="text"
                                value={slide.badge || ''}
                                onChange={(e) => {
                                  const slides = [...(formState.heroSlides || [])];
                                  if (slides[idx]) {
                                    slides[idx] = { ...slides[idx], badge: e.target.value };
                                    setFormState({ ...formState, heroSlides: slides });
                                  }
                                }}
                                className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs font-bold bg-white"
                              />
                              <LocalizedTextFields
                                label={t('scSlideBadgeTranslations')}
                                fallback={slide.badge || ''}
                                value={(slide.badgeI18n || {}) as LocalizedText}
                                onChange={(next) => {
                                  // The updater form, because the AI button can
                                  // deliver this seconds after the click and a
                                  // captured formState would revert whatever was
                                  // typed in the meantime.
                                  setFormState((prev) => {
                                    const slides = [...(prev.heroSlides || [])];
                                    if (!slides[idx]) return prev;
                                    slides[idx] = { ...slides[idx], badgeI18n: Object.keys(next).length ? next : null };
                                    return { ...prev, heroSlides: slides };
                                  });
                                }}
                              />
                            </div>
                          </div>

                          {/* THE SECOND LINE ON THE FRONT PAGE, AND THERE WAS NO
                              BOX FOR IT — 15.4.7. The home page has rendered
                              localized(slide.subtitle, slide.subtitleI18n, …)
                              since the site copy was translated; this editor
                              offered Title and Badge and nothing else. A seeded
                              slide ships with "300 DPI High Precision Print", so
                              the owner was looking at a sentence on his own hero
                              that he had never typed, could not reword and could
                              not have said in Swedish. */}
                          <div>
                            <label className="block text-[0.6875rem] font-bold text-gray-600">Slide Subtitle</label>
                            <input
                              type="text"
                              value={slide.subtitle || ''}
                              onChange={(e) => {
                                const slides = [...(formState.heroSlides || [])];
                                if (slides[idx]) {
                                  slides[idx] = { ...slides[idx], subtitle: e.target.value };
                                  setFormState({ ...formState, heroSlides: slides });
                                }
                              }}
                              className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs font-bold bg-white"
                            />
                            <LocalizedTextFields
                              label={t('scSlideSubtitleTranslations')}
                              fallback={slide.subtitle || ''}
                              value={(slide.subtitleI18n || {}) as LocalizedText}
                              onChange={(next) => {
                                // The updater form, because the AI button can
                                // deliver this seconds after the click and a
                                // captured formState would revert whatever was
                                // typed in the meantime.
                                setFormState((prev) => {
                                  const slides = [...(prev.heroSlides || [])];
                                  if (!slides[idx]) return prev;
                                  slides[idx] = { ...slides[idx], subtitleI18n: Object.keys(next).length ? next : null };
                                  return { ...prev, heroSlides: slides };
                                });
                              }}
                            />
                          </div>

                          {/* The offer: a price shown large and calm ("från 995 kr")
                              and where the slide's one button goes. */}
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-[0.6875rem] font-bold text-gray-600">Offer price (SEK ex. VAT, optional)</label>
                              <input
                                type="number"
                                min={0}
                                step="1"
                                inputMode="numeric"
                                value={slide.priceSek ?? ''}
                                placeholder="995"
                                onChange={(e) => {
                                  const slides = [...(formState.heroSlides || [])];
                                  if (slides[idx]) {
                                    const n = e.target.value === '' ? null : Number(e.target.value);
                                    slides[idx] = { ...slides[idx], priceSek: n !== null && Number.isFinite(n) && n > 0 ? n : null };
                                    setFormState({ ...formState, heroSlides: slides });
                                  }
                                }}
                                className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs font-bold bg-white"
                              />
                            </div>
                            <div>
                              <label className="block text-[0.6875rem] font-bold text-gray-600">Button link (optional)</label>
                              <input
                                type="text"
                                value={slide.link || ''}
                                placeholder="/products/rollup"
                                onChange={(e) => {
                                  const slides = [...(formState.heroSlides || [])];
                                  if (slides[idx]) {
                                    // Only an address on this shop: a slide must not send
                                    // a visitor to another site by a typo or a paste.
                                    const v = e.target.value.trim();
                                    slides[idx] = { ...slides[idx], link: v.startsWith('/') && !v.startsWith('//') ? v : v ? `/${v.replace(/^\/+/, '')}` : null };
                                    setFormState({ ...formState, heroSlides: slides });
                                  }
                                }}
                                className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs font-bold bg-white"
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 2. Side Bento Grid Cards Images */}
              <div className="space-y-4 pt-6 border-t border-gray-100">
                <div>
                  <span className="block text-xs font-black text-gray-900 uppercase tracking-wider">
                    2. Side grid images
                  </span>
                  <p className="text-[0.6875rem] text-gray-500">
                    Replace background images for the 6 side cards (Gift Boxes, Custom Labels, Exhibition Stands, etc.).
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  {(formState.bentoCards || []).map((bento, bIdx) => (
                    <div key={bento.id || bIdx} className="p-3 bg-gray-50 rounded-2xl border border-gray-200 space-y-2">
                      {/* THE CARD'S OWN NAME, EDITABLE AT LAST — 15.4.7.
                          These six cards are above the fold on the front page and
                          the home page already renders localized(card.title,
                          card.titleI18n, …). This screen printed the title as a
                          read-only heading and offered the picture only, so
                          "GIFT BOXES" was a word the owner could see on his shop,
                          could not rename, and had no way of saying in Swedish,
                          Danish or Norwegian. */}
                      <div>
                        <label className="block text-[0.6875rem] font-bold text-gray-600">Card Title</label>
                        <input
                          type="text"
                          value={bento.title || ''}
                          onChange={(e) => {
                            const currentBentos = [...(formState.bentoCards || [])];
                            if (!currentBentos[bIdx]) return;
                            currentBentos[bIdx] = { ...currentBentos[bIdx], title: e.target.value };
                            setFormState({ ...formState, bentoCards: currentBentos });
                          }}
                          className="w-full px-2.5 py-1 border border-gray-200 rounded-lg text-[0.6875rem] font-black text-gray-900 uppercase bg-white"
                        />
                        <LocalizedTextFields
                          label={t('scBentoTitleTranslations')}
                          fallback={bento.title || ''}
                          value={(bento.titleI18n || {}) as LocalizedText}
                          onChange={(next) => {
                            // The updater form, because the AI button can deliver
                            // this seconds after the click and a captured
                            // formState would revert whatever was typed in the
                            // meantime.
                            setFormState((prev) => {
                              const cards = [...(prev.bentoCards || [])];
                              if (!cards[bIdx]) return prev;
                              cards[bIdx] = { ...cards[bIdx], titleI18n: Object.keys(next).length ? next : null };
                              return { ...prev, bentoCards: cards };
                            });
                          }}
                        />
                      </div>

                      <div className="relative aspect-video rounded-xl overflow-hidden bg-gray-900 border border-gray-200 group">
                        <img src={bento.imageUrl} alt={bento.title} className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <label className="cursor-pointer px-3 py-1 bg-white text-gray-900 rounded-lg text-xs font-black hover:bg-gray-100 shadow-md flex items-center">
                            <Upload className="w-3 h-3 mr-1 text-orange-600" />
                            Change
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              data-rx-bento-file={bIdx}
                              onChange={(e) => {
                                if (e.target.files?.[0]) {
                                  void handlePictureFile(e.target.files[0], (url) => {
                                    setFormState((prev) => {
                                      const currentBentos = [...(prev.bentoCards || [])];
                                      if (!currentBentos[bIdx]) return prev;
                                      currentBentos[bIdx] = { ...currentBentos[bIdx], imageUrl: url };
                                      return { ...prev, bentoCards: currentBentos };
                                    });
                                  });
                                }
                              }}
                            />
                          </label>
                        </div>
                      </div>

                      <input
                        type="text"
                        value={bento.imageUrl}
                        onChange={(e) => {
                          const newUrl = e.target.value;
                          const currentBentos = [...(formState.bentoCards || [])];
                          if (!currentBentos[bIdx]) return;
                          currentBentos[bIdx] = { ...currentBentos[bIdx], imageUrl: newUrl };
                          setFormState({ ...formState, bentoCards: currentBentos });
                        }}
                        className="w-full px-2.5 py-1 border border-gray-200 rounded-lg text-[0.6875rem] font-mono bg-white"
                        placeholder="Image URL..."
                      />
                      <button
                        type="button"
                        onClick={() => setPicker({ kind: 'bento', index: bIdx })}
                        className="mt-1.5 w-full px-2.5 py-1.5 bg-gray-100 text-gray-800 text-[0.6875rem] font-black rounded-lg hover:bg-gray-200 transition-colors"
                      >
                        {t('mlChoose')}
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* "3. Online editor section image" was here — an upload button, a
                  thumbnail and a URL box for editorPromoImageUrl. No page on the
                  site has ever rendered that image, so uploading one filed it in
                  Firestore and changed nothing a customer could see. */}
            </div>
          )}

          {/* TAB 6: CUSTOM PAGES (SERVICES, ABOUT US, CONTACT) */}
          {activeTab === 'pages' && (
            <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-6">
              <h3 className="text-base font-black text-gray-900 flex items-center border-b border-gray-100 pb-3">
                <Globe className="w-4 h-4 mr-2 text-orange-600" />
                Page content editor
              </h3>

              {/* TWO DOORS ONTO ONE FIELD, AND ONE OF THEM WAS ENGLISH-ONLY — 15.4.7.
                  Every box below writes the same settings field the page's own
                  Edit button writes, and that one has carried the sv/da/no boxes
                  since the site copy was translated. Editing the heading here
                  therefore replaced the English and left the three translations
                  standing: the shop kept showing the OLD Swedish headline over
                  the new English one, with nothing on either screen to say why.
                  Same control, same field, either door. */}
              <div className="grid grid-cols-1 gap-6">
                {/* Services Page */}
                <div className="p-5 bg-gray-50 rounded-2xl border border-gray-200/80 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-black text-sm text-gray-900">1. OUR SERVICES Page</span>
                    <a href="/services" target="_blank" rel="noreferrer" className="text-xs font-bold text-orange-600 hover:underline">
                      View Page ↗
                    </a>
                  </div>
                  <div>
                    <label className="block text-[0.6875rem] font-bold text-gray-600">Hero Title</label>
                    <input
                      type="text"
                      value={formState.servicesPageSettings?.heroTitle || ''}
                      onChange={(e) => setFormState({
                        ...formState,
                        servicesPageSettings: {
                          ...(formState.servicesPageSettings || { heroSubtitle: '', servicesList: [] }),
                          heroTitle: e.target.value
                        }
                      })}
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs bg-white font-bold"
                    />
                    <LocalizedTextFields
                      label={t('pgHeroTitleTranslations')}
                      fallback={formState.servicesPageSettings?.heroTitle || ''}
                      value={(formState.servicesPageSettings?.heroTitleI18n || {}) as LocalizedText}
                      onChange={(next) => setFormState((prev) => ({
                        ...prev,
                        servicesPageSettings: {
                          ...(prev.servicesPageSettings || { heroTitle: '', heroSubtitle: '', servicesList: [] }),
                          heroTitleI18n: Object.keys(next).length ? next : null,
                        },
                      }))}
                    />
                  </div>
                  <div>
                    <label className="block text-[0.6875rem] font-bold text-gray-600">Hero Subtitle</label>
                    <textarea
                      rows={2}
                      value={formState.servicesPageSettings?.heroSubtitle || ''}
                      onChange={(e) => setFormState({
                        ...formState,
                        servicesPageSettings: {
                          ...(formState.servicesPageSettings || { heroTitle: '', servicesList: [] }),
                          heroSubtitle: e.target.value
                        }
                      })}
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs bg-white font-bold"
                    />
                    <LocalizedTextFields
                      label={t('pgHeroSubtitleTranslations')}
                      fallback={formState.servicesPageSettings?.heroSubtitle || ''}
                      value={(formState.servicesPageSettings?.heroSubtitleI18n || {}) as LocalizedText}
                      onChange={(next) => setFormState((prev) => ({
                        ...prev,
                        servicesPageSettings: {
                          ...(prev.servicesPageSettings || { heroTitle: '', heroSubtitle: '', servicesList: [] }),
                          heroSubtitleI18n: Object.keys(next).length ? next : null,
                        },
                      }))}
                    />
                  </div>
                </div>

                {/* About Us Page */}
                <div className="p-5 bg-gray-50 rounded-2xl border border-gray-200/80 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-black text-sm text-gray-900">2. ABOUT US Page</span>
                    <a href="/about" target="_blank" rel="noreferrer" className="text-xs font-bold text-orange-600 hover:underline">
                      View Page ↗
                    </a>
                  </div>
                  <div>
                    <label className="block text-[0.6875rem] font-bold text-gray-600">Hero Title</label>
                    <input
                      type="text"
                      value={formState.aboutUsPageSettings?.heroTitle || ''}
                      onChange={(e) => setFormState({
                        ...formState,
                        aboutUsPageSettings: {
                          ...(formState.aboutUsPageSettings || { heroSubtitle: '', storyTitle: '', storyContent: '', mission: '', vision: '', bannerImageUrl: '', stats: [], teamMembers: [] }),
                          heroTitle: e.target.value
                        }
                      })}
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs bg-white font-bold"
                    />
                    <LocalizedTextFields
                      label={t('pgHeroTitleTranslations')}
                      fallback={formState.aboutUsPageSettings?.heroTitle || ''}
                      value={(formState.aboutUsPageSettings?.heroTitleI18n || {}) as LocalizedText}
                      onChange={(next) => setFormState((prev) => ({
                        ...prev,
                        aboutUsPageSettings: {
                          ...(prev.aboutUsPageSettings || { heroTitle: '', heroSubtitle: '', storyTitle: '', storyContent: '', mission: '', vision: '', bannerImageUrl: '', stats: [], teamMembers: [] }),
                          heroTitleI18n: Object.keys(next).length ? next : null,
                        },
                      }))}
                    />
                  </div>
                  <div>
                    <label className="block text-[0.6875rem] font-bold text-gray-600">Company Heritage & Story</label>
                    <textarea
                      rows={3}
                      value={formState.aboutUsPageSettings?.storyContent || ''}
                      onChange={(e) => setFormState({
                        ...formState,
                        aboutUsPageSettings: {
                          ...(formState.aboutUsPageSettings || { heroTitle: '', heroSubtitle: '', storyTitle: '', mission: '', vision: '', bannerImageUrl: '', stats: [], teamMembers: [] }),
                          storyContent: e.target.value
                        }
                      })}
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs bg-white font-bold"
                    />
                    <LocalizedTextFields
                      label={t('pgBodyTranslations')}
                      fallback={formState.aboutUsPageSettings?.storyContent || ''}
                      value={(formState.aboutUsPageSettings?.storyContentI18n || {}) as LocalizedText}
                      onChange={(next) => setFormState((prev) => ({
                        ...prev,
                        aboutUsPageSettings: {
                          ...(prev.aboutUsPageSettings || { heroTitle: '', heroSubtitle: '', storyTitle: '', storyContent: '', mission: '', vision: '', bannerImageUrl: '', stats: [], teamMembers: [] }),
                          storyContentI18n: Object.keys(next).length ? next : null,
                        },
                      }))}
                      multiline
                    />
                  </div>
                </div>

                {/* Contact Page */}
                <div className="p-5 bg-gray-50 rounded-2xl border border-gray-200/80 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-black text-sm text-gray-900">3. CONTACT Page</span>
                    <a href="/contact" target="_blank" rel="noreferrer" className="text-xs font-bold text-orange-600 hover:underline">
                      View Page ↗
                    </a>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[0.6875rem] font-bold text-gray-600">Phone / WhatsApp</label>
                      <input
                        type="text"
                        value={formState.contactPageSettings?.phone || formState.contactPhone || ''}
                        onChange={(e) => setFormState({
                          ...formState,
                          contactPhone: e.target.value,
                          contactPageSettings: {
                            ...(formState.contactPageSettings || { heroTitle: '', heroSubtitle: '', address: '', email: '', workingHours: '', faqList: [] }),
                            phone: e.target.value
                          }
                        })}
                        className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs bg-white font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-[0.6875rem] font-bold text-gray-600">Support Email</label>
                      <input
                        type="text"
                        value={formState.contactPageSettings?.email || formState.contactEmail || ''}
                        onChange={(e) => setFormState({
                          ...formState,
                          contactEmail: e.target.value,
                          contactPageSettings: {
                            ...(formState.contactPageSettings || { heroTitle: '', heroSubtitle: '', address: '', phone: '', workingHours: '', faqList: [] }),
                            email: e.target.value
                          }
                        })}
                        className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs bg-white font-bold"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[0.6875rem] font-bold text-gray-600">Physical Address</label>
                    <input
                      type="text"
                      value={formState.contactPageSettings?.address || ''}
                      onChange={(e) => setFormState({
                        ...formState,
                        contactPageSettings: {
                          ...(formState.contactPageSettings || { heroTitle: '', heroSubtitle: '', phone: '', email: '', workingHours: '', faqList: [] }),
                          address: e.target.value
                        }
                      })}
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs bg-white font-bold"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
          {activeTab === 'layout' && (
            <>
            {/* THE HOME PAGE'S ORDER (client, 2026-10-07: "order them") — dragged by the
                grip; saved with "Save & Apply" like every other setting here. */}
            <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-4" data-rx-home-order>
              <h3 className="text-base font-black text-gray-900 flex items-center border-b border-gray-100 pb-3">
                <Layout className="w-4 h-4 mr-2 text-rose-600" />
                Order of the home page
              </h3>
              <p className="text-[0.6875rem] font-bold text-gray-500">Drag a section by its grip to move it up or down the home page. A section switched off below keeps its place.</p>
              <SortableList
                ids={homeSectionOrder(formState.homeSectionOrder)}
                onReorder={(next) => setFormState({ ...formState, homeSectionOrder: next })}
                className="space-y-2"
                labelOf={(id) => HOME_SECTION_LABELS[id as HomeSectionId]?.label ?? id}
                renderItem={(id, { handle, index }) => {
                  const sec = HOME_SECTION_LABELS[id as HomeSectionId];
                  return (
                    <div className="flex items-center gap-3 p-3 rounded-2xl border border-gray-200 bg-gray-50/70" data-rx-home-section={id}>
                      <DragHandle handle={handle} label={`Drag "${sec?.label ?? id}"`} />
                      <span className="w-5 text-[0.6875rem] font-black text-gray-400 tabular-nums">{index + 1}</span>
                      <span className="min-w-0">
                        <span className="block text-xs font-black text-gray-900">{sec?.label ?? id}</span>
                        <span className="block text-[0.6875rem] font-bold text-gray-500">{sec?.desc}</span>
                      </span>
                    </div>
                  );
                }}
              />
            </div>

            <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-6">
              <h3 className="text-base font-black text-gray-900 flex items-center border-b border-gray-100 pb-3">
                <Layout className="w-4 h-4 mr-2 text-rose-600" />
                Homepage Section Visibility
              </h3>

              {/* Only the announcement bar ever obeyed its switch. The other four
                  were saved to Firestore and read by nothing: the owner switched a
                  section off, saved, reloaded the shop and it was still there. The
                  home page honours them now — except "Editor Promo Card", which is
                  gone from this list because there is no editor promo card on the
                  home page for it to hide. The descriptions name the sections as
                  they actually appear on the page. */}
              <div className="space-y-3">
                {[
                  { key: 'showAnnouncementBar', label: 'Announcement Bar', desc: 'Top banner above header' },
                  { key: 'showHero', label: 'Hero Section', desc: 'Big carousel banner at the top of the home page' },
                  { key: 'showCategoriesSection', label: 'Categories Grid', desc: 'Grid of product categories' },
                  { key: 'showStatsSection', label: 'Stats Bar', desc: 'The 24/7, 450+ and lead-time row' },
                ].map((sec) => (
                  /* THE SWITCH AND WHAT IT SWITCHES ON, TOGETHER.
                     The owner's client found this panel, turned the announcement
                     bar on, and had nowhere to type what it says: the text box
                     lives on the "Homepage Texts & Copy" tab, which he had no
                     reason to open. Same value, same Save — it is simply also
                     here, under the switch that reveals it. */
                  <React.Fragment key={sec.key}>
                  <div
                    className="flex items-center justify-between p-4 bg-gray-50/70 rounded-2xl border border-gray-200/80 hover:bg-white transition-all"
                  >
                    <div>
                      <span className="block text-xs font-black text-gray-900">{sec.label}</span>
                      <span className="text-[0.6875rem] font-bold text-gray-500">{sec.desc}</span>
                    </div>

                    <button
                      type="button"
                      onClick={() => setFormState({ ...formState, [sec.key]: !formState[sec.key as keyof SiteSettings] })}
                      className={cn(
                        "w-12 h-6 rounded-full transition-colors relative p-0.5",
                        formState[sec.key as keyof SiteSettings] ? "bg-emerald-500" : "bg-gray-300"
                      )}
                    >
                      <div
                        className={cn(
                          "w-5 h-5 bg-white rounded-full transition-transform shadow-sm",
                          formState[sec.key as keyof SiteSettings] ? "translate-x-6" : "translate-x-0"
                        )}
                      />
                    </button>
                  </div>

                  {sec.key === 'showAnnouncementBar' && formState.showAnnouncementBar && (
                    <div className="ml-4 mr-1 -mt-1 mb-1 p-4 bg-white rounded-2xl border border-gray-200/80 space-y-3">
                      <div>
                        <label className="block text-xs font-black text-gray-700 mb-1">Announcement Bar Text</label>
                        <input
                          type="text"
                          value={formState.announcementText}
                          onChange={(e) => setFormState({ ...formState, announcementText: e.target.value })}
                          className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-xs font-bold text-gray-900 outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        {/* The first line of text on every page in the shop, so it
                            is never left in one language. */}
                        <LocalizedTextFields
                          label={t('scAnnouncementTranslations')}
                          fallback={formState.announcementText}
                          value={(formState.announcementTextI18n || {}) as LocalizedText}
                          onChange={(next) => setFormState((prev) => ({ ...prev, announcementTextI18n: Object.keys(next).length ? next : null }))}
                        />
                      </div>
                      {/* The bar and its discount code switch off together (2026-10-15). */}
                      <div>
                        <label className="block text-xs font-black text-gray-700 mb-1">{t('scAnnouncementCoupon')}</label>
                        <input
                          type="text"
                          value={formState.announcementCouponCode || ''}
                          onChange={(e) => setFormState({ ...formState, announcementCouponCode: e.target.value.toUpperCase().replace(/\s+/g, '') })}
                          placeholder="PRINT15"
                          data-rx-announcement-coupon
                          className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-xs font-bold text-gray-900 outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <p className="text-[0.625rem] text-gray-500 mt-1">{t('scAnnouncementCouponNote')}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <label className="text-xs font-black text-gray-700">Background</label>
                        <input
                          type="color"
                          value={formState.announcementBg || '#1e293b'}
                          onChange={(e) => setFormState({ ...formState, announcementBg: e.target.value })}
                          className="h-8 w-16 rounded-lg border border-gray-200 cursor-pointer"
                        />
                        <span className="text-[0.6875rem] font-bold text-gray-400">{formState.announcementBg || '#1e293b'}</span>
                      </div>
                    </div>
                  )}
                  </React.Fragment>
                ))}
              </div>
            </div>

            {/* THE PRODUCT PAGE — the row of suggested products under every
                product (round 16, item 10). His picks are made per product, in
                the product dialog; this is what happens around them. */}
            <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-4" data-rx-suggestion-settings>
              <div className="border-b border-gray-100 pb-3">
                <h3 className="text-base font-black text-gray-900 flex items-center">
                  <Layout className="w-4 h-4 mr-2 text-orange-600" />
                  Product page — suggested products
                </h3>
                <p className="text-[0.6875rem] text-gray-500 mt-1">
                  A row of four products under every product. Pick them per product in Products Admin → Edit → &ldquo;Suggested products&rdquo;.
                </p>
              </div>
              <div className="space-y-2" role="radiogroup" aria-label="Suggested products under each product">
                {([
                  { value: 'fill', label: 'My picks, then products from the same category', desc: 'A product with fewer than four picks is filled with the products after it in its category.' },
                  { value: 'picks', label: 'Only my picks', desc: 'A product you picked nothing for shows no row.' },
                  { value: 'off', label: 'Off', desc: 'No suggestions under any product.' },
                ] as const).map((choice) => (
                  <label
                    key={choice.value}
                    className={cn(
                      'flex items-start gap-3 p-3.5 rounded-2xl border cursor-pointer transition-colors',
                      suggestionModeOf(formState.productSuggestions) === choice.value ? 'border-orange-300 bg-orange-50/60' : 'border-gray-200 bg-gray-50/70 hover:bg-white',
                    )}
                  >
                    <input
                      type="radio"
                      name="productSuggestions"
                      value={choice.value}
                      checked={suggestionModeOf(formState.productSuggestions) === choice.value}
                      onChange={() => setFormState({ ...formState, productSuggestions: choice.value })}
                      className="mt-0.5 w-4 h-4 accent-orange-600"
                    />
                    <span>
                      <span className="block text-xs font-black text-gray-900">{choice.label}</span>
                      <span className="block text-[0.6875rem] font-bold text-gray-500">{choice.desc}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* Payment icons (footer) */}
            <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-5">
              <div className="border-b border-gray-100 pb-3">
                <h3 className="text-base font-black text-gray-900 flex items-center">
                  <CreditCard className="w-4 h-4 mr-2 text-sky-600" />
                  Payment icons (footer)
                </h3>
                <p className="text-[0.6875rem] text-gray-500 mt-1">
                  Shown as a row of badges above the footer copyright line. Remove all of them to hide the row.
                </p>
              </div>

              {/* AUTOMATIC, FROM MOLLIE.
                  The list below is kept by hand, which is how this footer came
                  to advertise Klarna but not PayPal while both were live in the
                  Mollie account. Switched on, the badges are whatever Mollie
                  says is enabled, drawn with Mollie's own logos — enable a
                  method there and it appears here by itself. The hand-kept list
                  stays as the fallback if Mollie cannot be reached. */}
              <label className="flex items-start gap-3 p-3 rounded-2xl border border-sky-200 bg-sky-50/60 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formState.footerPaymentIconsAuto === true}
                  onChange={(e) => setFormState({ ...formState, footerPaymentIconsAuto: e.target.checked })}
                  className="w-4 h-4 mt-0.5 rounded accent-sky-600 cursor-pointer shrink-0"
                />
                <span>
                  <span className="block text-xs font-black text-gray-900">
                    Show the methods my Mollie account accepts, automatically
                  </span>
                  <span className="block text-[0.6875rem] text-gray-500 mt-0.5">
                    Uses Mollie's own logos, exactly as they appear on the payment page. Enable
                    a method in Mollie and it shows up here on its own — nothing to add below.
                    The list underneath is then only used if Mollie cannot be reached.
                  </span>
                </span>
              </label>

              {/* Current entries: preview, reorder, delete */}
              <div className="space-y-2">
                {(formState.footerPaymentIcons || []).length === 0 && (
                  <p className="text-xs font-bold text-gray-400 text-center py-3">
                    No payment icons yet — the footer row is hidden.
                  </p>
                )}
                {(formState.footerPaymentIcons || []).map((entry, idx, arr) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between p-3 bg-gray-50/70 rounded-2xl border border-gray-200/80"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <PaymentIconBadge entry={entry} />
                      <span className="text-xs font-black text-gray-800 truncate">
                        {entry.builtin ? BUILTIN_PAYMENT_ICON_LABELS[entry.builtin] : (entry.label || 'Custom icon')}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => movePaymentIcon(idx, -1)}
                        disabled={idx === 0}
                        title="Move up"
                        className="p-1.5 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-white border border-transparent hover:border-gray-200 transition-all disabled:opacity-30 disabled:pointer-events-none"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => movePaymentIcon(idx, 1)}
                        disabled={idx === arr.length - 1}
                        title="Move down"
                        className="p-1.5 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-white border border-transparent hover:border-gray-200 transition-all disabled:opacity-30 disabled:pointer-events-none"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removePaymentIcon(idx)}
                        title="Remove"
                        className="p-1.5 rounded-lg text-red-500 hover:text-red-700 hover:bg-red-50 transition-all"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Add a builtin mark */}
              <div className="pt-4 border-t border-gray-100 space-y-4">
                <div>
                  <label className="block text-xs font-black text-gray-700 mb-1">Add a built-in icon</label>
                  {availableBuiltinIcons.length > 0 ? (
                    <div className="flex items-center gap-2">
                      <select
                        value={builtinIconToAdd}
                        onChange={(e) => setBuiltinIconToAdd(e.target.value as BuiltinPaymentIcon | '')}
                        className="flex-1 px-3 py-2.5 border border-gray-200 rounded-xl text-xs font-bold text-gray-900 bg-white outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">Choose a payment method…</option>
                        {availableBuiltinIcons.map((b) => (
                          <option key={b} value={b}>{BUILTIN_PAYMENT_ICON_LABELS[b]}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={addBuiltinPaymentIcon}
                        disabled={!builtinIconToAdd}
                        className="px-3.5 py-2.5 bg-gray-900 text-white text-xs font-black rounded-xl hover:bg-gray-800 transition-all flex items-center disabled:opacity-40"
                      >
                        <Plus className="w-3.5 h-3.5 mr-1" />
                        Add
                      </button>
                    </div>
                  ) : (
                    <p className="text-[0.6875rem] font-bold text-gray-400">All built-in icons are already in the list.</p>
                  )}
                </div>

                {/* Or a custom image */}
                <div className="p-4 bg-gray-50 rounded-2xl border border-gray-200 space-y-2">
                  <span className="block text-xs font-black text-gray-800">Or add a custom icon</span>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={customIconLabel}
                      onChange={(e) => setCustomIconLabel(e.target.value)}
                      placeholder="Label (e.g. Bank transfer)"
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs font-bold text-gray-900 bg-white outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <input
                      type="text"
                      value={customIconUrl}
                      onChange={(e) => setCustomIconUrl(e.target.value)}
                      placeholder="Image URL (https://...)"
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs font-mono text-gray-900 bg-white outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={addCustomPaymentIcon}
                    disabled={!customIconUrl.trim()}
                    className="px-3.5 py-2 bg-gray-900 text-white text-xs font-black rounded-xl hover:bg-gray-800 transition-all flex items-center disabled:opacity-40"
                  >
                    <Plus className="w-3.5 h-3.5 mr-1" />
                    Add Custom Icon
                  </button>
                </div>
              </div>
            </div>
            </>
          )}

        </div>

        {/* Right Column: Live Interactive Device Preview (5 cols) */}
        <div className="lg:col-span-5">
          <div className="sticky top-24 space-y-4">
            <div className="flex items-center justify-between bg-white px-5 py-3 rounded-2xl border border-gray-100 shadow-2xs">
              <div className="flex items-center space-x-2 text-xs font-black text-gray-800">
                <Eye className="w-4 h-4 text-blue-600" />
                <span>Live Website Preview</span>
              </div>
              <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[0.625rem] font-black">
                Live Sync
              </span>
            </div>

            {/* Simulated Website Frame */}
            <div className="bg-white rounded-3xl border-2 border-gray-200 shadow-xl overflow-hidden text-left select-none">
              
              {/* Simulated Browser Bar */}
              <div className="bg-gray-100 px-4 py-2 border-b border-gray-200 flex items-center justify-between">
                <div className="flex space-x-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
                  <div className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                </div>
                <div className="bg-white text-[0.625rem] font-mono text-gray-500 px-3 py-0.5 rounded-md border border-gray-200 truncate max-w-[11.25rem]">
                  https://{formState.siteName.toLowerCase().replace(/\s+/g, '')}.com
                </div>
              </div>

              {/* Live Announcement Bar */}
              {formState.showAnnouncementBar && (
                <div 
                  className="px-3 py-1.5 text-[0.625rem] font-bold text-center text-white truncate"
                  style={{ backgroundColor: formState.announcementBg || '#1e293b' }}
                >
                  {formState.announcementText}
                </div>
              )}

              {/* Live Header Navbar */}
              <div 
                className={cn(
                  "px-4 py-3 border-b flex items-center justify-between transition-colors",
                  formState.navbarBg === 'dark' ? "bg-gray-900 text-white border-gray-800" : "bg-white text-gray-900 border-gray-100"
                )}
              >
                <div className="flex items-center space-x-2">
                  {formState.logoType === 'image' && formState.logoUrl ? (
                    <img src={formState.logoUrl} alt="Logo" className="h-6 object-contain" />
                  ) : formState.logoType === 'text_and_icon' ? (
                    <>
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white shadow-xs" style={{ backgroundColor: formState.primaryColor }}>
                        <Printer className="w-4 h-4" />
                      </div>
                      <span className="font-black text-sm tracking-tight">{formState.siteName}</span>
                    </>
                  ) : (
                    <span className="font-black text-sm tracking-tight">{formState.siteName}</span>
                  )}
                </div>

                <div className="flex items-center space-x-2">
                  <span className="text-[0.625rem] font-bold opacity-60">Home</span>
                  <span className="text-[0.625rem] font-bold opacity-60">Products</span>
                  <button 
                    className="px-2.5 py-1 text-[0.625rem] font-black text-white rounded-lg shadow-xs"
                    style={{ backgroundColor: formState.primaryColor }}
                  >
                    Login
                  </button>
                </div>
              </div>

              {/* Live Hero Section — the first carousel slide, because that is what
                  the home page actually paints. This preview used to show a title,
                  a subtitle and two CTA buttons taken from the Texts tab, none of
                  which the site has ever rendered: the owner watched the mock
                  change and then found the real hero untouched. */}
              {formState.showHero && (
                <div className="relative p-6 bg-gray-900 text-white min-h-[13.75rem] flex flex-col justify-center overflow-hidden">
                  <img src={formState.heroSlides?.[0]?.imageUrl || formState.heroImageUrl} className="absolute inset-0 w-full h-full object-cover opacity-30" />
                  <div className="absolute inset-0 bg-gradient-to-r from-gray-950 via-gray-900/80 to-transparent" />

                  <div className="relative z-10 space-y-2">
                    {formState.heroSlides?.[0]?.badge && (
                      <span className="inline-block px-2 py-0.5 rounded-full bg-orange-600 text-white text-[0.5625rem] font-black uppercase tracking-wide">
                        {formState.heroSlides?.[0]?.badge}
                      </span>
                    )}
                    <h3 className="text-xl font-black leading-tight text-white">
                      {formState.heroSlides?.[0]?.title}
                    </h3>
                    <p className="text-[0.6875rem] text-gray-300 line-clamp-2 max-w-xs">
                      {formState.heroSlides?.[0]?.subtitle}
                    </p>
                  </div>
                </div>
              )}

              {/* Live Footer */}
              <div className="bg-gray-100 p-3 text-center border-t border-gray-200 text-[0.625rem] text-gray-500 font-bold">
                <PaymentIcons entries={formState.footerPaymentIcons} className="mb-2" />
                {formState.footerText}
              </div>

            </div>
          </div>
        </div>

      </div>
      {confirmDialog}

      {/* Choosing a picture fills the field. Nothing reaches the site until he
          presses Save, exactly as when he types a URL. */}
      <MediaPickerModal
        open={picker !== null}
        onClose={() => setPicker(null)}
        onPick={(url) => {
          if (!picker) return;
          if (picker.kind === 'hero') {
            const slides = [...(formState.heroSlides || [])];
            if (slides[picker.index]) {
              slides[picker.index] = { ...slides[picker.index], imageUrl: url };
              // heroImageUrl is the FIRST slide's picture and is read on its own
              // elsewhere; the typed input keeps them in step and so must this.
              setFormState({
                ...formState,
                heroSlides: slides,
                heroImageUrl: picker.index === 0 ? url : formState.heroImageUrl,
              });
            }
          } else {
            const cards = [...(formState.bentoCards || [])];
            if (cards[picker.index]) {
              cards[picker.index] = { ...cards[picker.index], imageUrl: url };
              setFormState({ ...formState, bentoCards: cards });
            }
          }
        }}
      />
    </div>
  );
}
