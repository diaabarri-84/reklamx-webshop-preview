import React, { useState } from 'react';
import { useSiteSettings, ContactPageSettings } from '../context/SiteSettingsContext';
import { useAuth } from '../App';
import { localized } from '../lib/localizedText';
import { LocalizedTextFields } from '../components/Admin/LocalizedTextFields';
import type { LocalizedText } from '../types';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clock,
  Edit3,
  HelpCircle,
  Mail,
  MapPin,
  Phone,
  Plus,
  Save,
  Send,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';

/** The print shop customers can visit (the owner, 2026-10-14). Used until an address is entered in the dashboard. */
const PRINT_SHOP_ADDRESS = 'Flintyxegatan 9, 213 76 Malmö';

export default function ContactPage() {
  const { settings, updateSettings } = useSiteSettings();
  const { user, t, language } = useAuth();
  const isAdmin = user?.role === 'admin';

  // No invented facts in the fallback: this once carried a street address that
  // does not exist and a Maps pin on a random block. Empty fields hide their
  // cards below instead.
  const pageSettings = settings.contactPageSettings || {
    heroTitle: t('contactDefaultHeroTitle'),
    heroSubtitle: t('contactDefaultHeroSubtitle'),
    address: '',
    phone: '',
    email: '',
    workingHours: t('contactDefaultWorkingHours'),
    googleMapsEmbedUrl: '',
    faqList: []
  };
  // Addresses are stored as one comma-separated line. Split it back apart so
  // the card reads like an envelope; an address entered with real line breaks
  // is honoured as typed.
  const addressLines = (raw: string) =>
    (raw.includes('\n') ? raw.split('\n') : raw.split(','))
      .map((part) => part.trim())
      .filter(Boolean);

  // Contact details fall back to the company-wide settings, so the number and
  // address entered once in Site Settings appear here without retyping them.
  const contactData = {
    ...pageSettings,
    phone: pageSettings.phone || settings.contactPhone || '',
    email: pageSettings.email || settings.contactEmail || 'info@reklamx.se',
    address: pageSettings.address || settings.companyAddress || PRINT_SHOP_ADDRESS,
  };
  // The map: the owner's own embed link when he pasted one, else a pin on the
  // address the card shows (Google's keyless embed), so the two never disagree.
  const mapEmbedUrl = contactData.googleMapsEmbedUrl
    || (contactData.address ? `https://www.google.com/maps?q=${encodeURIComponent(contactData.address)}&output=embed` : '');

  /**
   * WHAT THE EDIT MODAL STARTS FROM — 15.4.7.
   *
   * The stored document, not `contactData` above. That object is what the PAGE
   * is showing at this moment, and on a shop whose settings carry no contact
   * block its heading, intro and opening hours come out of t() — so an owner
   * working in the Danish dashboard could press Edit, press Save, and write the
   * DANISH wording into the one canonical field that every visitor reads,
   * English, Swedish and Norwegian included, with the sv/da/no maps beside it
   * still empty. Nothing on the screen would have said so. Seeded from the
   * document, an empty box means nothing is stored, and the page falls back to
   * its own four-language default as before.
   *
   * The phone, e-mail and address fallbacks stay exactly as they were: those
   * read the same in any language, and Save writes editForm.phone and .email
   * back to the company-wide contactPhone / contactEmail — seeding them empty
   * would wipe the details the page is currently showing.
   */
  const seedEditForm = (): ContactPageSettings => {
    const stored = settings.contactPageSettings;
    return {
      ...(stored || {}),
      heroTitle: stored?.heroTitle ?? '',
      heroTitleI18n: stored?.heroTitleI18n ?? null,
      heroSubtitle: stored?.heroSubtitle ?? '',
      heroSubtitleI18n: stored?.heroSubtitleI18n ?? null,
      workingHours: stored?.workingHours ?? '',
      googleMapsEmbedUrl: stored?.googleMapsEmbedUrl ?? '',
      faqList: stored?.faqList ?? [],
      phone: stored?.phone || settings.contactPhone || '',
      email: stored?.email || settings.contactEmail || 'info@reklamx.se',
      address: stored?.address || settings.companyAddress || '',
    };
  };

  // Inquiry Form State
  const [formData, setFormData] = useState({
    name: user?.displayName || '',
    email: user?.email || '',
    phone: '',
    subject: t('contactSubjectGeneralInquiry'),
    message: ''
  });
  const [submitting, setSubmitting] = useState(false);
  const [submittedSuccess, setSubmittedSuccess] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Admin Edit Modal State
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editForm, setEditForm] = useState<ContactPageSettings>(seedEditForm);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  // FAQ Accordion Toggle
  const [openFaqIdx, setOpenFaqIdx] = useState<number | null>(0);

  const handleSubmitInquiry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.email || !formData.message) {
      alert(t('contactValidationFillRequired'));
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      // Through the server, not straight into Firestore. Writing from here
      // stored the message and told nobody — the shop had a real enquiry sitting
      // unread. The endpoint saves it AND e-mails the shop, with Reply-To set
      // to the sender.
      const resp = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      const result = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(result?.error || 'The message could not be sent.');
      setSubmittedSuccess(true);
      setFormData({ name: '', email: '', phone: '', subject: t('contactSubjectGeneralInquiry'), message: '' });
    } catch (err) {
      // This used to log "Inquiry saved locally (Firestore error fallback)" and
      // then show "Message Sent Successfully!". Nothing was saved locally and
      // nothing was sent: the customer's message was discarded while they were
      // told to expect a reply. Now the form keeps what they typed and gives
      // them an address that works.
      console.error('The inquiry could not be saved:', err);
      setSubmitError(t('contactSendFailed').replace('{0}', contactData.email));
    } finally {
      setSubmitting(false);
    }
  };

  // A save can be refused (no connection, the database's daily limit): the editor
  // stays open with what he typed, and says so. updateSettings rethrows, and this
  // used to stay on "saving" for good with nothing said (code review 2026-10-11,
  // REVIEW-3 #6).
  const handleSaveContactSettings = async () => {
    setSavingSettings(true);
    setSettingsError(null);
    try {
      await updateSettings({
        contactPhone: editForm.phone,
        contactEmail: editForm.email,
        contactPageSettings: editForm
      });
      setIsEditModalOpen(false);
    } catch {
      setSettingsError(t('pgEditSaveFailed'));
    } finally {
      setSavingSettings(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50/50 pb-20">
      {/* Hero Header */}
      {/* The About page's drifting light (2026-10-14): three soft brand-coloured
          balls moving slowly BEHIND the title, under a dark layer, so the words
          stay sharp. The "Contact us" pill above the title is gone — the title
          says it. The drift stops for anyone who asked their system for less
          motion (index.css, .rx-blob). */}
      <div className="bg-[#0b0d12] text-white relative overflow-hidden py-16 md:py-24 px-4 sm:px-6 lg:px-8">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="rx-blob rx-blob-a absolute -top-32 -left-24 w-[34rem] h-[34rem] rounded-full bg-[#bb965b] opacity-40 blur-[110px]" />
          <div className="rx-blob rx-blob-b absolute top-10 right-[-8rem] w-[30rem] h-[30rem] rounded-full bg-[#5a6570] opacity-50 blur-[120px]" />
          <div className="rx-blob rx-blob-c absolute -bottom-40 left-1/3 w-[28rem] h-[28rem] rounded-full bg-[#e8d9aa] opacity-25 blur-[120px]" />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#0b0d12]/60" />
        </div>
        <div className="max-w-7xl mx-auto relative z-10">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="max-w-3xl">
              <h1 className="text-3xl sm:text-4xl md:text-5xl font-black text-white tracking-tight">
                {localized(contactData.heroTitle, contactData.heroTitleI18n, language)}
              </h1>
              <p className="mt-4 text-base md:text-lg text-gray-300 leading-relaxed font-medium">
                {localized(contactData.heroSubtitle, contactData.heroSubtitleI18n, language)}
              </p>
            </div>

            {/* Admin Quick Edit Button */}
            {isAdmin && (
              <div className="shrink-0">
                <button
                  onClick={() => {
                    setEditForm(seedEditForm());
                    setSettingsError(null);
                    setIsEditModalOpen(true);
                  }}
                  className="bg-orange-600 hover:bg-orange-500 text-white text-xs font-black px-5 py-3 rounded-2xl shadow-lg shadow-orange-600/30 flex items-center space-x-2 transition-all active:scale-95 cursor-pointer"
                >
                  <Edit3 className="w-4 h-4" />
                  <span>{t('contactAdminEditInfo')}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Grid Section */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 -mt-8 relative z-20 space-y-12">
        {/* Top 4 Info Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* Phone — hidden until a real number is configured; an empty card
              beats the invented number that used to sit here. */}
          {contactData.phone && (
            <div className="bg-white rounded-3xl p-6 border border-gray-200/90 shadow-sm space-y-3">
              <div className="text-orange-700">
                <Phone className="w-8 h-8" strokeWidth={1.5} />
              </div>
              <div>
                <span className="text-xs font-black text-gray-400 uppercase tracking-wider block">{t('contactCardPhoneTitle')}</span>
                <a href={`tel:${contactData.phone}`} className="text-base font-black text-gray-900 hover:text-orange-600 transition-colors block mt-0.5" dir="ltr">
                  {contactData.phone}
                </a>
              </div>
            </div>
          )}

          {/* Email */}
          <div className="bg-white rounded-3xl p-6 border border-gray-200/90 shadow-sm space-y-3">
            <div className="text-orange-700">
              <Mail className="w-8 h-8" strokeWidth={1.5} />
            </div>
            <div>
              <span className="text-xs font-black text-gray-400 uppercase tracking-wider block">{t('contactCardEmailTitle')}</span>
              <a href={`mailto:${contactData.email}`} className="text-sm font-black text-gray-900 hover:text-orange-700 transition-colors block mt-0.5 truncate">
                {contactData.email}
              </a>
            </div>
          </div>

          {/* Address — hidden until the real one is configured. */}
          {contactData.address && (
            <div className="bg-white rounded-3xl p-6 border border-gray-200/90 shadow-sm space-y-3">
              <div className="text-orange-700">
                <MapPin className="w-8 h-8" strokeWidth={1.5} />
              </div>
              <div>
                <span className="text-xs font-black text-gray-400 uppercase tracking-wider block">{t('contactCardAddressTitle')}</span>
                {/* Street, postcode + city, country each on their own line —
                    the way an address is written on an envelope. */}
                <div className="text-xs font-extrabold text-gray-800 mt-0.5 leading-snug">
                  {addressLines(contactData.address).map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Hours — hidden until real opening hours are configured. */}
          {contactData.workingHours && (
            <div className="bg-white rounded-3xl p-6 border border-gray-200/90 shadow-sm space-y-3">
              <div className="w-10 h-10 rounded-2xl bg-purple-50 text-purple-600 border border-purple-200/60 flex items-center justify-center">
                <Clock className="w-5 h-5" />
              </div>
              <div>
                <span className="text-xs font-black text-gray-400 uppercase tracking-wider block">{t('contactCardHoursTitle')}</span>
                <p className="text-xs font-extrabold text-gray-800 mt-0.5 leading-snug">
                  {contactData.workingHours}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Contact Form & Google Map Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left 7 Cols: Contact Form */}
          <div className="lg:col-span-7 bg-white rounded-3xl p-6 sm:p-8 border border-gray-200/90 shadow-sm space-y-6">
            <div>
              <span className="text-xs font-black uppercase text-orange-600 tracking-wider block">{t('contactSubmitInquiry')}</span>
              <h2 className="text-2xl font-black text-gray-900 mt-0.5">{t('contactFormTitle')}</h2>
              <p className="text-xs text-gray-500 mt-1">{t('contactFormSubtitle')}</p>
            </div>

            {submittedSuccess ? (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-emerald-50 border border-emerald-200 text-emerald-900 p-6 rounded-2xl space-y-3"
              >
                <div className="flex items-center space-x-2">
                  <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
                  <span className="font-black text-base">{t('contactSuccessTitle')}</span>
                </div>
                <p className="text-xs leading-relaxed text-emerald-800 font-medium">
                  {t('contactSuccessBody')}
                </p>
                <button
                  onClick={() => setSubmittedSuccess(false)}
                  className="mt-2 bg-emerald-600 text-white text-xs font-black px-4 py-2 rounded-xl hover:bg-emerald-700 transition-colors"
                >
                  {t('contactSendAnother')}
                </button>
              </motion.div>
            ) : (
              <form onSubmit={handleSubmitInquiry} className="space-y-4">
                {/* Each field has its own label (for/id), a name and an autocomplete
                    hint, so screen readers announce it and browsers can fill it in
                    (the client's audit, 2026-10-10). */}
                {submitError && (
                  <div role="alert" className="bg-amber-50 border border-amber-300 text-amber-900 rounded-2xl px-4 py-3 flex items-start gap-2.5">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                    <p className="text-xs font-bold leading-relaxed">{submitError}</p>
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="contact-name" className="block text-xs font-black text-gray-700 mb-1">{t('contactFormNameLabel')}</label>
                    <input
                      id="contact-name"
                      name="name"
                      autoComplete="name"
                      type="text"
                      required
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder={t('contactFormNamePlaceholder')}
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl text-xs font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                    />
                  </div>

                  <div>
                    <label htmlFor="contact-email" className="block text-xs font-black text-gray-700 mb-1">{t('contactFormEmailLabel')}</label>
                    <input
                      id="contact-email"
                      name="email"
                      autoComplete="email"
                      type="email"
                      required
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      placeholder={t('contactFormEmailPlaceholder')}
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl text-xs font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="contact-phone" className="block text-xs font-black text-gray-700 mb-1">{t('contactFormPhoneLabel')}</label>
                    <input
                      id="contact-phone"
                      name="phone"
                      autoComplete="tel"
                      type="tel"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      placeholder={t('contactFormPhonePlaceholder')}
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl text-xs font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                    />
                  </div>

                  <div>
                    <label htmlFor="contact-subject" className="block text-xs font-black text-gray-700 mb-1">{t('contactFormSubjectLabel')}</label>
                    <select
                      id="contact-subject"
                      name="subject"
                      value={formData.subject}
                      onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl text-xs font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white"
                    >
                      <option value={t('contactSubjectGeneralInquiry')}>{t('contactSubjectGeneralInquiry')}</option>
                      <option value={t('contactSubjectCustomQuote')}>{t('contactSubjectCustomQuote')}</option>
                      <option value={t('contactSubjectPrepressSupport')}>{t('contactSubjectPrepressSupport')}</option>
                      <option value={t('contactSubjectPartnership')}>{t('contactSubjectPartnership')}</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label htmlFor="contact-message" className="block text-xs font-black text-gray-700 mb-1">{t('contactFormMessageLabel')}</label>
                  <textarea
                    id="contact-message"
                    name="message"
                    rows={5}
                    required
                    value={formData.message}
                    onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                    placeholder={t('contactFormMessagePlaceholder')}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl text-xs font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full bg-orange-600 hover:bg-orange-500 text-white font-black py-4 rounded-2xl text-xs transition-all shadow-lg shadow-orange-600/30 flex items-center justify-center space-x-2 disabled:opacity-50 cursor-pointer"
                >
                  {submitting ? (
                    <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                  <span>{t('contactSubmitInquiry')}</span>
                </button>
              </form>
            )}
          </div>

          {/* Right 5 Cols: Google Map & Location Details */}
          <div className="lg:col-span-5 space-y-6">
            <div className="bg-white rounded-3xl p-6 border border-gray-200/90 shadow-sm space-y-4">
              <h3 className="font-black text-base text-gray-900 flex items-center space-x-2">
                <MapPin className="w-5 h-5 text-orange-600" />
                <span>{t('contactVisitTitle')}</span>
              </h3>
              <p className="text-xs text-gray-500 leading-relaxed">
                {t('contactVisitBody')}
              </p>

              {/* Map iFrame Container */}
              <div className="aspect-4/3 rounded-2xl overflow-hidden border border-gray-200 bg-gray-100">
                {mapEmbedUrl ? (
                  <iframe 
                    src={mapEmbedUrl}
                    title={t('contactVisitTitle')}
                    width="100%" 
                    height="100%" 
                    style={{ border: 0 }} 
                    allowFullScreen 
                    loading="lazy" 
                    referrerPolicy="no-referrer-when-downgrade"
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center p-4 text-center text-gray-400">
                    <MapPin className="w-8 h-8 mb-2" />
                    <span className="text-xs font-bold">{t('contactMapPlaceholder')}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* FAQs Accordion */}
        {contactData.faqList && contactData.faqList.length > 0 && (
          <div className="bg-white rounded-3xl p-6 sm:p-10 border border-gray-200/90 shadow-sm space-y-6">
            <div className="text-center max-w-xl mx-auto space-y-1">
              <span className="text-xs font-black uppercase tracking-wider text-orange-600">{t('contactFaqBadge')}</span>
              <h2 className="text-2xl font-black text-gray-900">{t('contactFaqTitle')}</h2>
            </div>

            <div className="max-w-3xl mx-auto space-y-3">
              {contactData.faqList.map((faq, idx) => {
                const isOpen = openFaqIdx === idx;
                return (
                  <div key={idx} className="border border-gray-200 rounded-2xl overflow-hidden transition-all">
                    <button
                      onClick={() => setOpenFaqIdx(isOpen ? null : idx)}
                      className="w-full p-4 text-left font-extrabold text-sm text-gray-900 flex items-center justify-between bg-gray-50/60 hover:bg-gray-50 transition-colors"
                    >
                      <span className="flex items-center space-x-2">
                        <HelpCircle className="w-4 h-4 text-orange-600 shrink-0" />
                        <span>{faq.question}</span>
                      </span>
                      <ChevronDown className={cn("w-4 h-4 text-gray-400 transition-transform duration-200", isOpen && "rotate-180")} />
                    </button>
                    {isOpen && (
                      <div className="p-4 bg-white text-xs text-gray-600 font-medium leading-relaxed border-t border-gray-100">
                        {faq.answer}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Admin Edit Contact Modal */}
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
                  <h2 className="text-xl font-black text-gray-900">{t('contactModalTitle')}</h2>
                  <p className="text-xs text-gray-500">{t('contactModalSubtitle')}</p>
                </div>
                <button
                  onClick={() => setIsEditModalOpen(false)}
                  className="p-2 text-gray-400 hover:text-gray-900 rounded-xl hover:bg-gray-100 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Form Controls */}
              <div className="space-y-4">
                {/* THE PAGE'S OWN HEADING AND INTRO — 15.4.7.
                    Both have been rendered through localized() since the site
                    copy was translated, and this modal had a box for neither:
                    the first two lines a customer reads on the Contact page were
                    the only words on it the owner could not change, in any
                    language, and the sv/da/no maps behind them could only ever
                    stay empty. */}
                <div>
                  <label className="block text-xs font-black text-gray-700 mb-1">{t('contactModalHeroTitleLabel')}</label>
                  <input
                    type="text"
                    value={editForm.heroTitle || ''}
                    onChange={(e) => setEditForm({ ...editForm, heroTitle: e.target.value })}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-xs font-bold text-gray-900"
                  />
                  <LocalizedTextFields
                    label={t('pgHeroTitleTranslations')}
                    fallback={editForm.heroTitle || ''}
                    value={(editForm.heroTitleI18n || {}) as LocalizedText}
                    onChange={(next) => setEditForm((prev) => ({ ...prev, heroTitleI18n: Object.keys(next).length ? next : null }))}
                  />
                </div>

                <div>
                  <label className="block text-xs font-black text-gray-700 mb-1">{t('contactModalHeroSubtitleLabel')}</label>
                  <textarea
                    rows={2}
                    value={editForm.heroSubtitle || ''}
                    onChange={(e) => setEditForm({ ...editForm, heroSubtitle: e.target.value })}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-xs font-bold text-gray-900"
                  />
                  <LocalizedTextFields
                    label={t('pgHeroSubtitleTranslations')}
                    fallback={editForm.heroSubtitle || ''}
                    value={(editForm.heroSubtitleI18n || {}) as LocalizedText}
                    onChange={(next) => setEditForm((prev) => ({ ...prev, heroSubtitleI18n: Object.keys(next).length ? next : null }))}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-black text-gray-700 mb-1">{t('contactModalPhoneLabel')}</label>
                    <input
                      type="text"
                      value={editForm.phone}
                      onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-xs font-bold text-gray-900"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-black text-gray-700 mb-1">{t('contactModalEmailLabel')}</label>
                    <input
                      type="text"
                      value={editForm.email}
                      onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-xs font-bold text-gray-900"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-black text-gray-700 mb-1">{t('contactModalAddressLabel')}</label>
                  <input
                    type="text"
                    value={editForm.address}
                    onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-xs font-bold text-gray-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-black text-gray-700 mb-1">{t('contactCardHoursTitle')}</label>
                  <input
                    type="text"
                    value={editForm.workingHours}
                    onChange={(e) => setEditForm({ ...editForm, workingHours: e.target.value })}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-xs font-bold text-gray-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-black text-gray-700 mb-1">{t('contactModalMapLabel')}</label>
                  <input
                    type="text"
                    value={editForm.googleMapsEmbedUrl || ''}
                    onChange={(e) => setEditForm({ ...editForm, googleMapsEmbedUrl: e.target.value })}
                    placeholder="https://www.google.com/maps/embed?..."
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-xs font-bold text-gray-900"
                  />
                </div>

                {/* FAQ List Editor */}
                <div className="pt-4 border-t border-gray-100 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-black text-gray-900">{t('contactModalFaqHeading')} ({editForm.faqList?.length || 0})</h3>
                    <button
                      type="button"
                      onClick={() => {
                        const newFaq = { question: t('contactModalNewFaqQuestion'), answer: t('contactModalNewFaqAnswer') };
                        setEditForm({ ...editForm, faqList: [...(editForm.faqList || []), newFaq] });
                      }}
                      className="px-3.5 py-2 bg-orange-600 text-white text-xs font-black rounded-xl hover:bg-orange-500 transition-all flex items-center cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5 mr-1" />
                      {t('contactModalAddFaq')}
                    </button>
                  </div>

                  <div className="space-y-3">
                    {editForm.faqList?.map((faq, idx) => (
                      <div key={idx} className="p-3 bg-gray-50 rounded-2xl border border-gray-200 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-black text-gray-700">{t('contactModalFaqNumber').replace('{0}', String(idx + 1))}</span>
                          <button
                            type="button"
                            onClick={() => {
                              const copy = (editForm.faqList || []).filter((_, i) => i !== idx);
                              setEditForm({ ...editForm, faqList: copy });
                            }}
                            className="text-red-500 hover:text-red-700 text-xs font-bold flex items-center cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5 mr-1" />
                            {t('contactModalRemoveFaq')}
                          </button>
                        </div>

                        <input
                          type="text"
                          placeholder={t('contactModalQuestionPlaceholder')}
                          value={faq.question}
                          onChange={(e) => {
                            const copy = [...(editForm.faqList || [])];
                            copy[idx].question = e.target.value;
                            setEditForm({ ...editForm, faqList: copy });
                          }}
                          className="w-full px-3 py-1.5 border border-gray-200 rounded-xl text-xs font-bold bg-white"
                        />

                        <textarea
                          rows={2}
                          placeholder={t('contactModalAnswerPlaceholder')}
                          value={faq.answer}
                          onChange={(e) => {
                            const copy = [...(editForm.faqList || [])];
                            copy[idx].answer = e.target.value;
                            setEditForm({ ...editForm, faqList: copy });
                          }}
                          className="w-full px-3 py-1.5 border border-gray-200 rounded-xl text-xs font-bold bg-white"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {settingsError && (
                <p role="alert" className="text-xs font-bold text-red-700 bg-red-50 border border-red-100 rounded-xl px-3 py-2.5" data-rx-page-edit-error>
                  {settingsError}
                </p>
              )}

              {/* Save Actions */}
              <div className="flex items-center justify-end space-x-3 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="px-5 py-2.5 rounded-xl border border-gray-200 text-xs font-bold text-gray-600 hover:bg-gray-50"
                >
                  {t('contactModalCancel')}
                </button>
                <button
                  type="button"
                  onClick={handleSaveContactSettings}
                  disabled={savingSettings}
                  className="px-6 py-2.5 bg-orange-600 hover:bg-orange-500 text-white text-xs font-black rounded-xl shadow-md flex items-center space-x-2 disabled:opacity-50"
                >
                  {savingSettings ? (
                    <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  <span>{t('contactModalSave')}</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
