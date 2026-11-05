/** Frequency window shown on a gram, in Hz. */
export interface FreqView { lo: number; hi: number }

export function clampView(v: FreqView, fMax: number, minSpan = 10): FreqView {
  let span = Math.min(fMax, Math.max(minSpan, v.hi - v.lo))
  let lo = Math.max(0, Math.min(v.lo, fMax - span))
  if (!Number.isFinite(lo)) lo = 0
  if (!Number.isFinite(span)) span = fMax
  return { lo, hi: lo + span }
}
export const freqToX = (f: number, v: FreqView, width: number): number => ((f - v.lo) / (v.hi - v.lo)) * width
export const xToFreq = (x: number, v: FreqView, width: number): number => v.lo + (x / Math.max(1, width)) * (v.hi - v.lo)

/** Zoom about an anchor frequency by factor (>1 zooms in). */
export function zoomView(v: FreqView, anchor: number, factor: number, fMax: number): FreqView {
  const f = Math.max(0.05, Math.min(20, factor))
  const lo = anchor - (anchor - v.lo) / f, hi = anchor + (v.hi - anchor) / f
  return clampView({ lo, hi }, fMax)
}

/** "Nice" tick values (1, 2, 5 × 10^n) covering [lo, hi] with about `target` ticks. */
export function niceTicks(lo: number, hi: number, target = 8): number[] {
  if (!(hi > lo) || !Number.isFinite(lo) || !Number.isFinite(hi)) return []
  const raw = (hi - lo) / Math.max(1, target)
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw)!
  const out: number[] = []
  for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-9; t += step) out.push(Math.round(t * 1e6) / 1e6)
  return out
}

/** Ring texture row for "age" rows before the newest (head). */
export const ringRow = (head: number, age: number, rows: number): number => (((head - age) % rows) + rows) % rows
