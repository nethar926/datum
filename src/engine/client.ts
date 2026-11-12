import type { Band, BuoysDropped, DropSource, DropSpec, FromWorker, GramConfig, GramRows, GramSettings, LofarBandPresetId, Tactical, ToWorker } from './contract'
import { engineStartOptions } from '../tactical/buoySequence'
import type { ScenarioParams } from '../scenarios/acousticsApi'
import { HandoffMachine, handoffLabel, type HandoffEvent, type HandoffTarget } from '../gram/handoff'

type RowsListener = (rows: GramRows) => void
/** Gram handoff notices for the waterfall (delivered synchronously, before any later gramRows). */
export type HandoffNotice =
  | { type: 'pending'; gen: number; configs: GramConfig[] }
  | { type: 'drop'; gen: number }
  | { type: 'promote'; gen: number; from: GramConfig[]; to: GramConfig[] }
type HandoffListener = (n: HandoffNotice) => void
/** Fired just before a CUT seek bulk is delivered so the gram can clear its ring. */
export type CutSeekNotice = {
  simT: number; rowCount: number; elapsedMs: number; streamId: number; bins: number
  gen: number; phase: 'first' | 'backfill' | 'done'; fullRows: number; replace: boolean
}
type CutSeekListener = (n: CutSeekNotice) => void
export interface SimStatus { receiver: boolean; scenarioId: string; seed: number; surfaceTraffic: number; params?: ScenarioParams; simT: number; playing: boolean; rate: number; band: Band; configs: GramConfig[]; error?: string; tactical?: Tactical
  /** RES/filter applied at init and by setGram; undefined = legacy 4 Hz gram. */
  gram?: GramSettings
  /** Gram handoff indicator: label stays after the swap with active=false so it can fade out. */
  handoff?: { label: string; active: boolean; gen: number }
  /** m3-fe-drop: the worker's reply to the latest dropBuoys. */
  lastDrop?: BuoysDropped }

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
  private cutSeekListeners = new Set<CutSeekListener>()
  /** True while a seekCut is in flight (Gram uses this to avoid epoch rebuild through backfill). */
  private seekingCut = false
  private cutSeekGen = -1
  private cutSeekAwaitingDone = false
  /** Cached first-paint rows (owned copy) until backfill replaces them. */
  private cutFirstData: Float32Array | null = null
  private cutFirstRowIndex: Uint32Array | null = null
  private cutFirstCount = 0
  private cutFirstBins = 0
  private cutFirstStreamId = 0
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

  start(seed = 7, scenarioId = 'ridgeline-field', band: Band = this.status.band, params: ScenarioParams | undefined = scenarioId === 'generated' ? this.status.params : undefined): void {
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
    if (g0) { this.target = { res: g0.res, filter: g0.filter, ...(g0.band ? { band: g0.band } : {}) }; this.displayed = { ...this.target } }
    if (this.status.handoff) this.setStatus({ handoff: undefined })
    const surfaceTraffic = params ? params.surfaceTraffic : this.status.surfaceTraffic
    this.setStatus({ scenarioId, seed: params?.seed ?? seed, band, simT: 0, configs: [], error: undefined, tactical: undefined, params, surfaceTraffic, lastDrop: undefined })
    // Live DEMON: always subscribe (Sonya). Keep streams running under LOFAR view; FE history owns the buffer.
    // Cuts still pass demon via startCut / ?demon=1 for the CutSession path.
    const cutScenario = typeof scenarioId === 'string' && scenarioId.startsWith('cut:')
    const demonOn = cutScenario
      ? (typeof location !== 'undefined' && new URLSearchParams(location.search).has('demon'))
      : true
    this.send({ type: 'init', seed: params?.seed ?? seed, scenarioId, band, rowRateHz: this.rowRateHz, params, surfaceTraffic, demon: demonOn,
      // Band gram (RES off) or RES gram: the engine keeps the two families exclusive, so send exactly one.
      ...(g0?.band ? { bandPreset: g0.band } : { gram: g0 ? { res: g0.res, filter: g0.filter } : undefined }),
      ...engineStartOptions() })
    if (!this.status.receiver) this.send({ type: 'setReceiver', enabled: false })
    if (!this.raf) { this.last = performance.now(); this.raf = requestAnimationFrame(this.tick) }
  }

  setPlaying(playing: boolean): void { this.setStatus({ playing }) }
  /**
   * CUT scrubber: ask the worker to jump to simT and paint the visible window. Preserves
   * play/pause and rate. No restart + fast-forward animation.
   */
  seekCut(simT: number, windowRows?: number): void {
    if (!this.worker) return
    this.seekingCut = true
    this.cutSeekAwaitingDone = true
    this.inFlight = true // block tick steps until the first-paint round-trip lands
    this.cutFirstData = null
    this.cutFirstRowIndex = null
    this.cutFirstCount = 0
    this.send({ type: 'seekCut', simT, ...(windowRows !== undefined ? { windowRows } : {}) })
  }
  /** Abandon the worker CutSession (back to list / unmount). Idempotent with a later init. */
  disposeCut(): void {
    if (!this.worker) return
    this.seekingCut = false
    this.cutSeekAwaitingDone = false
    this.cutFirstData = null
    this.cutFirstRowIndex = null
    this.cutFirstCount = 0
    this.send({ type: 'disposeCut' })
  }

    /** Subscribe to CUT seek notices (clear gram history / remap stream ids before the bulk rows arrive). */
  onCutSeek(cb: CutSeekListener): () => void { this.cutSeekListeners.add(cb); return () => this.cutSeekListeners.delete(cb) }
  /** True from seekCut() until the matching tactical lands — Gram uses this to avoid an epoch rebuild. */
  isSeekingCut(): boolean { return this.seekingCut }
  private seekStreamIds = new Int32Array(1)
  private seekRowIndex = new Uint32Array(1)
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
  setGram(p: { res?: number; filter?: 'NB' | 'BB'; vernierHz?: number | null; band?: LofarBandPresetId | null }): void {
    const g = this.status.gram
    if (!g) return
    const res = p.res === undefined ? this.target.res : Math.max(1, Math.min(9, Math.round(p.res)))
    const next: HandoffTarget = { res, filter: p.filter ?? this.target.filter }
    const v = p.vernierHz === undefined ? this.target.vernierHz : p.vernierHz === null ? undefined : p.vernierHz
    if (v !== undefined) next.vernierHz = v
    // band: preset id = band gram (RES off); null = back to RES; undefined = keep the current family.
    const band = p.band === undefined ? this.target.band : p.band ?? undefined
    if (band) next.band = band
    this.target = next
    this.setStatus({ gram: { res, filter: next.filter, ...(band ? { band } : {}) } })
    // Handoff needs a running set the engine can replace with a fresh subscribe (RES or band-preset streams).
    const live = this.status.configs.some((c) => c.kind === 'lofar' && (c.res !== undefined || c.bandPreset !== undefined))
    if (!this.worker || !live) {
      if (this.worker && !band && !p.band) this.send({ type: 'setGram', res: p.res === undefined ? undefined : res, filter: p.filter, vernierHz: p.vernierHz })
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
  private dropSeq = 0
  /** m3-fe-drop: lay buoys now (manual or AUTO). Returns the request seq echoed in status.lastDrop. */
  dropBuoys(buoys: DropSpec[], source: DropSource = 'manual'): number {
    const seq = ++this.dropSeq
    this.send({ type: 'dropBuoys', seq, source, buoys })
    return seq
  }
  setBand(band: Band): void { if (band !== this.status.band) this.start(this.status.seed, this.status.scenarioId, band) }

  onRows(cb: RowsListener): () => void { this.rowsListeners.add(cb); return () => this.rowsListeners.delete(cb) }
  subscribe = (cb: () => void): (() => void) => { this.statusListeners.add(cb); return () => this.statusListeners.delete(cb) }
  getStatus = (): SimStatus => this.status

  dispose(): void {
    cancelAnimationFrame(this.raf); this.raf = 0
    this.stopWorker()
    this.handoff.cancel()
    this.rowsListeners.clear(); this.statusListeners.clear(); this.handoffListeners.clear(); this.cutSeekListeners.clear()
  }

  private stopWorker(): void { this.worker?.terminate(); this.worker = undefined }
  private send(m: ToWorker, t: Transferable[] = []): void { this.worker?.postMessage(m, t) }
  private notify(n: HandoffNotice): void { for (const l of this.handoffListeners) l(n) }

  private apply(e: HandoffEvent): void {
    if (e.type === 'subscribe') {
      this.pendingTarget = e.target
      const t = e.target
      this.send(t.band ? { type: 'subscribeGram', gen: e.gen, bandPreset: t.band }
        : { type: 'subscribeGram', gen: e.gen, res: t.res, filter: t.filter, ...(t.vernierHz !== undefined ? { vernierHz: t.vernierHz } : {}) })
    } else if (e.type === 'drop') {
      this.pendingTarget = undefined
      this.send({ type: 'dropGram', gen: e.gen }); this.notify({ type: 'drop', gen: e.gen })
    } else {
      // Atomic swap: the waterfall flips buffers inside notify(), before any later rows are delivered.
      const from = this.status.configs.filter((c) => c.kind === 'lofar'), rest = this.status.configs.filter((c) => c.kind !== 'lofar')
      if (this.pendingTarget) this.displayed = { ...this.pendingTarget, filter: this.target.filter }
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
    if (this.status.playing && this.status.configs.length && !this.status.error && !this.seekingCut) {
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
      case 'cutSeeked': {
        // Stale backfill from a superseded scrub — ignore.
        if (m.phase !== 'first' && m.gen !== this.cutSeekGen && this.cutSeekGen >= 0 && m.gen < this.cutSeekGen) break
        if (m.phase === 'first') this.cutSeekGen = m.gen

        const bins = m.bins, n = m.rowCount
        // First paint: keep an owned copy so later backfill messages can prepend older history.
        if (m.phase === 'first') {
          this.cutFirstData = new Float32Array(n * bins)
          if (n) this.cutFirstData.set(m.data.subarray(0, n * bins))
          this.cutFirstRowIndex = new Uint32Array(n)
          if (n) this.cutFirstRowIndex.set(m.rowIndex.subarray(0, n))
          this.cutFirstCount = n
          this.cutFirstBins = bins
          this.cutFirstStreamId = m.streamId
          this.cutSeekAwaitingDone = m.fullRows > n
        }

        const connected = m.phase !== 'first' && n >= Math.max(0, m.fullRows - this.cutFirstCount)
        const replace = m.phase === 'first' || m.phase === 'done' || m.phase === 'backfill'
        const notice = {
          simT: m.simT, rowCount: n, elapsedMs: m.elapsedMs, streamId: m.streamId, bins,
          gen: m.gen, phase: m.phase, fullRows: m.fullRows, replace,
        }
        for (const l of this.cutSeekListeners) l(notice)

        const push = (streamId: number, rowIndex: number, data: Float32Array, simT: number) => {
          this.seekStreamIds[0] = streamId
          this.seekRowIndex[0] = rowIndex
          const rows: GramRows = {
            v: 1, type: 'gramRows', simT,
            streamIds: this.seekStreamIds, rowIndex: this.seekRowIndex, data,
          }
          for (const l of this.rowsListeners) l(rows)
        }

        if (m.phase === 'first' || m.phase === 'done' || connected) {
          // Paint the message rows alone (first = newest window; done/connected = full chronological).
          for (let i = 0; i < n; i++) push(m.streamId, m.rowIndex[i]!, m.data.subarray(i * bins, (i + 1) * bins), m.simT)
        } else if (m.phase === 'backfill') {
          // Older prefix + cached first-paint newest (gap closes as backfill catches up).
          for (let i = 0; i < n; i++) push(m.streamId, m.rowIndex[i]!, m.data.subarray(i * bins, (i + 1) * bins), m.simT)
          const fd = this.cutFirstData, fi = this.cutFirstRowIndex
          if (fd && fi) {
            const fb = this.cutFirstBins
            for (let i = 0; i < this.cutFirstCount; i++) {
              push(m.streamId, fi[i]!, fd.subarray(i * fb, (i + 1) * fb), m.simT)
            }
          }
        }

        this.setStatus({ simT: m.simT })
        if (m.phase === 'done' || (m.phase === 'first' && !this.cutSeekAwaitingDone)) {
          this.cutSeekAwaitingDone = false
          // seekingCut clears on the trailing tactical (or here if none follows a lone first).
        }
        if (m.phase === 'done') {
          this.cutFirstData = null
          this.cutFirstRowIndex = null
          this.cutFirstCount = 0
          this.seekingCut = false
          this.inFlight = false
        }
        break
      }
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
      case 'tactical': // last message of a step / seek (after every gramRows), so it ends the in-flight step
        this.inFlight = false
        if (!this.cutSeekAwaitingDone) this.seekingCut = false
        this.track.push(m.aircraft.x, m.aircraft.y)
        this.setStatus({ simT: m.simT, tactical: m })
        break
      case 'dropped': this.setStatus({ lastDrop: m }); break
      case 'error': this.inFlight = false; this.seekingCut = false; this.setStatus({ error: m.message, playing: false }); break
    }
  }
}
