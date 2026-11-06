import type { Band, FromWorker, GramConfig, GramRows, GramSettings, Tactical, ToWorker } from './contract'
import type { ScenarioParams } from '../scenarios/acousticsApi'
import { HandoffMachine, handoffLabel, type HandoffEvent, type HandoffTarget } from '../gram/handoff'

type RowsListener = (rows: GramRows) => void
/** Gram handoff notices for the waterfall (delivered synchronously, before any later gramRows). */
export type HandoffNotice =
  | { type: 'pending'; gen: number; configs: GramConfig[] }
  | { type: 'drop'; gen: number }
  | { type: 'promote'; gen: number; from: GramConfig[]; to: GramConfig[] }
type HandoffListener = (n: HandoffNotice) => void
export interface SimStatus { receiver: boolean; scenarioId: string; seed: number; surfaceTraffic: number; params?: ScenarioParams; simT: number; playing: boolean; rate: number; band: Band; configs: GramConfig[]; error?: string; tactical?: Tactical
  /** RES/filter applied at init and by setGram; undefined = legacy 4 Hz gram. */
  gram?: GramSettings
  /** Gram handoff indicator: label stays after the swap with active=false so it can fade out. */
  handoff?: { label: string; active: boolean; gen: number } }

/** Track history for the plot: fixed-size ring of x,y pairs. */
export class TrackRing {
  readonly xy: Float32Array; private head = 0; count = 0
  constructor(readonly capacity: number) { this.xy = new Float32Array(capacity * 2) }
  push(x: number, y: number): void { this.xy[this.head * 2] = x; this.xy[this.head * 2 + 1] = y; this.head = (this.head + 1) % this.capacity; this.count = Math.min(this.capacity, this.count + 1) }
  /** i = 0 is the oldest point. */
  at(i: number, out: { x: number; y: number }): void { const k = (this.head - this.count + i + this.capacity) % this.capacity; out.x = this.xy[k * 2]; out.y = this.xy[k * 2 + 1] }
  clear(): void { this.head = 0; this.count = 0 }
}

/**
 * Main-thread side: owns the Worker, the sim clock (rAF), and buffer release. One step in flight at a time,
 * so a slow frame never queues work; rows are released straight after listeners upload them.
 */
export class SimClient {
  private worker?: Worker
  private rowsListeners = new Set<RowsListener>()
  private statusListeners = new Set<() => void>()
  private raf = 0
  private last = 0
  private acc = 0
  private inFlight = false
  private rowRateHz = 2
  private releaseBufs: ArrayBuffer[] = []
  private handoffListeners = new Set<HandoffListener>()
  /** Gram handoff state machine; `displayed` = settings of the stream set on screen, `target` = latest request. */
  readonly handoff: HandoffMachine
  private displayed: HandoffTarget = { res: 5, filter: 'NB' }
  private target: HandoffTarget = { res: 5, filter: 'NB' }
  private pendingTarget?: HandoffTarget
  private lastPct = -1
  readonly track = new TrackRing(1200)
  status: SimStatus = { receiver: true, scenarioId: 'ridgeline-field', seed: 7, surfaceTraffic: 0.5, simT: 0, playing: false, rate: 4, band: 'lofar1k', configs: [], gram: { res: 5, filter: 'NB' } }

  constructor(private readonly makeWorker: () => Worker = () => new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' }),
    handoff?: HandoffMachine, private readonly now: () => number = () => performance.now()) { this.handoff = handoff ?? new HandoffMachine() }

  start(seed = 7, scenarioId = 'ridgeline-field', band: Band = this.status.band, params: ScenarioParams | undefined = this.status.params): void {
    this.stopWorker()
    this.track.clear()
    this.worker = this.makeWorker()
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.onMessage(e.data)
    this.worker.onerror = (e) => this.setStatus({ error: e.message || 'Worker failed', playing: false })
    this.inFlight = false; this.acc = 0
    // A restart drops any handoff (its streams died with the old worker); init carries RES + filter, no vernier.
    if (this.handoff.phase === 'pending') { const gen = this.handoff.gen; this.handoff.cancel(); this.notify({ type: 'drop', gen }) }
    this.handoff.cancel(); this.pendingTarget = undefined; this.lastPct = -1
    const g0 = this.status.gram
    if (g0) { this.target = { res: g0.res, filter: g0.filter }; this.displayed = { ...this.target } }
    if (this.status.handoff) this.setStatus({ handoff: undefined })
    const surfaceTraffic = params ? params.surfaceTraffic : this.status.surfaceTraffic
    this.setStatus({ scenarioId, seed: params?.seed ?? seed, band, simT: 0, configs: [], error: undefined, tactical: undefined, params, surfaceTraffic })
    this.send({ type: 'init', seed: params?.seed ?? seed, scenarioId, band, rowRateHz: this.rowRateHz, params, surfaceTraffic, demon: false, gram: this.status.gram })
    if (!this.status.receiver) this.send({ type: 'setReceiver', enabled: false })
    if (!this.raf) { this.last = performance.now(); this.raf = requestAnimationFrame(this.tick) }
  }

  setPlaying(playing: boolean): void { this.setStatus({ playing }) }
  setRate(rate: number): void { this.setStatus({ rate: Math.max(0.25, Math.min(32, rate)) }) }
  /** Live surface-traffic (shipping noise) level, 0 none … 1 heavy. */
  setSurfaceTraffic(value: number): void {
    const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0.5))
    this.setStatus({ surfaceTraffic: v })
    this.send({ type: 'setSurfaceTraffic', value: v })
  }
  /** Realistic receiver front end (AGC, finite dynamic range, clipping) on/off. */
  setReceiver(enabled: boolean): void { this.setStatus({ receiver: enabled }); this.send({ type: 'setReceiver', enabled }) }
  /**
   * RES level / NB-BB filter / vernier centre for every LOFAR stream. On a running RES gram this is a handoff:
   * a pending stream set fills alongside the displayed one and is swapped in by tick() (never a blank gram).
   * Before the first streams (or on a legacy gram) it applies directly.
   */
  setGram(p: { res?: number; filter?: 'NB' | 'BB'; vernierHz?: number | null }): void {
    const g = this.status.gram
    if (!g) return
    const res = p.res === undefined ? this.target.res : Math.max(1, Math.min(9, Math.round(p.res)))
    const next: HandoffTarget = { res, filter: p.filter ?? this.target.filter }
    const v = p.vernierHz === undefined ? this.target.vernierHz : p.vernierHz === null ? undefined : p.vernierHz
    if (v !== undefined) next.vernierHz = v
    this.target = next
    this.setStatus({ gram: { res, filter: next.filter } })
    const resGram = this.status.configs.some((c) => c.kind === 'lofar' && c.res !== undefined)
    if (!this.worker || !resGram) {
      if (this.worker) this.send({ type: 'setGram', ...p, ...(p.res !== undefined ? { res } : {}) })
      this.displayed = { ...next }
      return
    }
    for (const e of this.handoff.begin(this.displayed, next, this.now())) this.apply(e)
    this.updateIndicator(true)
  }
  /** Subscribe to gram handoff notices (pending / drop / promote). */
  onHandoff(cb: HandoffListener): () => void { this.handoffListeners.add(cb); return () => this.handoffListeners.delete(cb) }
  /** Pending configs while a handoff is announced (a waterfall mounting mid-handoff picks these up). */
  pendingConfigs(): GramConfig[] | undefined { return this.handoff.phase === 'pending' ? this.handoff.configs : undefined }
  setBand(band: Band): void { if (band !== this.status.band) this.start(this.status.seed, this.status.scenarioId, band) }

  onRows(cb: RowsListener): () => void { this.rowsListeners.add(cb); return () => this.rowsListeners.delete(cb) }
  subscribe = (cb: () => void): (() => void) => { this.statusListeners.add(cb); return () => this.statusListeners.delete(cb) }
  getStatus = (): SimStatus => this.status

  dispose(): void {
    cancelAnimationFrame(this.raf); this.raf = 0
    this.stopWorker()
    this.handoff.cancel()
    this.rowsListeners.clear(); this.statusListeners.clear(); this.handoffListeners.clear()
  }

  private stopWorker(): void { this.worker?.terminate(); this.worker = undefined }
  private send(m: ToWorker, t: Transferable[] = []): void { this.worker?.postMessage(m, t) }
  private notify(n: HandoffNotice): void { for (const l of this.handoffListeners) l(n) }

  private apply(e: HandoffEvent): void {
    if (e.type === 'subscribe') {
      this.pendingTarget = e.target
      this.send({ type: 'subscribeGram', gen: e.gen, res: e.target.res, filter: e.target.filter, ...(e.target.vernierHz !== undefined ? { vernierHz: e.target.vernierHz } : {}) })
    } else if (e.type === 'drop') {
      this.pendingTarget = undefined
      this.send({ type: 'dropGram', gen: e.gen }); this.notify({ type: 'drop', gen: e.gen })
    } else {
      // Atomic swap: the waterfall flips buffers inside notify(), before any later rows are delivered.
      const from = this.status.configs.filter((c) => c.kind === 'lofar'), rest = this.status.configs.filter((c) => c.kind !== 'lofar')
      if (this.pendingTarget) this.displayed = this.pendingTarget
      this.pendingTarget = undefined
      this.notify({ type: 'promote', gen: e.gen, from, to: e.configs })
      this.setStatus({ configs: [...e.configs, ...rest] })
      this.send({ type: 'promoteGram', gen: e.gen })
    }
  }

  /** Indicator: allocates only when the shown percent (or phase) changes. */
  private updateIndicator(force = false): void {
    const h = this.handoff
    if (h.phase !== 'pending') {
      if (this.status.handoff?.active) this.setStatus({ handoff: { ...this.status.handoff, active: false } })
      this.lastPct = -1; return
    }
    const pct = Math.round(h.progress() * 100)
    if (!force && pct === this.lastPct) return
    this.lastPct = pct
    this.setStatus({ handoff: { label: handoffLabel(h.from!, h.to!, h.progress()), active: true, gen: h.gen } })
  }

  private setStatus(p: Partial<SimStatus>): void { this.status = { ...this.status, ...p }; for (const l of this.statusListeners) l() }

  private tick = (now: number): void => {
    const dt = Math.min(0.25, (now - this.last) / 1000)
    this.last = now
    if (this.status.playing && this.status.configs.length && !this.status.error) {
      this.acc = Math.min(this.acc + dt * this.status.rate, 4 / this.rowRateHz)
      if (!this.inFlight && this.acc >= 1 / this.rowRateHz) { this.acc -= 1 / this.rowRateHz; this.inFlight = true; this.send({ type: 'step' }) }
    }
    this.pollHandoff(now)
    this.raf = requestAnimationFrame(this.tick)
  }

  /** Per-frame handoff check (no allocation unless something changes). Public for tests. */
  pollHandoff(now = this.now()): void {
    if (this.handoff.phase !== 'pending') return
    const e = this.handoff.tick(now)
    if (e) { this.apply(e); this.updateIndicator() } else this.updateIndicator()
  }

  private onMessage(m: FromWorker): void {
    switch (m.type) {
      case 'streams': this.setStatus({ configs: m.configs, error: undefined }); break
      case 'pendingStreams':
        if (this.handoff.announce(m.gen, m.configs)) { this.notify({ type: 'pending', gen: m.gen, configs: m.configs }); this.updateIndicator(true) }
        else this.send({ type: 'dropGram', gen: m.gen }) // superseded: make sure the worker lets it go
        break
      case 'gramRows': {
        if (this.handoff.phase === 'pending') for (let k = 0; k < m.streamIds.length; k++) { const id = m.streamIds[k]; if (id > 0) this.handoff.row(id) }
        for (const l of this.rowsListeners) l(m)
        const bufs = this.releaseBufs
        bufs.length = 0
        bufs.push(m.streamIds.buffer as ArrayBuffer, m.rowIndex.buffer as ArrayBuffer, m.data.buffer as ArrayBuffer)
        if (m.bearingDeg) bufs.push(m.bearingDeg.buffer as ArrayBuffer)
        this.send({ type: 'release', buffers: bufs }, bufs)
        break
      }
      case 'tactical': // last message of a step (after every gramRows), so it ends the in-flight step
        this.inFlight = false
        this.track.push(m.aircraft.x, m.aircraft.y)
        this.setStatus({ simT: m.simT, tactical: m })
        break
      case 'error': this.inFlight = false; this.setStatus({ error: m.message, playing: false }); break
    }
  }
}
