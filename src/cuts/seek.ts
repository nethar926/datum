/**
 * FE-side CUT seek (no acoustics/ edits).
 *
 * Two-phase UX:
 *   1. First paint — newest FIRST_ROWS via skip-ahead (~100 ms). Geometry/tonals at the
 *      target time are correct; LOFAR rowIndex/noise seed is approximate until backfill.
 *   2. Deterministic backfill — write every LOFAR row from t=0 (discarding until the
 *      visible window), keeping the last FULL_ROWS. Byte-identical to normal playback.
 *      Chunked for idle slices; a generation token cancels in-flight work.
 *
 * Why not skip-ahead for the final window? LofarGenerator seeds each row by an internal
 * rowIndex++, so skipping writeRow changes the noise field. Matching playback requires
 * writing every due row (to a scratch/ring) from t=0.
 */
import {
  applyRuntimeFidelity,
  looksOf,
  renderCut,
  type CutSession,
  type TonalLine,
} from '@acoustics'
import { rowRateHz } from '../gram/rowPeriod'

/** Newest rows painted immediately after a scrub (4 Hz × 30 s). */
export const CUT_SEEK_FIRST_ROWS = 120
/** Full visible history to backfill (matches Gram default historyRows). */
export const CUT_SEEK_FULL_ROWS = 600
/** Rows written per idle backfill slice. */
export const CUT_SEEK_CHUNK_ROWS = 64
/** @deprecated alias — first-paint window */
export const CUT_SEEK_WINDOW_ROWS = CUT_SEEK_FIRST_ROWS


/** Idempotent teardown for an Acoustics CutSession (no-op if null/already disposed). */
export function disposeCutSession(session: CutSession | null | undefined): void {
  if (session && !session.isDisposed) session.dispose()
}


export interface CutSeekBuffers {
  /** rowCount × bins, row-major (oldest → newest) once compacted. */
  data: Float32Array
  rowIndex: Uint32Array
  bearingDeg?: Float32Array
}


type CpuSnap = { user: number; system: number }

/** Main-thread CPU snapshot (Node). null in the browser. */
function threadCpuStart(): CpuSnap | null {
  const proc = (globalThis as { process?: { threadCpuUsage?: (prev?: CpuSnap) => CpuSnap } }).process
  return proc?.threadCpuUsage?.() ?? null
}

function threadCpuMs(start: CpuSnap | null): number {
  const proc = (globalThis as { process?: { threadCpuUsage?: (prev?: CpuSnap) => CpuSnap } }).process
  if (!start || !proc?.threadCpuUsage) return 0
  const used = proc.threadCpuUsage(start)
  return (used.user + used.system) / 1000
}

export interface CutSeekResult {
  session: CutSession
  simT: number
  rowCount: number
  bins: number
  streamId: number
  elapsedMs: number
  /** Main-thread CPU time (ms) of this fill; 0 when threadCpuUsage is unavailable. */
  cpuMs: number
}

function rampBasesFor(session: CutSession): Map<TonalLine, number> {
  const bases = new Map<TonalLine, number>()
  if (!looksOf(session.cut).has('propulsion-ramp')) return bases
  const contact =
    session.engine.scenario.contacts.find((c) => c.category !== 'surface') ??
    session.engine.scenario.contacts[0]
  for (const l of contact.params.tonals ?? []) if (l.lineFamily === 'EDA') bases.set(l, l.power)
  return bases
}

function contactOf(session: CutSession) {
  return (
    session.engine.scenario.contacts.find((c) => c.category !== 'surface') ??
    session.engine.scenario.contacts[0]
  )
}

function ensureCapacity(out: CutSeekBuffers, windowRows: number, bins: number): void {
  const need = windowRows * bins
  if (out.data.length < need) out.data = new Float32Array(need)
  if (out.rowIndex.length < windowRows) out.rowIndex = new Uint32Array(windowRows)
  if (out.bearingDeg && out.bearingDeg.length < need) out.bearingDeg = new Float32Array(need)
}

/**
 * Fast first-paint fill: skip-ahead to the newest window (approximate noise seed).
 * Used only for the instant scrub response; backfill replaces it with a deterministic window.
 */
export function fillCutSeekFast(
  cutId: string,
  targetS: number,
  out: CutSeekBuffers,
  windowRows = CUT_SEEK_FIRST_ROWS,
): CutSeekResult {
  const t0 = performance.now()
  const cpu0 = threadCpuStart()
  const session = renderCut(cutId)
  const eng = session.engine
  const sid = session.lofar.streamId
  const bins = session.lofar.bins
  const rowHz = rowRateHz(session.lofar, undefined, 0.25)
  const rowDt = 1 / rowHz
  const dur = session.cut.durationS
  const target = Math.max(0, Math.min(dur, Number.isFinite(targetS) ? targetS : 0))
  const winStart = Math.max(0, target - windowRows / rowHz)
  const contact = contactOf(session)
  const rampBases = rampBasesFor(session)
  const fidelity = (t: number) => applyRuntimeFidelity(contact.params, session.cut, t, rampBases)
  ensureCapacity(out, windowRows, bins)

  while (eng.time + 1e-9 < winStart) {
    const dt = Math.min(2, winStart - eng.time)
    eng.advance(dt)
    fidelity(eng.time)
  }
  if (eng.rowsReady(sid) > 0) eng.skipToLatest(sid)
  if (session.demonStreamId && eng.rowsReady(session.demonStreamId) > 0) eng.skipToLatest(session.demonStreamId)

  let n = 0
  while (n < windowRows && eng.time + 1e-9 < target + rowDt * 0.5) {
    while (eng.rowsReady(sid) === 0 && eng.time + 1e-9 < target) {
      const dt = Math.min(rowDt, Math.max(1e-4, target - eng.time))
      eng.advance(dt)
      fidelity(eng.time)
      if (dt <= 1e-4) break
    }
    if (eng.rowsReady(sid) === 0) break
    out.rowIndex[n] = eng.writeRow(sid, out.data, n * bins)
    if (session.demonStreamId && eng.rowsReady(session.demonStreamId) > 0) eng.skipToLatest(session.demonStreamId)
    n++
  }
  if (eng.time + 1e-9 < target) {
    eng.advance(target - eng.time)
    fidelity(eng.time)
  }
  return { session, simT: eng.time, rowCount: n, bins, streamId: sid, elapsedMs: performance.now() - t0, cpuMs: threadCpuMs(cpu0) }
}

/** @deprecated — use fillCutSeekFast for first paint; CutSeekPlayback for deterministic windows. */
export function fillCutSeek(
  cutId: string,
  targetS: number,
  out: CutSeekBuffers,
  windowRows = CUT_SEEK_FIRST_ROWS,
): CutSeekResult {
  return fillCutSeekFast(cutId, targetS, out, windowRows)
}

/**
 * Deterministic playback fill: write every LOFAR row from t=0 up to target, keeping the
 * last `windowRows` in a ring (then compacted oldest→newest into `out`). Chunkable.
 */
export class CutSeekPlayback {
  readonly session: CutSession
  readonly out: CutSeekBuffers
  readonly targetS: number
  readonly windowRows: number
  readonly bins: number
  readonly streamId: number
  private readonly contact: ReturnType<typeof contactOf>
  private readonly rampBases: Map<TonalLine, number>
  private readonly scratch: Float32Array
  private head = 0
  private written = 0
  private compacted = false
  private readonly t0: number
  private readonly cpu0: CpuSnap | null

  constructor(cutId: string, targetS: number, out: CutSeekBuffers, windowRows: number) {
    this.t0 = performance.now()
    this.cpu0 = threadCpuStart()
    this.session = renderCut(cutId)
    this.out = out
    this.windowRows = windowRows
    this.bins = this.session.lofar.bins
    this.streamId = this.session.lofar.streamId
    const dur = this.session.cut.durationS
    this.targetS = Math.max(0, Math.min(dur, Number.isFinite(targetS) ? targetS : 0))
    this.contact = contactOf(this.session)
    this.rampBases = rampBasesFor(this.session)
    ensureCapacity(out, windowRows, this.bins)
    // Ring lives in out.data; compaction copies to linear order at finish.
    this.scratch = out.data
  }

  private fidelity(t: number): void {
    applyRuntimeFidelity(this.contact.params, this.session.cut, t, this.rampBases)
  }

  get rowCount(): number { return Math.min(this.windowRows, this.written) }
  get done(): boolean {
    return this.session.simT + 1e-9 >= this.targetS || this.session.done
  }
  get elapsedMs(): number { return performance.now() - this.t0 }
  get cpuMs(): number { return threadCpuMs(this.cpu0) }
  get totalWritten(): number { return this.written }

  /** Write up to `maxRows` more rows into the ring. Returns rows written this call. */
  writeMore(maxRows: number): number {
    if (this.compacted) return 0
    let n = 0
    const bins = this.bins
    const keep = this.windowRows
    while (n < maxRows && !this.done) {
      const slot = this.head % keep
      const off = slot * bins
      const idx = this.session.writeLofarRow(this.scratch, off)
      if (idx < 0) break
      this.out.rowIndex[slot] = idx
      // Fidelity is applied inside CutSession.writeLofarRow for ramp cuts.
      this.head++
      this.written++
      n++
    }
    return n
  }

  /** Compact the ring to oldest→newest at offset 0. Idempotent. */
  compact(): void {
    if (this.compacted) return
    const keep = Math.min(this.windowRows, this.written)
    if (keep === 0) { this.compacted = true; return }
    if (this.written <= this.windowRows) {
      // Already linear 0..written-1
      this.compacted = true
      return
    }
    const bins = this.bins
    const linear = new Float32Array(keep * bins)
    const linearIdx = new Uint32Array(keep)
    const start = this.head - keep
    for (let i = 0; i < keep; i++) {
      const slot = (start + i) % this.windowRows
      linear.set(this.scratch.subarray(slot * bins, (slot + 1) * bins), i * bins)
      linearIdx[i] = this.out.rowIndex[slot]!
    }
    this.out.data.set(linear, 0)
    this.out.rowIndex.set(linearIdx, 0)
    this.compacted = true
  }


  /** Tear down this fill's session (e.g. abandoned backfill). Idempotent. */
  dispose(): void {
    disposeCutSession(this.session)
  }

  finish(): CutSeekResult {
    while (!this.done) this.writeMore(256)
    this.compact()
    return {
      session: this.session,
      simT: this.session.simT,
      rowCount: this.rowCount,
      bins: this.bins,
      streamId: this.streamId,
      elapsedMs: this.elapsedMs,
      cpuMs: this.cpuMs,
    }
  }
}

/** One-shot deterministic window (tests / reference). */
export function playbackWindow(
  cutId: string,
  targetS: number,
  out: CutSeekBuffers,
  keepRows: number,
): CutSeekResult {
  return new CutSeekPlayback(cutId, targetS, out, keepRows).finish()
}

/** Alias used by host backfill — deterministic full-window fill. */
export const CutSeekFill = CutSeekPlayback
