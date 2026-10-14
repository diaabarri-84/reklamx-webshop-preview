import React, { useEffect, useState } from 'react';
import { useSiteSettings, AboutUsPageSettings } from '../context/SiteSettingsContext';
import { holdReloads } from '../lib/reloadHold';
import { useAuth } from '../App';
import { localized } from '../lib/localizedText';
import { LocalizedTextFields } from '../components/Admin/LocalizedTextFields';
import type { LocalizedText } from '../types';
import { 
  Building2, 
  Target, 
  Eye, 
  Award, 
  Users, 
  Edit3, 
  X, 
  Save, 
  Plus, 
  Trash2, 
  Sparkles,
  ShieldCheck,
  CheckCircle2,
  Printer,
  Clock,
  TrendingUp
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import SafeImage from '../components/SafeImage';

export default function AboutUsPage() {
  const { settings, updateSettings } = useSiteSettings();
  const { user, t, language } = useAuth();
  const isAdmin = user?.role === 'admin';

  // Fallback mirrors the context default: claims nothing that is not true of
  // any shop running this code. The owner writes the real story from the
  // dashboard; empty stats/team hide those sections entirely.
  const aboutData = settings.aboutUsPageSettings || {
    heroTitle: t('aboutDefaultHeroTitle'),
    heroSubtitle: t('aboutDefaultHeroSubtitle'),
    storyTitle: t('aboutDefaultStoryTitle'),
    storyContent: t('aboutDefaultStoryContent'),
    mission: t('aboutDefaultMission'),
    vision: t('aboutDefaultVision'),
    bannerImageUrl: 'https://images.pexels.com/photos/6620983/pexels-photo-6620983.jpeg?auto=compress&cs=tinysrgb&w=1600',
    stats: [],
    teamMembers: []
  };

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  // The shop reloads this page by itself after a deploy (BuildWatcher): not while
  // the owner has the editor open, with his changes not yet saved.
  useEffect(() => (isEditModalOpen ? holdReloads() : undefined), [isEditModalOpen]);

  // Edit State
  const [editForm, setEditForm] = useState<AboutUsPageSettings>(aboutData);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // The contact form at the foot of the page — the contact page's own route.
  const [contactForm, setContactForm] = useState({ name: '', email: '', phone: '', message: '' });
  const [contactSending, setContactSending] = useState(false);
  const [contactSent, setContactSent] = useState(false);
  const [contactError, setContactError] = useState<string | null>(null);
  const sendContact = async (e: React.FormEvent) => {
    e.preventDefault();
    setContactSending(true);
    setContactError(null);
    try {
      const resp = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...contactForm, subject: t('aboutUs') }),
      });
      const result = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(result?.error || 'not sent');
      setContactSent(true);
      setContactForm({ name: '', email: '', phone: '', message: '' });
    } catch {
      // What they typed stays in the form; they are told where else to write.
      setContactError(t('contactSendFailed').replace('{0}', settings.contactEmail || 'info@reklamx.se'));
    } finally {
      setContactSending(false);
    }
  };

  // A save can be refused (no connection, the database's daily limit): the editor
  // stays open with what he typed, and says so. updateSettings rethrows, and this
  // used to stay on "saving" for good with nothing said (code review 2026-10-11,
  // REVIEW-3 #6).
  const handleSaveAboutInfo = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await updateSettings({
        aboutUsPageSettings: editForm
      });
      setIsEditModalOpen(false);
    } catch {
      setSaveError(t('pgEditSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f8f9fa] pb-0">
      {/* THE HERO: the brand's colours drifting slowly behind the words (2026-10-13)
          — gold, slate and sand, blurred into each other, never still and never
          busy. A small ruled eyebrow instead of the old icon pill. The motion
          stops for anyone who has asked their system for less of it. */}
      <div className="relative overflow-hidden bg-[#0b0d12] text-white px-4 sm:px-6 lg:px-8 py-24 md:py-32">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="rx-blob rx-blob-a absolute -top-32 -left-24 w-[34rem] h-[34rem] rounded-full bg-[#bb965b] opacity-40 blur-[110px]" />
          <div className="rx-blob rx-blob-b absolute top-10 right-[-8rem] w-[30rem] h-[30rem] rounded-full bg-[#5a6570] opacity-50 blur-[120px]" />
          <div className="rx-blob rx-blob-c absolute -bottom-40 left-1/3 w-[28rem] h-[28rem] rounded-full bg-[#e8d9aa] opacity-25 blur-[120px]" />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#0b0d12]/60" />
        </div>
        <div className="max-w-5xl mx-auto relative z-10">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-8">
            <div className="max-w-3xl">
              <p className="flex items-center gap-3 text-[0.6875rem] sm:text-xs font-semibold uppercase tracking-[0.24em] text-orange-200">
                <span className="h-px w-8 bg-orange-300/70" aria-hidden />
                {t('aboutUs')}
              </p>
              <h1 className="mt-5 text-4xl sm:text-5xl md:text-6xl font-black tracking-tight leading-[1.02] text-balance">
                {localized(aboutData.heroTitle, aboutData.heroTitleI18n, language)}
              </h1>
              <p className="mt-6 text-base md:text-lg text-white/70 leading-relaxed max-w-2xl">
                {localized(aboutData.heroSubtitle, aboutData.heroSubtitleI18n, language)}
              </p>
            </div>

            {isAdmin && (
              <button
                onClick={() => {
                  setEditForm(aboutData);
                  setSaveError(null);
                  setIsEditModalOpen(true);
                }}
                className="shrink-0 self-start md:self-end inline-flex items-center gap-2 bg-white/10 hover:bg-white/20 ring-1 ring-white/20 text-white text-xs font-bold px-4 py-2.5 rounded-full transition-colors"
              >
                <Edit3 className="w-4 h-4" />
                <span>{t('aboutAdminEditInfo')}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* WHO WE ARE — one eyebrow, one heading, the story set to be read; the
            picture beside it without a caption laid over it. */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16 items-center py-20 md:py-28">
          <div className="lg:col-span-6">
            <p className="flex items-center gap-3 text-[0.6875rem] font-semibold uppercase tracking-[0.2em] text-orange-700">
              <span className="h-px w-8 bg-orange-400" aria-hidden />
              {localized(aboutData.storyTitle, aboutData.storyTitleI18n, language)}
            </p>
            <h2 className="mt-4 text-3xl sm:text-4xl font-black text-gray-900 tracking-tight leading-tight text-balance">
              {t('aboutStoryHeading')}
            </h2>
            <p className="mt-6 text-base md:text-[1.0625rem] text-gray-600 leading-relaxed whitespace-pre-line max-w-prose">
              {localized(aboutData.storyContent, aboutData.storyContentI18n, language)}
            </p>
          </div>
          <div className="lg:col-span-6">
            <div className="aspect-[4/3] rounded-[2rem] overflow-hidden bg-gray-200">
              <SafeImage
                src={aboutData.bannerImageUrl}
                alt={t('aboutBannerAlt')}
                className="w-full h-full object-cover"
              />
            </div>
          </div>
        </section>

        {/* MISSION AND VISION as two statements, not two boxes: the icon on its
            own (no square behind it), a small label, the sentence large. A
            hairline between them, nothing around them. */}
        <section className="grid grid-cols-1 md:grid-cols-2 border-t border-gray-200 md:divide-x divide-gray-200">
          {([
            { icon: Target, label: t('aboutMissionTitle'), text: localized(aboutData.mission, aboutData.missionI18n, language) },
            { icon: Eye, label: t('aboutVisionTitle'), text: localized(aboutData.vision, aboutData.visionI18n, language) },
          ] as const).map(({ icon: Icon, label, text }, i) => (
            <div key={label} className={cn('py-14 md:py-16', i === 0 ? 'md:pr-12' : 'md:pl-12 border-t md:border-t-0 border-gray-200')}>
              <Icon className="w-7 h-7 text-orange-600" strokeWidth={1.5} aria-hidden />
              <p className="mt-6 text-[0.6875rem] font-semibold uppercase tracking-[0.2em] text-gray-500">{label}</p>
              <p className="mt-3 text-xl md:text-2xl font-semibold text-gray-900 leading-snug tracking-tight text-balance">
                {text}
              </p>
            </div>
          ))}
        </section>

        {/* Company stats — only when the owner has entered real ones */}
        {aboutData.stats && aboutData.stats.length > 0 && (
          <section className="border-t border-gray-200 py-16">
            <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.2em] text-gray-500">{t('aboutStatsEyebrow')}</p>
            <h3 className="mt-2 text-2xl font-black text-gray-900">{t('aboutStatsTitle')}</h3>
            <div className="mt-10 grid grid-cols-2 lg:grid-cols-4 gap-8">
              {aboutData.stats.map((st, idx) => (
                <div key={idx}>
                  <span className="text-4xl md:text-5xl font-extralight tabular-nums text-gray-900 block">{st.value}</span>
                  <span className="mt-2 text-sm text-gray-500 block">{st.label}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* The team — only when the owner has entered people */}
        {aboutData.teamMembers && aboutData.teamMembers.length > 0 && (
          <section className="border-t border-gray-200 py-16 space-y-10">
            <div className="max-w-xl">
              <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.2em] text-gray-500">{t('aboutTeamEyebrow')}</p>
              <h2 className="mt-2 text-2xl md:text-3xl font-black text-gray-900">{t('aboutTeamTitle')}</h2>
              <p className="mt-2 text-sm text-gray-500">{t('aboutTeamSubtitle')}</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-10">
              {aboutData.teamMembers.map((member, idx) => (
                <div key={member.id || idx} className="space-y-4">
                  <SafeImage src={member.photoUrl} alt={member.name} className="w-20 h-20 rounded-full object-cover" />
                  <div>
                    <h3 className="text-lg font-bold text-gray-900">{member.name}</h3>
                    <span className="text-sm text-orange-700 block mt-0.5">{member.role}</span>
                  </div>
                  {member.bio && <p className="text-sm text-gray-600 leading-relaxed">{member.bio}</p>}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* CONTACT, right before the footer: the page ends with a way to talk to
          the people it has just introduced. The same route as the contact page
          (/api/contact), so the message lands in the same inbox and dashboard. */}
      <section className="bg-white border-t border-gray-200 mt-8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20 md:py-24 grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16">
          <div className="lg:col-span-5">
            <p className="flex items-center gap-3 text-[0.6875rem] font-semibold uppercase tracking-[0.2em] text-orange-700">
              <span className="h-px w-8 bg-orange-400" aria-hidden />
              {t('contact')}
            </p>
            <h2 className="mt-4 text-3xl sm:text-4xl font-black text-gray-900 tracking-tight leading-tight text-balance">
              {t('aboutContactTitle')}
            </h2>
            <p className="mt-5 text-base text-gray-600 leading-relaxed max-w-md">{t('aboutContactLead')}</p>
          </div>

          <div className="lg:col-span-7">
            {contactSent ? (
              <div className="rounded-3xl bg-[#f8f9fa] p-10 text-center" role="status">
                <CheckCircle2 className="w-10 h-10 text-orange-600 mx-auto" strokeWidth={1.5} />
                <p className="mt-4 text-lg font-bold text-gray-900">{t('contactSuccessTitle')}</p>
                <p className="mt-2 text-sm text-gray-600">{t('contactSuccessBody')}</p>
                <button type="button" onClick={() => setContactSent(false)} className="mt-6 text-sm font-semibold text-gray-700 hover:text-gray-900 underline underline-offset-4">
                  {t('contactSendAnother')}
                </button>
              </div>
            ) : (
              <form onSubmit={sendContact} className="grid grid-cols-1 sm:grid-cols-2 gap-5" noValidate={false}>
                <label className="block">
                  <span className="text-sm font-medium text-gray-800">{t('contactFormNameLabel')}</span>
                  <input required name="name" autoComplete="name" value={contactForm.name} onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })}
                    placeholder={t('contactFormNamePlaceholder')}
                    className="mt-2 w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-base text-gray-900 placeholder:text-gray-400 focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10" />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-gray-800">{t('contactFormEmailLabel')}</span>
                  <input required type="email" name="email" autoComplete="email" value={contactForm.email} onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
                    placeholder={t('contactFormEmailPlaceholder')}
                    className="mt-2 w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-base text-gray-900 placeholder:text-gray-400 focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10" />
                </label>
                <label className="block sm:col-span-2">
                  <span className="text-sm font-medium text-gray-800">{t('contactFormPhoneLabel')}</span>
                  <input type="tel" name="phone" autoComplete="tel" value={contactForm.phone} onChange={(e) => setContactForm({ ...contactForm, phone: e.target.value })}
                    placeholder={t('contactFormPhonePlaceholder')}
                    className="mt-2 w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-base text-gray-900 placeholder:text-gray-400 focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10" />
                </label>
                <label className="block sm:col-span-2">
                  <span className="text-sm font-medium text-gray-800">{t('contactFormMessageLabel')}</span>
                  <textarea required name="message" rows={5} value={contactForm.message} onChange={(e) => setContactForm({ ...contactForm, message: e.target.value })}
                    placeholder={t('contactFormMessagePlaceholder')}
                    className="mt-2 w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-base text-gray-900 placeholder:text-gray-400 focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10 resize-y" />
                </label>
                {contactError && (
                  <p role="alert" className="sm:col-span-2 text-sm text-red-700 bg-red-50 rounded-xl px-4 py-3">{contactError}</p>
                )}
                <div className="sm:col-span-2">
                  <button type="submit" disabled={contactSending}
                    className="inline-flex items-center gap-2 bg-gray-900 hover:bg-orange-700 disabled:opacity-60 text-white text-sm font-bold px-7 py-3.5 rounded-full transition-colors">
                    {contactSending ? '…' : t('aboutContactSend')}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </section>

      {/* Admin Edit Modal */}
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
                  <h2 className="text-xl font-black text-gray-900">{t('aboutModalTitle')}</h2>
                  <p className="text-xs text-gray-500">{t('aboutModalSubtitle')}</p>
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
                <div>
                  <label className="block text-xs font-black text-gray-700 mb-1">{t('aboutModalHeroTitleLabel')}</label>
                  <input
                    type="text"
                    value={editForm.heroTitle}
                    onChange={(e) => setEditForm({ ...editForm, heroTitle: e.target.value })}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-xs font-bold text-gray-900"
                  />
                  <LocalizedTextFields
                    label={t('pgHeroTitleTranslations')}
                    fallback={editForm.heroTitle}
                    value={(editForm.heroTitleI18n || {}) as LocalizedText}
                    onChange={(next) => setEditForm((prev) => ({ ...prev, heroTitleI18n: Object.keys(next).length ? next : null }))}
                  />
                </div>

                <div>
                  <label className="block text-xs font-black text-gray-700 mb-1">{t('aboutModalHeroSubtitleLabel')}</label>
                  <textarea
                    rows={2}
                    value={editForm.heroSubtitle}
                    onChange={(e) => setEditForm({ ...editForm, heroSubtitle: e.target.value })}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-xs font-bold text-gray-900"
                  />
                  <LocalizedTextFields
                    label={t('pgHeroSubtitleTranslations')}
                    fallback={editForm.heroSubtitle}
                    value={(editForm.heroSubtitleI18n || {}) as LocalizedText}
                    onChange={(next) => setEditForm((prev) => ({ ...prev, heroSubtitleI18n: Object.keys(next).length ? next : null }))}
                  />
                </div>

                <div>
                  <label className="block text-xs font-black text-gray-700 mb-1">{t('aboutModalStoryTitleLabel')}</label>
                  <input
                    type="text"
                    value={editForm.storyTitle}
                    onChange={(e) => setEditForm({ ...editForm, storyTitle: e.target.value })}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-xs font-bold text-gray-900"
                  />
                  <LocalizedTextFields
                    label={t('pgHeroTitleTranslations')}
                    fallback={editForm.storyTitle}
                    value={(editForm.storyTitleI18n || {}) as LocalizedText}
                    onChange={(next) => setEditForm((prev) => ({ ...prev, storyTitleI18n: Object.keys(next).length ? next : null }))}
                  />
                </div>

                <div>
                  <label className="block text-xs font-black text-gray-700 mb-1">{t('aboutModalStoryContentLabel')}</label>
                  <textarea
                    rows={4}
                    value={editForm.storyContent}
                    onChange={(e) => setEditForm({ ...editForm, storyContent: e.target.value })}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-xs font-bold text-gray-900"
                  />
                  <LocalizedTextFields
                    label={t('pgBodyTranslations')}
                    fallback={editForm.storyContent}
                    value={(editForm.storyContentI18n || {}) as LocalizedText}
                    onChange={(next) => setEditForm((prev) => ({ ...prev, storyContentI18n: Object.keys(next).length ? next : null }))}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-black text-gray-700 mb-1">{t('aboutModalMissionLabel')}</label>
                    <textarea
                      rows={3}
                      value={editForm.mission}
                      onChange={(e) => setEditForm({ ...editForm, mission: e.target.value })}
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-xs font-bold text-gray-900"
                    />
                  <LocalizedTextFields
                    label={t('pgBodyTranslations')}
                    fallback={editForm.mission}
                    value={(editForm.missionI18n || {}) as LocalizedText}
                    onChange={(next) => setEditForm((prev) => ({ ...prev, missionI18n: Object.keys(next).length ? next : null }))}
                  />
                  </div>
                  <div>
                    <label className="block text-xs font-black text-gray-700 mb-1">{t('aboutModalVisionLabel')}</label>
                    <textarea
                      rows={3}
                      value={editForm.vision}
                      onChange={(e) => setEditForm({ ...editForm, vision: e.target.value })}
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-xs font-bold text-gray-900"
                    />
                  <LocalizedTextFields
                    label={t('pgBodyTranslations')}
                    fallback={editForm.vision}
                    value={(editForm.visionI18n || {}) as LocalizedText}
                    onChange={(next) => setEditForm((prev) => ({ ...prev, visionI18n: Object.keys(next).length ? next : null }))}
                  />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-black text-gray-700 mb-1">{t('aboutModalBannerUrlLabel')}</label>
                  <input
                    type="text"
                    value={editForm.bannerImageUrl}
                    onChange={(e) => setEditForm({ ...editForm, bannerImageUrl: e.target.value })}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-xs font-bold text-gray-900"
                  />
                </div>

                {/* Team Members Editor */}
                <div className="pt-4 border-t border-gray-100 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-black text-gray-900">{t('aboutModalTeamHeading')} ({editForm.teamMembers?.length || 0})</h3>
                    <button
                      type="button"
                      onClick={() => {
                        const newMem = {
                          id: 'tm_' + Date.now(),
                          name: t('aboutNewMemberName'),
                          role: t('aboutNewMemberRole'),
                          photoUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=400',
                          bio: t('aboutNewMemberBio')
                        };
                        setEditForm({ ...editForm, teamMembers: [...(editForm.teamMembers || []), newMem] });
                      }}
                      className="px-3.5 py-2 bg-orange-600 text-white text-xs font-black rounded-xl hover:bg-orange-500 transition-all flex items-center cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5 mr-1" />
                      {t('aboutModalAddMember')}
                    </button>
                  </div>

                  <div className="space-y-3">
                    {editForm.teamMembers?.map((m, idx) => (
                      <div key={m.id || idx} className="p-3 bg-gray-50 rounded-2xl border border-gray-200 grid grid-cols-1 sm:grid-cols-3 gap-3 items-center">
                        <input
                          type="text"
                          placeholder={t('aboutTeamNamePlaceholder')}
                          value={m.name}
                          onChange={(e) => {
                            const copy = [...(editForm.teamMembers || [])];
                            copy[idx].name = e.target.value;
                            setEditForm({ ...editForm, teamMembers: copy });
                          }}
                          className="px-3 py-1.5 border border-gray-200 rounded-xl text-xs font-bold bg-white"
                        />
                        <input
                          type="text"
                          placeholder={t('role')}
                          value={m.role}
                          onChange={(e) => {
                            const copy = [...(editForm.teamMembers || [])];
                            copy[idx].role = e.target.value;
                            setEditForm({ ...editForm, teamMembers: copy });
                          }}
                          className="px-3 py-1.5 border border-gray-200 rounded-xl text-xs font-bold bg-white"
                        />
                        <div className="flex items-center space-x-2">
                          <input
                            type="text"
                            placeholder={t('aboutTeamPhotoPlaceholder')}
                            value={m.photoUrl}
                            onChange={(e) => {
                              const copy = [...(editForm.teamMembers || [])];
                              copy[idx].photoUrl = e.target.value;
                              setEditForm({ ...editForm, teamMembers: copy });
                            }}
                            className="w-full px-3 py-1.5 border border-gray-200 rounded-xl text-xs font-bold bg-white"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const copy = (editForm.teamMembers || []).filter((_, i) => i !== idx);
                              setEditForm({ ...editForm, teamMembers: copy });
                            }}
                            className="p-2 text-red-500 hover:text-red-700"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
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
                  {t('dlgCancel')}
                </button>
                <button
                  type="button"
                  onClick={handleSaveAboutInfo}
                  disabled={saving}
                  className="px-6 py-2.5 bg-orange-600 hover:bg-orange-500 text-white text-xs font-black rounded-xl shadow-md flex items-center space-x-2 disabled:opacity-50"
                >
                  {saving ? (
                    <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  <span>{t('aboutModalSave')}</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
