// The design studio on its own page (scripts/local-e2e/studio.mjs builds this with
// Vite and drives it in Chromium and WebKit). The product comes from the address:
//   ?w=85&h=55&kind=card&sides=front,back&outline=rect&lang=sv&start=blank
// What the studio hands over is kept on window for the test, and its files are
// posted to the test server to be checked.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import './harness.css';
import DesignStudio from '../../../src/components/product/designer/studio/DesignStudio';
import TemplateGallery, { type GalleryChoice } from '../../../src/components/product/designer/studio/TemplateGallery';
import { translations, type Language, type TranslationKey } from '../../../src/lib/translations';
import { printSpecFor, type ProductKind } from '../../../src/lib/printSpec';
import type { SideId } from '../../../src/lib/designDoc';
import type { DesignerResult, StudioDraft, TemplateSummary } from '../../../src/components/product/designer/types';
import type { OutlineKind } from '../../../src/lib/shapes';

const q = new URLSearchParams(location.search);
const lang = (q.get('lang') ?? 'en') as Language;
const trimMm = { wMm: Number(q.get('w') ?? 85), hMm: Number(q.get('h') ?? 55) };
const kind = (q.get('kind') ?? 'card') as ProductKind;
const sides = (q.get('sides') ?? 'front').split(',') as SideId[];
const outline = (q.get('outline') || null) as OutlineKind | null;
const spec = printSpecFor({ kind, trimMm });
const t = (k: TranslationKey) => (translations[lang] as Record<string, string>)[k] ?? (translations.en as Record<string, string>)[k] ?? k;

declare global {
  interface Window {
    __draft?: StudioDraft;
    __result?: DesignerResult;
    __closed?: boolean;
    __uploaded?: string[];
  }
}

async function post(name: string, file: Blob) {
  await fetch(`/upload?name=${encodeURIComponent(name)}`, { method: 'POST', body: file });
  window.__uploaded = [...(window.__uploaded ?? []), name];
}

function App() {
  const [open, setOpen] = useState(true);
  const [templates] = useState<TemplateSummary[] | null | undefined>(() => (q.get('templates') === 'fail' ? null : []));
  const [choice, setChoice] = useState<GalleryChoice | null>(q.get('gallery') ? null : { continue: true });
  if (!open) return <p id="closed">closed</p>;
  if (!choice) {
    return (
      <TemplateGallery
        productName="Harness product"
        sizeLabel={`${trimMm.wMm} × ${trimMm.hMm} mm`}
        trimMm={trimMm}
        outline={outline}
        spec={spec}
        sides={sides}
        kind={kind}
        templates={templates}
        t={t}
        language={lang}
        onChoose={setChoice}
        onWithout={() => {
          window.__closed = true;
          setOpen(false);
        }}
        onClose={() => {
          window.__closed = true;
          setOpen(false);
        }}
      />
    );
  }
  const start =
    'template' in choice ? { template: choice.template, variant: choice.variant } : 'blank' in choice ? { blank: true as const } :
    q.get('start') === 'blank' ? { blank: true as const } : q.get('template') ? { template: q.get('template')!, variant: q.get('variant') ?? undefined } : null;
  return (
    <DesignStudio
      productId="harness-product"
      trimMm={trimMm}
      outline={outline}
      sizeLabel={`${trimMm.wMm} × ${trimMm.hMm} mm`}
      spec={spec}
      sides={sides}
      ink={q.get('ink') ? { front: q.get('ink') as 'black', back: q.get('ink') as 'black' } : undefined}
      draft={null}
      onDraftChange={(d) => {
        window.__draft = d;
      }}
      onUse={(r) => {
        window.__result = r;
        void post(r.file.name, r.file);
        for (const p of r.previews ?? []) void post(`preview-${p.side}.png`, p.file);
        setOpen(false);
      }}
      onClose={() => {
        window.__closed = true;
        setOpen(false);
      }}
      t={t}
      language={lang}
      templates={templates}
      start={start}
    />
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
