/**
 * THE ONLINE DESIGNER'S OWN SETTINGS (designer v2), in the dashboard's Design
 * templates screen — the owner's decisions of 2026-10-07:
 *
 *  - PRINT RESOLUTION BY SIZE: "by the size, or he sets it as he likes" — a table of
 *    size bands (the longest side up to N mm → the resolution the print file is made
 *    at, and the least it may fall to). The trade's values until he changes them
 *    (src/lib/printSpec.ts DEFAULT_DPI_BANDS); one product can still have its own
 *    (the product editor).
 *  - AI PICTURES in the studio: off until he switches them on — Google's image models
 *    need billing on his Google project, and each picture costs him — with a daily cap.
 *
 * Saved into the shop's settings (settings/siteConfig): every product page already
 * holds them, so they cost no read.
 */
import React, { useEffect, useState } from 'react';
import { Plus, RotateCcw, Sparkles, Trash2 } from 'lucide-react';
import { useSiteSettings } from '../../context/SiteSettingsContext';
import { DEFAULT_DPI_BANDS, cleanDpiBands, type DpiBand } from '../../lib/printSpec';
import { AI_IMAGE_DAILY_CAP_DEFAULT, dailyCap } from '../../lib/aiImages';

type Row = { max: string; target: string; min: string };
/** As many as cleanDpiBands keeps (src/lib/printSpec.ts): a 9th was cut before sorting. */
const MAX_BANDS = 8;
const toRows = (bands: readonly DpiBand[]): Row[] =>
  bands.map((b) => ({ max: b.maxLongSideMm === null ? '' : String(b.maxLongSideMm), target: String(b.targetDpi), min: String(b.minDpi) }));

export default function DesignerSettingsPanel({ onError }: { onError: (message: string | null) => void }) {
  const { settings, updateSettings } = useSiteSettings();
  const current = cleanDpiBands(settings.designerDpiBands);
  const [rows, setRows] = useState<Row[]>(() => toRows(current));
  const [saved, setSaved] = useState(false);
  const [cap, setCap] = useState(String(dailyCap(settings.designerAiDailyCap)));
  // The settings arrive after the screen (a live listener): take them once they do.
  useEffect(() => {
    setRows(toRows(cleanDpiBands(settings.designerDpiBands)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(settings.designerDpiBands ?? null)]);
  useEffect(() => setCap(String(dailyCap(settings.designerAiDailyCap))), [settings.designerAiDailyCap]);

  const parsed = rows.map((r) => ({
    maxLongSideMm: r.max.trim() === '' ? null : Number(r.max.replace(',', '.')),
    targetDpi: Number(r.target),
    minDpi: Number(r.min),
  }));
  const problem = (() => {
    if (parsed.length === 0) return 'Keep at least one band.';
    if (parsed.length > MAX_BANDS) return `At most ${MAX_BANDS} bands.`;
    if (parsed.filter((b) => b.maxLongSideMm === null).length !== 1) return 'Exactly one band has no upper size — "and larger".';
    {
      const sizes = parsed.flatMap((b) => (b.maxLongSideMm === null ? [] : [b.maxLongSideMm]));
      if (new Set(sizes).size !== sizes.length) return 'Each size once — two bands with the same size, and one of them is never used.';
    }
    for (const b of parsed) {
      if (b.maxLongSideMm !== null && !(b.maxLongSideMm >= 10 && b.maxLongSideMm <= 20000)) return 'Sizes are millimetres between 10 and 20 000.';
      if (!(b.targetDpi >= 50 && b.targetDpi <= 1200) || !(b.minDpi >= 50 && b.minDpi <= 1200)) return 'Resolutions are between 50 and 1 200 DPI.';
      if (b.minDpi > b.targetDpi) return 'The least a file may fall to cannot be above the resolution it is made at.';
    }
    return null;
  })();

  const save = async () => {
    if (problem) return;
    onError(null);
    try {
      await updateSettings({ designerDpiBands: cleanDpiBands(parsed) });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (err: any) {
      onError(`The resolution table could not be saved: ${err?.message ?? err}`);
    }
  };

  const field = 'w-full px-2.5 py-1.5 rounded-lg border border-gray-200 text-sm font-bold bg-white tabular-nums';
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <section className="p-4 rounded-2xl bg-gray-50 border border-gray-200 space-y-3" data-rx-dpi-bands>
        <div>
          <h3 className="text-sm font-black text-gray-900">Print resolution, by size</h3>
          <p className="text-[0.6875rem] font-bold text-gray-500">
            The online designer makes each print file at this resolution for the product&rsquo;s size (its longer side), and
            never lets it fall below the least. A roll-up is read from a metre away: 150 DPI is plenty. A product can have
            its own in the product editor.
          </p>
        </div>
        <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 text-[0.625rem] font-black uppercase tracking-wider text-gray-400">
          <span>Longer side up to (mm)</span>
          <span>Made at (DPI)</span>
          <span>Never below (DPI)</span>
          <span />
        </div>
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-center" data-rx-dpi-band={i}>
            <input className={field} inputMode="numeric" value={r.max} placeholder="and larger" onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, max: e.target.value } : x)))} aria-label="Longer side up to (mm)" />
            <input className={field} inputMode="numeric" value={r.target} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, target: e.target.value } : x)))} aria-label="Made at (DPI)" />
            <input className={field} inputMode="numeric" value={r.min} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, min: e.target.value } : x)))} aria-label="Never below (DPI)" />
            <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} disabled={rows.length <= 1} title="Remove this band" className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 disabled:opacity-30">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setRows([...rows, { max: '', target: '150', min: '100' }])} disabled={rows.length >= MAX_BANDS} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-xs font-black text-gray-700 disabled:opacity-40">
            <Plus className="w-3.5 h-3.5" />
            Add a band
          </button>
          <button type="button" onClick={() => setRows(toRows(DEFAULT_DPI_BANDS))} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-xs font-black text-gray-700">
            <RotateCcw className="w-3.5 h-3.5" />
            The trade&rsquo;s values
          </button>
          <button type="button" onClick={() => void save()} disabled={!!problem} data-rx-dpi-save className="ml-auto px-4 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-black disabled:opacity-40">
            {saved ? 'Saved' : 'Save the table'}
          </button>
        </div>
        {problem && <p className="text-[0.6875rem] font-black text-red-700">{problem}</p>}
      </section>

      <section className="p-4 rounded-2xl bg-gray-50 border border-gray-200 space-y-3" data-rx-ai-images-setting>
        <label className="flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.designerAiImages === true}
            onChange={(e) => void updateSettings({ designerAiImages: e.target.checked }).catch((err) => onError(`The setting could not be saved: ${err?.message ?? err}`))}
            className="mt-0.5 w-4 h-4 accent-blue-600"
          />
          <span>
            <span className="flex items-center gap-1.5 text-sm font-black text-gray-900">
              <Sparkles className="w-4 h-4 text-violet-600" />
              AI pictures in the designer
            </span>
            <span className="block text-[0.6875rem] font-bold text-gray-500">
              Customers describe a picture and the shop&rsquo;s AI makes four. Needs BILLING on your Google project (the
              key in Integrations): Google charges for each picture — check its price list before switching this on. Off,
              customers see &ldquo;not switched on in this shop yet&rdquo;.
            </span>
          </span>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs font-black text-gray-700" htmlFor="ai-cap">At most</label>
          <input
            id="ai-cap"
            className="w-24 px-2.5 py-1.5 rounded-lg border border-gray-200 text-sm font-bold bg-white tabular-nums"
            inputMode="numeric"
            value={cap}
            onChange={(e) => setCap(e.target.value)}
            onBlur={() => {
              // Emptied: nothing changes (an empty box is not "no pictures today").
              if (cap.trim() === '') {
                setCap(String(dailyCap(settings.designerAiDailyCap)));
                return;
              }
              const n = dailyCap(cap);
              setCap(String(n));
              if (n !== dailyCap(settings.designerAiDailyCap)) void updateSettings({ designerAiDailyCap: n }).catch((err) => onError(`The limit could not be saved: ${err?.message ?? err}`));
            }}
            data-rx-ai-cap
          />
          <span className="text-xs font-bold text-gray-600">pictures a day for the whole shop (four per request, so it is rounded up to fours; {AI_IMAGE_DAILY_CAP_DEFAULT} unless you change it; 0 = none).</span>
        </div>
      </section>
    </div>
  );
}
