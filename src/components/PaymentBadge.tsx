import React from 'react';
import type { TranslationKey } from '../lib/translations';
import { isOnDeliveryOpen, paymentLabelKey } from '../lib/orderQueue';
import { cn } from '../lib/utils';

/**
 * An order's payment state, in words — the admin's Orders tab, the overview's
 * latest orders and the production queue's cards. It printed Mollie's raw value
 * ("expired", "open"), in English whatever the screen's language, and only one
 * of the three screens marked a payment made with the TEST key — so a test
 * order looked like a real paid job everywhere else.
 */
export default function PaymentBadge({
  order,
  t,
  className,
}: {
  order: { paymentStatus?: unknown; paymentMode?: unknown; payOnDelivery?: unknown; status?: unknown };
  t: (k: TranslationKey) => string;
  className?: string;
}) {
  const s = String(order.paymentStatus ?? '').toLowerCase();
  const test = order.paymentMode === 'test';
  // To be paid on delivery — agreed, not overdue: its own colour.
  const onDelivery = isOnDeliveryOpen(order);
  return (
    <span className={cn('inline-flex items-center gap-1 flex-wrap', className)}>
      <span
        className={cn(
          'px-2 py-0.5 rounded-md text-[0.625rem] font-black uppercase tracking-wide whitespace-nowrap',
          onDelivery ? 'bg-sky-100 text-sky-800'
          : s === 'paid' ? 'bg-emerald-100 text-emerald-800'
            : s === 'refunded' ? 'bg-gray-200 text-gray-700'
              : ['failed', 'canceled', 'cancelled', 'expired', 'chargeback'].includes(s) ? 'bg-red-100 text-red-700'
                : 'bg-amber-100 text-amber-800',
        )}
      >
        {t(paymentLabelKey(order))}
      </span>
      {test && (
        <span className="px-2 py-0.5 rounded-md text-[0.625rem] font-black uppercase tracking-wide whitespace-nowrap bg-violet-600 text-white">
          {t('sdTestPayment')}
        </span>
      )}
    </span>
  );
}
