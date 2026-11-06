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

/**
 * Mono ~10 px estimate used for overlap / edge clamping (matches .axis font).
 * Slightly generous so edge glyphs aren't anti-aliased into overflow:hidden.
 */
export function estimateFreqLabelWidth(label: string): number {
  return Math.max(8, label.length * 7.2)
}

function fmtTick(f: number): string {
  if (!Number.isFinite(f)) return ''
  const a = Math.abs(f)
  if (a >= 100 || Number.isInteger(f)) return String(Math.round(f))
  if (a >= 10) return f.toFixed(1).replace(/\.0$/, '')
  return String(f)
}

type Item = FreqTickLabel & { half: number }

function collides(a: Item, b: Item, gap: number): boolean {
  return Math.abs(a.left - b.left) < a.half + b.half + gap
}

function placeItem(f: number, label: string, view: FreqView, width: number, inset: number): Item {
  const half = estimateFreqLabelWidth(label) / 2
  const x = freqToX(f, view, width)
  const left = Math.min(width - half - inset, Math.max(half + inset, x))
  return { f, x, left, label, half }
}

/**
 * Place frequency-axis labels so they never overlap each other or clip at the axis edges.
 * - '0' (first tick) is always kept, left-clamped.
 * - The last tick always carries the unit and is always kept, right-clamped.
 * - Interior ticks are dropped only when they would collide with a kept neighbour.
 */
export function placeFreqAxisTicks(
  ticks: number[],
  view: FreqView,
  width: number,
  unit = 'Hz',
  gap = 4,
): FreqTickLabel[] {
  if (!(width > 0) || !ticks.length) return []

  const inset = 3
  const items: Item[] = ticks.map((f, i) => {
    const last = i === ticks.length - 1
    const label = last ? `${fmtTick(f)} ${unit}` : fmtTick(f)
    return placeItem(f, label, view, width, inset)
  })

  if (items.length === 1) {
    const t = items[0]!
    return [{ f: t.f, x: t.x, left: t.left, label: t.label }]
  }

  // Always keep first + last. Greedily keep interiors that fit after the previous kept tick,
  // then drop trailing interiors that collide with the forced last (unit) tick.
  const kept: Item[] = [items[0]!]
  const last = items[items.length - 1]!
  for (let i = 1; i < items.length - 1; i++) {
    const t = items[i]!
    if (!collides(t, kept[kept.length - 1]!, gap)) kept.push(t)
  }
  while (kept.length > 1 && collides(last, kept[kept.length - 1]!, gap)) kept.pop()
  // Ultra-narrow: first and last may still overlap after clamping — still show both.
  kept.push(last)

  return kept.map(({ f, x, left, label }) => ({ f, x, left, label }))
}
