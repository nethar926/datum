/**
 * COMB cursor: singing-prop / resonance sidebands spaced evenly around a centre
 * frequency (not from 0 Hz like HARM). Spacing estimates PSR.
 * Pure functions — no answer-key reads.
 */

export const COMB_SIDEBANDS_DEFAULT = 5
export const COMB_SIDEBANDS_MIN = 1
export const COMB_SIDEBANDS_MAX = 10
/** Peak search half-width in bins when snapping marks. */
export const COMB_SNAP_BINS = 3
/** Minimum spacing (Hz) so marks do not collapse. */
export const COMB_MIN_SPACING_HZ = 0.25

export interface CombMark {
  /** Sideband order: 0 = centre, ±1..±N = sidebands. */
  n: number
  /** Geometric frequency before peak snap. */
  hz: number
  /** After peak snap (same as hz when no snap). */
  snappedHz: number
  /** True when a local peak was found within the snap window. */
  matched: boolean
}

export interface CombState {
  centreHz: number | null
  spacingHz: number | null
  sidebands: number
}

export function clampSidebands(n: number): number {
  if (!Number.isFinite(n)) return COMB_SIDEBANDS_DEFAULT
  return Math.max(COMB_SIDEBANDS_MIN, Math.min(COMB_SIDEBANDS_MAX, Math.round(n)))
}

/**
 * Geometric sideband positions: centre + n·spacing for n = -count..+count.
 * Clamps each mark into [fMin, fMax]; skips marks that fall outside after clamp
 * would leave them not representing that order (drop if geometric hz out of band).
 */
export function combSeries(
  centreHz: number,
  spacingHz: number,
  count: number,
  fMin = 0,
  fMax = Infinity,
): { n: number; hz: number }[] {
  const out: { n: number; hz: number }[] = []
  if (!(centreHz >= 0) || !(spacingHz > 0) || !(fMax > fMin)) return out
  const N = clampSidebands(count)
  for (let n = -N; n <= N; n++) {
    const raw = centreHz + n * spacingHz
    // Clamp to band edges (0 Hz / fMax); keep the slot so operators still see edge marks.
    out.push({ n, hz: Math.min(fMax, Math.max(fMin, raw)) })
  }
  return out
}

/** Nearest sideband order (≥0) for a click relative to centre; 0 means centre. */
export function nearestCombOrder(centreHz: number, spacingHz: number | null, hz: number): number {
  if (!(centreHz >= 0) || !(hz >= 0)) return 0
  const d = Math.abs(hz - centreHz)
  if (spacingHz === null || !(spacingHz > 0)) return d < 1e-9 ? 0 : 1
  return Math.max(0, Math.round(d / spacingHz))
}

/** Spacing implied by dragging order k (≥1) to hz. */
export function spacingFromDrag(centreHz: number, k: number, hz: number): number {
  if (!(k >= 1) || !(centreHz >= 0)) return COMB_MIN_SPACING_HZ
  return Math.max(COMB_MIN_SPACING_HZ, Math.abs(hz - centreHz) / k)
}

/**
 * Local-max peak near targetHz in a single gram row (dB values).
 * Returns snapped Hz or null if no peak above neighbors in the window.
 */
export function snapToPeakHz(
  row: ArrayLike<number>,
  f0: number,
  fBin: number,
  targetHz: number,
  searchBins = COMB_SNAP_BINS,
): number | null {
  if (!(fBin > 0) || row.length < 3) return null
  const bins = row.length
  const targetBin = Math.round((targetHz - f0) / fBin)
  if (targetBin < 1 || targetBin > bins - 2) return null
  const lo = Math.max(1, targetBin - searchBins)
  const hi = Math.min(bins - 2, targetBin + searchBins)
  let best = -1
  let bestV = -Infinity
  for (let b = lo; b <= hi; b++) {
    const v = row[b]!
    if (!Number.isFinite(v)) continue
    if (v > row[b - 1]! && v >= row[b + 1]! && v > bestV) {
      bestV = v
      best = b
    }
  }
  if (best < 0) return null
  return f0 + best * fBin
}

/**
 * Snap each geometric mark to a nearby peak; centre (n=0) stays geometric
 * (finger-exact) unless snapCentre is true.
 */
export function snapCombMarks(
  centreHz: number,
  spacingHz: number,
  count: number,
  row: ArrayLike<number> | null,
  f0: number,
  fBin: number,
  fMin = 0,
  fMax = Infinity,
  snapCentre = false,
): CombMark[] {
  const geo = combSeries(centreHz, spacingHz, count, fMin, fMax)
  return geo.map(({ n, hz }) => {
    if (!row || (n === 0 && !snapCentre)) {
      return { n, hz, snappedHz: hz, matched: n === 0 }
    }
    const snapped = snapToPeakHz(row, f0, fBin, hz)
    if (snapped === null) return { n, hz, snappedHz: hz, matched: false }
    return { n, hz, snappedHz: snapped, matched: true }
  })
}

/** Count of sideband marks (excluding centre) that matched a peak. */
export function combMatchedCount(marks: readonly CombMark[]): number {
  return marks.reduce((n, m) => n + (m.n !== 0 && m.matched ? 1 : 0), 0)
}

/** Sideband slots requested (2·count), for readout "matched/total". */
export function combSidebandSlots(count: number): number {
  return 2 * clampSidebands(count)
}

/** Operator readout — no class/answer-key names. */
export function combText(
  centreHz: number | null,
  spacingHz: number | null,
  count: number,
  matched: number | null = null,
): string {
  if (centreHz === null) return 'COMB  PIN CENTRE LINE, THEN DRAG TO SET SPACING'
  const N = clampSidebands(count)
  const slots = combSidebandSlots(N)
  if (spacingHz === null || !(spacingHz > 0)) {
    return `COMB  CENTRE ${centreHz.toFixed(2)} HZ  DRAG A SIDEBAND  ±${N}`
  }
  const matchPart = matched === null
    ? `${slots} SIDEBANDS`
    : `${matched}/${slots} MATCHED`
  return `COMB  CENTRE ${centreHz.toFixed(2)} HZ  PSR EST. ${spacingHz.toFixed(2)} HZ  ${matchPart}`
}
