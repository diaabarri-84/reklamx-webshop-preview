// What the product page and the designer hand each other. Types only, so the
// page can import them without pulling the designer (and fabric) into its bundle.
import type { OutlineKind } from '../../../lib/shapes';
import type { SideId } from '../../../lib/printSides';
export type { TemplateSummary } from '../../../lib/designTemplateDoc';

/**
 * The owner's template a design started from (round 16, item 5b). It travels
 * with the design: the background may be locked, a change to a size the template
 * does not fit sends the customer back to the chooser, and the job sheet names it.
 */
export interface TemplateMeta {
  id: string;
  /** In the customer's language, as shown to him. */
  name: string;
  trimMm: { wMm: number; hMm: number };
  outline: OutlineKind | null;
  lowestPictureDpi: number | null;
  lockBackground: boolean;
}

/** A design in progress, as the page keeps it between openings of the designer. */
export interface DesignDraft {
  /** The board, as fabric JSON. Pictures are referenced by `rxImageId`. */
  json: string;
  images: Record<string, Blob>;
  /** The trim size it was designed at, so it can be refitted to a new one. */
  trimMm: { wMm: number; hMm: number };
  savedAt: number;
  /** When it started from one of the owner's templates. */
  template?: TemplateMeta | null;
}

/** What the designer in OWNER mode hands the dashboard on "Save template". */
export interface TemplateDesign {
  json: string;
  /** Every picture the design uses, by rxImageId. */
  images: Record<string, Blob>;
  /** The trim area, small, for the lists. */
  thumbnail: Blob;
  /** The lowest resolution any picture prints at, at this size; null with none. */
  lowestPictureDpi: number | null;
}

/**
 * A studio design in progress (designer v2), as the page keeps it between openings:
 * every side of the design (src/lib/designDoc.ts), its pictures, the customer's
 * uploads, and the geometry it was made at (to refit when the size changes).
 */
export interface StudioDraft {
  /** serializeDesignDoc(doc): { v: 2, sides: [{ id, json }], template }. */
  doc: string;
  images: Record<string, Blob>;
  /** The Uploads panel's pictures, newest first (placed or not). */
  uploads: string[];
  trimMm: { wMm: number; hMm: number };
  bleedMm: number;
  savedAt: number;
}

/** "Add to my order": the print file and what the page needs to show and check it. */
export interface DesignerResult {
  /** The print file: trim + bleed — a PNG/JPEG (one side that fits one picture) or a PDF. */
  file: File;
  /** A small picture of the trim area (the first page), for the size preview. */
  preview: File;
  /** Every page's picture, in print order (designer v2). */
  previews?: Array<{ side: SideId; file: File }>;
  /** The pages of the print file, in order (designer v2). */
  sides?: SideId[];
  format?: 'png' | 'pdf';
  trimMm: { wMm: number; hMm: number };
  outline: OutlineKind | null;
  /** Bleed on every side of the file, in mm. */
  bleedMm: number;
  dpi: number;
  /** The lowest resolution any photo in it prints at; null with no photos. */
  lowestImageDpi: number | null;
  /**
   * The owner's template it started from, for the job sheet: by id, which the
   * server turns into the owner's own name for it when the order is placed.
   */
  template?: { id: string; name: string } | null;
}
