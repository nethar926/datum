/**
 * BFI (Bearing Frequency Indication): each DIFAR bin is plotted at its bearing
 * (horizontal, 0–360° true) and frequency (vertical, the gram's current band
 * and RES). Colour is level in the gram colormap; points fade over ~30 s.
 * Omni buoys have no bearing — BFI is unavailable and the control is greyed out.
 * Data is the engine's per-bin `bearingDeg` + dB (`drainAllWithBearing`); no
 * engine change. Math matches native `BfiPlot.swift`.
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

export function bfiAvailable(isDifar: boolean): boolean {
  return isDifar
}

/** Linear fade: 1 at age 0, 0 at `windowS`. Clamped. */
export function bfiFade(ageS: number, windowS = BFI_WINDOW_S): number {
  if (windowS <= 1e-12) return 1
  return Math.max(0, Math.min(1, 1 - ageS / windowS))
}

/** Whole rows covering the persistence window (at least one). */
export function bfiRowCount(rowRateHz: number, windowS = BFI_WINDOW_S): number {
  return Math.max(1, Math.round(windowS * Math.max(rowRateHz, 0)))
}

/**
 * Points from newest-first power and bearing rows. Bearing may be interleaved
 * (`deg, conf` per bin, native ring) or one deg per bin (web `BearingHistory`).
 * Bins outside `[fLo, fHi]`, with no finite bearing, zero confidence, or a
 * sentinel dB, are skipped. Rows older than `windowS` are skipped.
 * `ageS` of row `i` is `i / rowRateHz`.
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
}): BfiPoint[] {
  const windowS = opts.windowS ?? BFI_WINDOW_S
  const n = Math.min(
    opts.powerNewestFirst.length,
    opts.bearingNewestFirst.length,
    bfiRowCount(opts.rowRateHz, windowS),
  )
  if (n <= 0 || !Number.isFinite(opts.fBin) || opts.fBin <= 0) return []
  const out: BfiPoint[] = []
  const rate = Math.max(opts.rowRateHz, 1e-12)
  for (let i = 0; i < n; i++) {
    const age = i / rate
    const a = bfiFade(age, windowS)
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
  opts: { f0: number; fBin: number; fLo: number; fHi: number; rowRateHz: number; windowS?: number },
): BfiPoint[] {
  const windowS = opts.windowS ?? BFI_WINDOW_S
  const n = Math.min(power.size, bearing.size, bfiRowCount(opts.rowRateHz, windowS))
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
  return bfiPoints({
    powerNewestFirst: powerRows,
    bearingNewestFirst: brgRows,
    f0: opts.f0, fBin: opts.fBin, fLo: opts.fLo, fHi: opts.fHi,
    rowRateHz: opts.rowRateHz, windowS,
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
  const spanF = Math.max(1e-12, opts.fHi - opts.fLo)
  const r = 2.2
  for (const p of points) {
    const t = normalizeDb(p.db, opts.floor, opts.ceil)
    if (!Number.isFinite(t) || p.alpha <= 0) continue
    const idx = Math.min(255, Math.max(0, Math.round(t * 255)))
    const o = idx * 4
    ctx.globalAlpha = p.alpha
    ctx.fillStyle = `rgb(${lut[o]},${lut[o + 1]},${lut[o + 2]})`
    const x = (p.bearingDeg / 360) * width
    const y = (1 - (p.freqHz - opts.fLo) / spanF) * height
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}
