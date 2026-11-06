/**
 * LOFAR dB row → linear magnitudes for listen synthesis. Pure, allocation-aware helpers
 * (caller owns the output buffer). Floor/ceil match the gram colour scale so quiet bins stay quiet.
 */

/** Soft floor so dead/NaN bins stay silent. */
export const MAG_EPS = 1e-7

/** Map one dB sample to a linear magnitude in [0, 1]. NaN / non-finite → 0. */
export function dbToLinear(db: number, floorDb: number, ceilDb: number): number {
  if (!Number.isFinite(db)) return 0
  const span = ceilDb - floorDb
  if (!(span > 0)) return 0
  const t = (db - floorDb) / span
  if (t <= 0) return 0
  if (t >= 1) return 1
  // Mild compressive curve so mid-level tonals poke through without blowing the noise floor.
  return t * t
}

/**
 * Fill `out[0..bins)` from `src[offset..offset+bins)` dB samples.
 * Returns the peak magnitude written (0 if all silent).
 */
export function rowToMagnitudes(
  src: ArrayLike<number>, offset: number, bins: number,
  floorDb: number, ceilDb: number, out: Float32Array,
): number {
  const n = Math.min(bins, out.length)
  let peak = 0
  for (let i = 0; i < n; i++) {
    const m = dbToLinear(src[offset + i]!, floorDb, ceilDb)
    out[i] = m
    if (m > peak) peak = m
  }
  for (let i = n; i < out.length; i++) out[i] = 0
  return peak
}

/** Scale magnitudes so the peak sits at `target` (default 0.85). No-op when peak is 0. */
export function normalizePeak(mags: Float32Array, bins: number, target = 0.85): number {
  let peak = 0
  const n = Math.min(bins, mags.length)
  for (let i = 0; i < n; i++) if (mags[i]! > peak) peak = mags[i]!
  if (!(peak > MAG_EPS)) return 0
  const g = target / peak
  for (let i = 0; i < n; i++) mags[i]! *= g
  return g
}

/**
 * Soft tanh limiter. `threshold` is the level where compression starts (linear).
 * Keeps long sessions from clipping even when a bright tonal lands in FOCUS.
 */
export function softLimit(x: number, threshold = 0.7): number {
  if (!Number.isFinite(x)) return 0
  const a = Math.abs(x)
  if (a <= threshold) return x
  const s = Math.sign(x) || 1
  const over = a - threshold
  // Asymptote toward ~0.98 so we never hard-clip.
  return s * (threshold + (1 - threshold) * Math.tanh(over / (1 - threshold + MAG_EPS)))
}

/** Apply softLimit in place; returns peak |sample| after limiting. */
export function limitBuffer(buf: Float32Array, threshold = 0.7): number {
  let peak = 0
  for (let i = 0; i < buf.length; i++) {
    const y = softLimit(buf[i]!, threshold)
    buf[i] = y
    const a = Math.abs(y)
    if (a > peak) peak = a
  }
  return peak
}
