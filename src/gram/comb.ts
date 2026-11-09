/**
 * COMB cursor: singing-prop / resonance sidebands spaced evenly around a centre
 * frequency (not from 0 Hz like HARM). Spacing estimates PSR.
 *
 * Marks are ALWAYS drawn at the geometric grid centre ± k·spacing. Matched peaks
 * are reported separately (peakHz) for tick/dot overlays — never by moving a mark.
 * Pure functions — no answer-key reads.
 */

export const COMB_SIDEBANDS_DEFAULT = 5
export const COMB_SIDEBANDS_MIN = 1
export const COMB_SIDEBANDS_MAX = 10
/** Minimum spacing (Hz) so marks do not collapse. */
export const COMB_MIN_SPACING_HZ = 0.25

/**
 * MATCHED gate: a sideband counts only when a strict local peak sits within
 * matchToleranceHz of the geometric mark AND exceeds the local-window median
 * by at least this many dB.
 */
export const COMB_PEAK_DB_OVER_MEDIAN = 3
/** Match half-width floor in bins (converted via fBin). */
export const COMB_MATCH_TOL_BINS = 0.5
/** Match half-width as a fraction of spacing (whichever is larger with the bin floor wins). */
export const COMB_MATCH_TOL_SPACING_FRAC = 0.15
/** Minimum pixel gap between sideband labels before we thin to every Nth. */
export const COMB_LABEL_MIN_GAP_PX = 28

export interface CombMark {
  /** Sideband order: 0 = centre, ±1..±N = sidebands. */
  n: number
  /** Geometric frequency — ALWAYS used for drawing the comb mark. */
  hz: number
  /** Matched peak frequency for the tick/dot overlay, or null when unmatched. */
  peakHz: number | null
  /** True when a qualifying local peak was found near hz. */
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

/** Match half-width in Hz: max(0.5·fBin, 15% of spacing). */
export function matchToleranceHz(fBin: number, spacingHz: number): number {
  const binTol = Math.max(0, COMB_MATCH_TOL_BINS) * Math.max(0, fBin)
  const spTol = Math.max(0, COMB_MATCH_TOL_SPACING_FRAC) * Math.max(0, spacingHz)
  return Math.max(binTol, spTol, 1e-9)
}

/**
 * Geometric sideband positions: centre + n·spacing for n = -count..+count.
 * Clamps each mark into [fMin, fMax] for display at band edges.
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
 * Find a strict local-max peak near targetHz that clears the local median by
 * COMB_PEAK_DB_OVER_MEDIAN and lies within matchToleranceHz(fBin, spacingHz).
 * No soft/argmax fallback — noise-only rows must not match.
 */
export function findMatchedPeakHz(
  row: ArrayLike<number>,
  f0: number,
  fBin: number,
  targetHz: number,
  spacingHz: number,
): number | null {
  if (!(fBin > 0) || row.length < 3 || !(spacingHz > 0)) return null
  const bins = row.length
  const tolHz = matchToleranceHz(fBin, spacingHz)
  const targetBin = Math.round((targetHz - f0) / fBin)
  if (targetBin < 1 || targetBin > bins - 2) return null
  const halfBins = Math.max(1, Math.ceil(tolHz / fBin))
  const lo = Math.max(1, targetBin - halfBins)
  const hi = Math.min(bins - 2, targetBin + halfBins)

  const vals: number[] = []
  for (let b = lo; b <= hi; b++) {
    const v = row[b]!
    if (Number.isFinite(v)) vals.push(v)
  }
  if (vals.length < 3) return null
  const sorted = vals.slice().sort((a, b) => a - b)
  const med = sorted[Math.floor(sorted.length / 2)]!
  const floor = med + COMB_PEAK_DB_OVER_MEDIAN

  let best = -1
  let bestDist = Infinity
  let bestV = -Infinity
  for (let b = lo; b <= hi; b++) {
    const v = row[b]!
    if (!Number.isFinite(v)) continue
    if (!(v > row[b - 1]! && v >= row[b + 1]!)) continue
    if (!(v >= floor)) continue
    const hz = f0 + b * fBin
    if (Math.abs(hz - targetHz) > tolHz + 1e-9) continue
    const dist = Math.abs(hz - targetHz)
    if (dist < bestDist - 1e-12 || (Math.abs(dist - bestDist) < 1e-12 && v > bestV)) {
      best = b
      bestDist = dist
      bestV = v
    }
  }
  if (best < 0) return null
  return f0 + best * fBin
}

/**
 * Evaluate the comb: geometric marks stay put; matched peaks are attached as peakHz.
 * Centre (n=0) is always drawn; it matches when a qualifying peak is found (optional).
 */
export function evaluateComb(
  centreHz: number,
  spacingHz: number,
  count: number,
  row: ArrayLike<number> | null,
  f0: number,
  fBin: number,
  fMin = 0,
  fMax = Infinity,
  matchCentre = true,
): CombMark[] {
  const geo = combSeries(centreHz, spacingHz, count, fMin, fMax)
  return geo.map(({ n, hz }) => {
    if (!row) return { n, hz, peakHz: null, matched: false }
    if (n === 0 && !matchCentre) return { n, hz, peakHz: null, matched: false }
    const peak = findMatchedPeakHz(row, f0, fBin, hz, spacingHz)
    if (peak === null) return { n, hz, peakHz: null, matched: false }
    return { n, hz, peakHz: peak, matched: true }
  })
}

/** @deprecated Alias — prefer evaluateComb. Marks no longer move. */
export const snapCombMarks = evaluateComb

/** Count of sideband marks (excluding centre) that matched a peak. */
export function combMatchedCount(marks: readonly CombMark[]): number {
  return marks.reduce((n, m) => n + (m.n !== 0 && m.matched ? 1 : 0), 0)
}

/** Sideband slots requested (2·count), for readout "matched/total". */
export function combSidebandSlots(count: number): number {
  return 2 * clampSidebands(count)
}

/**
 * Least-squares fit of centre + n·spacing from matched peak positions.
 * Optional refinement — display still uses the operator centre/spacing unless
 * the caller chooses to adopt the fit.
 */
export function fitCombFromPeaks(
  peaks: readonly { n: number; peakHz: number }[],
): { centreHz: number; spacingHz: number } | null {
  const pts = peaks.filter((p) => Number.isFinite(p.n) && Number.isFinite(p.peakHz))
  if (pts.length < 2) return null
  // f = c + n·s  →  normal equations for [c, s]
  let Snn = 0, Sn = 0, Sf = 0, Snf = 0
  const N = pts.length
  for (const p of pts) {
    Sn += p.n
    Snn += p.n * p.n
    Sf += p.peakHz
    Snf += p.n * p.peakHz
  }
  const det = N * Snn - Sn * Sn
  if (Math.abs(det) < 1e-12) return null
  const centreHz = (Snn * Sf - Sn * Snf) / det
  const spacingHz = (N * Snf - Sn * Sf) / det
  if (!(centreHz >= 0) || !(spacingHz > COMB_MIN_SPACING_HZ)) return null
  return { centreHz, spacingHz }
}

/**
 * Label stride so adjacent labels stay ≥ COMB_LABEL_MIN_GAP_PX apart at the
 * current px/Hz. Always show C (n=0); thin sidebands to every stride-th order.
 */
export function combLabelStride(pxPerHz: number, spacingHz: number, minGapPx = COMB_LABEL_MIN_GAP_PX): number {
  if (!(pxPerHz > 0) || !(spacingHz > 0) || !(minGapPx > 0)) return 1
  const gap = pxPerHz * spacingHz
  if (gap >= minGapPx) return 1
  return Math.max(1, Math.ceil(minGapPx / gap))
}

export function combLabelVisible(n: number, stride: number): boolean {
  if (n === 0) return true
  const s = Math.max(1, Math.round(stride))
  return Math.abs(n) % s === 0
}

/** Operator readout — no class/answer-key names. Compact so it fits at 382. */
export function combText(
  centreHz: number | null,
  spacingHz: number | null,
  count: number,
  matched: number | null = null,
): string {
  if (centreHz === null) return 'COMB  pin centre, drag spacing'
  const N = clampSidebands(count)
  const slots = combSidebandSlots(N)
  if (spacingHz === null || !(spacingHz > 0)) {
    return `C ${centreHz.toFixed(2)} Hz · drag sideband ±${N}`
  }
  const matchPart = matched === null ? `±${N}` : `${matched}/${slots}`
  return `C ${centreHz.toFixed(2)} Hz · PSR est ${spacingHz.toFixed(2)} Hz · ${matchPart}`
}
