import React, { useId } from 'react';
import SafeImage from './SafeImage';
import type { BuiltinPaymentIcon, PaymentIconEntry } from '../context/SiteSettingsContext';

/**
 * The footer's payment-method row: a tidy line of small white badges.
 *
 * Builtin marks are drawn as inline SVG — simplified but recognisable brand
 * shapes — so the footer never makes a network request just to say "we take
 * Visa". Custom entries are owner-supplied images and go through SafeImage,
 * which swallows a dead URL instead of leaving a torn-page glyph on the page.
 */

export const BUILTIN_PAYMENT_ICON_LABELS: Record<BuiltinPaymentIcon, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'American Express',
  swish: 'Swish',
  klarna: 'Klarna',
  applepay: 'Apple Pay',
  googlepay: 'Google Pay',
};

const MARK_FONT = 'Helvetica, Arial, sans-serif';

const VisaMark = () => (
  <svg className="h-4 w-auto" viewBox="0 0 42 16" aria-hidden="true" focusable="false">
    <text
      x="21"
      y="12.5"
      textAnchor="middle"
      fontFamily={MARK_FONT}
      fontSize="13"
      fontStyle="italic"
      fontWeight="800"
      letterSpacing="0.5"
      fill="#1A1F71"
    >
      VISA
    </text>
  </svg>
);

const MastercardMark = () => (
  <svg className="h-4 w-auto" viewBox="0 0 28 16" aria-hidden="true" focusable="false">
    <circle cx="9.5" cy="8" r="7" fill="#EB001B" />
    <circle cx="18.5" cy="8" r="7" fill="#F79E1B" />
    {/* The lens where the two circles overlap. */}
    <path d="M14 2.64a7 7 0 0 1 0 10.72 7 7 0 0 1 0-10.72z" fill="#FF5F00" />
  </svg>
);

const AmexMark = () => (
  <svg className="h-4 w-auto" viewBox="0 0 34 16" aria-hidden="true" focusable="false">
    <rect width="34" height="16" rx="2" fill="#016FD0" />
    <text
      x="17"
      y="11.5"
      textAnchor="middle"
      fontFamily={MARK_FONT}
      fontSize="8"
      fontWeight="800"
      letterSpacing="0.5"
      fill="#ffffff"
    >
      AMEX
    </text>
  </svg>
);

const SwishMark = () => {
  // The gradient id must be unique per instance: the badge can appear in the
  // footer and the admin preview on the same page, and duplicate SVG ids make
  // one of them silently pick up the other's gradient (or none at all).
  const gradientId = useId();
  return (
    <svg className="h-4 w-auto" viewBox="0 0 34 16" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#EF2131" />
          <stop offset="1" stopColor="#7D2EA0" />
        </linearGradient>
      </defs>
      <text
        x="1"
        y="12.5"
        fontFamily={MARK_FONT}
        fontSize="12"
        fontWeight="900"
        fill={`url(#${gradientId})`}
      >
        S
      </text>
      <text x="9.5" y="12.5" fontFamily={MARK_FONT} fontSize="11" fontWeight="800" fill="#4A4A49">
        wish
      </text>
    </svg>
  );
};

const KlarnaMark = () => (
  <svg className="h-4 w-auto" viewBox="0 0 40 16" aria-hidden="true" focusable="false">
    <rect width="40" height="16" rx="3" fill="#FFB3C7" />
    <text
      x="20"
      y="11.5"
      textAnchor="middle"
      fontFamily={MARK_FONT}
      fontSize="8.5"
      fontWeight="800"
      fill="#0A0B09"
    >
      Klarna
    </text>
  </svg>
);

const ApplePayMark = () => (
  <svg className="h-4 w-auto" viewBox="0 0 34 16" aria-hidden="true" focusable="false">
    {/* Simplified apple: body, bite (badge background is white), leaf. */}
    <circle cx="6" cy="9.5" r="4.5" fill="#000000" />
    <circle cx="10.8" cy="8.6" r="2" fill="#ffffff" />
    <path d="M6.6 4.6C6.7 3.2 7.8 2.2 9 2.2 8.9 3.6 7.8 4.6 6.6 4.6Z" fill="#000000" />
    <text x="13" y="13" fontFamily={MARK_FONT} fontSize="10.5" fontWeight="700" fill="#000000">
      Pay
    </text>
  </svg>
);

const GooglePayMark = () => (
  <svg className="h-4 w-auto" viewBox="0 0 34 16" aria-hidden="true" focusable="false">
    <text x="1" y="12.5" fontFamily={MARK_FONT} fontSize="11" fontWeight="700">
      <tspan fill="#4285F4">G</tspan>
      <tspan dx="2" fill="#5F6368">Pay</tspan>
    </text>
  </svg>
);

const BUILTIN_MARKS: Record<BuiltinPaymentIcon, React.FC> = {
  visa: VisaMark,
  mastercard: MastercardMark,
  amex: AmexMark,
  swish: SwishMark,
  klarna: KlarnaMark,
  applepay: ApplePayMark,
  googlepay: GooglePayMark,
};

/** True when the entry has something drawable — a known builtin or an image URL. */
export const isRenderablePaymentIcon = (entry: PaymentIconEntry): boolean =>
  Boolean((entry.builtin && BUILTIN_MARKS[entry.builtin]) || entry.imageUrl);

/** A single payment badge — also used by the admin editor as a live preview. */
export const PaymentIconBadge: React.FC<{ entry: PaymentIconEntry }> = ({ entry }) => {
  const Mark = entry.builtin ? BUILTIN_MARKS[entry.builtin] : undefined;
  const label = entry.builtin
    ? BUILTIN_PAYMENT_ICON_LABELS[entry.builtin]
    : entry.label || 'Payment method';

  return (
    <span
      className="inline-flex h-7 items-center rounded-md border border-gray-200 bg-white px-2"
      role="img"
      aria-label={label}
      title={label}
    >
      {Mark ? (
        <Mark />
      ) : (
        <SafeImage src={entry.imageUrl} alt={label} className="h-5 max-w-[4.5rem] object-contain" />
      )}
    </span>
  );
};

interface PaymentIconsProps {
  entries?: PaymentIconEntry[];
  className?: string;
}

/**
 * Mollie's own artwork, for the methods Mollie says are enabled.
 *
 * The owner asked for exactly this: the logos as they appear in Mollie. Not our
 * simplified marks, not a hand-kept list — the official image Mollie serves for
 * each method, so a brand restyle or a newly enabled method needs nobody to
 * redraw anything. Enable a method in his Mollie dashboard and its real logo
 * appears in the footer on the next cache miss.
 *
 * The inline builtin marks stay as the fallback for the rare case where Mollie
 * returns a method with no image, so a method can never become an invisible gap.
 */
const MOLLIE_FALLBACK_BUILTIN: Record<string, BuiltinPaymentIcon> = {
  creditcard: 'visa',
  swish: 'swish',
  klarna: 'klarna',
  applepay: 'applepay',
  googlepay: 'googlepay',
};

export type MollieMethodIcon = { id: string; description: string; imageSvg: string | null };

/**
 * A Mollie method list turned into footer badges.
 *
 * Lives here rather than in the footer so the checkout strip and the footer row
 * cannot drift: both turn the same list into the same badges.
 */
export function entriesFromMollieMethods(methods: MollieMethodIcon[]): PaymentIconEntry[] {
  const out: PaymentIconEntry[] = [];
  const seen = new Set<string>();
  for (const m of methods) {
    if (!m?.id || seen.has(m.id)) continue;
    seen.add(m.id);
    if (m.imageSvg) {
      out.push({ id: `pay-${m.id}`, imageUrl: m.imageSvg, label: m.description || m.id });
    } else {
      const builtin = MOLLIE_FALLBACK_BUILTIN[m.id];
      if (builtin) out.push({ id: `pay-${m.id}`, builtin });
    }
  }
  return out;
}

export default function PaymentIcons({ entries, className }: PaymentIconsProps) {
  const renderable = (entries || []).filter(isRenderablePaymentIcon);
  if (renderable.length === 0) return null;

  return (
    <div className={`flex flex-wrap items-center justify-center gap-2 ${className ?? ''}`}>
      {renderable.map((entry) => (
        <PaymentIconBadge key={entry.id} entry={entry} />
      ))}
    </div>
  );
}
