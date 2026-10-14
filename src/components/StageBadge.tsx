/**
 * THE ORDER'S STAGE, IN COLOUR — client, 2026-10-07: "colours here: red cancelled,
 * yellow waiting, and so on", over a status column of plain grey words. One map for
 * every screen (the order list, the order panel, the overview, the customer's own
 * page) so a stage is the same colour wherever it is read. The payment beside it
 * keeps PaymentBadge's own colours; this pill matches its shape.
 */
import React from 'react';
import { cn } from '../lib/utils';
import { stageLabelKey } from '../lib/orderQueue';
import type { TranslationKey } from '../lib/translations';

export type Stage = 'pending' | 'in_design' | 'in_print' | 'finishing' | 'shipped' | 'completed' | 'cancelled';

/** A stage the shop knows, from the status an order carries — older names included. */
export function stageColourKey(status: unknown): Stage {
  switch (String(status ?? '')) {
    case 'in_design':
    case 'processing':
    case 'prepress':
      return 'in_design';
    case 'in_print':
    case 'printing':
      return 'in_print';
    case 'finishing':
      return 'finishing';
    case 'shipped':
    case 'in_transit':
    case 'dispatched':
      return 'shipped';
    case 'completed':
    case 'delivered':
    case 'fulfilled':
      return 'completed';
    case 'cancelled':
    case 'canceled':
      return 'cancelled';
    default:
      return 'pending';
  }
}

/** The pill's colours: yellow waiting → violet design → orange print → blue finishing → indigo shipped → green done; red cancelled. */
export const STAGE_PILL: Record<Stage, string> = {
  pending: 'bg-amber-100 text-amber-800',
  in_design: 'bg-purple-100 text-purple-800',
  in_print: 'bg-orange-100 text-orange-800',
  finishing: 'bg-blue-100 text-blue-800',
  shipped: 'bg-indigo-100 text-indigo-800',
  completed: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-red-100 text-red-700',
};

/** The same colour as a dot (the stage history). */
export const STAGE_DOT: Record<Stage, string> = {
  pending: 'bg-amber-500',
  in_design: 'bg-purple-500',
  in_print: 'bg-orange-500',
  finishing: 'bg-blue-500',
  shipped: 'bg-indigo-500',
  completed: 'bg-emerald-500',
  cancelled: 'bg-red-500',
};

export default function StageBadge({
  status,
  t,
  className,
}: {
  status: unknown;
  t: (key: TranslationKey) => string;
  className?: string;
}) {
  const stage = stageColourKey(status);
  return (
    <span
      className={cn('px-2 py-0.5 rounded-md text-[0.625rem] font-black uppercase tracking-wide whitespace-nowrap', STAGE_PILL[stage], className)}
      data-rx-stage={stage}
    >
      {t(stageLabelKey(stage))}
    </span>
  );
}
