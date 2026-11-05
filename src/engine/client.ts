import type { Band, FromWorker, GramConfig, GramRows, Tactical, ToWorker } from './contract'

type RowsListener = (rows: GramRows) => void
export interface SimStatus { simT: number; playing: boolean; rate: number; band: Band; configs: GramConfig[]; error?: string; tactical?: Tactical }

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
  readonly track = new TrackRing(1200)
  status: SimStatus = { simT: 0, playing: false, rate: 4, band: 'lofar1k', configs: [] }

  constructor(private readonly makeWorker: () => Worker = () => new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' })) {}

  start(seed = 7, scenarioId = 'ridgeline-field', band: Band = this.status.band): void {
    this.stopWorker()
    this.track.clear()
    this.worker = this.makeWorker()
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.onMessage(e.data)
    this.worker.onerror = (e) => this.setStatus({ error: e.message || 'Worker failed', playing: false })
    this.inFlight = false; this.acc = 0
    this.setStatus({ band, simT: 0, configs: [], error: undefined, tactical: undefined })
    this.send({ type: 'init', seed, scenarioId, band, rowRateHz: this.rowRateHz })
    if (!this.raf) { this.last = performance.now(); this.raf = requestAnimationFrame(this.tick) }
  }

  setPlaying(playing: boolean): void { this.setStatus({ playing }) }
  setRate(rate: number): void { this.setStatus({ rate: Math.max(0.25, Math.min(32, rate)) }) }
  setBand(band: Band): void { if (band !== this.status.band) this.start(7, 'ridgeline-field', band) }

  onRows(cb: RowsListener): () => void { this.rowsListeners.add(cb); return () => this.rowsListeners.delete(cb) }
  subscribe = (cb: () => void): (() => void) => { this.statusListeners.add(cb); return () => this.statusListeners.delete(cb) }
  getStatus = (): SimStatus => this.status

  dispose(): void {
    cancelAnimationFrame(this.raf); this.raf = 0
    this.stopWorker()
    this.rowsListeners.clear(); this.statusListeners.clear()
  }

  private stopWorker(): void { this.worker?.terminate(); this.worker = undefined }
  private send(m: ToWorker, t: Transferable[] = []): void { this.worker?.postMessage(m, t) }
  private setStatus(p: Partial<SimStatus>): void { this.status = { ...this.status, ...p }; for (const l of this.statusListeners) l() }

  private tick = (now: number): void => {
    const dt = Math.min(0.25, (now - this.last) / 1000)
    this.last = now
    if (this.status.playing && this.status.configs.length && !this.status.error) {
      this.acc = Math.min(this.acc + dt * this.status.rate, 4 / this.rowRateHz)
      if (!this.inFlight && this.acc >= 1 / this.rowRateHz) { this.acc -= 1 / this.rowRateHz; this.inFlight = true; this.send({ type: 'step' }) }
    }
    this.raf = requestAnimationFrame(this.tick)
  }

  private onMessage(m: FromWorker): void {
    switch (m.type) {
      case 'streams': this.setStatus({ configs: m.configs, error: undefined }); break
      case 'gramRows': {
        this.inFlight = false
        for (const l of this.rowsListeners) l(m)
        const bufs = this.releaseBufs
        bufs.length = 0
        bufs.push(m.streamIds.buffer as ArrayBuffer, m.rowIndex.buffer as ArrayBuffer, m.data.buffer as ArrayBuffer)
        this.send({ type: 'release', buffers: bufs }, bufs)
        break
      }
      case 'tactical':
        this.track.push(m.aircraft.x, m.aircraft.y)
        this.setStatus({ simT: m.simT, tactical: m })
        break
      case 'error': this.inFlight = false; this.setStatus({ error: m.message, playing: false }); break
    }
  }
}
