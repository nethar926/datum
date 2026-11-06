import { freqToX, type FreqView } from './axis'

/** One placed frequency-axis tick label (center x in px; last label carries the unit). */
export interface FreqTickLabel {
  f: number
  /** Ideal tick x (freq → px). */
  x: number
  /** Label center x after edge clamping. */
  left: number
  label: string
}

/** Mono 10 px estimate used for overlap / edge clamping (matches .axis font). */
export function estimateFreqLabelWidth(label: string): number {
  return Math.max(6, label.length * 5.9)
}

function fmtTick(f: number): string {
  if (!Number.isFinite(f)) return ''
  const a = Math.abs(f)
  if (a >= 100 || Number.isInteger(f)) return String(Math.round(f))
  if (a >= 10) return f.toFixed(1).replace(/\.0$/, '')
  return String(f)
}

/**
 * Place frequency-axis labels so they never overlap each other or clip at the axis edges.
 * The unit (e.g. "Hz") is stamped on the last kept tick only — no separate corner unit —
 * so "500" never collides with a trailing "Hz".
 */
export function placeFreqAxisTicks(
  ticks: number[],
  view: FreqView,
  width: number,
  unit = 'Hz',
  gap = 4,
): FreqTickLabel[] {
  if (!(width > 0) || !ticks.length) return []

  const items = ticks.map((f, i) => {
    const last = i === ticks.length - 1
    const label = last ? `${fmtTick(f)} ${unit}` : fmtTick(f)
    const half = estimateFreqLabelWidth(label) / 2
    const x = freqToX(f, view, width)
    // 2 px inset so edge glyphs (esp. "0") aren't anti-aliased against overflow:hidden.
    const inset = 2
    const left = Math.min(width - half - inset, Math.max(half + inset, x))
    return { f, x, left, label, half }
  })

  // Always keep the last (unit) tick. Walk right-to-left dropping anything that collides with a kept neighbour.
  const keep = new Array<boolean>(items.length).fill(true)
  let right = items.length - 1
  for (let i = items.length - 2; i >= 0; i--) {
    const a = items[i]!, b = items[right]!
    if (Math.abs(a.left - b.left) < a.half + b.half + gap) keep[i] = false
    else right = i
  }

  return items.filter((_, i) => keep[i]).map(({ f, x, left, label }) => ({ f, x, left, label }))
}
