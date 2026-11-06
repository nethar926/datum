/**
 * Optional phone-speaker shift-up: octave transpose of the listen band so sub-200 Hz
 * tonals land where small speakers can reproduce them. Pure mapping helpers.
 */

export type ShiftMode = 'off' | 'octave'

export const SHIFT_LABEL: Record<ShiftMode, string> = {
  off: 'SHIFT OFF',
  octave: 'SHIFT ↑ OCT',
}

export const isShiftMode = (v: unknown): v is ShiftMode => v === 'off' || v === 'octave'

/** Playback frequency for a source frequency under the current shift mode. */
export function shiftFreq(hz: number, mode: ShiftMode): number {
  if (!Number.isFinite(hz) || hz <= 0) return 0
  if (mode === 'octave') return hz * 2
  return hz
}

/**
 * Map a magnitude spectrum onto a shifted spectrum (octave = stretch bins ×2).
 * `src`/`dst` may be the same buffer only when mode is 'off'.
 * Bins past Nyquist (dst length) are dropped; empty low bins are zero-filled.
 */
export function mapSpectrumShift(
  src: Float32Array, bins: number, mode: ShiftMode, dst: Float32Array,
): void {
  const n = Math.min(bins, src.length, dst.length)
  if (mode === 'off') {
    if (src !== dst) {
      for (let i = 0; i < n; i++) dst[i] = src[i]!
      for (let i = n; i < dst.length; i++) dst[i] = 0
    }
    return
  }
  // Octave-up: energy at bin i moves to bin 2i (and 2i+1 gets a half share for smoothness).
  dst.fill(0)
  for (let i = 0; i < n; i++) {
    const m = src[i]!
    if (!(m > 0)) continue
    const j = i * 2
    if (j < dst.length) dst[j] = Math.max(dst[j]!, m)
    if (j + 1 < dst.length) dst[j + 1] = Math.max(dst[j + 1]!, m * 0.5)
  }
}

/** FOCUS centre after shift (for the bandpass that follows the worklet). */
export function shiftFocusHz(hz: number, mode: ShiftMode): number {
  return shiftFreq(hz, mode)
}
