import React from 'react';
import type { OrderItem } from '../types';
import type { TranslationKey } from '../lib/translations';

/**
 * WHAT A LINE'S AMOUNT HOLDS BEYOND unit price × quantity.
 *
 * `price` includes the per-line setup fee and, since 2026-10, the options
 * charged once per line (a cutting die, a proof, a designer's fee). A printed
 * "100 × 12,00 kr = 2 044,00 kr" with nothing under it reads as a mistake, so
 * the documents name what the difference is. Nothing is added again: both
 * figures are already inside `price`.
 *
 * Renders nothing for orders placed before these fields existed.
 */
export default function LineChargesNote({
  item,
  currency,
  t,
}: {
  item: OrderItem;
  currency: string;
  t: (key: TranslationKey) => string;
}) {
  const once = Number(item.onceCharges) || 0;
  const setup = Number(item.setupFee) || 0;
  if (once <= 0 && setup <= 0) return null;

  const money = (n: number) => `${n.toFixed(2)} ${currency}`;
  const names = (item.onceOptions ?? [])
    .filter((o) => o && o.label)
    .map((o) => `${o.label} ${money(Number(o.amount) || 0)}`)
    .join(', ');

  // One flowing line, not one line each: on a long order every line saved here
  // is a line the one-page invoice does not have to shrink for (printFit.ts).
  return (
    <span className="block text-[0.625rem] text-gray-500 font-medium leading-snug">
      {once > 0 && (
        <span>
          {t('docInclOnceCharges').replace('{0}', money(once))}
          {names ? ` (${names})` : ''}
        </span>
      )}
      {once > 0 && setup > 0 && ' · '}
      {setup > 0 && <span>{t('docInclSetupFee').replace('{0}', money(setup))}</span>}
    </span>
  );
}
