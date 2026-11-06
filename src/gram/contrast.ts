/** Gram contrast: a client-side gain on the colour scale about its midpoint. 1 = the engine's dB range as sent. */
export const CONTRAST_MIN = 0.5, CONTRAST_MAX = 3, CONTRAST_DEFAULT = 1, CONTRAST_STEP = 0.05
export const CONTRAST_KEY = 'datum.contrast'

export const clampContrast = (k: number): number =>
  Number.isFinite(k) ? Math.min(CONTRAST_MAX, Math.max(CONTRAST_MIN, Math.round(k / CONTRAST_STEP) * CONTRAST_STEP)) : CONTRAST_DEFAULT

/** Scale [floor, ceil] about its midpoint: k > 1 narrows the span (more contrast), k < 1 widens it. Mid stays put. */
export function contrastRange(dbFloor: number, dbCeil: number, k: number): { dbFloor: number; dbCeil: number } {
  const kk = clampContrast(k), mid = (dbFloor + dbCeil) / 2, half = (dbCeil - dbFloor) / 2 / kk
  return { dbFloor: mid - half, dbCeil: mid + half }
}

export function loadContrast(): number {
  try {
    const u = new URLSearchParams(location.search).get('contrast')
    if (u !== null && Number.isFinite(Number(u))) return clampContrast(Number(u))
    const v = localStorage.getItem(CONTRAST_KEY)
    return v === null ? CONTRAST_DEFAULT : clampContrast(Number(v))
  } catch { return CONTRAST_DEFAULT }
}
