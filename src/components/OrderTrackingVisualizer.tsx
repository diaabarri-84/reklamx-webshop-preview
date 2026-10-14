import React from 'react';
import { 
  PackageCheck, 
  Clock, 
  Printer, 
  Truck, 
  CheckCircle2, 
  Check, 
  Sparkles, 
  MapPin, 
  Calendar,
  ShieldCheck,
  Radio
} from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';
import { Order } from '../types';
import { useAuth } from '../App';
import { translations } from '../lib/translations';
import { formatShortDate, formatTime, localeFor, OPERATIONS_LOCALE } from '../lib/dateFormat';

export interface TrackingStep {
  key: 'placed' | 'processing' | 'in_print' | 'shipped' | 'delivered';
  labelKey: keyof typeof translations['en'];
  descKey: keyof typeof translations['en'];
  icon: React.ElementType;
}

export const ORDER_TRACKING_STEPS: TrackingStep[] = [
  {
    key: 'placed',
    labelKey: 'custStepPlaced',
    descKey: 'custStepPlacedDesc',
    icon: PackageCheck,
  },
  {
    key: 'processing',
    labelKey: 'custStepProcessing',
    descKey: 'custStepProcessingDesc',
    icon: Clock,
  },
  {
    key: 'in_print',
    labelKey: 'custStepInPrint',
    descKey: 'custStepInPrintDesc',
    icon: Printer,
  },
  {
    key: 'shipped',
    labelKey: 'custStepShipped',
    descKey: 'custStepShippedDesc',
    icon: Truck,
  },
  {
    key: 'delivered',
    labelKey: 'custStepDelivered',
    descKey: 'custStepDeliveredDesc',
    icon: CheckCircle2,
  },
];

/**
 * When this job is expected to be finished.
 *
 * `locale` is not optional-by-accident: this used to format with
 * `toLocaleDateString([])`, which means "whatever locale the machine is set to".
 * On the owner's Mac that is Arabic, so his customers' estimated-completion line
 * came out as `الجمعة، 21 أغسطس` — while a Swedish visitor saw Swedish and
 * nobody could reproduce it. The caller now says which language it is rendering
 * in, and it is the SHOP language the customer picked, never the OS.
 *
 * THE SHOP'S OWN DATES FIRST, AND AN ESTIMATE ONLY WHERE IT HAS NONE.
 *
 * This function used to answer every question from `createdAt` alone:
 *
 *  · For a finished order it showed the day the order was PLACED under the
 *    label "Delivered On". Every completed order therefore showed the wrong
 *    delivery day — days out on anything that took time to make, and provably
 *    contradicting the shop's own records if a customer ever queried a late
 *    job. The real `deliveredAt`, written by the sweep, was never read.
 *
 *  · Before completion it invented createdAt + 48/24/4/18 hours and ignored
 *    `order.dueDate` — the date the server computed from the owner's OWN lead
 *    times and then emailed to the customer. So the shop made two different
 *    promises about the same order and showed a different one on each screen.
 *
 * Now: `deliveredAt` when it exists, then `dueDate` (parsed at midday, the way
 * ProductionWorkOrderModal already does, so a date-only string does not slide a
 * day across timezones), and only then the old estimate — which stays, because
 * an order placed before the due date was computed still has to show something.
 */
export function getEstimatedCompletionTime(
  createdAt?: string,
  status?: string,
  locale: string = OPERATIONS_LOCALE,
  deliveredAt?: string,
  dueDate?: string,
): {
  dateString: string;
  timeString: string;
  badgeText: string;
  isCompleted: boolean;
} {
  const baseDate = createdAt ? new Date(createdAt) : new Date();
  const s = (status || '').toLowerCase().trim();

  const parsed = (value?: string): Date | null => {
    if (!value) return null;
    // A date-only string ("2026-09-04") parses as UTC midnight, which shows as
    // the previous evening west of Greenwich. Midday cannot slide either way.
    const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  if (s === 'delivered' || s === 'completed') {
    const actual = parsed(deliveredAt) ?? baseDate;
    return {
      dateString: formatShortDate(actual, locale),
      timeString: formatTime(actual, locale),
      badgeText: 'Delivered',
      isCompleted: true
    };
  }

  // The promised date, when the shop has made one.
  const due = parsed(dueDate);
  if (due) {
    const hoursLeft = Math.round((due.getTime() - Date.now()) / (1000 * 60 * 60));
    return {
      dateString: formatShortDate(due, locale),
      timeString: formatTime(due, locale),
      badgeText: hoursLeft > 24
        ? `~${Math.round(hoursLeft / 24)} days remaining`
        : `~${Math.max(1, hoursLeft)} hrs remaining`,
      isCompleted: false,
    };
  }

  let hoursToAdd = 48; // placed
  if (s === 'processing' || s === 'in_design' || s === 'prepress') hoursToAdd = 24;
  if (s === 'in_print' || s === 'printing' || s === 'finishing') hoursToAdd = 4;
  if (s === 'shipped' || s === 'in_transit') hoursToAdd = 18;

  const targetDate = new Date(baseDate.getTime() + hoursToAdd * 60 * 60 * 1000);
  const now = new Date();
  if (targetDate < now) {
    targetDate.setTime(now.getTime() + (s === 'in_print' ? 3 : 12) * 60 * 60 * 1000);
  }

  const hoursDiff = Math.max(1, Math.round((targetDate.getTime() - now.getTime()) / (1000 * 60 * 60)));

  return {
    dateString: formatShortDate(targetDate, locale),
    timeString: formatTime(targetDate, locale),
    badgeText: s === 'shipped' ? 'In Transit (~1 day)' : `~${hoursDiff} hrs remaining`,
    isCompleted: false
  };
}

export function getStepIndexForStatus(status: string): number {
  const s = (status || '').toLowerCase().trim();
  if (s === 'pending' || s === 'placed' || s === 'unpaid') return 0;
  if (s === 'in_design' || s === 'processing' || s === 'review' || s === 'prepress') return 1;
  if (s === 'in_print' || s === 'printing' || s === 'finishing' || s === 'production') return 2;
  if (s === 'shipped' || s === 'in_transit' || s === 'dispatched') return 3;
  if (s === 'delivered' || s === 'completed' || s === 'fulfilled') return 4;
  return 0;
}

/**
 * READ-ONLY ON PURPOSE.
 *
 * This used to carry `canSimulate` / `onAdvanceStatus` — a button that walked an
 * order forward a stage from the customer's own screen. The owner asked for it
 * gone: a customer sees where their job is, nobody drives production from here,
 * and the stages move by themselves (see the auto-stage sweep in server.ts).
 * Staff still move a job by hand from the Stage dropdown on the production card.
 */
interface OrderTrackingVisualizerProps {
  order: Order;
  className?: string;
}

export default function OrderTrackingVisualizer({
  order,
  className
}: OrderTrackingVisualizerProps) {
  const { t, language } = useAuth();
  const currentStepIdx = getStepIndexForStatus(order.status);
  const totalSteps = ORDER_TRACKING_STEPS.length;
  // Progress percentage calculation: 0 = 0%, 1 = 25%, 2 = 50%, 3 = 75%, 4 = 100%
  const progressPercent = Math.min(100, Math.max(0, (currentStepIdx / (totalSteps - 1)) * 100));

  const currentStep = ORDER_TRACKING_STEPS[currentStepIdx] || ORDER_TRACKING_STEPS[0];
  const est = getEstimatedCompletionTime(order.createdAt, order.status, localeFor(language), order.deliveredAt, order.dueDate);

  return (
    <div className={cn("bg-gradient-to-br from-gray-50/90 to-blue-50/30 rounded-3xl p-5 md:p-6 border border-gray-200/90 shadow-2xs space-y-6 relative overflow-hidden", className)}>
      {/* Tracker Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-200/70 pb-3.5">
        <div className="flex items-center space-x-2.5 space-x-reverse">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
          </span>
          <div className="flex items-center space-x-2 space-x-reverse">
            <span className="text-xs font-black uppercase tracking-wider text-gray-900">
              {t('custRealTimeProgress')}
            </span>
            <span className="text-[0.625rem] font-black bg-emerald-100 text-emerald-800 px-2.5 py-0.5 rounded-full flex items-center gap-1">
              <Radio className="w-2.5 h-2.5 animate-pulse text-emerald-600" />
              {t('custLiveStream')}
            </span>
          </div>
        </div>

      </div>

      {/* 5-Step Visual Stepper Bar */}
      <div className="relative pt-2 pb-2 px-1 md:px-4">
        {/* Background Grey Bar */}
        <div className="absolute top-8 left-10 right-10 h-1.5 bg-gray-200/90 rounded-full z-0 hidden md:block" />

        {/* Active Progress Animated Fill Bar */}
        <div 
          className="absolute top-8 left-10 h-1.5 bg-gradient-to-r from-orange-500 via-amber-500 to-emerald-500 rounded-full transition-all duration-700 ease-out z-0 hidden md:block"
          style={{ width: `calc(${progressPercent}% * 0.82)` }}
        />

        {/* 5 Steps Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4 relative z-10">
          {ORDER_TRACKING_STEPS.map((step, idx) => {
            const Icon = step.icon;
            const isCompleted = idx < currentStepIdx;
            const isActive = idx === currentStepIdx;
            const isUpcoming = idx > currentStepIdx;

            return (
              <div key={step.key} className="flex flex-col items-center text-center group">
                <div 
                  className={cn(
                    "w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-300 relative",
                    isCompleted && "bg-emerald-600 text-white shadow-md shadow-emerald-600/20",
                    isActive && "bg-orange-600 text-white shadow-lg shadow-orange-600/30 ring-4 ring-orange-500/20 scale-110",
                    isUpcoming && "bg-white text-gray-400 border-2 border-gray-200"
                  )}
                >
                  {isCompleted ? (
                    <Check className="w-6 h-6 stroke-[3]" />
                  ) : (
                    <Icon className={cn("w-5 h-5", isActive && "animate-pulse")} />
                  )}

                  {isActive && (
                    <span className="absolute -top-1 -right-1 flex h-3 w-3">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-orange-500" />
                    </span>
                  )}
                </div>

                <div className="mt-2.5 space-y-0.5">
                  <span className={cn(
                    "text-xs font-black block tracking-tight",
                    isActive ? "text-orange-600 font-black" : isCompleted ? "text-gray-900" : "text-gray-400"
                  )}>
                    {t(step.labelKey)}
                  </span>

                  <span className={cn(
                    "text-[0.625rem] font-bold block",
                    isCompleted ? "text-emerald-600" : isActive ? "text-orange-600 animate-pulse font-extrabold" : "text-gray-400"
                  )}>
                    {isCompleted 
                      ? t('custStepStateCompleted')
                      : isActive 
                        ? t('custStepStateInProgress')
                        : t('custStepStatePending')}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Current Stage Context & Status Banner */}
      <div className="bg-white p-4 rounded-2xl border border-gray-200/80 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
        <div className="flex items-center space-x-3 space-x-reverse">
          <div className="p-2.5 bg-orange-50 text-orange-600 rounded-xl shrink-0">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <span className="font-extrabold text-gray-900 block text-sm">
              {t('custCurrentStage')}
              <span className="text-orange-600">{t(currentStep.labelKey)}</span>
            </span>
            <p className="text-gray-500 font-medium mt-0.5">
              {/* "…and payment confirmed" only when it IS: an order to pay on delivery
                  (or any unpaid one) was received, not paid. */}
              {t(currentStep.descKey === 'custStepPlacedDesc' && order.paymentStatus !== 'paid' ? 'custOrderReceived' : currentStep.descKey)}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0 self-start sm:self-auto pt-2 sm:pt-0 border-t sm:border-t-0 border-gray-100">
          <div className="bg-orange-50 border border-orange-200/80 px-3 py-1.5 rounded-xl text-left">
            <span className="text-[0.625rem] font-black uppercase text-orange-800 tracking-wider flex items-center gap-1">
              <Calendar className="w-3 h-3 text-orange-600" />
              {est.isCompleted ? ('Delivered On') : ('Estimated Completion')}
            </span>
            <span className="text-xs font-black text-gray-900 block mt-0.5">
              {est.dateString} at {est.timeString}
              <span className="text-[0.625rem] font-bold text-orange-600 ml-1.5 bg-orange-100 px-1.5 py-0.5 rounded-md">
                {est.badgeText}
              </span>
            </span>
          </div>

          <span className="text-[0.625rem] font-bold text-gray-500 bg-gray-100 px-3 py-2 rounded-xl flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            {'Auto-Sync Active'}
          </span>
        </div>
      </div>
    </div>
  );
}
