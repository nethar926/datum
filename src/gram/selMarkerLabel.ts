/**
 * Placement for the red selected-Hz marker label so it never sits under the
 * top-left cursor readout (which may also carry the FOCUS note) and stays in
 * the top chrome band (never over the newest gram rows; newest is at the
 * bottom by default). Pure math — no DOM, no per-frame allocation beyond the
 * returned POJO (React render only).
 */

export interface Rect { x: number; y: number; w: number; h: number }
export type SelLabelSide = 'left' | 'right'
export interface SelLabelPlace { side: SelLabelSide; top: number }

/** Axis-aligned overlap with optional pad (px). */
export function rectsOverlap(a: Rect, b: Rect, pad = 0): boolean {
  return !(
    a.x + a.w + pad <= b.x ||
    b.x + b.w + pad <= a.x ||
    a.y + a.h + pad <= b.y ||
    b.y + b.h + pad <= a.y
  )
}

/** Monospace 10 px label width estimate (matches `.sel-marker span`). */
export function estimateSelLabelSize(text: string): { w: number; h: number } {
  const n = Math.max(1, text.length)
  return { w: Math.ceil(n * 7.0) + 2, h: 12 }
}

/**
 * Estimate the top-left cursor readout box from its text (11 px mono, CSS
 * `top: 6; left: 8`). Returns null when there is no top readout (e.g. crosshair
 * mode parks the readout bottom-right).
 */
export function estimateCursorReadout(text: string | null | undefined): Rect | null {
  if (!text) return null
  const n = Math.max(1, text.length)
  return { x: 8, y: 6, w: Math.ceil(n * 7.4) + 8, h: 16 }
}

const GAP = 8
const DEFAULT_TOP = 4

function labelRect(markerX: number, side: SelLabelSide, top: number, lw: number, lh: number): Rect {
  return side === 'right'
    ? { x: markerX + GAP, y: top, w: lw, h: lh }
    : { x: markerX - GAP - lw, y: top, w: lw, h: lh }
}

function fits(r: Rect, gramW: number): boolean {
  return r.x >= -0.5 && r.x + r.w <= gramW + 0.5
}

function clear(r: Rect, readout: Rect | null): boolean {
  return !readout || !rectsOverlap(r, readout, 1)
}

/**
 * Prefer right of the dashed line; flip to the left when that clears a readout
 * collision or a right-edge clip; otherwise drop just below the readout.
 * Always keeps `top` small so the label stays in the top chrome band.
 */
export function placeSelMarkerLabel(opts: {
  markerX: number
  gramW: number
  labelW: number
  labelH?: number
  readout: Rect | null
}): SelLabelPlace {
  const { markerX, gramW, labelW, readout } = opts
  const labelH = opts.labelH ?? 12
  const dropTop = readout ? readout.y + readout.h + GAP : DEFAULT_TOP

  const tryPlace = (side: SelLabelSide, top: number): SelLabelPlace | null => {
    const r = labelRect(markerX, side, top, labelW, labelH)
    return fits(r, gramW) && clear(r, readout) ? { side, top } : null
  }

  return (
    tryPlace('right', DEFAULT_TOP) ??
    tryPlace('left', DEFAULT_TOP) ??
    tryPlace('right', dropTop) ??
    tryPlace('left', dropTop) ??
    // Last resort: still drop below so we clear the readout even if the label
    // clips the opposite gram edge slightly.
    { side: markerX < gramW / 2 ? 'right' : 'left', top: dropTop }
  )
}
