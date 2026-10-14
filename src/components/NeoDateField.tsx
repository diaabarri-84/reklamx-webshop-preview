import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { cn } from '../lib/utils';

/**
 * A date field the browser cannot translate.
 *
 * WHY THIS EXISTS INSTEAD OF `<input type="date">`
 * The owner reported the promised-date box on every order card reading
 * `موي /ر هش /قتس`. That is Chrome's own placeholder for a native date input,
 * rendered in the BROWSER's interface language — Arabic on his machine. No
 * attribute fixes it: `lang="en"` does not change it, the shop's own language
 * setting does not reach it, and the calendar it opens is translated too. The
 * only way to control what that control says is to stop using it.
 *
 * So: an ISO text box the shop formats itself, plus a calendar this file draws.
 * `YYYY-MM-DD` in, `YYYY-MM-DD` out — the same string the order document already
 * stores, so nothing downstream changes — and every word on screen comes from
 * this file, in English, whatever the machine underneath is set to.
 *
 * Typing is still allowed: a production manager re-promising twenty jobs types
 * faster than they click, and a picker with no keyboard path would be a
 * downgrade from the native control it replaces.
 */

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function toIso(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * `2026-08-21` → a Date at noon, so a timezone shift can never move the day.
 * A day that does not exist is not a date: the browser reads 2026-02-30 as
 * 2 March, and the raw "2026-02-30" used to be stored as the promise.
 */
function parseIso(value: string | null | undefined): Date | null {
  if (!value || !ISO_DATE.test(value)) return null;
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) || toIso(date) !== value ? null : date;
}

/** Monday-first, because a Swedish print shop's week starts on Monday. */
function mondayFirstIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

interface NeoDateFieldProps {
  /** ISO `YYYY-MM-DD`, or empty. */
  value?: string | null;
  /** Called with a valid ISO date, or '' when cleared. */
  onChange: (value: string) => void;
  /**
   * 'change' (default): every complete date as it is typed — for filters.
   * 'blur': only when the field is left, Enter is pressed or a day is picked —
   * for a field that WRITES somewhere. Typing over a stored date passes through
   * "" (select-all, Backspace), and in 'change' mode that "" was written to the
   * order at once: the customer's promised date blanked mid-edit.
   */
  commitOn?: 'change' | 'blur';
  disabled?: boolean;
  className?: string;
  id?: string;
  'aria-label'?: string;
}

export default function NeoDateField({
  value,
  onChange,
  disabled = false,
  className,
  id,
  'aria-label': ariaLabel,
  commitOn = 'change',
}: NeoDateFieldProps) {
  const [open, setOpen] = useState(false);
  // What the user is typing, which is not always a valid date yet. Committed to
  // the parent only when it becomes one — a half-typed "2026-08" must not wipe
  // the stored date.
  const [draft, setDraft] = useState<string>(value ?? '');
  const [cursor, setCursor] = useState<Date>(() => parseIso(value) ?? new Date());
  const wrapRef = useRef<HTMLDivElement>(null);

  // The order can change under us — another member of staff moves the date, or
  // the card re-renders with a different order.
  useEffect(() => {
    setDraft(value ?? '');
    const parsed = parseIso(value);
    if (parsed) setCursor(parsed);
  }, [value]);

  // Escape closes, and so does a click anywhere else. A popover that traps the
  // page is worse than no popover.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  /** The 42 cells of the visible month, leading and trailing days included. */
  const cells = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const start = new Date(first);
    start.setDate(first.getDate() - mondayFirstIndex(first));
    return Array.from({ length: 42 }, (_, i) => {
      const day = new Date(start);
      day.setDate(start.getDate() + i);
      return day;
    });
  }, [cursor]);

  const selected = parseIso(value);
  const todayIso = toIso(new Date());

  const commit = (next: string) => {
    setDraft(next);
    if (commitOn === 'blur') return;
    if (next === '') return onChange('');
    if (parseIso(next)) onChange(next);
  };

  /** 'blur' mode: hand the parent what was typed, if it is a date (or empty) and new. */
  const settle = () => {
    if (commitOn !== 'blur' || draft === (value ?? '')) return;
    if (draft === '' || parseIso(draft)) onChange(draft);
  };

  const pick = (date: Date) => {
    const iso = toIso(date);
    setDraft(iso);
    onChange(iso);
    setOpen(false);
  };

  const draftInvalid = draft !== '' && !parseIso(draft);

  return (
    <div ref={wrapRef} className={cn('relative', className)}>
      <div className="flex items-center gap-1.5">
        <input
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          value={draft}
          aria-label={ariaLabel || 'Date, YYYY-MM-DD'}
          // The placeholder is OURS. This is the whole point of the component.
          placeholder="YYYY-MM-DD"
          onChange={(e) => commit(e.target.value.trim())}
          onBlur={settle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') settle();
          }}
          className={cn(
            'flex-1 min-w-0 px-2.5 py-1.5 bg-white border rounded-xl font-black text-xs text-gray-900 tabular-nums',
            'focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50',
            draftInvalid ? 'border-red-300 text-red-700' : 'border-gray-200',
          )}
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          title="Open the calendar"
          aria-label="Open the calendar"
          className="p-1.5 rounded-xl border border-gray-200 bg-white text-gray-500 hover:text-blue-600 hover:border-blue-300 transition-colors disabled:opacity-50 shrink-0"
        >
          <Calendar className="w-3.5 h-3.5" />
        </button>
      </div>

      {draftInvalid && (
        <p className="text-[0.625rem] font-black text-red-600 mt-1">Use the form 2026-08-21.</p>
      )}

      {open && !disabled && (
        <div className="absolute z-30 mt-2 right-0 w-64 bg-white border border-gray-200 rounded-2xl shadow-xl p-3 space-y-2">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
              className="p-1 rounded-lg hover:bg-gray-100 text-gray-500"
              aria-label="Previous month"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs font-black text-gray-900">
              {MONTHS[cursor.getMonth()]} {cursor.getFullYear()}
            </span>
            <button
              type="button"
              onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
              className="p-1 rounded-lg hover:bg-gray-100 text-gray-500"
              aria-label="Next month"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-0.5 text-center">
            {WEEKDAYS.map((day) => (
              <span key={day} className="text-[0.5625rem] font-black uppercase text-gray-400 py-1">
                {day.slice(0, 2)}
              </span>
            ))}
            {cells.map((day) => {
              const iso = toIso(day);
              const outside = day.getMonth() !== cursor.getMonth();
              const isSelected = selected && iso === toIso(selected);
              const isToday = iso === todayIso;
              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => pick(day)}
                  className={cn(
                    'text-[0.6875rem] font-bold py-1.5 rounded-lg transition-colors',
                    outside ? 'text-gray-300' : 'text-gray-800 hover:bg-blue-50',
                    isToday && !isSelected && 'ring-1 ring-blue-300',
                    isSelected && 'bg-blue-600 text-white hover:bg-blue-600',
                  )}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between pt-1 border-t border-gray-100">
            <button
              type="button"
              onClick={() => pick(new Date())}
              className="text-[0.625rem] font-black text-blue-700 hover:underline"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft('');
                onChange('');
                setOpen(false);
              }}
              className="text-[0.625rem] font-black text-gray-500 hover:text-red-600 flex items-center gap-1"
            >
              <X className="w-3 h-3" />
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
