/**
 * DIFAR display colouring: brightness from power only; bearing contributes hue tint only.
 * Lloyd's-mirror nulls (low power) must stay dark even when a bearing hue is present.
 */

/** Map normalised power (0..1) to display brightness (0..1). Identity — no bearing leakage. */
export function difarBrightnessFromPower(power01: number): number {
  if (!Number.isFinite(power01)) return 0
  return Math.min(1, Math.max(0, power01))
}

/**
 * Compose final RGB: hueRgb (full V) scaled by power brightness.
 * Null / low-power bins → near-black regardless of bearing.
 */
export function difarRgbFromPowerAndHue(
  hueRgb: readonly [number, number, number],
  power01: number,
): [number, number, number] {
  const b = difarBrightnessFromPower(power01)
  return [
    Math.round(hueRgb[0] * b),
    Math.round(hueRgb[1] * b),
    Math.round(hueRgb[2] * b),
  ]
}

/** True when a low-power bin stays dark (brightness ≤ floor) despite a vivid hue. */
export function lmNullStaysDark(power01: number, brightnessFloor = 0.15): boolean {
  return difarBrightnessFromPower(power01) <= brightnessFloor
}
