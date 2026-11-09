/** Layout contract: cursor lock must clear the gram time-axis column. */
export const GRAM_TIME_AXIS_PX = 44
export const LOCK_BTN = { w: 36, h: 36, top: 6, gapFromAxisPx: 8 } as const

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

/** Synthetic topmost Zulu label centred near the axis top (matches clamp(7px, …)). */
export function topmostZuluTickRect(gramWidth: number, labelW = 36, labelH = 10): Rect {
  const axisLeft = gramWidth - GRAM_TIME_AXIS_PX
  const cx = axisLeft + 6 + labelW / 2 // left:6px on spans; approximate
  const cy = 7 // clamp min top
  return {
    left: cx - labelW / 2,
    top: cy - labelH / 2,
    right: cx + labelW / 2,
    bottom: cy + labelH / 2,
  }
}
