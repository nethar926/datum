/** App-side controller for Sonya's chunked beginDrain / pumpDrain / cancelDrain.
 * Draw keys off filledFrom, never NaN: unfilled rows (k < filledFrom) are a clear "filling" state.
 * Every start() cancels the previous handle and drops the listener so a switch-back cannot mix rows or leak. */
import { isResLevel, type AcousticEngine, type DrainHandle, type DrainState, type ResLevel } from '@acoustics'

export const FILLING_SENTINEL = 1e10
export const FILLING_SENTINEL_THRESHOLD = 1e9
/** Cool slate, distinct from black (0,0,0) and the NaN gap (0.06, 0.06, 0.07). */
export const FILLING_COLOR = [0.10, 0.18, 0.26, 1] as const

export type DrainRowKind = 'filling' | 'ready'

export function drainKind(index: number, filledFrom: number): DrainRowKind {
  return index >= filledFrom ? 'ready' : 'filling'
}

/** Age 0 is newest (oldest-first index totalRows - 1). */
export function drainKindAge(age: number, totalRows: number, filledFrom: number): DrainRowKind {
  return drainKind(totalRows - 1 - age, filledFrom)
}

export function isFillingValue(v: number): boolean {
  return Number.isFinite(v) && v > FILLING_SENTINEL_THRESHOLD
}

export function drainAge(index: number, totalRows: number): number { return totalRows - 1 - index }

export function landedRange(fromRow: number, toRow: number, totalRows: number): [number, number] | null {
  if (totalRows <= 0) return null
  const lo = Math.max(0, Math.min(fromRow, toRow))
  const hi = Math.min(totalRows - 1, Math.max(fromRow, toRow))
  return lo <= hi ? [lo, hi] : null
}

export type DrainEvent = {
  streamId: number
  streamIndex: number
  handleId: number
  fromRow: number
  toRow: number
  filledFrom: number
  totalRows: number
  state: DrainState
  /** Landed rows only, packed oldest-first, length = (toRow - fromRow + 1) * bins when rows exist. */
  bins: number
  data: Float32Array
  bearingDeg?: Float32Array
}

export class HistoryDrain {
  private handle: DrainHandle | undefined
  private progress: ((ev: DrainEvent) => void) | undefined
  streamIndex = 0
  constructor(private readonly engine: AcousticEngine) {}

  get isRunning(): boolean { return this.handle?.state === 'running' }
  get state(): DrainState | undefined { return this.handle?.state }
  get handleId(): number | undefined { return this.handle?.id }
  get filledFrom(): number | undefined { return this.handle?.filledFrom }
  get totalRows(): number { return this.handle?.rows.length ?? 0 }
  get streamId(): number | undefined { return this.handle?.streamId }

  start(streamId: number, res: number | null, totalRows: number, visibleRows: number, streamIndex = 0, onProgress?: (ev: DrainEvent) => void): DrainEvent | undefined {
    this.release()
    this.streamIndex = streamIndex
    this.progress = onProgress
    if (res !== null && !isResLevel(res)) throw new Error(`beginDrain: invalid res ${res}`)
    const drainRes: ResLevel | null = res
    const h = this.engine.beginDrain(streamId, drainRes, totalRows, {
      onDrainProgress: (handle, from, to) => {
        const ev = eventFrom(handle, from, to, this.streamIndex)
        this.progress?.(ev)
      },
    })
    this.handle = h
    if (h.state === 'running') this.engine.pumpDrain(h, { maxRows: Math.max(1, visibleRows) })
    return this.snapshot()
  }

  pump(opts?: { budgetMs?: number; maxRows?: number }): DrainEvent | undefined {
    if (!this.handle || this.handle.state !== 'running') return this.snapshot()
    this.engine.pumpDrain(this.handle, opts ?? { budgetMs: 16 })
    return this.snapshot()
  }

  /** Freeze the handle and drop the listener; the frozen handle stays readable until start/release. */
  cancel(): void {
    if (this.handle) this.engine.cancelDrain(this.handle)
    this.progress = undefined
  }

  release(): void {
    this.cancel()
    this.handle = undefined
  }

  snapshot(): DrainEvent | undefined {
    const h = this.handle
    if (!h) return undefined
    const from = h.filledFrom
    const to = Math.max(from, h.rows.length) - 1
    return eventFrom(h, from, to, this.streamIndex)
  }
}

function eventFrom(h: DrainHandle, from: number, to: number, streamIndex: number): DrainEvent {
  const total = h.rows.length
  const range = landedRange(from, to, total)
  const bins = h.rows[0]?.data.length ?? 0
  const n = range ? range[1] - range[0] + 1 : 0
  const data = new Float32Array(n * bins)
  let bearingDeg: Float32Array | undefined
  if (range) {
    for (let i = 0; i < n; i++) {
      const row = h.rows[range[0] + i]!
      data.set(row.data, i * bins)
      if (row.bearingDeg) {
        if (!bearingDeg) bearingDeg = new Float32Array(n * bins)
        bearingDeg.set(row.bearingDeg, i * bins)
      }
    }
  }
  return { streamId: h.streamId, streamIndex, handleId: h.id, fromRow: from, toRow: to, filledFrom: h.filledFrom, totalRows: total, state: h.state, bins, data, bearingDeg }
}

/** CPU ring (newest at the end) used by tests and as a model for the GL / LevelHistory apply. */
export function seedFillingRing(rows: number, bins: number): Float32Array {
  return new Float32Array(rows * bins).fill(FILLING_SENTINEL)
}

/** Write landed rows into an oldest-first-seeded ring (age 0 = last row). Keys off filledFrom, not NaN. */
export function applyLandedToRing(ring: Float32Array, rows: number, bins: number, ev: { data: Float32Array; bins: number; fromRow: number; toRow: number; filledFrom: number; totalRows: number }, liveOffset = 0): number[] {
  const dirty: number[] = []
  const range = landedRange(ev.fromRow, ev.toRow, ev.totalRows)
  if (!range) return dirty
  const n = range[1] - range[0] + 1
  for (let i = 0; i < n; i++) {
    const k = range[0] + i
    if (drainKind(k, ev.filledFrom) !== 'ready') continue
    const age = drainAge(k, ev.totalRows) + liveOffset
    if (age < 0 || age >= rows) continue
    const destRow = (rows - 1 - age) // seed was oldest-first into 0..rows-1, last index is newest
    const srcOff = i * ev.bins
    const dstOff = destRow * bins
    for (let b = 0; b < bins && b < ev.bins; b++) ring[dstOff + b] = ev.data[srcOff + b]!
    dirty.push(destRow)
  }
  return dirty
}
