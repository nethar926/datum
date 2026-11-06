/**
 * FOCUS bandpass: centre on the cursor Hz, width from a preset half-bandwidth that
 * auto-narrows when the gram is zoomed. Pure math (biquad coeffs + width helpers).
 */

export const FOCUS_HALF_WIDTHS = [5, 10, 25, 50] as const
export type FocusHalfWidth = (typeof FOCUS_HALF_WIDTHS)[number]

export const DEFAULT_FOCUS_HALF = 10 as FocusHalfWidth

export const isFocusHalf = (v: unknown): v is FocusHalfWidth =>
  typeof v === 'number' && (FOCUS_HALF_WIDTHS as readonly number[]).includes(v)

/**
 * Effective half-bandwidth (Hz) given the operator preset and the current zoom.
 * When the view spans the full band, return `baseHalf`. As the view narrows,
 * shrink toward `minHalf` (never below the bin width-ish floor).
 *
 * `zoom = fullSpan / viewSpan` (≥ 1). Effective ≈ baseHalf / sqrt(zoom), clamped.
 */
export function focusHalfWidthHz(
  baseHalf: number,
  viewSpanHz: number,
  fullSpanHz: number,
  minHalf = 2,
): number {
  const base = Math.max(minHalf, Number.isFinite(baseHalf) ? baseHalf : DEFAULT_FOCUS_HALF)
  const view = Math.max(1e-6, Number.isFinite(viewSpanHz) ? viewSpanHz : fullSpanHz)
  const full = Math.max(view, Number.isFinite(fullSpanHz) ? fullSpanHz : view)
  const zoom = full / view
  const narrowed = base / Math.sqrt(Math.max(1, zoom))
  return Math.max(minHalf, Math.min(base, narrowed))
}

/** Bandwidth (full, Hz) and Q for a bandpass centred at `f0` with half-width `halfHz`. */
export function bandpassQ(f0: number, halfHz: number): { bw: number; Q: number } {
  const f = Math.max(1, Number.isFinite(f0) ? f0 : 1)
  const half = Math.max(0.5, Number.isFinite(halfHz) ? halfHz : DEFAULT_FOCUS_HALF)
  const bw = Math.min(f * 1.5, 2 * half) // keep Q sane near DC
  const Q = Math.max(0.5, Math.min(80, f / Math.max(0.5, bw)))
  return { bw, Q }
}

export interface BiquadCoeffs { b0: number; b1: number; b2: number; a1: number; a2: number }

/**
 * RBJ cookbook bandpass (constant skirt gain, peak gain = Q).
 * `a0` is normalised out so a0 = 1.
 */
export function biquadBandpass(f0: number, Q: number, sampleRate: number): BiquadCoeffs {
  const sr = Math.max(1, sampleRate)
  const f = Math.min(sr * 0.49, Math.max(1, f0))
  const q = Math.max(0.1, Math.min(80, Q))
  const w0 = 2 * Math.PI * f / sr
  const cos = Math.cos(w0), sin = Math.sin(w0)
  const alpha = sin / (2 * q)
  const a0 = 1 + alpha
  return {
    b0: alpha / a0,
    b1: 0,
    b2: -alpha / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  }
}

/** Capsule label, e.g. "FOCUS 123 Hz ±10". */
export function focusLabel(hz: number, halfHz: number): string {
  const h = Math.round(hz)
  const w = Math.round(halfHz)
  return `FOCUS ${h} Hz ±${w}`
}
