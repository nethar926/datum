/**
 * m3-fe-brg-freq: sample DIFAR bearing at a frequency from recent per-bin bearing rows
 * (circular mean over a small band + recent rows). Pure maths; no allocation in the hot path
 * beyond the caller's preallocated history ring.
 */
import type { Bearing, GramConfig } from '../engine/contract'

export const BRG_SPREAD_HZ = 1.5
export const BRG_RECENT_ROWS = 12

/** Preallocated ring of per-bin bearing rows for the on-screen stream. */
export class BearingHistory {
  private readonly buf: Float32Array
  private head = 0
  private count = 0
  constructor(readonly rows: number, readonly bins: number) {
    this.buf = new Float32Array(rows * bins)
  }
  clear(): void { this.head = 0; this.count = 0 }
  get size(): number { return this.count }
  /** Copy one row; no allocation. */
  push(src: Float32Array, off: number): void {
    if (src.length < off + this.bins) return
    this.buf.set(src.subarray(off, off + this.bins), this.head * this.bins)
    this.head = (this.head + 1) % this.rows
    if (this.count < this.rows) this.count++
  }
  /** Bearing at row `ago` (0 = newest) and bin, or NaN. */
  at(ago: number, bin: number): number {
    const a = Math.round(ago), b = Math.round(bin)
    if (a < 0 || a >= this.count || b < 0 || b >= this.bins) return NaN
    const row = (this.head - 1 - a + this.rows * 2) % this.rows
    return this.buf[row * this.bins + b]
  }
}

/** Bin index for hz on this gram config (may be out of range). */
export function freqToBin(cfg: GramConfig, hz: number): number {
  return (hz - cfg.f0) / cfg.fBin
}

/**
 * Circular mean of finite bearings in ±spreadHz around hz, over the newest `rows` history rows.
 * Returns null when nothing finite is in range (omni / dead / quiet band).
 */
export function sampleBearingAt(
  hist: BearingHistory,
  cfg: GramConfig,
  hz: number,
  spreadHz = BRG_SPREAD_HZ,
  rows = BRG_RECENT_ROWS,
): number | null {
  if (!hist.size || !cfg.bins) return null
  const c = freqToBin(cfg, hz)
  if (!Number.isFinite(c)) return null
  const half = Math.max(1, Math.round(spreadHz / cfg.fBin))
  const lo = Math.max(0, Math.floor(c) - half)
  const hi = Math.min(cfg.bins - 1, Math.ceil(c) + half)
  const nRows = Math.min(rows, hist.size)
  let sx = 0, sy = 0, n = 0
  for (let ago = 0; ago < nRows; ago++) {
    for (let b = lo; b <= hi; b++) {
      const deg = hist.at(ago, b)
      if (!Number.isFinite(deg)) continue
      const rad = (deg * Math.PI) / 180
      sx += Math.sin(rad); sy += Math.cos(rad); n++
    }
  }
  if (!n) return null
  return ((Math.atan2(sx / n, sy / n) * 180) / Math.PI + 360) % 360
}

/**
 * Fallback when the engine bearing ring is empty: nearest tracked line on this buoy within ±spreadHz.
 */
export function bearingFromTracked(
  bearings: readonly Bearing[] | undefined,
  buoyId: number,
  hz: number,
  spreadHz = BRG_SPREAD_HZ,
): number | null {
  if (!bearings?.length) return null
  let best: Bearing | null = null, bestD = Infinity
  for (const b of bearings) {
    if (b.buoyId !== buoyId || !Number.isFinite(b.brgDeg) || !Number.isFinite(b.freqHz)) continue
    const d = Math.abs(b.freqHz - hz)
    if (d <= spreadHz && d < bestD) { best = b; bestD = d }
  }
  return best ? ((best.brgDeg % 360) + 360) % 360 : null
}

/** Prefer history sample; fall back to tracked tactical lines. */
export function resolveBearingAt(
  hist: BearingHistory | null,
  cfg: GramConfig | null | undefined,
  hz: number,
  buoyId: number,
  tracked?: readonly Bearing[],
  spreadHz = BRG_SPREAD_HZ,
): number | null {
  if (!cfg || !Number.isFinite(hz)) return null
  if (hist && hist.size) {
    const s = sampleBearingAt(hist, cfg, hz, spreadHz)
    if (s !== null) return s
  }
  return bearingFromTracked(tracked, buoyId, hz, spreadHz)
}

export function formatBrgHud(deg: number, hz: number, channel: number): string {
  const d = Math.round(((deg % 360) + 360) % 360) % 360
  const h = hz >= 100 ? hz.toFixed(1) : hz.toFixed(2)
  return `BRG ${String(d).padStart(3, '0')}° @ ${h} Hz · B${channel}`
}

export const OMNI_BRG_MSG = 'No bearing: omni buoy'
export const NO_BRG_MSG = 'No bearing at frequency'
