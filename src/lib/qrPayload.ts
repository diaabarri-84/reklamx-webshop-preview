/**
 * WHAT A QR CODE SAYS — the designer's QR panel (designer v2).
 *
 * A customer fills in a form (a link, a phone number, a contact card, a Wi-Fi
 * network); the code holds the text every phone camera understands for it:
 *   link     https://…            (a bare "shop.se" gets https://)
 *   phone    tel:+46…
 *   e-mail   mailto:a@b.se?subject=…&body=…
 *   SMS      SMSTO:+46…:message
 *   contact  a vCard 3.0
 *   Wi-Fi    WIFI:T:WPA;S:name;P:password;;
 *   text     as typed.
 * And back again, so a code on the board opens in its own form to be changed.
 * And what a phone needs to read it in print: big enough squares, and contrast.
 * Pure; scripts/test-qr-payload.mjs.
 */

export type QrKind = 'url' | 'text' | 'phone' | 'email' | 'sms' | 'vcard' | 'wifi';
export const QR_KINDS: readonly QrKind[] = ['url', 'text', 'phone', 'email', 'sms', 'vcard', 'wifi'];

export interface QrFields {
  url?: string;
  text?: string;
  phone?: string;
  email?: string;
  subject?: string;
  body?: string;
  first?: string;
  last?: string;
  org?: string;
  title?: string;
  web?: string;
  street?: string;
  zip?: string;
  city?: string;
  country?: string;
  ssid?: string;
  password?: string;
  security?: 'WPA' | 'WEP' | 'nopass';
}

const clean = (v: unknown) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
/** Digits and a leading +: what a dialler wants. "+46 (0)70…" drops the (0), which no phone dials. */
const phoneOf = (v: unknown) => {
  const s = clean(v).replace(/\(\s*0\s*\)/g, '');
  const plus = s.startsWith('+') ? '+' : '';
  return plus + s.replace(/[^\d]/g, '');
};
/**
 * A %-escape undone, or the text as it was: a lone "%" in an address made
 * decodeURIComponent throw, and the throw took the whole designer down when the code
 * was opened to be changed (code review DSN-14).
 */
const decoded = (v: string) => {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
};
const vcardEscape = (v: string) => v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
const vcardUnescape = (v: string) => v.replace(/\\(n|N|,|;|\\)/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c));
const wifiEscape = (v: string) => v.replace(/([\\;,":])/g, '\\$1');

/** The text for the code, or null when what the kind needs is missing. */
export function qrPayload(kind: QrKind, f: QrFields): string | null {
  switch (kind) {
    case 'url': {
      const u = clean(f.url);
      if (!u) return null;
      // No "." in a scheme here: "shop.se:8080/x" read as one and went into the code
      // without https:// — a text no phone opens as a link (code review DSN-14).
      return /^[a-z][a-z0-9+-]*:/i.test(u) ? u : `https://${u}`;
    }
    case 'text': {
      const t = String(f.text ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
      return t || null;
    }
    case 'phone': {
      const p = phoneOf(f.phone);
      return p.replace('+', '') ? `tel:${p}` : null;
    }
    case 'email': {
      const e = clean(f.email);
      if (!e) return null;
      const q = [
        clean(f.subject) && `subject=${encodeURIComponent(clean(f.subject))}`,
        String(f.body ?? '').trim() && `body=${encodeURIComponent(String(f.body).trim())}`,
      ].filter(Boolean);
      return `mailto:${e}${q.length ? `?${q.join('&')}` : ''}`;
    }
    case 'sms': {
      const p = phoneOf(f.phone);
      if (!p.replace('+', '')) return null;
      return `SMSTO:${p}:${String(f.body ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim()}`;
    }
    case 'vcard': {
      const first = clean(f.first);
      const last = clean(f.last);
      const org = clean(f.org);
      if (!first && !last && !org) return null;
      const lines = ['BEGIN:VCARD', 'VERSION:3.0', `N:${vcardEscape(last)};${vcardEscape(first)};;;`, `FN:${vcardEscape([first, last].filter(Boolean).join(' ') || org)}`];
      if (org) lines.push(`ORG:${vcardEscape(org)}`);
      if (clean(f.title)) lines.push(`TITLE:${vcardEscape(clean(f.title))}`);
      if (phoneOf(f.phone).replace('+', '')) lines.push(`TEL;TYPE=CELL:${phoneOf(f.phone)}`);
      if (clean(f.email)) lines.push(`EMAIL:${vcardEscape(clean(f.email))}`);
      if (clean(f.web)) lines.push(`URL:${vcardEscape(clean(f.web))}`);
      if (clean(f.street) || clean(f.city) || clean(f.zip) || clean(f.country)) {
        lines.push(`ADR;TYPE=WORK:;;${vcardEscape(clean(f.street))};${vcardEscape(clean(f.city))};;${vcardEscape(clean(f.zip))};${vcardEscape(clean(f.country))}`);
      }
      lines.push('END:VCARD');
      return lines.join('\n');
    }
    case 'wifi': {
      const ssid = clean(f.ssid);
      if (!ssid) return null;
      const sec = f.security === 'WEP' || f.security === 'nopass' ? f.security : 'WPA';
      const pass = sec === 'nopass' ? '' : String(f.password ?? '');
      return `WIFI:T:${sec};S:${wifiEscape(ssid)};${sec === 'nopass' ? '' : `P:${wifiEscape(pass)};`};`;
    }
  }
}

/** Split on `sep` where it is not escaped with a backslash. */
function splitEscaped(s: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (ch === '\\' && i + 1 < s.length) {
      cur += ch + s[i + 1];
      i += 1;
    } else if (ch === sep) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** What kind of code a text is, and its form filled in (a plain text when nothing else fits). */
export function parseQrPayload(text: string): { kind: QrKind; fields: QrFields } {
  const s = String(text ?? '');
  if (/^tel:/i.test(s)) return { kind: 'phone', fields: { phone: s.slice(4) } };
  if (/^mailto:/i.test(s)) {
    const [addr, query = ''] = s.slice(7).split('?');
    const params = new URLSearchParams(query);
    return { kind: 'email', fields: { email: decoded(addr), subject: params.get('subject') ?? '', body: params.get('body') ?? '' } };
  }
  if (/^SMSTO:/i.test(s)) {
    const rest = s.slice(6);
    const i = rest.indexOf(':');
    return { kind: 'sms', fields: { phone: i < 0 ? rest : rest.slice(0, i), body: i < 0 ? '' : rest.slice(i + 1) } };
  }
  if (/^WIFI:/i.test(s)) {
    const fields: QrFields = { security: 'WPA' };
    for (const part of splitEscaped(s.slice(5), ';')) {
      const m = /^([TSPH]):(.*)$/s.exec(part);
      if (!m) continue;
      const value = m[2].replace(/\\(.)/g, '$1');
      if (m[1] === 'T') fields.security = value === 'WEP' ? 'WEP' : value === 'nopass' || value === '' ? 'nopass' : 'WPA';
      if (m[1] === 'S') fields.ssid = value;
      if (m[1] === 'P') fields.password = value;
    }
    return { kind: 'wifi', fields };
  }
  if (/^BEGIN:VCARD/i.test(s)) {
    const fields: QrFields = {};
    for (const line of s.split(/\r?\n/)) {
      const i = line.indexOf(':');
      if (i < 0) continue;
      const key = line.slice(0, i).split(';')[0].toUpperCase();
      const value = line.slice(i + 1);
      if (key === 'N') {
        const [last = '', first = ''] = splitEscaped(value, ';').map(vcardUnescape);
        fields.last = last;
        fields.first = first;
      } else if (key === 'ORG') fields.org = vcardUnescape(value);
      else if (key === 'TITLE') fields.title = vcardUnescape(value);
      else if (key === 'TEL') fields.phone = value;
      else if (key === 'EMAIL') fields.email = vcardUnescape(value);
      else if (key === 'URL') fields.web = vcardUnescape(value);
      else if (key === 'ADR') {
        const parts = splitEscaped(value, ';').map(vcardUnescape);
        fields.street = parts[2] ?? '';
        fields.city = parts[3] ?? '';
        fields.zip = parts[5] ?? '';
        fields.country = parts[6] ?? '';
      }
    }
    return { kind: 'vcard', fields };
  }
  if (/^https?:\/\//i.test(s)) return { kind: 'url', fields: { url: s } };
  return { kind: 'text', fields: { text: s } };
}

// ---- how a code prints --------------------------------------------------------------------

/** The smallest module (one square of the code) phones read reliably in print, mm. */
export const QR_MIN_MODULE_MM = 0.3;
/** The least contrast between a code and what is behind it: WCAG's 3:1 for graphics. */
export const QR_MIN_CONTRAST = 3;

/** #rgb, #rrggbb, rgb(…), white or black as [r, g, b]; null for anything else. */
function rgbOf(colour: unknown): [number, number, number] | null {
  const s = String(colour ?? '').trim().toLowerCase();
  if (s === 'white') return [255, 255, 255];
  if (s === 'black') return [0, 0, 0];
  let m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s);
  if (m) return [m[1], m[2], m[3]].map((x) => parseInt(x + x, 16)) as [number, number, number];
  m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})(?:ff)?$/.exec(s);
  if (m) return [m[1], m[2], m[3]].map((x) => parseInt(x, 16)) as [number, number, number];
  m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)\s*(?:[,/]\s*1(?:\.0+)?\s*)?\)$/.exec(s);
  if (m) return [m[1], m[2], m[3]].map((x) => Math.min(255, Number(x))) as [number, number, number];
  return null;
}

const luminance = ([r, g, b]: [number, number, number]) => {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

/**
 * How far apart two colours are in lightness: 1 (the same) to 21 (black on white),
 * the WCAG contrast ratio. Either way round — a light code on a dark ground is read
 * too, so a white code is never refused for being white. Null when either is not a
 * plain, solid colour (nothing can be said about it).
 */
export function contrastRatio(a: unknown, b: unknown): number | null {
  const x = rgbOf(a);
  const y = rgbOf(b);
  if (!x || !y) return null;
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}
