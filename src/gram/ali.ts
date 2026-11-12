/**
 * ALI (Automatic Line Integration): a 30 s (by default) integration of each LOFAR
 * frequency bin, shown as a thin strip at the newest-data edge of the gram.
 *
 * When the waterfall cascades downward (newest at the top), the strip sits on the
 * top edge; when it cascades upward (newest at the bottom, the app default), it
 * sits on the bottom. LOFAR only — not DEMON. The window length is a parameter
 * so it is easy to change.
 *
 * Math matches native `AliStrip.swift`: per-bin mean of linear power, dB in / dB out.
 */
import { paletteLut, normalizeDb, type PaletteId } from '../gl/colormap'
import type { LevelHistory } from './levelHistory'

export const ALI_WINDOW_S = 30
export const ALI_STRIP_PX = 16

export function aliEdgeIsTop(newestAtBottom: boolean): boolean {
  return !newestAtBottom
}

export function aliRowCount(periodS: number, windowS = ALI_WINDOW_S): number {
  return Math.max(1, Math.ceil(windowS / Math.max(periodS, 1e-12)))
}

export function aliAvailable(isLofar: boolean): boolean {
  return isLofar
}

/** Per-bin mean of linear power over `rowsNewestFirst` (age 0 first), limited to the window. */
export function integrateAli(rowsNewestFirst: ArrayLike<number>[], periodS: number, windowS = ALI_WINDOW_S): Float32Array {
  const first = rowsNewestFirst[0]
  if (!first || first.length === 0) return new Float32Array(0)
  const nWanted = Math.min(rowsNewestFirst.length, aliRowCount(periodS, windowS))
  const bins = first.length
  const out = new Float32Array(bins)
  out.fill(NaN)
  for (let b = 0; b < bins; b++) {
    let sum = 0, n = 0
    for (let i = 0; i < nWanted; i++) {
      const db = rowsNewestFirst[i][b]
      if (!Number.isFinite(db) || db <= -1e30) continue
      sum += 10 ** (db / 10)
      n++
    }
    if (n > 0) out[b] = 10 * Math.log10(sum / n)
  }
  return out
}

export function integrateFromHistory(
  hist: Pick<LevelHistory, 'size' | 'copyRow' | 'bins'>,
  periodS: number,
  windowS = ALI_WINDOW_S,
): Float32Array {
  const n = Math.min(hist.size, aliRowCount(periodS, windowS))
  if (n <= 0 || hist.bins <= 0) return new Float32Array(0)
  const rows: Float32Array[] = []
  for (let age = 0; age < n; age++) {
    const dest = new Float32Array(hist.bins)
    if (!hist.copyRow(age, dest)) break
    rows.push(dest)
  }
  return integrateAli(rows, periodS, windowS)
}

/** Paint the integrated row into an already-sized canvas, aligned to [fLo, fHi] on the gram. */
export function drawAliStrip(
  ctx: CanvasRenderingContext2D,
  row: Float32Array,
  opts: { f0: number; fBin: number; fLo: number; fHi: number; floor: number; ceil: number; palette?: PaletteId },
): void {
  const { width, height } = ctx.canvas
  ctx.clearRect(0, 0, width, height)
  if (!row.length || width < 1 || height < 1) return
  const lut = paletteLut(opts.palette ?? 'green')
  const span = Math.max(1e-9, opts.fHi - opts.fLo)
  for (let x = 0; x < width; x++) {
    const hz = opts.fLo + (x + 0.5) / width * span
    const i = Math.round((hz - opts.f0) / Math.max(1e-12, opts.fBin))
    if (i < 0 || i >= row.length) continue
    const t = normalizeDb(row[i], opts.floor, opts.ceil)
    if (!Number.isFinite(t)) continue
    const idx = Math.min(255, Math.max(0, Math.round(t * 255)))
    ctx.fillStyle = `rgb(${lut[idx * 4]},${lut[idx * 4 + 1]},${lut[idx * 4 + 2]})`
    ctx.fillRect(x, 0, 1.5, height)
  }
}
