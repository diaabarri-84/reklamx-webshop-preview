/**
 * THE DESIGNER, OPENED FROM ANYWHERE (designer v2): the studio and its gallery,
 * fetched only when a customer opens them (fabric never rides with a page); the
 * boundary that keeps a failed load from taking the page with it; the loading
 * screen with a way out; and AI Studio's pictures from the shop's server. The
 * product page opens the designer with these, and so does "Create your design" on a
 * basket or order line bought without its design (DesignLater.tsx).
 */
import React, { useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import type { DesignStudioProps } from './studio/DesignStudio';
import type { TemplateGalleryProps } from './studio/TemplateGallery';
import type { AiGenerate } from './studio/panels/AiPanel';

export const loadDesigner = () => import('./studio/DesignStudio');
export const loadGallery = () => import('./studio/TemplateGallery');
// `let`: React.lazy remembers a failed load for ever, so after a failure (a
// flaky phone network, or a deploy that replaced the file) the next opening
// needs a fresh one.
let Studio = React.lazy(loadDesigner);
let Gallery = React.lazy(loadGallery);

/** The studio, loaded on first use (inside a DesignerBoundary and a Suspense). */
export function LazyStudio(props: DesignStudioProps) {
  const C = Studio;
  return <C {...props} />;
}

/** The template gallery, loaded on first use (inside a DesignerBoundary and a Suspense). */
export function LazyGallery(props: TemplateGalleryProps) {
  const C = Gallery;
  return <C {...props} />;
}

/**
 * The designer failing to load, or throwing, must not take the page with it.
 * Without this boundary a lost network request replaced the whole page with
 * "Something went wrong" and the customer's configuration was gone. It closes the
 * designer and says so instead.
 */
export class DesignerBoundary extends React.Component<{ onFail: () => void; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.warn('The online designer failed:', error);
    Studio = React.lazy(loadDesigner);
    Gallery = React.lazy(loadGallery);
    this.props.onFail();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** While the designer loads: a way out, by button and by Escape (which must not reach a dialog behind). */
export function DesignerLoading({ label, closeLabel, onClose }: { label: string; closeLabel: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-3 bg-[#eceef4]" role="status" aria-live="polite">
      <Loader2 className="w-8 h-8 text-orange-600 animate-spin" />
      <span className="text-xs font-black text-gray-700">{label}</span>
      <button
        type="button"
        onClick={onClose}
        className="mt-2 px-4 py-2 rounded-full text-xs font-black text-gray-700 bg-white border border-gray-300"
      >
        {closeLabel}
      </button>
    </div>
  );
}

/**
 * AI Studio's pictures, from the shop's server — which holds the key, the owner's
 * switch, the daily cap and the per-visitor limit. The pictures come back as data:
 * URLs and go into the studio's Uploads as the customer's own.
 */
export const aiGenerate: AiGenerate = async (prompt, shape) => {
  try {
    const res = await fetch('/api/designer/ai-images', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, shape }),
    });
    const body = (await res.json().catch(() => ({}))) as { images?: string[]; error?: string };
    if (!res.ok || !Array.isArray(body.images)) {
      return { error: body.error === 'limit' ? ('limit' as const) : body.error === 'off' ? ('off' as const) : ('failed' as const) };
    }
    const images = await Promise.all(body.images.filter((u) => /^data:image\/(png|jpeg|webp);base64,/.test(u)).map(async (u) => (await fetch(u)).blob()));
    return { images };
  } catch {
    return { error: 'failed' as const };
  }
};
