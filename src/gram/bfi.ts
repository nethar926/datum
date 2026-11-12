/**
 * BFI (Bearing Frequency Indication): each DIFAR bin is plotted at its bearing
 * (horizontal, 0–360° true) and frequency (vertical, the selected BFI Hz range).
 * Colour is a high-contrast stretch of the gram colormap so CPAs read well;
 * points fade over ~30 s. Omni buoys have no bearing — BFI is unavailable and
 * the control is greyed out.
 *
 * Until Sonya's per-band engine output lands (bearing against frequency,
 * integrated over each band), points come from the existing per-bin
 * `bearingDeg` + dB rows, clipped to the selected preset's Hz range.
 * `bfiPointsFromBandSamples` is the seam for that output. Math matches
 * native `BfiPlot.swift`.
 */
import { paletteLut, normalizeDb, type PaletteId } from '../gl/colormap'
import type { LevelHistory } from './levelHistory'
import type { BearingHistory } from './brgFreq'

export const BFI_WINDOW_S = 30

export type BfiPoint = {
  bearingDeg: number
  freqHz: number
  db: number
  ageS: number
  alpha: number
}


export const BFI_PRESETS = [1, 2, 3] as const
export type BfiPreset = (typeof BFI_PRESETS)[number]
export type BfiRange = { loHz: number; hiHz: number }
export type BfiRanges = { 1: BfiRange; 2: BfiRange; 3: BfiRange }

export const BFI_DEFAULT_PRESET: BfiPreset = 1
export const BFI_DEFAULT_RANGES: BfiRanges = {
  1: { loHz: 10, hiHz: 100 },
  2: { loHz: 10, hiHz: 500 },
  3: { loHz: 100, hiHz: 1000 },
}

export function bfiPresetTitle(preset: BfiPreset): string {
  return `BFI ${preset}`
}

export function clampBfiRange(range: BfiRange, minSpan = 1): BfiRange {
  let lo = Number.isFinite(range.loHz) ? range.loHz : 0
  let hi = Number.isFinite(range.hiHz) ? range.hiHz : lo + minSpan
  if (lo < 0) lo = 0
  if (hi < 0) hi = 0
  if (hi < lo) { const t = lo; lo = hi; hi = t }
  if (hi - lo < minSpan) hi = lo + minSpan
  return { loHz: lo, hiHz: hi }
}

export function bfiRangeFor(preset: BfiPreset, ranges: BfiRanges = BFI_DEFAULT_RANGES): BfiRange {
  return clampBfiRange(ranges[preset])
}

/** High-contrast stretch of a 0…1 level so mid/high returns (CPAs) stand out. Matches native `BfiPlot.contrast`. */
export function bfiContrast(t: number): number {
  const x = Math.max(0, Math.min(1, t))
  const y = Math.max(0, (x - 0.12) / 0.88)
  return y ** 0.55
}

/** One integrated sample from Sonya's future per-band drain (bearing against frequency). */
export type BfiBandSample = { bearingDeg: number; freqHz: number; db: number; rowTime: number }

/** Seam for Sonya's per-band output: clip each integrated sample to `range` and apply the 30 s fade. */
export function bfiPointsFromBandSamples(
  samples: readonly BfiBandSample[],
  range: BfiRange,
  tNewestRowSim: number,
  windowS = BFI_WINDOW_S,
): BfiPoint[] {
  const r = clampBfiRange(range)
  const out: BfiPoint[] = []
  for (const s of samples) {
    if (s.freqHz < r.loHz - 1e-9 || s.freqHz > r.hiHz + 1e-9) continue
    if (!Number.isFinite(s.db) || s.db <= -1e30 || !Number.isFinite(s.bearingDeg)) continue
    const a = bfiAlpha(tNewestRowSim, s.rowTime, windowS)
    if (a <= 0) continue
    let d = s.bearingDeg % 360
    if (d < 0) d += 360
    out.push({ bearingDeg: d, freqHz: s.freqHz, db: s.db, ageS: tNewestRowSim - s.rowTime, alpha: a })
  }
  return out
}

export function bfiAvailable(isDifar: boolean): boolean {
  return isDifar
}

/** Linear fade: 1 at age 0, 0 at `windowS`. Clamped. */
export function bfiFade(ageS: number, windowS = BFI_WINDOW_S): number {
  if (windowS <= 1e-12) return 1
  return Math.max(0, Math.min(1, 1 - ageS / windowS))
}

/** Time-based fade: `max(0, 1 - (tNewestRowSim - rowTime) / 30)`.
 *  `tNewestRowSim` is the newest row's sim time, not the live engine clock. */
export function bfiAlpha(tNewestRowSim: number, rowTime: number, windowS = BFI_WINDOW_S): number {
  return bfiFade(tNewestRowSim - rowTime, windowS)
}

/** History hint only — visibility is `alpha > 0`, not this count. */
export function bfiRowCount(rowRateHz: number, windowS = BFI_WINDOW_S): number {
  return Math.max(1, Math.round(windowS * Math.max(rowRateHz, 0)))
}

/** Bearing is horizontal: 0° at the left edge, 360° at the right. */
export function bfiX(bearingDeg: number, width: number): number {
  return (bearingDeg / 360) * width
}

/** Frequency is vertical: `fHi` at the top (y = 0), `fLo` at the bottom. */
export function bfiY(freqHz: number, fLo: number, fHi: number, height: number): number {
  const span = Math.max(1e-12, fHi - fLo)
  return (1 - (freqHz - fLo) / span) * height
}

/**
 * Points from newest-first power and bearing rows. Bearing may be interleaved
 * (`deg, conf` per bin, native ring) or one deg per bin (web `BearingHistory`).
 * Bins outside `[fLo, fHi]`, with no finite bearing, zero confidence, or a
 * sentinel dB, are skipped.
 *
 * Fade is time-based, not row-counted:
 * `alpha = max(0, 1 - (tNewestRowSim - rowTime(k)) / 30)`. A row with
 * `alpha === 0` (age ≥ 30 s) is skipped. `tNewestRowSim` is the newest row's
 * sim time. Until the post-deploy stream-config sync, times fall back to the
 * `rowPeriodS` clock: `rowTime(i) = tNewestRowSim - i · rowPeriodS`.
 */
export function bfiPoints(opts: {
  powerNewestFirst: ArrayLike<number>[]
  bearingNewestFirst: ArrayLike<number>[]
  f0: number
  fBin: number
  fLo: number
  fHi: number
  rowRateHz: number
  windowS?: number
  rowTimesNewestFirst?: number[]
  tNewestRowSim?: number
  rowPeriodS?: number
}): BfiPoint[] {
  const windowS = opts.windowS ?? BFI_WINDOW_S
  const n = Math.min(
    opts.powerNewestFirst.length,
    opts.bearingNewestFirst.length,
    opts.rowTimesNewestFirst?.length ?? Infinity,
  )
  if (n <= 0 || !Number.isFinite(opts.fBin) || opts.fBin <= 0) return []
  const out: BfiPoint[] = []
  const rate = Math.max(opts.rowRateHz, 1e-12)
  const period = (opts.rowPeriodS != null && opts.rowPeriodS > 1e-12) ? opts.rowPeriodS : 1 / rate
  const tNewest = opts.tNewestRowSim ?? opts.rowTimesNewestFirst?.[0] ?? 0
  for (let i = 0; i < n; i++) {
    const rowT = opts.rowTimesNewestFirst?.[i] ?? (tNewest - i * period)
    const age = tNewest - rowT
    const a = bfiAlpha(tNewest, rowT, windowS)
    if (a <= 0) continue
    const power = opts.powerNewestFirst[i]
    const brg = opts.bearingNewestFirst[i]
    const bins = power.length
    for (let b = 0; b < bins; b++) {
      const hz = opts.f0 + b * opts.fBin
      if (hz < opts.fLo - 1e-9 || hz > opts.fHi + 1e-9) continue
      const db = power[b]
      if (!Number.isFinite(db) || db <= -1e30) continue
      let deg: number, conf: number
      if (brg.length >= 2 * bins) {
        deg = brg[2 * b]; conf = brg[2 * b + 1]
      } else if (b < brg.length) {
        deg = brg[b]; conf = 1
      } else continue
      if (!Number.isFinite(deg) || !Number.isFinite(conf) || conf <= 0) continue
      let d = deg % 360
      if (d < 0) d += 360
      out.push({ bearingDeg: d, freqHz: hz, db, ageS: age, alpha: a })
    }
  }
  return out
}

/** Collect newest-first rows from the on-screen histories. */
export function bfiPointsFromHistory(
  power: Pick<LevelHistory, 'size' | 'copyRow' | 'bins'>,
  bearing: Pick<BearingHistory, 'size' | 'at'> & { bins: number },
  opts: {
    f0: number; fBin: number; fLo: number; fHi: number; rowRateHz: number; windowS?: number
    tNewestRowSim?: number; rowPeriodS?: number
  },
): BfiPoint[] {
  const windowS = opts.windowS ?? BFI_WINDOW_S
  // Every stored row; visibility is alpha > 0, not a whole-rows cap.
  const n = Math.min(power.size, bearing.size)
  if (n <= 0 || power.bins <= 0) return []
  const powerRows: Float32Array[] = []
  const brgRows: Float32Array[] = []
  for (let age = 0; age < n; age++) {
    const dest = new Float32Array(power.bins)
    if (!power.copyRow(age, dest)) break
    const brg = new Float32Array(bearing.bins)
    for (let b = 0; b < bearing.bins; b++) brg[b] = bearing.at(age, b)
    powerRows.push(dest)
    brgRows.push(brg)
  }
  const period = (opts.rowPeriodS != null && opts.rowPeriodS > 1e-12)
    ? opts.rowPeriodS : 1 / Math.max(opts.rowRateHz, 1e-12)
  const tNewest = opts.tNewestRowSim ?? 0
  const rowTimes = powerRows.map((_, i) => tNewest - i * period)
  return bfiPoints({
    powerNewestFirst: powerRows,
    bearingNewestFirst: brgRows,
    f0: opts.f0, fBin: opts.fBin, fLo: opts.fLo, fHi: opts.fHi,
    rowRateHz: opts.rowRateHz, windowS,
    rowTimesNewestFirst: rowTimes, tNewestRowSim: tNewest, rowPeriodS: period,
  })
}

/** Paint BFI points into an already-sized canvas. Frequency is vertical (low at bottom). */
export function drawBfi(
  ctx: CanvasRenderingContext2D,
  points: readonly BfiPoint[],
  opts: { fLo: number; fHi: number; floor: number; ceil: number; palette?: PaletteId },
): void {
  const { width, height } = ctx.canvas
  ctx.clearRect(0, 0, width, height)
  if (!points.length || width < 1 || height < 1 || opts.fHi <= opts.fLo) return
  const lut = paletteLut(opts.palette ?? 'green')
  const r = 2.2
  for (const p of points) {
    const t = bfiContrast(normalizeDb(p.db, opts.floor, opts.ceil))
    if (!Number.isFinite(t) || p.alpha <= 0) continue
    const idx = Math.min(255, Math.max(0, Math.round(t * 255)))
    const o = idx * 4
    ctx.globalAlpha = p.alpha
    ctx.fillStyle = `rgb(${lut[o]},${lut[o + 1]},${lut[o + 2]})`
    const x = bfiX(p.bearingDeg, width)
    const y = bfiY(p.freqHz, opts.fLo, opts.fHi, height)
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}
