// A confirm dialog that lives inside the page.
//
// Every destructive action in the admin used to call window.confirm(). Chrome,
// Safari and Firefox all let a visitor tick "don't allow this page to prompt me
// again" on any dialog — and from then on confirm() returns FALSE immediately,
// showing nothing. The delete then does nothing at all, silently, and there is
// no way back short of clearing the site's settings in the browser. That is
// exactly what the shop owner reported: he pressed delete and nothing happened.
// alert() is suppressed by the same switch, so the explanations went missing too.
//
// Two ways in:
//
//   const { confirm, notify, dialog } = useConfirmDialog();
//   if (!(await confirm({ title: '…', message: '…' }))) return;
//   …and render {dialog} somewhere in the tree.
//
// or drive <ConfirmDialog> directly when the dialog carries its own controls —
// CategoryAdmin does, because it offers to move the products out first.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertTriangle, Info } from 'lucide-react';
import { useAuth } from '../App';
import { cn } from '../lib/utils';

export type ConfirmTone = 'danger' | 'primary';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message?: React.ReactNode;
  /** Extra controls rendered under the message — a dropdown, a checkbox, a list. */
  children?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
  /** Work is in flight: both buttons lock and the confirm label is replaced. */
  busy?: boolean;
  busyLabel?: string;
  confirmDisabled?: boolean;
  /** A statement, not a question: one button, no cancel. Replaces alert(). */
  notice?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  children,
  confirmLabel,
  cancelLabel,
  tone = 'danger',
  busy = false,
  busyLabel,
  confirmDisabled = false,
  notice = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useAuth();
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  // Escape cancels, and the keyboard lands somewhere sensible: on the safe
  // button for a destructive question, on the only button for a notice.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    const focusTarget = notice ? confirmRef.current : cancelRef.current;
    focusTarget?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, notice, onCancel]);

  const danger = tone === 'danger';

  return (
    <AnimatePresence>
      {open && (
        <div
          // Above the editor modals, which sit at z-50 — a delete can be started
          // from inside one.
          // overflow-y-auto here and max-h on the panel below: this dialog TAKES
          // CHILDREN, and CategoryAdmin's delete flow fills it with one row per
          // category to reassign products to. With enough categories it grew past
          // a phone screen and its own Confirm and Cancel buttons went off the
          // bottom with no way to scroll to them — the deletion could neither be
          // completed nor cancelled except by reloading. The two admin modals
          // that open this dialog were fixed the same day; fixing them and not
          // this one would have left the last step of the same journey stuck.
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs overflow-y-auto"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !busy) onCancel();
          }}
          role="presentation"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            role="alertdialog"
            aria-modal="true"
            aria-label={title}
            className="bg-white rounded-3xl max-w-md w-full my-auto max-h-[90vh] overflow-y-auto p-6 shadow-2xl border border-gray-100 space-y-5"
          >
            <div className="flex items-start space-x-3">
              <div
                className={cn(
                  'w-10 h-10 shrink-0 rounded-2xl flex items-center justify-center',
                  danger && !notice ? 'bg-red-50 text-red-600' : 'bg-orange-50 text-orange-600',
                )}
              >
                {notice ? <Info className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-black text-gray-900 leading-snug">{title}</h3>
                {message && (
                  <div className="text-xs font-semibold text-gray-500 mt-1.5 leading-relaxed">{message}</div>
                )}
              </div>
            </div>

            {children && <div className="space-y-2">{children}</div>}

            <div className="flex items-center justify-end space-x-3 pt-1">
              {!notice && (
                <button
                  ref={cancelRef}
                  type="button"
                  onClick={onCancel}
                  disabled={busy}
                  className="px-5 py-2.5 rounded-xl border border-gray-200 text-xs font-bold text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                >
                  {cancelLabel || t('dlgCancel')}
                </button>
              )}
              <button
                ref={confirmRef}
                type="button"
                onClick={onConfirm}
                disabled={busy || confirmDisabled}
                className={cn(
                  'px-6 py-2.5 rounded-xl text-white text-xs font-black shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed',
                  danger && !notice
                    ? 'bg-red-600 hover:bg-red-500 shadow-red-500/20'
                    : 'bg-orange-600 hover:bg-orange-500 shadow-orange-500/20',
                )}
              >
                {busy ? busyLabel || t('dlgWorking') : confirmLabel || (notice ? t('dlgOk') : t('dlgConfirm'))}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

type ConfirmRequest = Omit<ConfirmDialogProps, 'open' | 'onConfirm' | 'onCancel' | 'children' | 'busy' | 'busyLabel'>;

/**
 * The simple yes/no case, as a drop-in for `window.confirm` / `alert`.
 *
 * `confirm` resolves true or false; `notify` shows one button and resolves once
 * it is dismissed. Render the returned `dialog` anywhere in the component.
 */
export function useConfirmDialog() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const [open, setOpen] = useState(false);
  const resolveRef = useRef<((ok: boolean) => void) | null>(null);

  // The request is deliberately NOT cleared on close: AnimatePresence still
  // renders the dialog while it fades out, and blanking it first made the title
  // disappear for the length of the animation.
  const settle = useCallback((ok: boolean) => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    setOpen(false);
    resolve?.(ok);
  }, []);

  const confirm = useCallback((req: ConfirmRequest) => {
    // A second question asked while one is open would otherwise strand the
    // first promise forever, and its caller with it.
    resolveRef.current?.(false);
    resolveRef.current = null;
    setRequest(req);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  const notify = useCallback(
    (req: Omit<ConfirmRequest, 'notice'>) => confirm({ ...req, notice: true }),
    [confirm],
  );

  const dialog = (
    <ConfirmDialog
      title=""
      {...(request ?? {})}
      open={open}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  );

  return { confirm, notify, dialog };
}
