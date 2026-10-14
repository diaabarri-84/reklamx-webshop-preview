// What to do with the products he has ticked.
//
// It lives apart from ProductsAdmin because that file is already several
// thousand lines, and because every write here goes through ONE server endpoint
// — /api/admin/products/bulk — rather than the browser loop the screens used to
// run. Task 0.2 measured that loop at six seconds for two products with nothing
// on screen while it ran; at 500 it is minutes of a screen that looks idle, and
// closing the tab halfway leaves half of them written with no record of which.
//
// Nothing here writes directly to Firestore. Two of these operations are things
// the browser cannot do at all: deleting a product's paired productCosts record
// (that collection is closed to every client), and re-pricing from the stored
// trade price instead of from the number on screen.

import { useState } from 'react';
import { Trash2, Eye, EyeOff, FolderInput, Percent, Tag, X, Loader2, Upload, UploadCloud } from 'lucide-react';
import { useAuth } from '../../App';
import { cn } from '../../lib/utils';
import { bulkProducts, type BulkResult } from '../../lib/bulkProducts';
import type { Category } from '../../types';
import { categoryPickList } from '../../lib/categoryTree';
import { BAR_FIELD } from './darkBar';

type Action = 'delete' | 'hide' | 'show' | 'artworkOn' | 'artworkOff' | 'category' | 'percent' | 'sale' | 'margin';

interface Props {
  ids: string[];
  categories: Category[];
  /** Cleared selection and reloaded list. */
  onDone: (result: BulkResult) => void;
  onClear: () => void;
}

export default function ProductsBulkBar({ ids, categories, onDone, onClear }: Props) {
  const { t } = useAuth();
  const [action, setAction] = useState<Action | null>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (ids.length === 0) return null;

  const run = async (payload: Parameters<typeof bulkProducts>[0]) => {
    setBusy(true);
    setError(null);
    try {
      const result = await bulkProducts(payload);
      setAction(null);
      setValue('');
      onDone(result);
    } catch (err: any) {
      setError(err?.message || t('pbFailed'));
    } finally {
      setBusy(false);
    }
  };

  const count = ids.length;
  const label = (key: Parameters<typeof t>[0]) => t(key).replace('{0}', String(count));

  return (
    <div className="sticky top-2 z-30 bg-gray-900 text-white rounded-2xl shadow-lg p-3 sm:p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="text-xs font-black">{label('pbSelected')}</span>
        <div className="flex items-center gap-1.5 flex-wrap">
          <BulkButton icon={<EyeOff className="w-3.5 h-3.5" />} onClick={() => setAction('hide')} active={action === 'hide'} label={t('pbHide')} />
          <BulkButton icon={<Eye className="w-3.5 h-3.5" />} onClick={() => setAction('show')} active={action === 'show'} label={t('pbShow')} />
          {/* THE ARTWORK BOX, for a whole selection at once. It defaults to off,
              so the common job is turning it ON for the products that really are
              print jobs — and 109 products is not a thing anyone does one by one. */}
          <BulkButton icon={<Upload className="w-3.5 h-3.5" />} onClick={() => setAction('artworkOn')} active={action === 'artworkOn'} label={t('pbArtworkOn')} />
          <BulkButton icon={<UploadCloud className="w-3.5 h-3.5" />} onClick={() => setAction('artworkOff')} active={action === 'artworkOff'} label={t('pbArtworkOff')} />
          <BulkButton icon={<FolderInput className="w-3.5 h-3.5" />} onClick={() => setAction('category')} active={action === 'category'} label={t('pbMove')} />
          <BulkButton icon={<Percent className="w-3.5 h-3.5" />} onClick={() => setAction('percent')} active={action === 'percent'} label={t('pbPrice')} />
          <BulkButton icon={<Tag className="w-3.5 h-3.5" />} onClick={() => setAction('sale')} active={action === 'sale'} label={t('pbSale')} />
          <BulkButton icon={<Percent className="w-3.5 h-3.5" />} onClick={() => setAction('margin')} active={action === 'margin'} label={t('pbMargin')} />
          <BulkButton icon={<Trash2 className="w-3.5 h-3.5" />} onClick={() => setAction('delete')} active={action === 'delete'} label={t('pbDelete')} danger />
          <button type="button" onClick={onClear} className="px-2.5 py-2 rounded-xl hover:bg-white/10" aria-label={t('pbClear')}>
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Every action confirms before it runs. Each of these is irreversible or
          hard to undo across hundreds of products, and the bar sits directly
          above a grid where one stray click changes the selection. */}
      {action && (
        <div className="bg-white/10 rounded-xl p-3 space-y-2.5">
          {action === 'hide' && <Confirm text={label('pbConfirmHide')} busy={busy} onRun={() => run({ ids, op: 'visibility', hidden: true })} onCancel={() => setAction(null)} t={t} />}
          {action === 'show' && <Confirm text={label('pbConfirmShow')} busy={busy} onRun={() => run({ ids, op: 'visibility', hidden: false })} onCancel={() => setAction(null)} t={t} />}
          {action === 'artworkOn' && <Confirm text={label('pbConfirmArtworkOn')} busy={busy} onRun={() => run({ ids, op: 'artwork', enabled: true })} onCancel={() => setAction(null)} t={t} />}
          {action === 'artworkOff' && <Confirm text={label('pbConfirmArtworkOff')} busy={busy} onRun={() => run({ ids, op: 'artwork', enabled: false })} onCancel={() => setAction(null)} t={t} />}

          {action === 'delete' && (
            <Confirm
              text={label('pbConfirmDelete')}
              danger
              busy={busy}
              onRun={() => run({ ids, op: 'delete' })}
              onCancel={() => setAction(null)}
              t={t}
            />
          )}

          {action === 'category' && (
            <>
              <select
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className={cn('py-2.5', BAR_FIELD)}
              >
                <option value="">{t('pbPickCategory')}</option>
                {/* Tree order and indented, so moving products INTO a sub-category
                    is a choice he can see rather than guess. */}
                {categoryPickList(categories).map(({ category: c, indent }) => (
                  <option key={c.id} value={c.id}>{indent}{c.name}</option>
                ))}
              </select>
              <Confirm
                text={label('pbConfirmMove')}
                disabled={!value}
                busy={busy}
                onRun={() => run({ ids, op: 'category', categoryId: value })}
                onCancel={() => setAction(null)}
                t={t}
              />
            </>
          )}

          {action === 'percent' && (
            <>
              <NumberField
                value={value}
                onChange={setValue}
                placeholder={t('pbPercentPlaceholder')}
                hint={t('pbPercentHint')}
              />
              <Confirm
                text={label('pbConfirmPrice')}
                disabled={!value.trim() || !Number.isFinite(Number(value))}
                busy={busy}
                onRun={() => run({ ids, op: 'price', mode: 'percent', value: Number(value) })}
                onCancel={() => setAction(null)}
                t={t}
              />
            </>
          )}

          {action === 'sale' && (
            <>
              <NumberField
                value={value}
                onChange={setValue}
                placeholder={t('pbSalePlaceholder')}
                hint={t('pbSaleHint')}
              />
              <Confirm
                text={value.trim() ? label('pbConfirmSale') : label('pbConfirmSaleClear')}
                busy={busy}
                onRun={() => run({ ids, op: 'salePrice', value: value.trim() ? Number(value) : null })}
                onCancel={() => setAction(null)}
                t={t}
              />
            </>
          )}

          {action === 'margin' && (
            <>
              <NumberField
                value={value}
                onChange={setValue}
                placeholder={t('pbMarginPlaceholder')}
                hint={t('pbMarginHint')}
              />
              <Confirm
                text={label('pbConfirmMargin')}
                disabled={!value.trim() || !(Number(value) >= 0)}
                busy={busy}
                onRun={() => run({ ids, op: 'margin', marginPercent: Number(value) })}
                onCancel={() => setAction(null)}
                t={t}
              />
            </>
          )}
        </div>
      )}

      {error && <p className="text-xs font-bold text-red-300">{error}</p>}
    </div>
  );
}

function BulkButton({ icon, label, onClick, active, danger }: {
  icon: React.ReactNode; label: string; onClick: () => void; active?: boolean; danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'px-2.5 py-2 rounded-xl text-[0.6875rem] font-black inline-flex items-center gap-1.5 transition-colors',
        active ? 'bg-white text-gray-900' : danger ? 'bg-red-600/80 hover:bg-red-600' : 'bg-white/10 hover:bg-white/20',
      )}
    >
      {icon}<span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function NumberField({ value, onChange, placeholder, hint }: {
  value: string; onChange: (v: string) => void; placeholder: string; hint: string;
}) {
  return (
    <div className="space-y-1">
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn('py-2.5', BAR_FIELD)}
      />
      <p className="text-[0.625rem] font-medium text-white/60">{hint}</p>
    </div>
  );
}

function Confirm({ text, onRun, onCancel, busy, disabled, danger, t }: {
  text: string; onRun: () => void; onCancel: () => void; busy: boolean; disabled?: boolean; danger?: boolean;
  t: (k: any) => string;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[0.6875rem] font-bold flex-1 min-w-[12.5rem]">{text}</span>
      <button type="button" onClick={onCancel} className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-[0.6875rem] font-black">
        {t('pbCancel')}
      </button>
      <button
        type="button"
        onClick={onRun}
        disabled={busy || disabled}
        className={cn(
          'px-4 py-2 rounded-xl text-[0.6875rem] font-black inline-flex items-center gap-1.5 disabled:opacity-50',
          danger ? 'bg-red-600 hover:bg-red-500' : 'bg-white text-gray-900 hover:bg-gray-100',
        )}
      >
        {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
        {t('pbApply')}
      </button>
    </div>
  );
}
