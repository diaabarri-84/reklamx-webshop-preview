/**
 * QR code: a link, text, a phone number, an e-mail, an SMS, a contact card or a
 * Wi-Fi network (src/lib/qrPayload.ts), drawn as vector squares (rxObjects.ts RxQr)
 * so it is sharp at any size. A code chosen on the board opens here in its own form,
 * to be changed in place.
 */
import React, { useEffect, useState } from 'react';
import { QrCode } from 'lucide-react';
import type { TranslationKey } from '../../../../../lib/translations';
import { QR_MAX_TEXT } from '../../../../../lib/designQr';
import { QR_KINDS, parseQrPayload, qrPayload, type QrFields, type QrKind } from '../../../../../lib/qrPayload';
import type { RxQr } from '../../rxObjects';
import type { StudioEngine } from '../engine';
import { ColourPicker, SectionLabel } from '../ui';
import { Chip } from './ElementsPanel';

const KIND_LABEL: Record<QrKind, TranslationKey> = {
  url: 'stQrLink',
  text: 'stQrText',
  phone: 'stQrPhone',
  email: 'stQrEmail',
  sms: 'stQrSms',
  vcard: 'stQrContact',
  wifi: 'stQrWifi',
};

const DARKS = ['#000000', '#1d1d1b', '#3c3c3b', '#2d2e83', '#1d71b8', '#008d36', '#e30613', '#662483', '#951b81', '#c8a46e', '#706f6f', '#ffffff'];

export default function QrPanel({ engine, t, editing, onDone }: { engine: StudioEngine; t: (k: TranslationKey) => string; editing: RxQr | null; onDone: () => void }) {
  const [kind, setKind] = useState<QrKind>('url');
  const [fields, setFields] = useState<QrFields>({});
  const [fg, setFg] = useState('#000000');
  const [bg, setBg] = useState<'#ffffff' | ''>('#ffffff');
  const [problem, setProblem] = useState<TranslationKey | null>(null);

  // A code chosen on the board: its own form, filled in.
  useEffect(() => {
    if (!editing) return;
    const parsed = parseQrPayload(editing.rxQr?.text ?? '');
    setKind(parsed.kind);
    setFields(parsed.fields);
    setFg(typeof editing.fill === 'string' && editing.fill ? editing.fill : '#000000');
    setBg(editing.rxQrBg ? '#ffffff' : '');
  }, [editing]);

  const set = (k: keyof QrFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setProblem(null);
    setFields((f) => ({ ...f, [k]: e.target.value }));
  };

  const save = () => {
    const text = qrPayload(kind, fields);
    if (!text) {
      setProblem('stQrEmpty');
      return;
    }
    if (text.length > QR_MAX_TEXT) {
      setProblem('stQrTooLong');
      return;
    }
    const spec = { text, ecc: 'M' as const };
    if (editing) engine.updateQr(editing, spec, { fg, bg });
    else engine.addQr(spec, { fg, bg });
    onDone();
  };

  const field = (k: keyof QrFields, label: TranslationKey, type = 'text', multiline = false) => (
    <label className="block space-y-1" key={k}>
      <span className="text-[0.6875rem] font-bold text-gray-600">{t(label)}</span>
      {multiline ? (
        <textarea
          value={String(fields[k] ?? '')}
          onChange={set(k)}
          rows={3}
          className="w-full px-3 py-2 rounded-xl border border-gray-200 text-base sm:text-sm font-bold resize-y"
          data-rx-st-qr-field={k}
        />
      ) : (
        <input
          value={String(fields[k] ?? '')}
          onChange={set(k)}
          type={type}
          className="w-full h-10 px-3 rounded-xl border border-gray-200 text-base sm:text-sm font-bold"
          data-rx-st-qr-field={k}
        />
      )}
    </label>
  );

  return (
    <div className="space-y-4" data-rx-st-panel="qr">
      <p className="flex items-start gap-2 text-[0.6875rem] font-bold text-gray-500">
        <QrCode className="w-4 h-4 shrink-0 text-gray-400" />
        {t('stQrIntro')}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {QR_KINDS.map((k) => (
          <Chip
            key={k}
            active={kind === k}
            onClick={() => {
              setKind(k);
              setProblem(null);
            }}
            testId={`qr-${k}`}
          >
            {t(KIND_LABEL[k])}
          </Chip>
        ))}
      </div>

      <div className="space-y-2.5">
        {kind === 'url' && field('url', 'stQrUrl', 'url')}
        {kind === 'text' && field('text', 'stQrText', 'text', true)}
        {kind === 'phone' && field('phone', 'stQrNumber', 'tel')}
        {kind === 'email' && (
          <>
            {field('email', 'stQrEmailAddress', 'email')}
            {field('subject', 'stQrSubject')}
            {field('body', 'stQrMessage', 'text', true)}
          </>
        )}
        {kind === 'sms' && (
          <>
            {field('phone', 'stQrNumber', 'tel')}
            {field('body', 'stQrMessage', 'text', true)}
          </>
        )}
        {kind === 'vcard' && (
          <>
            <div className="grid grid-cols-2 gap-2">
              {field('first', 'stQrFirst')}
              {field('last', 'stQrLast')}
            </div>
            {field('org', 'stQrCompany')}
            {field('title', 'stQrJobTitle')}
            {field('phone', 'stQrNumber', 'tel')}
            {field('email', 'stQrEmailAddress', 'email')}
            {field('web', 'stQrWebsite', 'url')}
            {field('street', 'stQrStreet')}
            <div className="grid grid-cols-2 gap-2">
              {field('zip', 'stQrZip')}
              {field('city', 'stQrCity')}
            </div>
            {field('country', 'stQrCountry')}
          </>
        )}
        {kind === 'wifi' && (
          <>
            {field('ssid', 'stQrNetwork')}
            <label className="block space-y-1">
              <span className="text-[0.6875rem] font-bold text-gray-600">{t('stQrSecurity')}</span>
              <select
                value={fields.security ?? 'WPA'}
                onChange={set('security')}
                className="w-full h-10 px-3 rounded-xl border border-gray-200 text-base sm:text-sm font-bold bg-white"
                data-rx-st-qr-field="security"
              >
                <option value="WPA">WPA / WPA2 / WPA3</option>
                <option value="WEP">WEP</option>
                <option value="nopass">{t('stQrNoPassword')}</option>
              </select>
            </label>
            {fields.security !== 'nopass' && field('password', 'stQrPassword')}
          </>
        )}
      </div>

      <div>
        <SectionLabel>{t('stQrColour')}</SectionLabel>
        <ColourPicker value={fg} onPick={(c) => c && setFg(c)} palette={DARKS} labels={{ custom: t('dsgCustomColour'), eyedropper: t('stEyedropper'), hex: t('stHex') }} testId="qr" />
      </div>
      <div>
        <SectionLabel>{t('stQrBackground')}</SectionLabel>
        <div className="flex gap-1.5">
          <Chip active={bg === '#ffffff'} onClick={() => setBg('#ffffff')} testId="qr-bg-white">{t('stQrBgWhite')}</Chip>
          <Chip active={bg === ''} onClick={() => setBg('')} testId="qr-bg-none">{t('stQrBgNone')}</Chip>
        </div>
      </div>

      {problem && (
        <p role="alert" className="text-[0.6875rem] font-black text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{t(problem)}</p>
      )}
      <button
        type="button"
        onClick={save}
        data-rx-st-qr-save
        className="w-full px-4 py-2.5 rounded-full text-xs font-black uppercase tracking-wider text-white bg-[#0b77c4] hover:bg-[#0a68ab] shadow-md"
      >
        {editing ? t('stQrUpdate') : t('stQrAdd')}
      </button>
      <p className="text-[0.6875rem] font-bold text-gray-500">{t('stQrScanTip')}</p>
    </div>
  );
}
