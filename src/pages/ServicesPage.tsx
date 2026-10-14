import React, { useEffect, useState } from 'react';
import { useSiteSettings, ServiceItem } from '../context/SiteSettingsContext';
import { holdReloads } from '../lib/reloadHold';
import { useAuth } from '../App';
import { localized } from '../lib/localizedText';
import { LocalizedTextFields } from '../components/Admin/LocalizedTextFields';
import type { LocalizedText } from '../types';
import { Link } from 'react-router-dom';
import { 
  Printer, 
  Box, 
  Layers, 
  Tag, 
  UploadCloud, 
  Truck, 
  Sparkles, 
  CheckCircle2, 
  Check,
  ArrowRight, 
  Edit3, 
  Plus, 
  Trash2, 
  X, 
  Save, 
  Search,
  ShieldCheck,
  Clock,
  Palette
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import SafeImage from '../components/SafeImage';

// TEMPORARILY OFF (2026-10-13): the "Upload file" link beside each service.
// Set to true to bring every one of them back.
const SHOW_UPLOAD_LINK = false;

export default function ServicesPage() {
  const { settings, updateSettings } = useSiteSettings();
  const { user, t, language } = useAuth();
  const isAdmin = user?.role === 'admin';

  const servicesData = settings.servicesPageSettings || {
    heroTitle: t('svcDefaultHeroTitle'),
    heroSubtitle: t('svcDefaultHeroSubtitle'),
    servicesList: []
  };

  const [searchQuery, setSearchQuery] = useState('');
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  // The shop reloads this page by itself after a deploy (BuildWatcher): not while
  // the owner has the editor open, with his changes not yet saved.
  useEffect(() => (isEditModalOpen ? holdReloads() : undefined), [isEditModalOpen]);

  // Editable Form State
  const [editHeroTitle, setEditHeroTitle] = useState(servicesData.heroTitle);
  const [editHeroSubtitle, setEditHeroSubtitle] = useState(servicesData.heroSubtitle);
  const [editHeroTitleI18n, setEditHeroTitleI18n] = useState<LocalizedText>((servicesData.heroTitleI18n || {}) as LocalizedText);
  const [editHeroSubtitleI18n, setEditHeroSubtitleI18n] = useState<LocalizedText>((servicesData.heroSubtitleI18n || {}) as LocalizedText);
  const [editList, setEditList] = useState<ServiceItem[]>(servicesData.servicesList);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Every field is optional in practice: a service row saved from the dashboard
  // with the description left blank used to throw on the first keystroke in the
  // search box and take the whole page down with it.
  const needle = searchQuery.trim().toLowerCase();
  const filteredServices = (servicesData.servicesList ?? []).filter((s) =>
    !needle ||
    [s?.title, s?.description, s?.subtitle].some((v) => String(v ?? '').toLowerCase().includes(needle)),
  );

  const getIconComponent = (iconName: string) => {
    switch (iconName) {
      case 'Box': return <Box className="w-6 h-6" />;
      case 'Layers': return <Layers className="w-6 h-6" />;
      case 'Tag': return <Tag className="w-6 h-6" />;
      case 'UploadCloud': return <UploadCloud className="w-6 h-6" />;
      case 'Truck': return <Truck className="w-6 h-6" />;
      case 'Sparkles': return <Sparkles className="w-6 h-6" />;
      case 'Palette': return <Palette className="w-6 h-6" />;
      default: return <Printer className="w-6 h-6" />;
    }
  };

  // A save can be refused (no connection, the database's daily limit): the editor
  // stays open with what he typed, and says so. updateSettings rethrows, and this
  // used to stay on "saving" for good with nothing said (code review 2026-10-11,
  // REVIEW-3 #6).
  const handleSaveServices = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await updateSettings({
        servicesPageSettings: {
          heroTitle: editHeroTitle,
          heroSubtitle: editHeroSubtitle,
          // Always assign: this document is written with a merge, so an omitted
          // key would keep a translation the owner has just cleared.
          heroTitleI18n: Object.keys(editHeroTitleI18n).length ? editHeroTitleI18n : null,
          heroSubtitleI18n: Object.keys(editHeroSubtitleI18n).length ? editHeroSubtitleI18n : null,
          servicesList: editList
        }
      });
      setIsEditModalOpen(false);
    } catch {
      setSaveError(t('pgEditSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleAddServiceItem = () => {
    const newItem: ServiceItem = {
      id: 'srv_' + Date.now(),
      title: t('svcNewItemTitle'),
      subtitle: t('svcNewItemSubtitle'),
      description: t('svcNewItemDescription'),
      icon: 'Printer',
      imageUrl: 'https://images.pexels.com/photos/9550363/pexels-photo-9550363.jpeg?auto=compress&cs=tinysrgb&w=1200',
      features: [t('svcNewItemFeature1'), t('svcNewItemFeature2'), t('svcNewItemFeature3')]
    };
    setEditList([...editList, newItem]);
  };

  return (
    <div className="min-h-screen bg-gray-50/50 pb-20">
      {/* Hero Header */}
      <div className="bg-gradient-to-br from-gray-900 via-gray-900 to-orange-950 text-white relative overflow-hidden py-16 md:py-24 px-4 sm:px-6 lg:px-8">
        <div className="absolute top-0 right-0 w-96 h-96 bg-orange-600/10 rounded-full blur-3xl pointer-events-none" />
        <div className="max-w-7xl mx-auto relative z-10">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="max-w-3xl">
              <h1 className="text-3xl sm:text-4xl md:text-5xl font-black text-white tracking-tight">
                {localized(servicesData.heroTitle, servicesData.heroTitleI18n, language)}
              </h1>
              <p className="mt-4 text-base md:text-lg text-gray-300 leading-relaxed font-medium">
                {localized(servicesData.heroSubtitle, servicesData.heroSubtitleI18n, language)}
              </p>
            </div>

            {/* Admin Quick Edit Button */}
            {isAdmin && (
              <div className="shrink-0">
                <button
                  onClick={() => {
                    setEditHeroTitle(servicesData.heroTitle);
                    setEditHeroSubtitle(servicesData.heroSubtitle);
                    setEditList(servicesData.servicesList);
                    setEditHeroTitleI18n((servicesData.heroTitleI18n || {}) as LocalizedText);
                    setEditHeroSubtitleI18n((servicesData.heroSubtitleI18n || {}) as LocalizedText);
                    setSaveError(null);
                    setIsEditModalOpen(true);
                  }}
                  className="bg-orange-600 hover:bg-orange-500 text-white text-xs font-black px-5 py-3 rounded-2xl shadow-lg shadow-orange-600/30 flex items-center space-x-2 transition-all active:scale-95 cursor-pointer"
                >
                  <Edit3 className="w-4 h-4" />
                  <span>{t('svcAdminEditInfo')}</span>
                </button>
              </div>
            )}
          </div>

          {/* Search Box */}
          <div className="mt-8 max-w-xl">
            <div className="relative">
              <Search className="w-5 h-5 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" />
              <input 
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('svcSearchPlaceholder')}
                className="w-full bg-gray-800/90 border border-gray-700/80 rounded-2xl pl-11 pr-4 py-3.5 text-sm text-white placeholder-gray-400 focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 transition-all"
              />
            </div>
          </div>
        </div>
      </div>

      {/* THE SERVICES AS CHAPTERS, not a grid of identical cards (2026-10-13:
          "less generic"). One service per row, its picture large and on
          alternating sides, the subtitle as an eyebrow
          above the title, the features in two columns with gold ticks — the
          brand's own colour, not a generic green. Rows are separated by space
          and a hairline, not by boxes: it reads like a printed brochure. */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 md:pt-20">
        <div className="divide-y divide-gray-200/80">
          {filteredServices.map((service, index) => {
            const title = localized(service.title, service.titleI18n, language);
            const subtitle = localized(service.subtitle || '', service.subtitleI18n, language);
            const flipped = index % 2 === 1;
            return (
              <motion.article
                key={service.id || index}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-80px' }}
                transition={{ duration: 0.5 }}
                className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-14 items-center py-14 md:py-20 first:pt-0 group"
              >
                {/* The picture — or, without one, the service's icon large on a dark panel */}
                <div className={cn('lg:col-span-7', flipped && 'lg:order-2')}>
                  <div className="relative aspect-[4/3] rounded-[2rem] overflow-hidden bg-gray-900">
                    {service.imageUrl ? (
                      <SafeImage
                        src={service.imageUrl}
                        alt={title}
                        className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.03]"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-900 to-gray-800 text-orange-500 [&>svg]:w-20 [&>svg]:h-20 [&>svg]:stroke-[1.25]">
                        {getIconComponent(service.icon)}
                      </div>
                    )}
                  </div>
                </div>

                {/* The words */}
                <div className={cn('lg:col-span-5', flipped && 'lg:order-1')}>
                  {subtitle && (
                    <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.18em] text-orange-700">
                      {subtitle}
                    </p>
                  )}
                  <h2 className="mt-2 text-2xl md:text-3xl font-black text-gray-900 tracking-tight leading-tight">
                    {title}
                  </h2>
                  <p className="mt-4 text-[0.9375rem] text-gray-600 leading-relaxed max-w-prose">
                    {localized(service.description, service.descriptionI18n, language)}
                  </p>

                  {service.features && service.features.length > 0 && (
                    <ul className="mt-7 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
                      {service.features.map((feat, fIdx) => (
                        <li key={fIdx} className="flex items-start gap-2.5 text-sm text-gray-700">
                          <span className="mt-0.5 w-5 h-5 rounded-full bg-orange-100 ring-1 ring-orange-200/80 flex items-center justify-center shrink-0">
                            <Check className="w-3 h-3 text-orange-700" strokeWidth={3} />
                          </span>
                          <span className="leading-snug">{feat}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-3">
                    <Link
                      to="/products"
                      className="inline-flex items-center gap-2 bg-gray-900 hover:bg-orange-600 text-white text-sm font-bold px-6 py-3.5 rounded-full transition-colors"
                    >
                      <span>{t('svcExploreCatalog')}</span>
                      <ArrowRight className="w-4 h-4" />
                    </Link>
                    {SHOW_UPLOAD_LINK && (
                      <Link
                        to="/custom-upload"
                        title={t('svcUploadFileTitle')}
                        className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-700 hover:text-orange-600 transition-colors"
                      >
                        <UploadCloud className="w-4 h-4" />
                        <span>{t('svcUploadFile')}</span>
                      </Link>
                    )}
                  </div>
                </div>
              </motion.article>
            );
          })}
        </div>

        {filteredServices.length === 0 && (
          <div className="bg-white rounded-3xl p-12 text-center border border-gray-200 mt-6 space-y-3">
            <Printer className="w-12 h-12 text-gray-400 mx-auto" />
            <h3 className="text-lg font-black text-gray-800">{t('svcNoResultsTitle')}</h3>
            <p className="text-xs text-gray-500">{t('svcNoResultsBody')}</p>
          </div>
        )}
      </div>

      {/* Admin Edit Services Modal */}
      <AnimatePresence>
        {isEditModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl max-w-4xl w-full max-h-[90vh] overflow-y-auto p-6 md:p-8 shadow-2xl space-y-6 border border-gray-200"
            >
              <div className="flex items-center justify-between border-b border-gray-100 pb-4">
                <div>
                  <h2 className="text-xl font-black text-gray-900">{t('svcModalTitle')}</h2>
                  <p className="text-xs text-gray-500">{t('svcModalSubtitle')}</p>
                </div>
                <button
                  onClick={() => setIsEditModalOpen(false)}
                  className="p-2 text-gray-400 hover:text-gray-900 rounded-xl hover:bg-gray-100 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Form Fields */}
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-black text-gray-700 mb-1">{t('svcModalHeroTitleLabel')}</label>
                  <input
                    type="text"
                    value={editHeroTitle}
                    onChange={(e) => setEditHeroTitle(e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-xs font-bold text-gray-900 outline-none focus:ring-2 focus:ring-orange-500"
                  />
                  <LocalizedTextFields
                    label={t('pgHeroTitleTranslations')}
                    fallback={editHeroTitle}
                    value={editHeroTitleI18n}
                    onChange={setEditHeroTitleI18n}
                  />
                </div>

                <div>
                  <label className="block text-xs font-black text-gray-700 mb-1">{t('svcModalHeroSubtitleLabel')}</label>
                  <textarea
                    rows={2}
                    value={editHeroSubtitle}
                    onChange={(e) => setEditHeroSubtitle(e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-xs font-bold text-gray-900 outline-none focus:ring-2 focus:ring-orange-500"
                  />
                  <LocalizedTextFields
                    label={t('pgHeroSubtitleTranslations')}
                    fallback={editHeroSubtitle}
                    value={editHeroSubtitleI18n}
                    onChange={setEditHeroSubtitleI18n}
                  />
                </div>

                {/* Service Cards List Editor */}
                <div className="space-y-4 pt-4 border-t border-gray-100">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-black text-gray-900">{t('svcModalCardsHeading')} ({editList.length})</h3>
                    <button
                      type="button"
                      onClick={handleAddServiceItem}
                      className="px-3.5 py-2 bg-orange-600 text-white text-xs font-black rounded-xl hover:bg-orange-500 transition-all flex items-center cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5 mr-1" />
                      {t('svcModalAddCard')}
                    </button>
                  </div>

                  <div className="space-y-4">
                    {editList.map((item, idx) => (
                      <div key={item.id || idx} className="p-4 bg-gray-50 rounded-2xl border border-gray-200 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-black text-orange-600">{t('svcModalCardNumber').replace('{0}', String(idx + 1))}</span>
                          <button
                            type="button"
                            onClick={() => setEditList(editList.filter((_, i) => i !== idx))}
                            className="text-red-500 hover:text-red-700 text-xs font-bold flex items-center cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5 mr-1" />
                            {t('svcModalDeleteCard')}
                          </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[0.6875rem] font-bold text-gray-600">{t('svcModalTitleLabel')}</label>
                            <input
                              type="text"
                              value={item.title}
                              onChange={(e) => {
                                const copy = [...editList];
                                copy[idx].title = e.target.value;
                                setEditList(copy);
                              }}
                              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs font-bold bg-white"
                            />
                            <LocalizedTextFields
                              label={t('pgHeroTitleTranslations')}
                              fallback={item.title || ''}
                              value={(item.titleI18n || {}) as LocalizedText}
                              onChange={(next) => {
                                // The updater form: the AI button can deliver this seconds
                                // later, and a captured editList would revert anything typed
                                // into the other cards while it was spinning.
                                setEditList((prev) => {
                                  const copy = [...prev];
                                  if (!copy[idx]) return prev;
                                  copy[idx] = { ...copy[idx], titleI18n: Object.keys(next).length ? next : null };
                                  return copy;
                                });
                              }}
                            />
                          </div>

                          <div>
                            <label className="block text-[0.6875rem] font-bold text-gray-600">{t('svcModalSubtitleLabel')}</label>
                            <input
                              type="text"
                              value={item.subtitle || ''}
                              onChange={(e) => {
                                const copy = [...editList];
                                copy[idx].subtitle = e.target.value;
                                setEditList(copy);
                              }}
                              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs font-bold bg-white"
                            />
                            <LocalizedTextFields
                              label={t('pgHeroSubtitleTranslations')}
                              fallback={item.subtitle || ''}
                              value={(item.subtitleI18n || {}) as LocalizedText}
                              onChange={(next) => {
                                // The updater form: the AI button can deliver this seconds
                                // later, and a captured editList would revert anything typed
                                // into the other cards while it was spinning.
                                setEditList((prev) => {
                                  const copy = [...prev];
                                  if (!copy[idx]) return prev;
                                  copy[idx] = { ...copy[idx], subtitleI18n: Object.keys(next).length ? next : null };
                                  return copy;
                                });
                              }}
                            />
                          </div>
                        </div>

                        <div>
                          <label className="block text-[0.6875rem] font-bold text-gray-600">{t('svcModalDescriptionLabel')}</label>
                          <textarea
                            rows={2}
                            value={item.description}
                            onChange={(e) => {
                              const copy = [...editList];
                              copy[idx].description = e.target.value;
                              setEditList(copy);
                            }}
                            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs font-bold bg-white"
                          />
                          <LocalizedTextFields
                            label={t('pgBodyTranslations')}
                            fallback={item.description || ''}
                            value={(item.descriptionI18n || {}) as LocalizedText}
                            onChange={(next) => {
                              // The updater form: the AI button can deliver this seconds
                              // later, and a captured editList would revert anything typed
                              // into the other cards while it was spinning.
                              setEditList((prev) => {
                                const copy = [...prev];
                                if (!copy[idx]) return prev;
                                copy[idx] = { ...copy[idx], descriptionI18n: Object.keys(next).length ? next : null };
                                return copy;
                              });
                            }}
                          />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[0.6875rem] font-bold text-gray-600">{t('svcModalIconLabel')}</label>
                            <select
                              value={item.icon}
                              onChange={(e) => {
                                const copy = [...editList];
                                copy[idx].icon = e.target.value;
                                setEditList(copy);
                              }}
                              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs font-bold bg-white"
                            >
                              <option value="Printer">{t('svcIconPrinter')}</option>
                              <option value="Box">{t('svcIconBox')}</option>
                              <option value="Layers">{t('svcIconLayers')}</option>
                              <option value="Tag">{t('svcIconTag')}</option>
                              <option value="UploadCloud">{t('svcIconUploadCloud')}</option>
                              <option value="Truck">{t('svcIconTruck')}</option>
                              <option value="Palette">{t('svcIconPalette')}</option>
                              <option value="Sparkles">{t('svcIconSparkles')}</option>
                            </select>
                          </div>

                          <div>
                            <label className="block text-[0.6875rem] font-bold text-gray-600">{t('svcModalImageUrlLabel')}</label>
                            <input
                              type="text"
                              value={item.imageUrl || ''}
                              onChange={(e) => {
                                const copy = [...editList];
                                copy[idx].imageUrl = e.target.value;
                                setEditList(copy);
                              }}
                              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs font-bold bg-white"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="block text-[0.6875rem] font-bold text-gray-600">{t('svcModalFeaturesLabel')}</label>
                          <input
                            type="text"
                            value={item.features.join(', ')}
                            onChange={(e) => {
                              const copy = [...editList];
                              copy[idx].features = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                              setEditList(copy);
                            }}
                            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs font-bold bg-white"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {saveError && (
                <p role="alert" className="text-xs font-bold text-red-700 bg-red-50 border border-red-100 rounded-xl px-3 py-2.5" data-rx-page-edit-error>
                  {saveError}
                </p>
              )}

              {/* Save Actions */}
              <div className="flex items-center justify-end space-x-3 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="px-5 py-2.5 rounded-xl border border-gray-200 text-xs font-bold text-gray-600 hover:bg-gray-50"
                >
                  {t('svcModalCancel')}
                </button>
                <button
                  type="button"
                  onClick={handleSaveServices}
                  disabled={saving}
                  className="px-6 py-2.5 bg-orange-600 hover:bg-orange-500 text-white text-xs font-black rounded-xl shadow-md flex items-center space-x-2 disabled:opacity-50"
                >
                  {saving ? (
                    <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  <span>{t('svcModalSave')}</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
