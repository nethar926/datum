/** Layout contract: cursor lock + Zulu time-axis labels stay fully visible. */
export const GRAM_TIME_AXIS_PX = 44
export const LOCK_BTN = { w: 36, h: 36, top: 6, gapFromAxisPx: 8 } as const

/**
 * Centre of top/bottom .axis-y spans (CSS `top` before translateY(-50%)).
 * Font is 10px/1; ascent box is ~12px, so 7px centred the glyph 1px above the
 * clip edge. 10px keeps the glyph top ≥ ~4px inside the axis.
 */
export const AXIS_Y_EDGE_CLAMP_PX = 10

/** Typical Zulu span content box used by the contract (matches 10px/1 mono). */
export const AXIS_Y_LABEL_H_PX = 12

export type Rect = { left: number; top: number; right: number; bottom: number }

export function lockBtnRect(gramWidth: number): Rect {
  const right = gramWidth - (GRAM_TIME_AXIS_PX + LOCK_BTN.gapFromAxisPx)
  const left = right - LOCK_BTN.w
  return { left, top: LOCK_BTN.top, right, bottom: LOCK_BTN.top + LOCK_BTN.h }
}

/** Axis-y column occupies the trailing GRAM_TIME_AXIS_PX of the gram. */
export function timeAxisColumnRect(gramWidth: number, gramHeight: number): Rect {
  return {
    left: gramWidth - GRAM_TIME_AXIS_PX,
    top: 0,
    right: gramWidth,
    bottom: gramHeight,
  }
}

export function aabbOverlap(a: Rect, b: Rect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

/** How many px the label sticks above the axis top (0 = fully inside). */
export function topLabelClipPx(labelTop: number, axisTop: number): number {
  return Math.max(0, axisTop - labelTop)
}

/** Synthetic topmost Zulu label after AXIS_Y_EDGE_CLAMP_PX + translateY(-50%). */
export function topmostZuluTickRect(
  gramWidth: number,
  labelW = 36,
  labelH = AXIS_Y_LABEL_H_PX,
  clampPx = AXIS_Y_EDGE_CLAMP_PX,
): Rect {
  const axisLeft = gramWidth - GRAM_TIME_AXIS_PX
  const cx = axisLeft + 6 + labelW / 2 // left:6px on spans
  const cy = clampPx
  return {
    left: cx - labelW / 2,
    top: cy - labelH / 2,
    right: cx + labelW / 2,
    bottom: cy + labelH / 2,
  }
}
