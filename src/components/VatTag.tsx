import { useAuth } from '../App';
import { cn } from '../lib/utils';

interface VatTagProps {
  /**
   * Which mode the amount NEXT TO THIS TAG is actually in.
   *
   * Omit it for prices produced by formatPriceWithVat(...).formatted / displayPrice,
   * which flip with the header's VAT toggle — the tag then follows the toggle too.
   * Pass 'excl' or 'incl' for amounts that are fixed regardless of the toggle
   * (cart line items and the checkout subtotal are always net; the checkout
   * Payment Due is always gross). A toggle-following tag beside a fixed amount
   * would lie half the time.
   */
  mode?: 'incl' | 'excl';
  /** Lighter tone for dark panels (e.g. the custom-upload total card). */
  dark?: boolean;
  className?: string;
}

/** Tiny muted "incl. VAT" / "ex. VAT" marker rendered beside a price. */
export default function VatTag({ mode, dark = false, className }: VatTagProps) {
  const { includeVat, t } = useAuth();
  const showIncl = mode ? mode === 'incl' : includeVat;

  return (
    <span
      className={cn(
        'text-[0.5625rem] font-bold uppercase tracking-wide whitespace-nowrap',
        dark ? 'text-white/40' : 'text-gray-400',
        className,
      )}
    >
      {showIncl ? t('vatTagIncl') : t('vatTagExcl')}
    </span>
  );
}
