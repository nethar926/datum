/**
 * ALI (Automatic Line Integration): a ~30 s integration of each LOFAR frequency
 * bin, shown as an amplitude bar chart under the gram. A taller bar means more
 * amplitude. The operator can select a bar or peak and send a bearing.
 *
 * The chart always sits under the waterfall, above the frequency axis — it is
 * never placed on the newest-data edge, and never over the Duo hinge crease.
 * LOFAR only — not DEMON.
 *
 * The window is a whole number of rows: `n = max(1, round(windowS * rowRateHz))`.
 * Power is averaged in linear units, then converted back to dB. The labelled
 * span is the real coverage `n / rowRateHz` (RES 1 is 32 s, not 30). ALI keeps
 * working in LSTI; the label then also shows the row's analysis span
 * (`integrationSpanS`) so it is not read as extra gain. `integrationMode`
 * defaults to `'sti'` — web has no LSTI fields until the post-deploy sync.
 *
 * Math matches native `AliStrip.swift`.
 */
import { paletteLut, normalizeDb, type PaletteId } from '../gl/colormap'
import type { LevelHistory } from './levelHistory'

export const ALI_WINDOW_S = 30
/** Amplitude bar chart height, in CSS pixels. */
export const ALI_CHART_PX = 56
/** @deprecated alias of ALI_CHART_PX */
export const ALI_STRIP_PX = ALI_CHART_PX

export function aliEdgeIsTop(newestAtBottom: boolean): boolean {
  return !newestAtBottom
}

export function aliRowCount(rowRateHz: number, windowS = ALI_WINDOW_S): number {
  return Math.max(1, Math.round(windowS * Math.max(rowRateHz, 0)))
}

/** Real coverage of those n rows, in sim seconds. */
export function aliSpanS(rowRateHz: number, windowS = ALI_WINDOW_S): number {
  return aliRowCount(rowRateHz, windowS) / Math.max(rowRateHz, 1e-12)
}

/** Whole seconds when the value is an integer; one decimal otherwise (e.g. 17.5). */
function formatS(s: number): string {
  const r = Math.round(s * 10) / 10
  return Number.isInteger(r) ? String(r) : r.toFixed(1)
}

/**
 * STI: `"ALI 32 s"`. When `integrationMode` is `'lsti'`, also the row span:
 * `"ALI 32 s (LSTI 88 s)"`. `integrationMode` defaults to `'sti'`.
 */
export function aliLabel(
  rowRateHz: number,
  windowS = ALI_WINDOW_S,
  integrationMode: 'sti' | 'lsti' = 'sti',
  integrationSpanS = 0,
): string {
  const ali = `ALI ${formatS(aliSpanS(rowRateHz, windowS))} s`
  return integrationMode === 'lsti' ? `${ali} (LSTI ${formatS(integrationSpanS)} s)` : ali
}

export function aliAvailable(isLofar: boolean): boolean {
  return isLofar
}

/** Per-bin mean of linear power over `rowsNewestFirst` (age 0 first), limited to the window. */
export function integrateAli(rowsNewestFirst: ArrayLike<number>[], rowRateHz: number, windowS = ALI_WINDOW_S): Float32Array {
  const first = rowsNewestFirst[0]
  if (!first || first.length === 0) return new Float32Array(0)
  const nWanted = Math.min(rowsNewestFirst.length, aliRowCount(rowRateHz, windowS))
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
  rowRateHz: number,
  windowS = ALI_WINDOW_S,
): Float32Array {
  const n = Math.min(hist.size, aliRowCount(rowRateHz, windowS))
  if (n <= 0 || hist.bins <= 0) return new Float32Array(0)
  const rows: Float32Array[] = []
  for (let age = 0; age < n; age++) {
    const dest = new Float32Array(hist.bins)
    if (!hist.copyRow(age, dest)) break
    rows.push(dest)
  }
  return integrateAli(rows, rowRateHz, windowS)
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

export type AliBar = {
  bin: number
  hz: number
  db: number
  /** 0…1; taller means more amplitude. */
  height: number
  isPeak: boolean
  /** Set when the bar comes from Sonya's per-bearing amplitude API. */
  bearingDeg?: number
}

/** Per-bearing amplitude sample from the upcoming engine API. */
export type AliBearingAmp = { bearingDeg: number; freqHz: number; db: number }

export type AliSendRoute = 'engine' | 'manual'

/** Seam for Sonya's per-bearing amplitude and send-bearing-from-peak engine API. */
export type AliEngineSource = {
  aliBearingAmplitudes(): AliBearingAmp[] | null | undefined
  /** Return true when the engine itself sent the bearing. */
  sendBearingFromPeak(hz: number): boolean
}

export type AliLayoutRect = { x: number; y: number; width: number; height: number }

export function aliRectUsable(r: AliLayoutRect): boolean {
  return Number.isFinite(r.width) && Number.isFinite(r.height) && r.width > 0 && r.height > 0
}

function aliIntersect(a: AliLayoutRect, b: AliLayoutRect): AliLayoutRect {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.width, b.x + b.width)
  const y2 = Math.min(a.y + a.height, b.y + b.height)
  return { x: x1, y: y1, width: Math.max(0, x2 - x1), height: Math.max(0, y2 - y1) }
}

/** Height of a bar in 0…1. Taller means more amplitude. */
export function aliBarHeight(db: number, floor: number, ceil: number): number {
  if (!Number.isFinite(db)) return NaN
  const span = Math.max(1e-6, ceil - floor)
  return Math.min(1, Math.max(0, (db - floor) / span))
}

export function aliHz(bin: number, f0: number, fBin: number): number {
  return f0 + bin * fBin
}

export function aliHzAt(x: number, width: number, fLo: number, fHi: number): number {
  const w = Math.max(1e-12, width)
  const t = Math.min(1, Math.max(0, x / w))
  return fLo + t * (fHi - fLo)
}

/** Local-maxima bins. Non-finite neighbours count as −∞. Peaks within 12 dB of the max are kept. */
export function aliPeakBins(row: ArrayLike<number>): number[] {
  const finite: { i: number; v: number }[] = []
  for (let i = 0; i < row.length; i++) {
    const v = row[i]
    if (Number.isFinite(v) && v > -1e30) finite.push({ i, v })
  }
  if (!finite.length) return []
  const maxDb = Math.max(...finite.map((p) => p.v))
  if (row.length < 3) return finite.filter((p) => p.v >= maxDb - 1e-6).map((p) => p.i)
  const floor = maxDb - 12
  const peaks: number[] = []
  for (let i = 0; i < row.length; i++) {
    const v = row[i]
    if (!Number.isFinite(v) || v <= -1e30 || v < floor) continue
    const left = i > 0 ? row[i - 1] : -Infinity
    const right = i + 1 < row.length ? row[i + 1] : -Infinity
    const l = Number.isFinite(left) && left > -1e30 ? left : -Infinity
    const r = Number.isFinite(right) && right > -1e30 ? right : -Infinity
    if (v > l && v >= r) peaks.push(i)
  }
  return peaks
}

export function aliSnap(hz: number, bars: AliBar[], windowHz: number): number {
  const peaks = bars.filter((b) => b.isPeak)
  if (!peaks.length) return hz
  let best = peaks[0], bestD = Math.abs(best.hz - hz)
  for (const p of peaks) {
    const d = Math.abs(p.hz - hz)
    if (d < bestD) { best = p; bestD = d }
  }
  return bestD <= windowHz ? best.hz : hz
}

export function aliBarsFromRow(
  row: ArrayLike<number>,
  opts: { f0: number; fBin: number; fLo: number; fHi: number; floor: number; ceil: number },
): AliBar[] {
  const peaks = new Set(aliPeakBins(row))
  const bin = Math.max(1e-12, opts.fBin)
  const out: AliBar[] = []
  for (let i = 0; i < row.length; i++) {
    const hz = aliHz(i, opts.f0, bin)
    if (hz < opts.fLo || hz > opts.fHi) continue
    const db = row[i]
    if (!Number.isFinite(db) || db <= -1e30) continue
    const height = aliBarHeight(db, opts.floor, opts.ceil)
    if (!Number.isFinite(height)) continue
    out.push({ bin: i, hz, db, height, isPeak: peaks.has(i) })
  }
  return out
}

export function aliBarsFromBearingAmps(
  amps: AliBearingAmp[],
  opts: { fLo: number; fHi: number; floor: number; ceil: number },
): AliBar[] {
  const peaks = new Set(aliPeakBins(amps.map((a) => a.db)))
  const out: AliBar[] = []
  for (let i = 0; i < amps.length; i++) {
    const a = amps[i]
    if (a.freqHz < opts.fLo || a.freqHz > opts.fHi) continue
    if (!Number.isFinite(a.db) || a.db <= -1e30) continue
    const height = aliBarHeight(a.db, opts.floor, opts.ceil)
    if (!Number.isFinite(height)) continue
    out.push({ bin: i, hz: a.freqHz, db: a.db, height, isPeak: peaks.has(i), bearingDeg: a.bearingDeg })
  }
  return out
}

/** Prefer Sonya's per-bearing amplitude when present; otherwise the integrated row. */
export function aliBars(
  row: ArrayLike<number> | null | undefined,
  bearingAmps: AliBearingAmp[] | null | undefined,
  opts: { f0: number; fBin: number; fLo: number; fHi: number; floor: number; ceil: number },
): AliBar[] {
  if (bearingAmps && bearingAmps.length) return aliBarsFromBearingAmps(bearingAmps, opts)
  if (!row || row.length === 0) return []
  return aliBarsFromRow(row, opts)
}

function aliClip(frame: AliLayoutRect, crease: AliLayoutRect): AliLayoutRect {
  const hit = aliIntersect(frame, crease)
  if (!aliRectUsable(hit)) return frame
  if (hit.width <= hit.height) {
    const leftW = Math.max(0, hit.x - frame.x)
    const rightW = Math.max(0, frame.x + frame.width - (hit.x + hit.width))
    if (hit.x <= frame.x + 1e-9) {
      return { x: hit.x + hit.width, y: frame.y, width: Math.max(0, frame.x + frame.width - (hit.x + hit.width)), height: frame.height }
    }
    if (hit.x + hit.width >= frame.x + frame.width - 1e-9) {
      return { x: frame.x, y: frame.y, width: leftW, height: frame.height }
    }
    return leftW >= rightW
      ? { x: frame.x, y: frame.y, width: leftW, height: frame.height }
      : { x: hit.x + hit.width, y: frame.y, width: rightW, height: frame.height }
  }
  const topH = Math.max(0, hit.y - frame.y)
  const botH = Math.max(0, frame.y + frame.height - (hit.y + hit.height))
  if (hit.y <= frame.y + 1e-9) {
    return { x: frame.x, y: hit.y + hit.height, width: frame.width, height: Math.max(0, frame.y + frame.height - (hit.y + hit.height)) }
  }
  if (hit.y + hit.height >= frame.y + frame.height - 1e-9) {
    return { x: frame.x, y: frame.y, width: frame.width, height: topH }
  }
  return topH >= botH
    ? { x: frame.x, y: frame.y, width: frame.width, height: topH }
    : { x: frame.x, y: hit.y + hit.height, width: frame.width, height: botH }
}

/** Chart frame under the waterfall, above the frequency axis, never over the crease. */
export function aliChartFrame(
  gramBounds: AliLayoutRect,
  axisH = 44,
  crease?: AliLayoutRect | null,
  chartH = ALI_CHART_PX,
): AliLayoutRect | null {
  const aboveAxis: AliLayoutRect = { x: gramBounds.x, y: gramBounds.y, width: gramBounds.width, height: Math.max(0, gramBounds.height - axisH) }
  let frame: AliLayoutRect = { x: gramBounds.x, y: gramBounds.y + gramBounds.height - axisH - chartH, width: gramBounds.width, height: chartH }
  frame = aliIntersect(frame, aboveAxis)
  if (!aliRectUsable(frame)) return null
  if (crease && aliRectUsable(crease)) frame = aliClip(frame, crease)
  return aliRectUsable(frame) ? frame : null
}

export function aliAvoidsCrease(frame: AliLayoutRect, crease?: AliLayoutRect | null): boolean {
  if (!crease || !aliRectUsable(crease)) return true
  return !aliRectUsable(aliIntersect(frame, crease))
}

/** Route a send: engine wins when it handles the peak; otherwise the manual bearing path. */
export function aliRouteSend(hz: number, engine?: AliEngineSource | null): AliSendRoute {
  if (engine?.sendBearingFromPeak(hz) === true) return 'engine'
  return 'manual'
}

/** Paint amplitude bars into an already-sized canvas, aligned to [fLo, fHi]. */
export function drawAliBars(
  ctx: CanvasRenderingContext2D,
  bars: AliBar[],
  opts: { fLo: number; fHi: number; selectedHz?: number | null; accent?: string; fill?: string },
): void {
  const { width, height } = ctx.canvas
  ctx.clearRect(0, 0, width, height)
  if (!bars.length || width < 1 || height < 1) return
  const span = Math.max(1e-9, opts.fHi - opts.fLo)
  const barW = Math.max(1, width / Math.max(1, bars.length) * 0.85)
  const fill = opts.fill ?? '#5cff7a'
  const accent = opts.accent ?? '#30d158'
  for (const bar of bars) {
    const x = (bar.hz - opts.fLo) / span * width
    const h = bar.height * height
    if (h <= 0.5) continue
    const selected = opts.selectedHz != null && Math.abs(opts.selectedHz - bar.hz) <= span * 0.005
    ctx.fillStyle = selected || bar.isPeak ? accent : fill
    if (!selected && bar.isPeak) ctx.globalAlpha = 0.85
    else if (!selected) ctx.globalAlpha = 0.85
    else ctx.globalAlpha = 1
    const rx = x - barW / 2
    ctx.fillRect(rx, height - h, barW, h)
    ctx.globalAlpha = 1
  }
}
