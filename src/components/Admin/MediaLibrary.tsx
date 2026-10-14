// The owner's pictures, in one place — "لازم يكون عندي صفحه ميديا للصور".
//
// ONE component, two jobs. As a PAGE it is a manager: upload, see, copy, delete.
// Given `onPick` it is a PICKER: the same grid, and clicking a picture hands its
// URL back to whichever screen opened it. Two components would have meant two
// upload paths and two ideas of what a thumbnail looks like, and the second one
// would rot — the option-image upload already exists twice in this codebase for
// exactly that reason.
//
// Everything here writes to public/media/, which storage.rules makes
// world-readable and admin-writable. Customer artwork lives under uploads/ and
// is never reachable from this screen: the delete endpoint refuses any path
// outside the media prefix.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Upload, Trash2, Copy, Check, Link2, RefreshCw, ImageOff, X } from 'lucide-react';
import { useAuth } from '../../App';
import { cn } from '../../lib/utils';
import {
  listMedia, deleteMedia, rehostImage, uploadMedia, formatBytes, type MediaItem,
} from '../../lib/mediaLibrary';

/** What the bucket rules and the storefront can actually use. */
const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml';
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

interface Props {
  /** Present = picker. The URL is handed back and the caller closes itself. */
  onPick?: (url: string) => void;
}

export default function MediaLibrary({ onPick }: Props) {
  const { t } = useAuth();
  const isPicker = typeof onPick === 'function';

  const [items, setItems] = useState<MediaItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ name: string; percent: number } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<MediaItem | null>(null);
  const [urlInput, setUrlInput] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  // A late reply must not land in a screen that has moved on. The same ticket
  // pattern the translate button uses.
  const live = useRef(0);
  useEffect(() => () => { live.current = -1; }, []);

  const load = useCallback(async (next?: string | null) => {
    const ticket = live.current + 1;
    live.current = ticket;
    if (!next) setLoading(true);
    setError(null);
    try {
      const data = await listMedia(next);
      if (live.current !== ticket) return;
      setItems((prev) => {
        if (!next) return data.items;
        // Merged by path: a file can move between pages while the owner scrolls.
        const seen = new Set(prev.map((i) => i.path));
        return [...prev, ...data.items.filter((i) => !seen.has(i.path))];
      });
      setCursor(data.nextCursor);
    } catch (err: any) {
      if (live.current === ticket) setError(err?.message || t('mlLoadFailed'));
    } finally {
      if (live.current === ticket) setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    const chosen = Array.from(files);

    // Refused HERE rather than by the bucket. A rules rejection arrives as an
    // opaque CORS-shaped error with nothing the owner can act on.
    const tooBig = chosen.find((f) => f.size >= MAX_UPLOAD_BYTES);
    if (tooBig) {
      setError(t('mlTooBig').replace('{0}', tooBig.name).replace('{1}', formatBytes(tooBig.size)));
      return;
    }
    const wrongType = chosen.find((f) => f.type && !ACCEPT.includes(f.type));
    if (wrongType) {
      setError(t('mlWrongType').replace('{0}', wrongType.name));
      return;
    }

    for (const file of chosen) {
      setProgress({ name: file.name, percent: 0 });
      try {
        await uploadMedia(file, (percent) => setProgress({ name: file.name, percent }));
      } catch (err: any) {
        setError(`${file.name}: ${err?.message || t('mlUploadFailed')}`);
        break;
      }
    }
    setProgress(null);
    if (fileInput.current) fileInput.current.value = '';
    await load();
  };

  const onRehost = async () => {
    const url = urlInput.trim();
    if (!url) return;
    setBusy('rehost');
    setError(null);
    try {
      await rehostImage(url);
      setUrlInput('');
      await load();
    } catch (err: any) {
      setError(err?.message || t('mlFetchFailed'));
    } finally {
      setBusy(null);
    }
  };

  const onDelete = async (item: MediaItem) => {
    setBusy(item.path);
    setError(null);
    try {
      await deleteMedia(item.path);
      setItems((prev) => prev.filter((i) => i.path !== item.path));
      setConfirmDelete(null);
    } catch (err: any) {
      setError(err?.message || t('mlDeleteFailed'));
    } finally {
      setBusy(null);
    }
  };

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      setTimeout(() => setCopied((c) => (c === url ? null : c)), 1800);
    } catch {
      setError(t('mlCopyFailed'));
    }
  };

  return (
    <div className="space-y-5">
      {!isPicker && (
        <div>
          <h2 className="text-xl font-black text-gray-900">{t('mlTitle')}</h2>
          <p className="text-xs text-gray-500 font-medium mt-1">{t('mlSubtitle')}</p>
        </div>
      )}

      {/* Add: from this computer, or from a URL somewhere else. */}
      <div className="bg-white rounded-3xl border border-gray-100 p-4 sm:p-5 space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={progress !== null}
            className="px-5 py-3 bg-gray-900 text-white text-xs font-black rounded-2xl hover:bg-orange-600 transition-colors inline-flex items-center gap-2 disabled:opacity-60 shrink-0"
          >
            <Upload className="w-4 h-4" />
            {progress ? `${progress.percent}% · ${progress.name}` : t('mlUpload')}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPT}
            multiple
            hidden
            onChange={(e) => void onFiles(e.target.files)}
          />

          <div className="flex-1 flex gap-2">
            <div className="relative flex-1">
              <Link2 className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void onRehost(); }}
                placeholder={t('mlFromUrlPlaceholder')}
                className="w-full pl-9 pr-3 py-3 text-xs font-medium border border-gray-200 rounded-2xl focus:outline-hidden focus:ring-2 focus:ring-orange-500"
              />
            </div>
            <button
              type="button"
              onClick={() => void onRehost()}
              disabled={!urlInput.trim() || busy === 'rehost'}
              className="px-4 py-3 bg-gray-100 text-gray-800 text-xs font-black rounded-2xl hover:bg-gray-200 transition-colors disabled:opacity-50 shrink-0"
            >
              {busy === 'rehost' ? '…' : t('mlFetch')}
            </button>
          </div>
        </div>
        <p className="text-[0.6875rem] text-gray-400 font-medium leading-relaxed">{t('mlFromUrlHelp')}</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-xs font-bold rounded-2xl px-4 py-3 flex items-start gap-2">
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="dismiss"><X className="w-4 h-4" /></button>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="bg-gray-100 rounded-2xl aspect-square animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-3xl border border-gray-200 p-12 text-center space-y-3">
          <ImageOff className="w-10 h-10 text-gray-300 mx-auto" />
          <p className="text-sm font-bold text-gray-700">{t('mlEmptyTitle')}</p>
          <p className="text-xs text-gray-400 max-w-sm mx-auto">{t('mlEmptyBody')}</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {items.map((item) => (
              <div
                key={item.path}
                className={cn(
                  'group bg-white rounded-2xl border border-gray-200 overflow-hidden flex flex-col',
                  isPicker && item.url && 'cursor-pointer hover:border-orange-400 hover:shadow-lg transition-all',
                )}
                onClick={isPicker && item.url ? () => onPick!(item.url!) : undefined}
              >
                <div className="aspect-square bg-gray-50 p-2">
                  {item.url ? (
                    <img
                      src={item.url}
                      alt={item.name}
                      loading="lazy"
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    // An object with no download token cannot be shown or used.
                    // Saying so beats a broken image icon with no explanation.
                    <div className="w-full h-full flex flex-col items-center justify-center text-center gap-1 px-1">
                      <ImageOff className="w-5 h-5 text-gray-300" />
                      <span className="text-[0.625rem] font-bold text-gray-400">{t('mlNoUrl')}</span>
                    </div>
                  )}
                </div>
                <div className="px-2.5 py-2 border-t border-gray-100">
                  <p className="text-[0.6875rem] font-bold text-gray-700 truncate" title={item.name}>{item.name}</p>
                  <p className="text-[0.625rem] text-gray-400 font-medium">{formatBytes(item.size)}</p>
                </div>
                {!isPicker && item.url && (
                  <div className="flex border-t border-gray-100">
                    <button
                      type="button"
                      onClick={() => void copy(item.url!)}
                      className="flex-1 py-2 text-[0.6875rem] font-black text-gray-600 hover:bg-gray-50 inline-flex items-center justify-center gap-1"
                    >
                      {copied === item.url
                        ? <><Check className="w-3.5 h-3.5 text-green-600" />{t('mlCopied')}</>
                        : <><Copy className="w-3.5 h-3.5" />{t('mlCopy')}</>}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(item)}
                      disabled={busy === item.path}
                      className="px-3 py-2 text-red-600 hover:bg-red-50 disabled:opacity-50 border-l border-gray-100"
                      aria-label={t('mlDelete')}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {cursor && (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => void load(cursor)}
                className="px-6 py-3 bg-gray-100 text-gray-800 text-xs font-black rounded-2xl hover:bg-gray-200 transition-colors inline-flex items-center gap-2"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                {t('mlLoadMore')}
              </button>
            </div>
          )}
        </>
      )}

      {/* Deleting is not undoable and the picture may be on a live product, so
          it asks — and names the file, because "are you sure?" on a grid of
          thumbnails is a question about nothing in particular. */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setConfirmDelete(null)}>
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-black text-gray-900">{t('mlDeleteTitle')}</h3>
            <p className="text-xs text-gray-600 font-medium break-all">{confirmDelete.name}</p>
            <p className="text-xs text-gray-500">{t('mlDeleteWarning')}</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="flex-1 px-4 py-3 bg-gray-100 text-gray-800 text-xs font-black rounded-2xl hover:bg-gray-200"
              >
                {t('mlCancel')}
              </button>
              <button
                type="button"
                onClick={() => void onDelete(confirmDelete)}
                disabled={busy === confirmDelete.path}
                className="flex-1 px-4 py-3 bg-red-600 text-white text-xs font-black rounded-2xl hover:bg-red-500 disabled:opacity-60"
              >
                {busy === confirmDelete.path ? '…' : t('mlDelete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** The picker, as a modal any screen can open. */
export function MediaPickerModal({ open, onClose, onPick }: {
  open: boolean;
  onClose: () => void;
  onPick: (url: string) => void;
}) {
  const { t } = useAuth();
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div
        className="bg-gray-50 rounded-3xl p-5 sm:p-6 max-w-5xl w-full my-8 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-black text-gray-900">{t('mlPickTitle')}</h3>
            <p className="text-xs text-gray-500 font-medium">{t('mlPickSubtitle')}</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-xl hover:bg-gray-200" aria-label={t('mlCancel')}>
            <X className="w-5 h-5" />
          </button>
        </div>
        <MediaLibrary onPick={(url) => { onPick(url); onClose(); }} />
      </div>
    </div>
  );
}
