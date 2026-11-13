/**
 * Bearing-time (BT) display math.
 *
 * Horizontal axis is true bearing 0–360° (north-up); an optional centre shifts
 * the axis so a track near 000° does not wrap. Vertical axis is time, scrolling
 * from the same newest edge and at the same rate as the LOFAR waterfall.
 *
 * Energy rows come from the engine (`bearingEnergy` / `bearingEnergyHistory`):
 * 360 uint8 bins, 0…359° true. Legacy rows (no `scale`) are max-normalised;
 * `scale: 'db-above-bg-0.1'` is dB above background at 0.1 dB/step (0–25.5 dB),
 * mapped linearly onto the palette (noise near black). `btRowFromEngine` writes
 * that row into the ring. Per-line overlay dots come from `bearingTime` entries;
 * σ is drawn as a short horizontal bar (faint when `valid` is false).
 *
 * There is no stub fold from per-bin bearingDeg/dB. When the engine has not
 * posted rows, the display is empty ("No bearing data").
 *
 * Native (Swift/Metal) parity comes in a later commit: mirror wrapBearingDeg,
 * bearingBin, bearingToAxisFrac / axisFracToBearing, the uint8 ring
 * push/wrap/clear, the centred-axis mapping, and the σ-bar overlay. Do not
 * fork the formulas.
 */
import { agoFromY, yFromAgo, type GramDir } from './timeAxis'
import { formatZuluHms } from '../touch/scrollBack'
import type { PaletteId } from '../gl/colormap'
import { paletteLut } from '../gl/colormap'
import type { BearingEnergyRow, BearingTimeEntry } from '../engine/contract'

export const BT_BINS = 360
/** Default / max history window: 15 minutes (matches the 900 s user-cut window). */
export const BT_WINDOW_S = 15 * 60
/** Zoom steps: 5 min and 15 min. */
export const BT_ZOOM_WINDOWS_S = [5 * 60, 15 * 60] as const
export type BtZoomS = (typeof BT_ZOOM_WINDOWS_S)[number]
/**
 * Sizing rate behind the approved ~10 MB / 1.3 MB budgets (900 rows × 360 B).
 * Engine energy rows arrive at a 1 s cadence.
 */
export const BT_ROW_RATE_HZ = 1
export const BT_MAX_ROWS = BT_WINDOW_S * BT_ROW_RATE_HZ
export const BT_MAX_BUOYS = 32
export const BT_ENERGY_BYTES = BT_MAX_BUOYS * BT_MAX_ROWS * BT_BINS

export const BT_EMPTY_LABEL = 'No bearing data'

/** Full Zulu tick as rendered on the time axis (`formatZuluHms`). */
export const BT_ZULU_TICK = '00:00:00z'
/** Matches `.axis { font: 10px/1 var(--font-mono) }`. */
export const BT_AXIS_FONT_PX = 10
/** Matches `.axis-y span { left: 6px }` and a matching right slack. */
export const BT_AXIS_INSET_PX = 6
/** Em-advance of a typical 10px monospace glyph (0.6em). */
export const BT_MONO_ADVANCE = 0.6

/** Minimum time-axis gutter so `HH:MM:SSz` fits (9ch at 10px mono + insets). */
export function btTimeAxisMinWidthPx(): number {
  return Math.ceil(BT_ZULU_TICK.length * BT_AXIS_FONT_PX * BT_MONO_ADVANCE + BT_AXIS_INSET_PX * 2)
}

export type BtAxisAlign = 'start' | 'center' | 'end'
export type BtAxisTick = { deg: number; label: string; frac: number; left: string; align: BtAxisAlign }

export function formatBtBearingTick(deg: number, centre: number | null): string {
  if (deg === 360 && centre === null) return '360°'
  return `${String(Math.round(wrapBearingDeg(deg)) % 360).padStart(3, '0')}°`
}

/** Anchor end ticks inward so the label stays inside the plot. */
export function btAxisTickAlign(frac: number): BtAxisAlign {
  if (frac <= 1e-9) return 'start'
  if (frac >= 1 - 1e-9) return 'end'
  return 'center'
}

export function btAxisTicks(centre: number | null, width: number): BtAxisTick[] {
  const step = width < 360 ? 90 : 45
  const ticks: { deg: number; frac: number }[] = []
  if (centre === null) {
    for (let d = 0; d <= 360; d += step) {
      ticks.push({ deg: d, frac: d === 360 ? 1 : bearingToAxisFrac(d, null) })
    }
  } else {
    for (let k = -180; k <= 180; k += step) {
      ticks.push({ deg: wrapBearingDeg(centre + k), frac: (k + 180) / 360 })
    }
  }
  return ticks.map(({ deg, frac }) => ({
    deg,
    frac,
    label: formatBtBearingTick(centre === null && frac >= 1 - 1e-9 ? 360 : deg, centre),
    left: `${(frac * 100).toFixed(4)}%`,
    align: btAxisTickAlign(frac),
  }))
}

export function wrapBearingDeg(deg: number): number {
  const w = deg % 360
  return w < 0 ? w + 360 : w
}

/** 1° bin in [0, 359] for a true bearing (bin 0 = 000°, bin 359 = 359°). */
export function bearingBin(deg: number): number {
  const w = wrapBearingDeg(deg)
  return w >= 360 - 1e-12 ? 0 : Math.min(BT_BINS - 1, Math.floor(w + 1e-12))
}

/**
 * True bearing → horizontal fraction on a north-up axis.
 * `centreDeg = null` puts 000° at the left edge and 360° at the right.
 * A finite centre puts that bearing in the middle (000°-centred keeps a
 * north track from wrapping at the edges).
 */
export function bearingToAxisFrac(bearingDeg: number, centreDeg: number | null): number {
  const b = wrapBearingDeg(bearingDeg)
  if (centreDeg === null) return b / 360
  return wrapBearingDeg(b - wrapBearingDeg(centreDeg) + 180) / 360
}

/** Inverse of `bearingToAxisFrac`. */
export function axisFracToBearing(frac: number, centreDeg: number | null): number {
  const t = ((frac % 1) + 1) % 1
  if (centreDeg === null) return wrapBearingDeg(t * 360)
  return wrapBearingDeg(t * 360 + wrapBearingDeg(centreDeg) - 180)
}

export const BT_DB_ABOVE_BG_SCALE = 'db-above-bg-0.1' as const
/** dB per uint8 step when `scale === 'db-above-bg-0.1'`. */
export const BT_DB_ABOVE_BG_STEP = 0.1
/** Full-scale range: 255 × 0.1 dB. */
export const BT_DB_ABOVE_BG_MAX = 25.5

/**
 * Map one engine energy sample onto a 256-step BT palette index.
 * `db-above-bg-0.1` is already 0–25.5 dB in 0.1 dB steps, so 0 (noise) is
 * palette 0 (near black) and 255 (25.5 dB) is the top of the LUT.
 * Legacy max-normalised rows (no scale, or any other value) copy as stored.
 */
export function btPaletteIndex(energy: number, scale?: string | null): number {
  const v = energy & 255
  if (scale === BT_DB_ABOVE_BG_SCALE) return v
  return v
}

/**
 * Copy a 360-bin engine energy row into `out` (length 360), mapping
 * `scale: 'db-above-bg-0.1'` linearly onto the palette and leaving
 * max-normalised rows (no scale) unchanged.
 */
export function btRowFromEngine(row: Pick<BearingEnergyRow, 'energy' | 'scale'>, out: Uint8Array): Uint8Array {
  const src = row.energy
  const n = Math.min(BT_BINS, out.length, src.length)
  const scale = row.scale
  if (scale === BT_DB_ABOVE_BG_SCALE) {
    for (let i = 0; i < n; i++) out[i] = btPaletteIndex(src[i] ?? 0, scale)
    if (n < out.length) out.fill(0, n)
    return out
  }
  if (src.length >= n && out.length >= n) out.set(src.subarray(0, n), 0)
  else {
    for (let i = 0; i < n; i++) out[i] = src[i] ?? 0
  }
  if (n < out.length) out.fill(0, n)
  return out
}

/** Per-line overlay from Sonya's `bearingTime` / `bearingTimeHistory` entries. */
export type BtLineOverlay = BearingTimeEntry

/**
 * Preallocated ring of 360 one-degree Uint8 bins for one buoy.
 * No allocation in push / at / row. Clear on seek, cut, or a new sim
 * the same way BearingHistory / LevelHistory are cleared, then refill
 * from `bearingEnergyHistory`.
 */
export class BtRing {
  private readonly buf: Uint8Array
  private readonly rowTimes: Float64Array
  private head = 0
  private count = 0
  constructor(readonly rows: number, readonly bins = BT_BINS) {
    this.buf = new Uint8Array(rows * bins)
    this.rowTimes = new Float64Array(rows)
  }
  /** Energy-buffer byte length (the 10 MB budget counts these, not the timestamps). */
  get byteLength(): number { return this.buf.byteLength }
  get size(): number { return this.count }
  clear(): void {
    this.head = 0
    this.count = 0
    this.buf.fill(0)
    this.rowTimes.fill(0)
  }
  /** Copy one 360-bin Uint8 row; no allocation. */
  push(src: Uint8Array, simT = 0): void {
    if (src.length < this.bins) return
    this.buf.set(src.subarray(0, this.bins), this.head * this.bins)
    this.rowTimes[this.head] = simT
    this.head = (this.head + 1) % this.rows
    if (this.count < this.rows) this.count++
  }
  /** Energy at row `ago` (0 = newest) and bearing bin, or 0 when empty / out of range. */
  at(ago: number, bin: number): number {
    const a = Math.round(ago), b = Math.round(bin)
    if (a < 0 || a >= this.count || b < 0 || b >= this.bins) return 0
    const row = (this.head - 1 - a + this.rows * 2) % this.rows
    return this.buf[row * this.bins + b]!
  }
  /** View of row `ago` (0 = newest); no copy. */
  row(ago: number): Uint8Array | null {
    const a = Math.round(ago)
    if (a < 0 || a >= this.count) return null
    const row = (this.head - 1 - a + this.rows * 2) % this.rows
    const o = row * this.bins
    return this.buf.subarray(o, o + this.bins)
  }
  /** Sim time of row `ago` (0 = newest), or NaN. */
  timeAt(ago: number): number {
    const a = Math.round(ago)
    if (a < 0 || a >= this.count) return NaN
    const row = (this.head - 1 - a + this.rows * 2) % this.rows
    return this.rowTimes[row]!
  }
}

/** Preallocated ring per buoy (up to 32). All energy buffers are allocated in the constructor. */
export class BtStore {
  private readonly rings: BtRing[]
  private readonly buoyOf: Int32Array
  constructor(readonly capacity = BT_MAX_BUOYS, readonly rows = BT_MAX_ROWS) {
    this.rings = Array.from({ length: capacity }, () => new BtRing(rows))
    this.buoyOf = new Int32Array(capacity).fill(-1)
  }
  /** Sum of energy-buffer byte lengths (the ~10 MB budget). */
  get byteLength(): number { return this.capacity * this.rows * BT_BINS }
  ringFor(buoyId: number): BtRing {
    let free = -1
    for (let i = 0; i < this.capacity; i++) {
      if (this.buoyOf[i] === buoyId) return this.rings[i]!
      if (free < 0 && this.buoyOf[i] === -1) free = i
    }
    const i = free >= 0 ? free : 0
    if (this.buoyOf[i] !== -1) this.rings[i]!.clear()
    this.buoyOf[i] = buoyId
    return this.rings[i]!
  }
  clear(): void {
    for (const r of this.rings) r.clear()
    this.buoyOf.fill(-1)
  }
  clearBuoy(buoyId: number): void {
    for (let i = 0; i < this.capacity; i++) {
      if (this.buoyOf[i] === buoyId) {
        this.rings[i]!.clear()
        this.buoyOf[i] = -1
        return
      }
    }
  }
}

/** Clear BT history on a cut seek with `replace: true`, then refill from `bearingEnergyHistory`. */
export function applyBtSeekClear(ring: { clear(): void }, notice: { replace: boolean }): void {
  if (notice.replace) ring.clear()
}

/**
 * Load engine energy rows (oldest first) into a ring. Used after a seek/cut
 * replace. No allocation beyond the caller's preallocated `out`.
 */
export function fillBtRingFromHistory(
  ring: BtRing,
  rows: readonly Pick<BearingEnergyRow, 'energy' | 't' | 'scale'>[],
  out: Uint8Array,
): void {
  ring.clear()
  for (const row of rows) {
    btRowFromEngine(row, out)
    ring.push(out, row.t)
  }
}

export type BtMark = { bearingDeg: number; simS: number }

/** Shortest-path bearing rate in deg/s from two marked points. Null when dt is ~0. */
export function bearingRateDegPerS(a: BtMark, b: BtMark): number | null {
  const dt = b.simS - a.simS
  if (!Number.isFinite(dt) || Math.abs(dt) < 1e-9) return null
  let d = wrapBearingDeg(b.bearingDeg - a.bearingDeg)
  if (d > 180) d -= 360
  return d / dt
}

export function formatBtCursor(
  bearingDeg: number,
  simS: number,
  originMs: number,
  rateDegPerS?: number | null,
): string {
  const brg = String(Math.round(wrapBearingDeg(bearingDeg)) % 360).padStart(3, '0')
  const t = formatZuluHms(simS, originMs)
  if (rateDegPerS == null || !Number.isFinite(rateDegPerS)) return `${brg}°  ${t}`
  const sign = rateDegPerS >= 0 ? '+' : '−'
  return `${brg}°  ${t}  ${sign}${Math.abs(rateDegPerS).toFixed(2)}°/s`
}

/** Gate: engine buoy `type === 'difar'`. Falls back to `kind` only when type is missing. */
export function btAvailable(buoy: { type?: string | null; kind?: string | null } | null | undefined): boolean {
  if (!buoy) return false
  if (buoy.type) return buoy.type === 'difar'
  return buoy.kind === 'difar'
}

export const BT_UNAVAILABLE_TITLE = 'BT is available on DIFAR buoys only.'
export const BT_AVAILABLE_TITLE = 'Bearing time: true bearing against time, scrolling with the waterfall. DIFAR only.'

export type BtOverlayBar = {
  /** Axis fraction of the bearing (0–1). */
  x: number
  /** Half-width of the σ bar, in axis fraction. */
  half: number
  /** Age in seconds (0 = newest). */
  agoS: number
  valid: boolean
  bearingDeg: number
  simS: number
  freqHz?: number
}

const SIGMA_BAR_MIN_FRAC = 1.5 / 360

/** Overlay bars in the visible time window for one buoy. */
export function btOverlayBars(
  entries: readonly BtLineOverlay[],
  opts: { buoyId: number; newest: number; windowS: number },
): BtOverlayBar[] {
  const { buoyId, newest, windowS } = opts
  const t0 = newest - windowS
  const out: BtOverlayBar[] = []
  for (const e of entries) {
    if (e.buoyId !== buoyId) continue
    if (!Number.isFinite(e.t) || e.t < t0 - 1e-9 || e.t > newest + 1e-9) continue
    const sigma = Number.isFinite(e.sigmaDeg) ? Math.max(0, e.sigmaDeg) : 0
    out.push({
      x: 0, // filled by the caller with the current centre
      half: Math.max(SIGMA_BAR_MIN_FRAC, sigma / 360),
      agoS: newest - e.t,
      valid: e.valid,
      bearingDeg: e.bearingDeg,
      simS: e.t,
      freqHz: e.freqHz,
    })
  }
  return out
}

/** Axis-fraction segments for a σ bar, split when the bar wraps at the edge. */
export function sigmaBarSegments(
  bearingDeg: number,
  halfFrac: number,
  centreDeg: number | null,
): { lo: number; hi: number }[] {
  const x = bearingToAxisFrac(bearingDeg, centreDeg)
  const lo = x - halfFrac, hi = x + halfFrac
  if (lo >= 0 && hi <= 1) return [{ lo, hi }]
  const segs: { lo: number; hi: number }[] = []
  if (lo < 0) {
    segs.push({ lo: 0, hi: Math.min(1, hi) })
    segs.push({ lo: Math.max(0, 1 + lo), hi: 1 })
  } else {
    segs.push({ lo: Math.max(0, lo), hi: 1 })
    segs.push({ lo: 0, hi: Math.min(1, hi - 1) })
  }
  return segs.filter((s) => s.hi - s.lo > 1e-6)
}

/** Paint the ring into a preallocated RGBA buffer (width × height × 4). No allocation. */
export function paintBtRgba(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  ring: BtRing,
  opts: {
    centreDeg: number | null
    lut: Uint8Array
    dir: GramDir
    windowS: number
    rowPeriodS: number
  },
): void {
  const { centreDeg, lut, dir, windowS, rowPeriodS } = opts
  const period = Math.max(1e-12, rowPeriodS)
  const w = Math.max(1, width), h = Math.max(1, height)
  for (let y = 0; y < h; y++) {
    const agoRow = Math.floor(agoFromY(y, h, windowS, dir) / period)
    const row = ring.row(agoRow)
    const rowOff = y * w
    for (let x = 0; x < w; x++) {
      const bin = bearingBin(axisFracToBearing((x + 0.5) / w, centreDeg))
      const v = row ? row[bin]! : 0
      const lo = v * 4
      const o = (rowOff + x) * 4
      rgba[o] = lut[lo] ?? 0
      rgba[o + 1] = lut[lo + 1] ?? 0
      rgba[o + 2] = lut[lo + 2] ?? 0
      rgba[o + 3] = 255
    }
  }
}

/** Draw overlay σ-bars on top of a painted BT canvas. Invalid entries are faint. */
export function drawBtOverlays(
  ctx: CanvasRenderingContext2D,
  bars: readonly BtOverlayBar[],
  opts: { width: number; height: number; windowS: number; dir: GramDir; centreDeg: number | null; dpr?: number },
): void {
  const { width, height, windowS, dir, centreDeg } = opts
  const dpr = opts.dpr ?? 1
  for (const bar of bars) {
    const y = yFromAgo(bar.agoS, height, windowS, dir)
    const segs = sigmaBarSegments(bar.bearingDeg, bar.half, centreDeg)
    ctx.save()
    ctx.globalAlpha = bar.valid ? 0.9 : 0.25
    ctx.strokeStyle = bar.valid ? 'rgba(220,255,230,0.95)' : 'rgba(220,255,230,0.7)'
    ctx.lineWidth = Math.max(1, 2 * dpr)
    ctx.beginPath()
    for (const s of segs) {
      ctx.moveTo(s.lo * width, y)
      ctx.lineTo(s.hi * width, y)
    }
    ctx.stroke()
    const x = bearingToAxisFrac(bar.bearingDeg, centreDeg) * width
    ctx.beginPath()
    ctx.arc(x, y, Math.max(1.5, 2.5 * dpr), 0, Math.PI * 2)
    ctx.fillStyle = ctx.strokeStyle
    ctx.fill()
    ctx.restore()
  }
}

export function lutForPalette(id: PaletteId = 'green'): Uint8Array {
  return paletteLut(id)
}
