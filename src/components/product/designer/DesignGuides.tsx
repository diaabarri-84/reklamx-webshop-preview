import React, { useId } from 'react';
import { outlinePath, type OutlineKind } from '../../../lib/shapes';

/**
 * The marks over the board: what gets cut off, where the cut runs, and the band
 * inside it to keep text out of. Round 16, item 5.
 *
 * AN SVG OVER THE CANVAS, NEVER fabric objects. fabric's `excludeFromExport`
 * only keeps an object out of the JSON and SVG output, not out of a raster
 * export, so a guide drawn on the canvas would be printed. This layer takes no
 * pointer events, so the board underneath gets every tap.
 *
 * It is drawn in the board's own units (tenths of a millimetre) and scaled with
 * it. The cut line is the same outline the product page previews
 * (outlinePath), so the shape the customer designs in is the shape the cutter
 * follows.
 */
interface DesignGuidesProps {
  board: { w: number; h: number };
  /** The trim box on the board: inside the bleed. */
  trim: { x: number; y: number; w: number; h: number };
  outline: OutlineKind | null;
  /** The safe margin inside the cut line, in board units. */
  safe: number;
  /** CSS pixels per board unit. */
  z: number;
  width: number;
  height: number;
}

export default function DesignGuides({ board, trim, outline, safe, z, width, height }: DesignGuidesProps) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const kind = outline ?? 'rect';
  const cut = outlinePath(kind, trim.w, trim.h);
  const px = (n: number) => n / z;
  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      width={width}
      height={height}
      viewBox={`0 0 ${board.w} ${board.h}`}
      aria-hidden="true"
      data-rx-guides
    >
      <defs>
        <mask id={`${id}-off`} maskUnits="userSpaceOnUse" x={0} y={0} width={board.w} height={board.h}>
          <rect x={0} y={0} width={board.w} height={board.h} fill="white" />
          <path d={cut} transform={`translate(${trim.x} ${trim.y})`} fill="black" />
        </mask>
        {/* Read in the user space of the group below, which is already moved to the trim. */}
        <clipPath id={`${id}-in`}>
          <path d={cut} />
        </clipPath>
      </defs>
      {/* Cut off: the bleed, and for a shape everything outside it. */}
      <rect x={0} y={0} width={board.w} height={board.h} fill="rgba(15,23,42,0.30)" mask={`url(#${id}-off)`} data-rx-guide="bleed" />
      <g transform={`translate(${trim.x} ${trim.y})`}>
        {/* Keep text out of this band: the cut line stroked twice the margin, clipped to its inside. */}
        <path d={cut} fill="none" stroke="rgba(234,88,12,0.18)" strokeWidth={safe * 2} clipPath={`url(#${id}-in)`} data-rx-guide="safe" />
        <path
          d={cut}
          fill="none"
          stroke="#ea580c"
          strokeWidth={px(1.5)}
          strokeDasharray={`${px(6)} ${px(4)}`}
          data-rx-guide="cut"
          data-rx-cut={kind}
        />
      </g>
    </svg>
  );
}
