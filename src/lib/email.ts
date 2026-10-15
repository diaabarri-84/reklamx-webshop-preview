// Order emails, sent over the shop's own SMTP.
//
// The shop runs on Google Workspace, so this talks to smtp.gmail.com rather than
// adding a third-party sending service. Two addresses are in play:
//   info@reklamx.se   — what customers see as the sender
//   order@reklamx.se  — where the shop is told a paid order arrived
//
// IMPORTANT for Google Workspace: SMTP_PASSWORD must be an APP PASSWORD, not the
// account's own password. Google refuses a normal password over SMTP on any
// account with 2-step verification. Create one at
// myaccount.google.com → Security → App passwords.
//
// With no SMTP settings the shop runs exactly as before and logs that email is
// disabled. It never blocks an order over a failed email: the money has already
// moved, and a customer who paid must not see an error because a mail server was
// briefly down.

import nodemailer, { type Transporter } from 'nodemailer';
import { deliveryAddressOf } from './deliveryAddress.js';

let transporter: Transporter | null = null;
let attempted = false;

export type EmailConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  shopInbox: string;
  /**
   * Where a CUSTOMER's question should land, as opposed to an operational
   * notice about an order.
   *
   * The owner keeps the two apart on purpose: "you have a new order" goes to
   * the order mailbox he works from, and anything a customer writes goes to the
   * address the business answers on. One setting cannot do both — it used to,
   * and it meant a customer replying to their own confirmation reached an
   * operations inbox nobody answers from.
   *
   * Falls back to shopInbox when unset, so a shop that has not split them keeps
   * behaving exactly as before.
   */
  contactInbox: string;
};

function readConfig(): EmailConfig | null {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASSWORD?.trim();
  if (!host || !user || !pass) return null;

  // 465 is implicit TLS; 587 upgrades with STARTTLS. Getting this pair wrong is
  // the usual reason SMTP "just hangs".
  const port = Number(process.env.SMTP_PORT) || 465;
  return {
    host,
    port,
    secure: port === 465,
    user,
    pass,
    from: process.env.SMTP_FROM?.trim() || user,
    shopInbox: process.env.SHOP_ORDER_INBOX?.trim() || user,
    contactInbox: process.env.SHOP_CONTACT_INBOX?.trim()
      || process.env.SHOP_ORDER_INBOX?.trim()
      || user,
  };
}

/** What the dashboard may show about the mail setup — the addresses, never the password. */
export function mailSetup(): { configured: boolean; from: string | null; defaultInbox: string | null } {
  const config = readConfig();
  return config
    ? { configured: true, from: config.from, defaultInbox: config.shopInbox }
    : { configured: false, from: null, defaultInbox: null };
}

const EMAIL_RE = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;
/** At most this many addresses get the shop's new-order notice. */
export const ORDER_INBOX_MAX = 5;

/**
 * The owner's "send new-order e-mails to" list, from the dashboard: addresses
 * split on commas, semicolons or spaces, de-duplicated, lower-cased. Null when
 * any of them is not an address (the save is refused, nothing half-saved), or
 * there are more than ORDER_INBOX_MAX. Empty is valid: "use the server's default".
 */
export function cleanInboxList(raw: unknown): string[] | null {
  const parts = (Array.isArray(raw) ? raw.map(String) : String(raw ?? '').split(/[\s,;]+/))
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (parts.some((p) => p.length > 200 || !EMAIL_RE.test(p))) return null;
  const unique = [...new Set(parts)];
  return unique.length > ORDER_INBOX_MAX ? null : unique;
}

export function getMailer(): { transporter: Transporter; config: EmailConfig } | null {
  const config = readConfig();
  if (!config) {
    if (!attempted) {
      attempted = true;
      console.warn('SMTP is not configured — order emails are disabled.');
    }
    return null;
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.user, pass: config.pass },
    });
    console.log(`Email ready — ${config.host}:${config.port} as ${config.user}`);
  }
  return { transporter, config };
}

/**
 * THE ACCOUNT MAILBOX — password resets and e-mail checks (2026-10-15).
 *
 * The owner wanted one address per purpose: orders from order@, account mail
 * from noreply@, campaigns from their own. SMTP_ACCOUNT_USER/_PASSWORD (and
 * optionally _FROM) name the second mailbox, on the same SMTP_HOST/PORT. Unset,
 * account mail goes out through the order mailbox as before.
 */
let accountTransporter: Transporter | null = null;
export function getAccountMailer(): { transporter: Transporter; config: EmailConfig } | null {
  const base = readConfig();
  const user = process.env.SMTP_ACCOUNT_USER?.trim();
  const pass = process.env.SMTP_ACCOUNT_PASSWORD?.trim();
  if (!base || !user || !pass) return getMailer();
  const config: EmailConfig = { ...base, user, pass, from: process.env.SMTP_ACCOUNT_FROM?.trim() || user };
  if (!accountTransporter) {
    accountTransporter = nodemailer.createTransport({ host: config.host, port: config.port, secure: config.secure, auth: { user, pass } });
    console.log(`Account email ready — ${config.host}:${config.port} as ${user}`);
  }
  return { transporter: accountTransporter, config };
}

/**
 * The shop's logo, ready to travel inside the message.
 *
 * It is stored in settings/siteConfig as a data: URL, which is exactly what the
 * <img> on the site wants and exactly what Gmail, Outlook and Apple Mail all
 * refuse to render in an email. So the bytes are attached instead and the
 * <img> points at the attachment with cid:. Anything that is not a plain
 * base64 image — an http URL, an SVG, an empty setting — returns null and the
 * email falls back to the wordmark it has always had.
 */
export const LOGO_CID = 'shop-logo';

export type LogoAttachment = { filename: string; content: Buffer; contentType: string; cid: string };

export function parseLogo(dataUrl: unknown): LogoAttachment | null {
  if (typeof dataUrl !== 'string') return null;
  const match = dataUrl.trim().match(/^data:(image\/(png|jpeg|jpg|gif|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) return null;
  const content = Buffer.from(match[3].replace(/\s+/g, ''), 'base64');
  // A logo is a few tens of KB. Anything approaching a megabyte is a mistake in
  // the settings, and some mail servers reject the message rather than the part.
  if (content.length === 0 || content.length > 512 * 1024) return null;
  const kind = match[2].toLowerCase();
  return {
    filename: `logo.${kind === 'jpeg' ? 'jpg' : kind}`,
    content,
    contentType: match[1].toLowerCase(),
    cid: LOGO_CID,
  };
}

const money = (n: number, currency = 'SEK') =>
  `${(Number(n) || 0).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

const escape = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/**
 * One visual shell so both emails look like they come from the same shop.
 *
 * `logoSrc` is whatever an <img src> should say: `cid:shop-logo` for a real
 * send, or the data: URL itself when a preview is being written to disk for a
 * browser. Without one the header is the heading alone, as before.
 */
function shell(title: string, body: string, footer: string, logo?: { src: string; alt: string }) {
  const logoTag = logo
    ? `<img src="${escape(logo.src)}" alt="${escape(logo.alt)}" width="200"
           style="display:block;width:200px;max-width:60%;height:auto;border:0;margin:0 0 16px;outline:none;text-decoration:none" />`
    : '';
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f6f8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#101519">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e3e8ee">
    <div style="padding:24px 28px;border-bottom:1px solid #eef1f4">
      ${logoTag}
      <h1 style="margin:0;font-size:20px;font-weight:800;letter-spacing:-.01em">${escape(title)}</h1>
    </div>
    <div style="padding:24px 28px;font-size:15px;line-height:1.65;color:#3d4753">${body}</div>
    <div style="padding:18px 28px;background:#fafbfc;border-top:1px solid #eef1f4;font-size:12px;color:#8b95a1">${footer}</div>
  </div></body></html>`;
}

/**
 * THE ORDER E-MAILS' WORDS (2026-10-15). The customer's confirmation is written in
 * the language he shopped in (order.language, set at checkout); the shop's own
 * notice is Swedish, the language it is read in.
 */
type MailLang = 'sv' | 'en' | 'da' | 'no';
const mailLang = (v: unknown): MailLang => ((['sv', 'en', 'da', 'no'] as const).find((l) => l === v) ?? 'sv');
const OM: Record<MailLang, Record<string, string>> = {
  en: {
    net: 'Net', vat: 'VAT', total: 'Total', due: 'Estimated ready / delivery', delivery: 'Delivery', note: 'Your note',
    thanksPaid: 'Thank you for your order. We have received your payment and your job is now in our queue.',
    thanksPod: 'Thank you for your order. You pay when you receive it — <strong>{0} on delivery</strong> — and your job is now in our queue.',
    order: 'Order', title: 'Your order is confirmed', subject: '{0} — order #{1} confirmed', view: 'View your order',
    wrong: 'If anything looks wrong, reply to this email and we will sort it out.',
    collect: 'Collect your order here', maps: 'Open in maps',
    designTitle: 'Your design is still to be made', designFor: 'You chose to design online for: {0}.',
    designHow: 'Make it from your order page, in the same designer — press &ldquo;Create your design&rdquo; on the line: <a href="{0}" style="color:#1a56db;font-weight:700">create your design</a>. We start printing once it is there.',
    fileTitle: 'We still need your print file', fileFor: 'You ordered without attaching artwork for: {0}.',
    fileHow: 'Send it from your order page — there is an upload box on each line: <a href="{0}" style="color:#1a56db;font-weight:700">upload your file</a>. Replying to this email with the file works too.',
    studioTitle: 'Our designer makes your artwork', studioFor: 'For: {0}. Reply to this email with your logo, the text you want and any requests — our designer starts from them.',
    reprintTitle: 'A reprint of an earlier order', reprintFor: 'For: {0}. We reuse the artwork from your earlier order with us. Ordered from us more than once? Reply to this email with the number of the order you want reprinted.',
  },
  sv: {
    net: 'Netto', vat: 'Moms', total: 'Totalt', due: 'Beräknat klar / leverans', delivery: 'Leverans', note: 'Din kommentar',
    thanksPaid: 'Tack för din beställning! Vi har tagit emot din betalning och ditt jobb ligger nu i vår kö.',
    thanksPod: 'Tack för din beställning! Du betalar när du tar emot den — <strong>{0} vid leverans</strong> — och ditt jobb ligger nu i vår kö.',
    order: 'Order', title: 'Din beställning är bekräftad', subject: '{0} — order #{1} bekräftad', view: 'Visa din order',
    wrong: 'Ser något fel ut? Svara på det här mejlet så ordnar vi det.',
    collect: 'Hämta din order här', maps: 'Öppna i kartan',
    designTitle: 'Din design återstår att göra', designFor: 'Du valde att designa online för: {0}.',
    designHow: 'Gör den från din ordersida, i samma designverktyg — tryck på &ldquo;Skapa din design&rdquo; på raden: <a href="{0}" style="color:#1a56db;font-weight:700">skapa din design</a>. Vi börjar trycka när den är klar.',
    fileTitle: 'Vi behöver fortfarande din tryckfil', fileFor: 'Du beställde utan att bifoga tryckfil för: {0}.',
    fileHow: 'Skicka den från din ordersida — det finns en uppladdningsruta på varje rad: <a href="{0}" style="color:#1a56db;font-weight:700">ladda upp din fil</a>. Det går också bra att svara på det här mejlet med filen.',
    studioTitle: 'Vår designer gör ditt original', studioFor: 'För: {0}. Svara på det här mejlet med din logotyp, texten du vill ha och eventuella önskemål — vår designer utgår från dem.',
    reprintTitle: 'Omtryck av en tidigare order', reprintFor: 'För: {0}. Vi använder originalet från din tidigare order hos oss. Har du beställt fler gånger? Svara på det här mejlet med numret på ordern som ska tryckas om.',
  },
  da: {
    net: 'Netto', vat: 'Moms', total: 'I alt', due: 'Forventet klar / levering', delivery: 'Levering', note: 'Din kommentar',
    thanksPaid: 'Tak for din bestilling! Vi har modtaget din betaling, og din opgave er nu i vores kø.',
    thanksPod: 'Tak for din bestilling! Du betaler, når du modtager den — <strong>{0} ved levering</strong> — og din opgave er nu i vores kø.',
    order: 'Ordre', title: 'Din bestilling er bekræftet', subject: '{0} — ordre #{1} bekræftet', view: 'Se din ordre',
    wrong: 'Ser noget forkert ud? Svar på denne e-mail, så ordner vi det.',
    collect: 'Hent din ordre her', maps: 'Åbn i kort',
    designTitle: 'Dit design mangler stadig', designFor: 'Du valgte at designe online til: {0}.',
    designHow: 'Lav det fra din ordreside i samme designværktøj — tryk på &ldquo;Lav dit design&rdquo; på linjen: <a href="{0}" style="color:#1a56db;font-weight:700">lav dit design</a>. Vi begynder at trykke, når det er klar.',
    fileTitle: 'Vi mangler stadig din trykfil', fileFor: 'Du bestilte uden at vedhæfte trykfil til: {0}.',
    fileHow: 'Send den fra din ordreside — der er en upload-boks på hver linje: <a href="{0}" style="color:#1a56db;font-weight:700">upload din fil</a>. Du kan også svare på denne e-mail med filen.',
    studioTitle: 'Vores designer laver dit design', studioFor: 'Til: {0}. Svar på denne e-mail med dit logo, den tekst du ønsker og eventuelle ønsker — vores designer tager udgangspunkt i dem.',
    reprintTitle: 'Genoptryk af en tidligere ordre', reprintFor: 'Til: {0}. Vi genbruger designet fra din tidligere ordre hos os. Har du bestilt flere gange? Svar på denne e-mail med nummeret på den ordre, der skal genoptrykkes.',
  },
  no: {
    net: 'Netto', vat: 'MVA', total: 'Totalt', due: 'Beregnet klar / levering', delivery: 'Levering', note: 'Din kommentar',
    thanksPaid: 'Takk for bestillingen! Vi har mottatt betalingen din, og jobben din ligger nå i køen vår.',
    thanksPod: 'Takk for bestillingen! Du betaler når du mottar den — <strong>{0} ved levering</strong> — og jobben din ligger nå i køen vår.',
    order: 'Ordre', title: 'Bestillingen din er bekreftet', subject: '{0} — ordre #{1} bekreftet', view: 'Se ordren din',
    wrong: 'Ser noe feil ut? Svar på denne e-posten, så ordner vi det.',
    collect: 'Hent ordren din her', maps: 'Åpne i kart',
    designTitle: 'Designet ditt gjenstår', designFor: 'Du valgte å designe online for: {0}.',
    designHow: 'Lag det fra ordresiden din, i samme designverktøy — trykk på &ldquo;Lag designet ditt&rdquo; på linjen: <a href="{0}" style="color:#1a56db;font-weight:700">lag designet ditt</a>. Vi begynner å trykke når det er klart.',
    fileTitle: 'Vi trenger fortsatt trykkfilen din', fileFor: 'Du bestilte uten å legge ved trykkfil for: {0}.',
    fileHow: 'Send den fra ordresiden din — det er en opplastingsboks på hver linje: <a href="{0}" style="color:#1a56db;font-weight:700">last opp filen din</a>. Du kan også svare på denne e-posten med filen.',
    studioTitle: 'Designeren vår lager originalen din', studioFor: 'For: {0}. Svar på denne e-posten med logoen din, teksten du vil ha og eventuelle ønsker — designeren vår tar utgangspunkt i dem.',
    reprintTitle: 'Nytt opptrykk av en tidligere ordre', reprintFor: 'For: {0}. Vi gjenbruker originalen fra den tidligere ordren din hos oss. Har du bestilt flere ganger? Svar på denne e-posten med nummeret på ordren som skal trykkes på nytt.',
  },
};
const fill = (t: string, ...v: string[]) => v.reduce((acc, x, i) => acc.split(`{${i}}`).join(x), t);

function itemRows(order: any) {
  return (order.items ?? [])
    .map(
      (i: any) => `<tr>
        <td style="padding:8px 0;border-bottom:1px solid #eef1f4">${escape(i.productName)} × ${escape(i.quantity)}</td>
        <td style="padding:8px 0;border-bottom:1px solid #eef1f4;text-align:right;white-space:nowrap">${money(i.price, order.currency)}</td>
      </tr>`,
    )
    .join('');
}

function totalsRows(order: any, lang: MailLang = 'en') {
  const w = OM[lang];
  const vatPct = Math.round((Number(order.vatRate) || 0.25) * 1000) / 10;
  return `
    <tr><td style="padding:6px 0">${w.net}</td><td style="padding:6px 0;text-align:right">${money(order.netTotal, order.currency)}</td></tr>
    <tr><td style="padding:6px 0">${w.vat} (${vatPct}%)</td><td style="padding:6px 0;text-align:right">${money(order.vatAmount, order.currency)}</td></tr>
    <tr><td style="padding:10px 0;font-weight:800;border-top:1px solid #e3e8ee">${w.total}</td>
        <td style="padding:10px 0;text-align:right;font-weight:800;border-top:1px solid #e3e8ee">${money(order.grossTotal, order.currency)}</td></tr>`;
}

/** A readable Swedish-style date from a plain YYYY-MM-DD, or '' if there is none. */
function dueDateLine(order: any, lang: MailLang = 'en') {
  if (!order?.dueDate) return '';
  return `<p style="margin-top:6px"><strong>${OM[lang].due}:</strong> ${escape(order.dueDate)}</p>`;
}

/**
 * The lines of an order that are still waiting for a print file — WITH THE SIZE.
 *
 * 15.6.7 — this returned names only, so the one message that reaches a customer
 * who bought before his artwork existed said which product it was waiting for
 * and not how big the file has to be. That is the question his designer asks
 * him, and the answer was on a screen he had no reason to open.
 *
 * The size is whichever the order actually recorded: what the file itself was
 * measured at, what the server priced the line on, or the print size taken from
 * the option he chose. A line with none of those is named without one rather
 * than with a guess.
 */
function pendingArtworkNames(order: any): string[] {
  return (order?.items ?? [])
    .filter((i: any) => i?.artworkPending)
    .map((i: any) => {
      const name = String(i?.productName ?? 'item');
      const w = Number(i?.fileSpecs?.widthCm) || Number(i?.widthCm) || Number(i?.printWidthCm) || 0;
      const h = Number(i?.fileSpecs?.heightCm) || Number(i?.heightCm) || Number(i?.printHeightCm) || 0;
      return w > 0 && h > 0 ? `${name} (${w} × ${h} cm)` : name;
    });
}

/**
 * A line bought as "Design online" before it was designed (designer v2, design
 * later): the customer designs it from his order page, so his e-mail sends him
 * there to DESIGN it — not to upload a print file he was never going to make.
 */
const designLaterLine = (i: any) => i?.artworkPending === true && !!i?.designLater && typeof i.designLater === 'object';
const designLaterOnly = (order: any) => ({ ...order, items: (order?.items ?? []).filter(designLaterLine) });
const filesOnly = (order: any) => ({ ...order, items: (order?.items ?? []).filter((i: any) => !designLaterLine(i)) });

/**
 * Lines whose artwork the SHOP provides — a reprint of an earlier order's file, or
 * the studio's design (src/lib/artwork.ts). They are not "waiting for artwork"
 * from the customer, and the shop's own e-mail must still say what they need.
 */
function shopArtworkLines(order: any): string {
  const names = (source: string) =>
    (order?.items ?? []).filter((i: any) => i?.artworkSource === source).map((i: any) => String(i?.productName ?? 'item'));
  const reprint = names('reprint');
  const studio = names('studio');
  return [
    reprint.length ? `<p style="margin-top:6px;font-weight:800;color:#0b5c8a">Omtryck — använd originalet från den tidigare ordern: ${escape(reprint.join(', '))}</p>` : '',
    studio.length ? `<p style="margin-top:6px;font-weight:800;color:#0b5c8a">Studiodesign — vår designer gör originalet: ${escape(studio.join(', '))}</p>` : '',
  ].join('');
}

/**
 * What the CUSTOMER is asked for on a line whose artwork the shop supplies. The
 * product page tells him to reply to this e-mail with his logo and texts (the
 * studio) or with the earlier order's number (a reprint) — so this e-mail must
 * ask. It used to say nothing at all, and his order page has no upload box for
 * such a line (it is not waiting for HIS file): a customer who had paid 1 795 kr
 * for a design had no way to send the shop his logo.
 */
function shopArtworkAsk(order: any, lang: MailLang = 'en'): string {
  const w = OM[lang];
  const names = (source: string) =>
    (order?.items ?? []).filter((i: any) => i?.artworkSource === source).map((i: any) => String(i?.productName ?? 'item'));
  const studio = names('studio');
  const reprint = names('reprint');
  if (!studio.length && !reprint.length) return '';
  return `<div data-rx-shop-artwork-ask style="margin-top:18px;padding:14px 16px;background:#eef6fb;border:1px solid #b9d9ec;border-radius:12px">
    ${
      studio.length
        ? `<p style="margin:0;font-weight:800">${w.studioTitle}</p>
           <p style="margin:6px 0 0">${fill(w.studioFor, escape(studio.join(', ')))}</p>`
        : ''
    }
    ${
      reprint.length
        ? `<p style="margin:${studio.length ? '14px' : '0'} 0 0;font-weight:800">${w.reprintTitle}</p>
           <p style="margin:6px 0 0">${fill(w.reprintFor, escape(reprint.join(', ')))}</p>`
        : ''
    }
  </div>`;
}

/**
 * Where to collect, printed only when the customer actually chose Pickup and the
 * owner has filled the address in. An empty settings block prints nothing rather
 * than an empty box with a heading.
 */
function pickupBlock(order: any, pickup: any, lang: MailLang = 'en') {
  // `enabled` is the owner's switch and the checkout already obeys it. Reading
  // it only there meant an owner who filled the address in but left the switch
  // off saw nothing on screen — and the shop emailed the customer a "Collect
  // your order here" box with that address anyway.
  if (order?.shippingMethod !== 'pickup' || !pickup || pickup.enabled === false) return '';
  const lines = [pickup.companyName, pickup.address, pickup.phone].filter(
    (v: unknown) => typeof v === 'string' && v.trim(),
  );
  const hours = (pickup.openingHours ?? [])
    .filter((h: any) => (h?.days ?? '').trim() || (h?.hours ?? '').trim())
    .map(
      (h: any) =>
        `<tr><td style="padding:2px 12px 2px 0;color:#6c7883">${escape(h.days)}</td><td style="padding:2px 0">${escape(h.hours)}</td></tr>`,
    )
    .join('');
  if (lines.length === 0 && !hours) return '';

  return `
    <div style="margin-top:18px;padding:14px 16px;background:#f7f9fb;border:1px solid #e3e8ee;border-radius:12px">
      <p style="margin:0 0 6px;font-weight:800">${OM[lang].collect}</p>
      ${lines
        .map(
          // The address is authored as one line per row in a textarea. HTML
          // collapses those newlines, so without pre-line the whole address
          // arrives as one run-on line — while the checkout, which uses
          // whitespace-pre-line, shows it correctly. Same value, two answers.
          (l: string) => `<p style="margin:0;white-space:pre-line">${escape(l)}</p>`,
        )
        .join('')}
      ${hours ? `<table style="margin-top:8px;font-size:13px;border-collapse:collapse">${hours}</table>` : ''}
      ${pickup.note ? `<p style="margin:8px 0 0;color:#6c7883">${escape(pickup.note)}</p>` : ''}
      ${pickup.mapsUrl ? `<p style="margin:8px 0 0"><a href="${escape(pickup.mapsUrl)}" style="color:#1a56db">${OM[lang].maps}</a></p>` : ''}
    </div>`;
}

export function customerConfirmation(
  order: any,
  shopName: string,
  orderUrl: string,
  pickup?: any,
  logoSrc?: string,
) {
  // In the language he shopped in (order.language), Swedish when unknown.
  const lang = mailLang(order?.language);
  const w = OM[lang];
  // Placed to pay on delivery: nothing was paid, and the e-mail must not say it was.
  const onDelivery = order?.payOnDelivery === true && order?.paymentStatus !== 'paid';
  const body = `
    <p>${onDelivery ? fill(w.thanksPod, money(order.grossTotal, order.currency)) : w.thanksPaid}</p>
    <p style="margin:20px 0 8px;font-weight:700">${w.order} #${escape(order.id)}</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px">${itemRows(order)}${totalsRows(order, lang)}</table>
    ${order.shippingMethodTitle ? `<p style="margin-top:18px"><strong>${w.delivery}:</strong> ${escape(order.shippingMethodTitle)}</p>` : ''}
    ${dueDateLine(order, lang)}
    ${order.notes ? `<p style="margin-top:6px"><strong>${w.note}:</strong> ${escape(order.notes)}</p>` : ''}
    ${pickupBlock(order, pickup, lang)}
    ${
      pendingArtworkNames(designLaterOnly(order)).length
        ? `<div style="margin-top:18px;padding:14px 16px;background:#fff8e6;border:1px solid #f2d98d;border-radius:12px" data-rx-design-later-ask>
             <p style="margin:0;font-weight:800">${w.designTitle}</p>
             <p style="margin:6px 0 0">${fill(w.designFor, escape(pendingArtworkNames(designLaterOnly(order)).join(', ')))}</p>
             <p style="margin:6px 0 0">${fill(w.designHow, escape(orderUrl))}</p>
           </div>`
        : ''
    }
    ${
      pendingArtworkNames(filesOnly(order)).length
        ? `<div style="margin-top:18px;padding:14px 16px;background:#fff8e6;border:1px solid #f2d98d;border-radius:12px">
             <p style="margin:0;font-weight:800">${w.fileTitle}</p>
             <p style="margin:6px 0 0">${fill(w.fileFor, escape(pendingArtworkNames(filesOnly(order)).join(', ')))}</p>
             <!-- 15.6.7 — the order page has an UPLOAD BOX on it, and this
                  message used to offer only "reply to this email": the one route
                  that needs a human at our end to notice the attachment, move
                  the file and mark the line. The link is the same one the button
                  below uses and it carries the guest token. -->
             <p style="margin:6px 0 0">${fill(w.fileHow, escape(orderUrl))}</p>
           </div>`
        : ''
    }
    ${shopArtworkAsk(order, lang)}
    <p style="margin-top:22px"><a href="${escape(orderUrl)}" style="display:inline-block;background:#101519;color:#fff;padding:11px 20px;border-radius:10px;text-decoration:none;font-weight:700">${w.view}</a></p>
    <p style="margin-top:20px;color:#6c7883">${w.wrong}</p>`;
  return {
    subject: fill(w.subject, shopName, String(order.id)),
    html: shell(
      w.title,
      body,
      `${escape(shopName)}`,
      logoSrc ? { src: logoSrc, alt: shopName } : undefined,
    ),
  };
}

export function shopNotification(order: any, shopName: string, logoSrc?: string) {
  const c = order.customerDetails ?? {};
  // A SEPARATE delivery address is said out loud — this e-mail printed only the
  // billing one, so a parcel for Frankfurt read like one for Stockholm.
  const dest = deliveryAddressOf(order);
  const deliverTo = dest.separate
    ? [dest.name, dest.company, dest.address1, dest.address2, [dest.postcode, dest.city].filter(Boolean).join(' '), dest.country]
        .filter(Boolean)
        .join(', ')
    : '';
  const onDelivery = order?.payOnDelivery === true && order?.paymentStatus !== 'paid';
  const body = `
    <p><strong>${onDelivery ? `En ny order har kommit in — BETALNING VID LEVERANS: ${money(order.grossTotal, order.currency)} är ännu inte betalt.` : 'En betald order har kommit in.'}</strong></p>
    <table style="width:100%;border-collapse:collapse;font-size:14px">${itemRows(order)}${totalsRows(order, 'sv')}</table>
    <p style="margin-top:18px;font-weight:700">Kund</p>
    <p style="margin:0">${escape(order.customerName)} — ${escape(order.customerEmail)}${c.phone ? ` — ${escape(c.phone)}` : ''}</p>
    ${c.company ? `<p style="margin:4px 0 0">${escape(c.company)}${c.taxId ? ` (${escape(c.taxId)})` : ''}</p>` : ''}
    <p style="margin:4px 0 0">${escape([c.address1, c.postcode, c.city, c.country].filter(Boolean).join(', '))}</p>
    ${deliverTo ? `<p style="margin:8px 0 0"><strong>Leverera till:</strong> ${escape(deliverTo)}</p>` : ''}
    ${order.shippingMethodTitle ? `<p style="margin-top:12px"><strong>Leverans:</strong> ${escape(order.shippingMethodTitle)}</p>` : ''}
    ${dueDateLine(order, 'sv')}
    ${order.language && order.language !== 'sv' ? `<p style="margin-top:6px;color:#6c7883">Kundens språk: ${escape(String(order.language).toUpperCase())}</p>` : ''}
    ${
      pendingArtworkNames(designLaterOnly(order)).length
        ? `<p style="margin-top:6px;font-weight:800;color:#a15c00">Väntar på kundens onlinedesign: ${escape(pendingArtworkNames(designLaterOnly(order)).join(', '))}</p>`
        : ''
    }
    ${
      pendingArtworkNames(filesOnly(order)).length
        ? `<p style="margin-top:6px;font-weight:800;color:#a15c00">Väntar på tryckfil: ${escape(pendingArtworkNames(filesOnly(order)).join(', '))}</p>`
        : ''
    }
    ${shopArtworkLines(order)}
    ${order.notes ? `<p style="margin-top:6px"><strong>Kundens kommentar:</strong> ${escape(order.notes)}</p>` : ''}
    ${order.molliePaymentId ? `<p style="margin-top:6px;color:#6c7883">Betalningsreferens: ${escape(order.molliePaymentId)}</p>` : ''}`;
  return {
    subject: onDelivery
      ? `Ny order #${order.id} — BETALNING VID LEVERANS — ${money(order.grossTotal, order.currency)}`
      : `Ny betald order #${order.id} — ${money(order.grossTotal, order.currency)}`,
    html: shell(
      `Ny order #${order.id}`,
      body,
      `${escape(shopName)} — automatiskt meddelande`,
      logoSrc ? { src: logoSrc, alt: shopName } : undefined,
    ),
  };
}

/**
 * The shop's copy of "the missing print file just arrived".
 *
 * Only the shop is told. The customer already saw the file land on their own
 * order page, and a second mail saying so is noise — but the press has no
 * reason to look at an order again until something changes, so it needs this.
 */
export function artworkNotification(
  order: any,
  shopName: string,
  lines: { productName: string; fileName: string; fileUrl?: string }[],
  orderUrl: string,
  logoSrc?: string,
) {
  const stillWaiting = pendingArtworkNames(order);
  const body = `
    <p><strong>A print file has arrived for order #${escape(order.id)}.</strong></p>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      ${lines
        .map(
          (l) => `<tr>
            <td style="padding:8px 0;border-bottom:1px solid #eef1f4">${escape(l.productName)}</td>
            <td style="padding:8px 0;border-bottom:1px solid #eef1f4;text-align:right">
              ${l.fileUrl ? `<a href="${escape(l.fileUrl)}" style="color:#1a56db">${escape(l.fileName)}</a>` : escape(l.fileName)}
            </td>
          </tr>`,
        )
        .join('')}
    </table>
    <p style="margin-top:18px">${escape(order.customerName)} — ${escape(order.customerEmail)}</p>
    ${
      stillWaiting.length
        ? `<p style="margin-top:6px;font-weight:800;color:#a15c00">Still waiting for artwork: ${escape(stillWaiting.join(', '))}</p>`
        : `<p style="margin-top:6px;font-weight:800;color:#1a7f37">Every line of this order now has its file.</p>`
    }
    <p style="margin-top:22px"><a href="${escape(orderUrl)}" style="display:inline-block;background:#101519;color:#fff;padding:11px 20px;border-radius:10px;text-decoration:none;font-weight:700">Open the order</a></p>`;
  return {
    subject: `Print file received — order #${order.id}`,
    html: shell(
      `Print file received`,
      body,
      `${escape(shopName)} — automatic notification`,
      logoSrc ? { src: logoSrc, alt: shopName } : undefined,
    ),
  };
}

/**
 * Tell the shop that a file arrived. Never throws, for the same reason the
 * order emails do not: the file is already stored, and the customer must not be
 * shown a failure because a mail server was slow.
 */
export async function sendArtworkNotification(
  order: any,
  shopName: string,
  lines: { productName: string; fileName: string; fileUrl?: string }[],
  orderUrl: string,
  logoDataUrl?: unknown,
) {
  const mailer = getMailer();
  if (!mailer) return { sent: false, reason: 'smtp_not_configured' as const };
  const { transporter, config } = mailer;
  if (!config.shopInbox) return { sent: false, reason: 'no_shop_inbox' as const };

  const logo = parseLogo(logoDataUrl);
  const mail = artworkNotification(order, shopName, lines, orderUrl, logo ? `cid:${logo.cid}` : undefined);

  try {
    await transporter.sendMail({
      from: `${shopName} <${config.from}>`,
      to: config.shopInbox,
      replyTo: order.customerEmail || config.shopInbox,
      subject: mail.subject,
      html: mail.html,
      ...(logo ? { attachments: [logo] } : {}),
    });
    return { sent: true };
  } catch (err: any) {
    console.error('Artwork notification failed:', err?.message ?? err);
    return { sent: false, reason: String(err?.message ?? err).slice(0, 160) };
  }
}

/**
 * Tell the customer their money is on the way back, and give them the document.
 *
 * A refund the customer only discovers from their bank statement is a support
 * call. And the kreditnota is not a courtesy: under Swedish rules the credit note
 * is the document that reverses an invoice, and the customer's own bookkeeping
 * needs it — so the NUMBER is in the mail even though the printable sheet lives
 * in the dashboard.
 *
 * Never throws. The money has already moved; a slow mail server must not turn a
 * completed refund into an error.
 */
export async function sendCreditNoteEmail(
  note: {
    creditNoteNumber: string;
    orderNumber?: string;
    orderId: string;
    gross: number;
    net: number;
    vat: number;
    currency?: string;
    reason?: string;
    customerEmail?: string | null;
    customerName?: string | null;
  },
  shopName: string,
  dashboardUrl: string,
  logoDataUrl?: unknown,
) {
  const mailer = getMailer();
  if (!mailer) return { sent: false, reason: 'smtp_not_configured' as const };
  const to = String(note.customerEmail ?? '').trim();
  if (!to) return { sent: false, reason: 'no_customer_email' as const };

  const { transporter, config } = mailer;
  const logo = parseLogo(logoDataUrl);
  const currency = note.currency || 'SEK';
  const money = (n: number) => `${n.toFixed(2).replace('.', ',')} ${currency}`;
  const order = note.orderNumber || note.orderId;

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#111;max-width:560px">
      ${logo ? `<img src="cid:${logo.cid}" alt="${shopName}" style="max-height:48px;margin-bottom:16px">` : ''}
      <h2 style="margin:0 0 8px">Kreditnota ${note.creditNoteNumber}</h2>
      <p style="margin:0 0 16px;color:#444">
        We have refunded part or all of order <strong>${order}</strong>.
        This credit note is the document for your records.
      </p>
      <table style="border-collapse:collapse;width:100%;font-size:14px">
        <tr><td style="padding:6px 0;color:#666">Net</td><td style="padding:6px 0;text-align:right">−${money(note.net)}</td></tr>
        <tr><td style="padding:6px 0;color:#666">VAT</td><td style="padding:6px 0;text-align:right">−${money(note.vat)}</td></tr>
        <tr><td style="padding:10px 0;border-top:1px solid #ddd;font-weight:bold">Total credited</td>
            <td style="padding:10px 0;border-top:1px solid #ddd;text-align:right;font-weight:bold">−${money(note.gross)}</td></tr>
      </table>
      ${note.reason ? `<p style="margin:16px 0 0;color:#666;font-size:13px">Reason: ${note.reason}</p>` : ''}
      ${/^https?:\/\//.test(dashboardUrl) ? `<p style="margin:20px 0 0">
        <a href="${dashboardUrl}" style="background:#111;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none;font-weight:bold">
          Open it in your account
        </a>
      </p>` : '<p style="margin:20px 0 0;color:#444">You can open and print it from your account on our website.</p>'}
      <p style="margin:20px 0 0;color:#888;font-size:12px">
        The money can take a few banking days to appear, depending on your bank.
      </p>
    </div>`;

  try {
    await transporter.sendMail({
      from: `${shopName} <${config.from}>`,
      to,
      ...(config.shopInbox ? { bcc: config.shopInbox } : {}),
      subject: `Kreditnota ${note.creditNoteNumber} — ${shopName}`,
      html,
      ...(logo ? { attachments: [logo] } : {}),
    });
    return { sent: true };
  } catch (err: any) {
    console.error('Credit note email failed:', err?.message ?? err);
    return { sent: false, reason: String(err?.message ?? err).slice(0, 160) };
  }
}

/**
 * Send both emails for a paid order.
 *
 * Never throws: this runs after the money has moved, and a customer who has paid
 * must not be shown a failure because a mail server was slow. Failures are logged
 * and reported back so the caller can record them on the order.
 */
/**
 * Tell the shop that somebody wrote to them.
 *
 * The contact form has always saved the message to Firestore and stopped
 * there, and nothing in the back office ever showed that collection — so a
 * real enquiry sat in a database nobody opened. This is the other half of the
 * fix: the message arrives in the shop's inbox, with Reply-To set to the
 * person who sent it, so answering is one click.
 */
export async function sendInquiryNotification(
  inquiry: { name: string; email: string; phone?: string; subject?: string; message: string },
  shopName: string,
  logoDataUrl?: unknown,
  /** The owner's contact address from the dashboard (siteConfig.contactEmail); else SHOP_CONTACT_INBOX. */
  inbox?: string | null,
) {
  const mailer = getMailer();
  if (!mailer) return { sent: false, reason: 'smtp_not_configured' as const };
  const { transporter, config } = mailer;
  const to = (inbox && EMAIL_RE.test(inbox.trim()) ? inbox.trim() : '') || config.contactInbox;
  if (!to) return { sent: false, reason: 'no_shop_inbox' as const };

  const logo = parseLogo(logoDataUrl);
  const esc = (v: string) =>
    String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

  const rows = [
    // In Swedish: this one is read by the shop (2026-10-15).
    ['Namn', inquiry.name],
    ['E-post', inquiry.email],
    ['Telefon', inquiry.phone || '—'],
    ['Ämne', inquiry.subject || '—'],
  ]
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 14px 6px 0;color:#6b7280;font-size:13px;white-space:nowrap">${k}</td>` +
        `<td style="padding:6px 0;font-size:14px;font-weight:600;color:#111827">${esc(v)}</td></tr>`,
    )
    .join('');

  const body = `
    <p style="margin:0 0 18px;font-size:15px;color:#374151">
      Ett nytt meddelande har kommit in via kontaktformuläret på webbshoppen.
    </p>
    <table style="border-collapse:collapse;margin-bottom:18px">${rows}</table>
    <div style="background:#f9fafb;border-left:3px solid #ea580c;padding:14px 16px;border-radius:6px">
      <div style="font-size:11px;font-weight:700;letter-spacing:1px;color:#9ca3af;text-transform:uppercase;margin-bottom:6px">Meddelande</div>
      <div style="font-size:14px;color:#111827;line-height:1.65;white-space:pre-wrap">${esc(inquiry.message)}</div>
    </div>
    <p style="margin:18px 0 0;font-size:13px;color:#6b7280">
      Svara på det här mejlet så går svaret direkt till ${esc(inquiry.email)}.
    </p>`;

  try {
    await transporter.sendMail({
      from: `${shopName} <${config.from}>`,
      to,
      replyTo: inquiry.email,
      subject: `Ny förfrågan — ${inquiry.subject || 'Allmänt'} — ${inquiry.name}`,
      html: shell(
        'Ny kontaktförfrågan',
        body,
        shopName,
        logo ? { src: `cid:${logo.cid}`, alt: shopName } : undefined,
      ),
      ...(logo ? { attachments: [logo] } : {}),
    });
    return { sent: true };
  } catch (err: any) {
    console.error('Inquiry notification failed:', err?.message ?? err);
    return { sent: false, reason: String(err?.message ?? err).slice(0, 160) };
  }
}

export async function sendOrderEmails(
  order: any,
  shopName: string,
  orderUrl: string,
  pickup?: any,
  logoDataUrl?: unknown,
  opts: {
    /** The owner's own list from the dashboard; empty = the server's SHOP_ORDER_INBOX. */
    shopInbox?: string[];
    /** Send only one side again (the "Send again" button). */
    only?: 'customer' | 'shop';
  } = {},
) {
  const mailer = getMailer();
  if (!mailer) return { sent: false, reason: 'smtp_not_configured' as const };

  const { transporter, config } = mailer;
  const results: Record<string, string> = {};

  // Attached, not linked. A data: URL is stripped by every major mail client,
  // and a link back to the shop is blocked until the reader clicks "show
  // images" — an inline part is the one form that simply appears.
  const logo = parseLogo(logoDataUrl);
  const logoSrc = logo ? `cid:${logo.cid}` : undefined;
  const attachments = logo ? [logo] : undefined;

  // The shop's notice goes to the addresses the OWNER chose in the dashboard
  // (client, 2026-10-07: "when an order is created I must get an e-mail"), else to
  // the server's SHOP_ORDER_INBOX as before.
  const shopTo = opts.shopInbox?.length ? opts.shopInbox.join(', ') : config.shopInbox;
  const attempts = ([
    ['customer', order.customerEmail, () => customerConfirmation(order, shopName, orderUrl, pickup, logoSrc)],
    ['shop', shopTo, () => shopNotification(order, shopName, logoSrc)],
  ] as [string, string, () => { subject: string; html: string }][]).filter(([who]) => !opts.only || who === opts.only);

  for (const [who, to, build] of attempts) {
    if (!to) {
      results[who] = 'no address';
      continue;
    }
    const mail = build();
    try {
      await transporter.sendMail({
        from: `${shopName} <${config.from}>`,
        to,
        // A customer hitting reply is asking a question, not filing an
        // operational notice, so it goes to the address the business answers on.
        replyTo: config.contactInbox,
        subject: mail.subject,
        html: mail.html,
        ...(attachments ? { attachments } : {}),
      });
      results[who] = 'sent';
    } catch (err: any) {
      results[who] = `failed: ${String(err?.message ?? err).slice(0, 160)}`;
      console.error(`Order email to ${who} (${to}) failed:`, err?.message ?? err);
    }
  }

  // EVERY ADDRESSED RECIPIENT, NOT ANY ONE OF THEM.
  //
  // This was `.includes('sent')` — an OR. The shop's own copy reaching
  // order@reklamx.se was enough to report the whole send as successful while the
  // CUSTOMER's confirmation had failed, and the caller then filed the order as
  // emailed and never tried again. The customer copy is the one that matters
  // most: for a guest it carries the only copy of the publicToken, which is the
  // only way back to their own order.
  //
  // 'no address' is not a failure — there was nobody to write to, which is a
  // property of the order rather than of the mail server. Anything else that is
  // not 'sent' is.
  const outcomes = Object.values(results);
  const addressed = outcomes.filter((r) => r !== 'no address');
  return {
    sent: addressed.length > 0 && addressed.every((r) => r === 'sent'),
    results,
  };
}

/**
 * "Send a test e-mail" in the dashboard: the new-order notice's road, proven —
 * the same server, sender and recipients a real paid order uses. Reports what
 * the mail server said, so a refused password (Google answers 535 to anything
 * but an App Password) reaches the person who can fix it.
 */
export async function sendTestOrderNotice(
  shopInbox: string[],
  shopName: string,
): Promise<{ sent: boolean; to: string | null; reason?: string }> {
  const mailer = getMailer();
  if (!mailer) return { sent: false, to: null, reason: 'smtp_not_configured' };
  const { transporter, config } = mailer;
  const to = shopInbox.length ? shopInbox.join(', ') : config.shopInbox;
  try {
    await transporter.sendMail({
      from: `${shopName} <${config.from}>`,
      to,
      replyTo: config.contactInbox,
      subject: `${shopName} — test: new-order e-mails reach this address`,
      html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111">
        <p><strong>This is a test from the shop's dashboard.</strong></p>
        <p>When a customer's payment for an order is confirmed, an e-mail with the order — items, customer,
        delivery address and the artwork — is sent to this address.</p>
        <p style="color:#666;font-size:12px">Sent ${new Date().toISOString()} from ${config.from}.</p>
      </div>`,
    });
    return { sent: true, to };
  } catch (err: any) {
    return { sent: false, to, reason: String(err?.message ?? err).slice(0, 240) };
  }
}


/**
 * THE CUSTOMER'S RECEIPT FOR A CONTACT MESSAGE (2026-10-15) — "thanks, we have
 * it", in the language the visitor had chosen on the site. From the account
 * mailbox (noreply@); a reply goes to the shop's contact address, never back
 * into noreply@. A copy of what they wrote is included, so they know what they sent.
 */
const CONTACT_THANKS: Record<'en' | 'sv' | 'da' | 'no', { subject: string; hi: string; body: string; yours: string; sign: string }> = {
  en: { subject: 'Thank you for getting in touch', hi: 'Hi', body: 'Thank you for your message — it has reached us, and we usually reply within one or two working days. If anything is urgent, just reply to this e-mail.', yours: 'Your message', sign: 'Kind regards' },
  sv: { subject: 'Tack för att du hörde av dig', hi: 'Hej', body: 'Tack för ditt meddelande — vi har tagit emot det och svarar oftast inom en till två arbetsdagar. Är något brådskande kan du svara direkt på det här mejlet.', yours: 'Ditt meddelande', sign: 'Vänliga hälsningar' },
  da: { subject: 'Tak fordi du kontaktede os', hi: 'Hej', body: 'Tak for din besked — vi har modtaget den og svarer som regel inden for en til to arbejdsdage. Hvis noget haster, kan du bare svare på denne e-mail.', yours: 'Din besked', sign: 'Venlig hilsen' },
  no: { subject: 'Takk for at du tok kontakt', hi: 'Hei', body: 'Takk for meldingen din — vi har mottatt den og svarer vanligvis innen én til to virkedager. Haster det, kan du bare svare på denne e-posten.', yours: 'Din melding', sign: 'Vennlig hilsen' },
};

export async function sendInquiryThanks(
  inquiry: { name: string; email: string; message: string },
  language: unknown,
  shopName: string,
  logoDataUrl?: unknown,
  replyTo?: string | null,
) {
  const mailer = getAccountMailer();
  if (!mailer) return { sent: false, reason: 'smtp_not_configured' as const };
  const lang = (['sv', 'da', 'no', 'en'] as const).find((l) => l === language) ?? 'sv';
  const t = CONTACT_THANKS[lang];
  const logo = parseLogo(logoDataUrl);
  const esc = (v: string) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const first = inquiry.name.trim().split(/\s+/)[0] || '';
  const body = `
    <p style="margin:0 0 14px;font-size:15px;color:#374151">${t.hi} ${esc(first)},</p>
    <p style="margin:0 0 18px;font-size:15px;color:#374151;line-height:1.6">${t.body}</p>
    <div style="background:#f9fafb;border-left:3px solid #bb965b;padding:14px 16px;border-radius:6px">
      <div style="font-size:11px;font-weight:700;letter-spacing:1px;color:#9ca3af;text-transform:uppercase;margin-bottom:6px">${t.yours}</div>
      <div style="font-size:14px;color:#111827;line-height:1.65;white-space:pre-wrap">${esc(inquiry.message)}</div>
    </div>
    <p style="margin:18px 0 0;font-size:14px;color:#374151">${t.sign},<br>${esc(shopName)}</p>`;
  try {
    await mailer.transporter.sendMail({
      from: `${shopName} <${mailer.config.from}>`,
      to: inquiry.email,
      ...(replyTo && EMAIL_RE.test(replyTo) ? { replyTo } : {}),
      subject: `${t.subject} — ${shopName}`,
      html: shell(t.subject, body, shopName, logo ? { src: `cid:${logo.cid}`, alt: shopName } : undefined),
      ...(logo ? { attachments: [logo] } : {}),
    });
    return { sent: true };
  } catch (err: any) {
    console.error('Contact thank-you e-mail failed:', err?.message ?? err);
    return { sent: false, reason: 'send_failed' as const };
  }
}
