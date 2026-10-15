import React, { useState } from 'react';
import { X } from 'lucide-react';
import type { PrintingField, PrintingFieldOption } from '../../types';
import type { Language } from '../../lib/translations';
import { chestCmOf } from '../../lib/clothingTemplate';
import { cn } from '../../lib/utils';

/**
 * HOW MANY OF EACH SIZE — the clothing template's size row (src/lib/clothingTemplate.ts).
 *
 * A size tile with a quantity box under it, for every size; a size guide drawn
 * from the options' own measurements; and the full price list as a file. Each
 * size with a quantity becomes its own basket line (ProductConfigurator).
 */
const L: Record<Language, {
  size: string; guide: string; priceList: string; pieces: string; chest: string; qtyFor: string;
  guideTitle: string; guideNote: string; listQty: string; listUnit: string; close: string;
}> = {
  sv: { size: 'Storlek', guide: 'Storleksguide', priceList: 'Ladda ner hela prislistan', pieces: 'st', chest: 'Bröstvidd', qtyFor: 'Antal i storlek', guideTitle: 'Storleksguide', guideNote: 'Mät runt bröstet, under armarna. Plaggets mått kan skilja lite.', listQty: 'Antal', listUnit: 'Pris per st exkl. moms (SEK)', close: 'Stäng' },
  en: { size: 'Size', guide: 'Size guide', priceList: 'Download full price list', pieces: 'pcs', chest: 'Chest', qtyFor: 'Quantity in size', guideTitle: 'Size guide', guideNote: 'Measure around the chest, under the arms. Garments can differ a little.', listQty: 'Quantity', listUnit: 'Price per piece excl. VAT (SEK)', close: 'Close' },
  da: { size: 'Størrelse', guide: 'Størrelsesguide', priceList: 'Download hele prislisten', pieces: 'stk', chest: 'Brystvidde', qtyFor: 'Antal i størrelse', guideTitle: 'Størrelsesguide', guideNote: 'Mål rundt om brystet, under armene. Tøjet kan variere lidt.', listQty: 'Antal', listUnit: 'Pris pr. stk ekskl. moms (SEK)', close: 'Luk' },
  no: { size: 'Størrelse', guide: 'Størrelsesguide', priceList: 'Last ned hele prislisten', pieces: 'stk', chest: 'Brystvidde', qtyFor: 'Antall i størrelse', guideTitle: 'Størrelsesguide', guideNote: 'Mål rundt brystet, under armene. Plagget kan variere litt.', listQty: 'Antall', listUnit: 'Pris per stk ekskl. mva. (SEK)', close: 'Lukk' },
};

/** The quantities the price list is printed for. */
const LIST_QUANTITIES = [1, 5, 10, 25, 50, 100, 250, 500, 1000];

interface Props {
  field: PrintingField;
  /** Only the options a customer may be offered. */
  options: PrintingFieldOption[];
  quantities: Record<string, number>;
  onChange: (optionId: string, qty: number) => void;
  /** Net SEK per piece for this size at this quantity — the configurator's own pricing. */
  unitPriceFor: (option: PrintingFieldOption, qty: number) => number;
  labelOf: (option: PrintingFieldOption) => string;
  productName: string;
  language: Language;
}

export default function ClothingSizeQuantities({ field, options, quantities, onChange, unitPriceFor, labelOf, productName, language }: Props) {
  const l = L[language] ?? L.en;
  const [guideOpen, setGuideOpen] = useState(false);
  const total = options.reduce((s, o) => s + (quantities[o.id] || 0), 0);

  const downloadPriceList = () => {
    const head = [l.listQty, ...options.map(labelOf)].join(';');
    const rows = LIST_QUANTITIES.map((q) => [q, ...options.map((o) => unitPriceFor(o, q).toFixed(2).replace('.', ','))].join(';'));
    const csv = `﻿${productName}\n${l.listUnit}\n\n${head}\n${rows.join('\n')}\n`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${productName.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'prislista'}.csv`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <section className="space-y-3" data-rx-field={field.id} data-rx-size-quantities>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm text-gray-700">
          {l.size}
          {total > 0 && <span className="ml-2 font-black text-gray-900">{total} {l.pieces}</span>}
        </h3>
        <button type="button" onClick={() => setGuideOpen(true)} className="text-sm font-semibold text-sky-700 hover:underline">
          {l.guide}
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const qty = quantities[o.id] || 0;
          return (
            <label key={o.id} className="flex w-[3.75rem] flex-col items-stretch gap-1.5">
              <span
                className={cn(
                  'flex h-10 items-center justify-center rounded-xl border text-sm font-semibold transition-colors',
                  qty > 0 ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 bg-white text-gray-800',
                )}
              >
                {labelOf(o)}
              </span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={qty || ''}
                placeholder="0"
                aria-label={`${l.qtyFor} ${labelOf(o)}`}
                onChange={(e) => {
                  const n = Math.max(0, Math.min(100000, Math.floor(Number(e.target.value) || 0)));
                  onChange(o.id, n);
                }}
                className="h-11 w-full rounded-xl border-2 border-gray-900 bg-white text-center text-sm font-bold text-gray-900 outline-none focus:border-orange-600 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
            </label>
          );
        })}
      </div>

      <div className="flex justify-end">
        <button type="button" onClick={downloadPriceList} className="text-sm font-semibold text-sky-700 underline underline-offset-2 hover:text-sky-900">
          {l.priceList}
        </button>
      </div>

      {guideOpen && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label={l.guideTitle} onClick={() => setGuideOpen(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h4 className="text-lg font-black text-gray-900">{l.guideTitle}</h4>
              <button type="button" onClick={() => setGuideOpen(false)} aria-label={l.close} className="rounded-full p-2 text-gray-500 hover:bg-gray-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="border-b border-gray-900 text-left text-gray-600">
                  <th className="py-2">{l.size}</th>
                  <th className="py-2 text-right">{l.chest}</th>
                </tr>
              </thead>
              <tbody>
                {options.map((o) => {
                  const cm = chestCmOf(o);
                  return (
                    <tr key={o.id} className="border-b border-gray-100">
                      <td className="py-2 font-semibold text-gray-900">{labelOf(o)}</td>
                      <td className="py-2 text-right text-gray-700">{cm ? `${cm} cm` : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-gray-500">{l.guideNote}</p>
          </div>
        </div>
      )}
    </section>
  );
}
