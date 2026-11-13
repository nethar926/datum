import * as Acoustics from '@acoustics'
import { Receiver } from './receiver'
import { AcousticEngine, inferBuoyType, isAlive, isResLevel, renderCut, type CutSession, type ResLevel } from '@acoustics'
import type { Band, Bearing, BearingBtMsg, DropSpec, EngineBuoyType, FromWorker, GramConfig, GramRows, LofarBandPresetId, Tactical, TacticalBuoy, TruthContact, ToWorker } from './contract'
import { DEMON_CARRIER_BAND } from '../gram/demonConfig'
import { buildScenario } from '../scenarios/training'
import { parseCutScenarioId } from '../cuts/api'
import { HistoryDrain, type DrainEvent } from './historyDrain'
import {
  CUT_SEEK_CHUNK_ROWS,
  CUT_SEEK_FIRST_ROWS,
  CUT_SEEK_FULL_ROWS,
  CutSeekPlayback,
  disposeCutSession,
  fillCutSeekFast,
  type CutSeekBuffers,
} from '../cuts/seek'

export const BANDS: Record<Band, { fmax: number; bins: number }> = {
  lofar1k: { fmax: 1000, bins: 2048 },
  lofar2k: { fmax: 2000, bins: 2048 },
}
export const POOL_FRAMES = 3
const ORBIT_RADIUS_M = 7000
const AIRCRAFT_ALT_M = 450 // display value for the fictional patrol aircraft
/** m3-fe-drop: field cap (the engine bench budget is 32 buoys per frame) and drop defaults. */
export const MAX_FIELD_BUOYS = 32
const DROP_DEPTH_M = { difar: 60, omni: 150 } as const
const DROP_LIFE_S = 4 * 3600
/** Legacy pull streams for dropped buoys are registered far above the engine's sequential subscription ids. */
const LEGACY_DROP_ID = 1_000_000

type Post = (msg: FromWorker, transfer?: Transferable[]) => void
interface Frame { streamIds: Int32Array; rowIndex: Uint32Array; data: Float32Array; bearingDeg?: Float32Array }
type EngineSubscribe = (req: { channel: number; res?: number; filter?: 'NB' | 'BB'; vernierHz?: number; bandPreset?: LofarBandPresetId }) => GramConfig & { simT?: number }
type EngineSetGram = (id: number, p: { res?: number; filter?: 'NB' | 'BB'; vernierHz?: number | null }) => GramConfig & { simT?: number }
/** Engine gramConfig → display contract (drops simT; keeps the RES fields). */
const toConfig = (c: GramConfig & { simT?: number }): GramConfig => { const { simT: _t, ...rest } = c; return { ...rest, type: 'gramConfig', v: 1 } }
const rad2deg = (r: number) => ((((r * 180) / Math.PI) % 360) + 360) % 360

/** One-line swap onto AcousticEngine.aisTracks: surface-only, fictional names, coords match Reveal. */
export function plotContactSource(engine: AcousticEngine): NonNullable<Tactical['aisTracks']> {
  return engine.aisTracks(engine.time)
}

/**
 * One LOFAR stream per buoy, all alike. 'legacy' = the engine's registered pull streams (always a row);
 * 'res' = m3-res zoom-FFT subscriptions (rows every P s, phase-staggered); 'band' = m3-bands analytic
 * subscriptions with a named bandPreset (4 Hz in the engine, skipToLatest once per host step).
 */
interface LofarSet { mode: 'legacy' | 'res' | 'band'; ids: Int32Array; configs: GramConfig[]; bins: number; filter: 'NB' | 'BB'; rx: Receiver[]
  /** Subscribe request the set was made with (kept current by setGram), so a dropped buoy gets a matching stream. */
  req: { res?: number; filter?: 'NB' | 'BB'; vernierHz?: number; bandPreset?: LofarBandPresetId } }


function feBuoyType(b: { type?: unknown; kind?: unknown; difar?: unknown }): EngineBuoyType {
  const t = inferBuoyType(b)
  return t === 'bt' || t === 'omni' || t === 'difar' || t === 'dicass' ? t : 'difar'
}

function engineNumericId(b: { id: unknown }, index: number): number {
  return Number(String(b.id).replace(/\D/g, '')) || index + 1
}

/** Copy an engine energy row onto the FE contract, preserving `scale` when present. */
function feBearingEnergyRow(
  row: { t: number; buoyId: number; fLo: number; fHi: number; energy: Uint8Array; scale?: string },
  buoyId: number,
): import('./contract').BearingEnergyRow {
  const out: import('./contract').BearingEnergyRow = {
    t: row.t, buoyId, fLo: row.fLo, fHi: row.fHi, energy: new Uint8Array(row.energy),
  }
  if (row.scale === 'db-above-bg-0.1') out.scale = 'db-above-bg-0.1'
  return out
}

/** Worker-side host: owns an AcousticEngine and speaks the data contract. Pure enough to unit test without a Worker. */
export class SimHost {
  private engine?: AcousticEngine
  private btDrops: import('./contract').BtDrop[] = []
  /** When set, LOFAR/DEMON rows drain through Acoustics renderCut (CUT mode). */
  private cutSession: CutSession | null = null
  /** Reused across CUT seeks — no per-seek capacity growth after warm-up. */
  private cutSeekBuf: CutSeekBuffers = { data: new Float32Array(0), rowIndex: new Uint32Array(0) }
  private cutBackfillBuf: CutSeekBuffers = { data: new Float32Array(0), rowIndex: new Uint32Array(0) }
  private cutSeekGen = 0
  private cutBackfill: CutSeekPlayback | null = null
  private cutBackfillTimer = 0
  private cutFirstRows = CUT_SEEK_FIRST_ROWS
  private cutFullRows = CUT_SEEK_FULL_ROWS
  private cutDemonOn = false
  private cutRowRate = 2
  /** LOFAR frame pools keyed by bins (RES 1024, band/legacy = scenario bins): only the live sets' sizes are kept. */
  private pools = new Map<number, Frame[]>()
  /** DEMON streams (v1.1 engines): own pool and own gramRows message, since bins differ from LOFAR. */
  private demonPool: Frame[] = []
  private demonIds: number[] = []
  private demonBins = 0
  private n = 0
  private dt = 0.5
  private rowRateHz = 2
  private rowCount = 0
  private tactical?: Tactical
  /** Last sim time a live bearingBt message was posted (1 s cadence). */
  private lastBtT = Number.NEGATIVE_INFINITY
  private btFillGen = 0
  private btFillTimer: ReturnType<typeof setTimeout> | undefined
  private rxEnabled = true
  private demonConfigs: GramConfig[] = []
  /** Displayed LOFAR set (one receiver front end per stream; rxEnabled=false gives an ideal receiver). */
  private active: LofarSet = { mode: 'legacy', ids: new Int32Array(0), configs: [], bins: 0, filter: 'NB', rx: [], req: {} }
  /** m3-fe-gram-handoff: pending set (pendingGen > 0 while one exists), filling alongside the displayed one. */
  private pending?: LofarSet
  private pendingGen = 0
  /** In-flight chunked history drains (one handle per displayed stream). */
  private drains = new Map<number, HistoryDrain>()
  private drainTimer: number | void = 0
  /** Snapshot length requested of beginDrain; first pump covers visibleRows. */
  historyRows = 600
  visibleRows = 600
  /** Frame widths (buoy counts) from before a drop: their in-flight buffers are recognised and dropped on release. */
  private retiredN = new Set<number>()
  constructor(
    private readonly post: Post,
    /** Schedule a later callback (worker: setTimeout; tests: sync or queueMicrotask). */
    private readonly schedule: (fn: () => void, ms?: number) => number | void = (fn, ms = 0) => setTimeout(fn, ms),
    private readonly cancelSchedule: (id: number) => void = (id) => clearTimeout(id),
  ) {}

  handle(msg: ToWorker): void {
    try {
      if (msg.type === 'init') return this.init(msg)
      if (!this.engine) throw new Error('Initialize first')
      if (msg.type === 'release') return this.release(msg.buffers)
      if (msg.type === 'step') return this.step()
      if (msg.type === 'seekCut') return this.seekCut(msg.simT, msg.windowRows)
      if (msg.type === 'disposeCut') return this.disposeCutMode()
      if (msg.type === 'setSurfaceTraffic') return this.setSurfaceTraffic(msg.value)
      if (msg.type === 'setGram') return this.setGram(msg)
      if (msg.type === 'subscribeGram') return this.subscribeGram(msg)
      if (msg.type === 'promoteGram') return this.promoteGram(msg.gen)
      if (msg.type === 'dropGram') { if (msg.gen === this.pendingGen) this.dropPending(); return }
      if (msg.type === 'dropBuoys') return this.dropBuoys(msg)
      if (msg.type === 'dropBtBuoys') return this.dropBtBuoys(msg)
      if (msg.type === 'sendBearingFromPeak') return this.sendBearingFromPeak(msg)
      if (msg.type === 'setReceiver') { this.rxEnabled = !!msg.enabled; for (const r of this.active.rx) r.reset(); for (const r of this.pending?.rx ?? []) r.reset(); return }
      throw new Error('Unknown message')
    } catch (e) {
      this.post({ v: 1, type: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }

  private cancelCutBackfill(): void {
    this.cutSeekGen += 1
    this.abandonCutBackfill()
  }

  /** Drop in-flight backfill without bumping gen (seekCut bumps itself after). Disposes the orphan session. */
  private abandonCutBackfill(): void {
    if (this.cutBackfillTimer) { this.cancelSchedule(this.cutBackfillTimer as number); this.cutBackfillTimer = 0 }
    if (this.cutBackfill) {
      const orphan = this.cutBackfill.session
      this.cutBackfill = null
      if (orphan !== this.cutSession) disposeCutSession(orphan)
    }
  }

  /** Dispose the live CUT session (finish / leave CUT / replace). */
  private disposeLiveCut(): void {
    disposeCutSession(this.cutSession)
    this.cutSession = null
  }

  /** Abandon CUT mode in the worker: cancel backfill and dispose the live session. Engine stays until next init. */
  private disposeCutMode(): void {
    this.cancelCutBackfill()
    this.cancelBtFill()
    this.disposeLiveCut()
  }

  private init(msg: Extract<ToWorker, { type: 'init' }>): void {
    this.cancelCutBackfill()
    this.cancelBtFill()
    this.cancelDrains()

    const band = BANDS[msg.band]
    if (!band) throw new Error('Unknown band')
    if (!Number.isFinite(msg.rowRateHz) || msg.rowRateHz < 0.25 || msg.rowRateHz > 8) throw new Error('rowRateHz out of range')
    const cutId = parseCutScenarioId(msg.scenarioId)
    if (cutId) {
      this.initCut(msg, cutId)
      return
    }
    this.disposeLiveCut()
    const gen = (Acoustics as unknown as { generateScenario?: (p: unknown) => ConstructorParameters<typeof AcousticEngine>[0] }).generateScenario
    const engine = new AcousticEngine(msg.params && gen ? gen(msg.params) : buildScenario(msg.scenarioId, msg.seed >>> 0, band.fmax, band.bins), msg.seed >>> 0, {
      buoyStartMode: msg.buoyStartMode, autoDropPattern: msg.autoDropPattern,
      dropAltitudeM: msg.dropAltitudeM, descentRateMps: msg.descentRateMps, integrationTimeS: msg.integrationTimeS,
    })
    this.btDrops = []; this.engine = engine
    this.n = engine.scenario.buoys.length
    this.dt = 1 / msg.rowRateHz; this.rowRateHz = msg.rowRateHz
    this.rowCount = 0
    this.pending = undefined; this.pendingGen = 0
    this.pools = new Map(); this.retiredN.clear()
    const setGram = (engine as unknown as { setGram?: EngineSetGram }).setGram
    const ids = new Int32Array(this.n); for (let i = 0; i < this.n; i++) ids[i] = i + 1
    if (msg.gram && typeof setGram === 'function') {
      const configs = engine.scenario.buoys.map((_, i) => toConfig(setGram.call(engine, i + 1, { res: msg.gram!.res, filter: msg.gram!.filter })))
      this.active = this.makeSet('res', ids, configs, { res: msg.gram.res, filter: msg.gram.filter })
    } else if (msg.bandPreset && this.canSubscribe()) {
      this.active = this.subscribeSet({ bandPreset: msg.bandPreset })
    } else {
      const fBin = band.fmax / (band.bins - 1)
      this.active = this.makeSet('legacy', ids, engine.scenario.buoys.map((b, i) => ({
        v: 1, type: 'gramConfig', streamId: i + 1, kind: 'lofar', channel: b.rfChannel,
        bins: band.bins, f0: 0, fBin, rowRateHz: msg.rowRateHz, dbFloor: 40, dbCeil: 110,
      })), {})
    }
    this.ensurePool(this.active.bins)
    this.tactical = this.makeTactical()
    const configs: GramConfig[] = this.active.configs.slice()
    this.demonIds = []; this.demonPool = []; this.demonBins = 0
    const sub = (engine as unknown as { subscribe?: (r: { kind: 'demon'; buoyId: number; band?: [number, number] }) => number }).subscribe
    const all = (engine as unknown as { configs?: () => GramConfig[] }).configs
    if (msg.demon !== false && typeof sub === 'function' && typeof all === 'function') {
      try {
        engine.scenario.buoys.forEach((b, i) => {
          const id = (b as { id?: string }).id
          this.demonIds.push(sub.call(engine, { kind: 'demon', buoyId: Number(String(id ?? '').replace(/\D/g, '')) || i + 1, band: [...DEMON_CARRIER_BAND] as [number, number] }))
        })
        const dc = all.call(engine).filter((c) => c.kind === 'demon' && this.demonIds.includes(c.streamId))
        if (dc.length === this.demonIds.length && dc.length) {
          this.demonBins = dc[0].bins
          // Rows are emitted once per host step, so the display's time axis uses the host row rate.
          for (const c of dc) configs.push({ v: 1, type: 'gramConfig', streamId: c.streamId, kind: 'demon', channel: c.channel, bins: c.bins, f0: c.f0, fBin: c.fBin, rowRateHz: msg.rowRateHz, dbFloor: c.dbFloor, dbCeil: c.dbCeil, ...(c.demodBandHz ? { demodBandHz: c.demodBandHz } : {}) })
          for (let k = 0; k < POOL_FRAMES; k++) this.demonPool.push(this.newDemonFrame())
        } else this.demonIds = []
      } catch { this.demonIds = []; this.demonBins = 0 }
    }
    this.demonConfigs = configs.filter((c) => c.kind === 'demon')
    this.post({ v: 1, type: 'streams', configs })
    this.post(this.tactical)
    this.lastBtT = Number.NEGATIVE_INFINITY
    this.postBearingBt(true)
    if (msg.surfaceTraffic !== undefined) this.setSurfaceTraffic(msg.surfaceTraffic)
  }

  private makeSet(mode: LofarSet['mode'], ids: Int32Array, configs: GramConfig[], req: LofarSet['req']): LofarSet {
    return { mode, ids, configs, bins: configs[0]?.bins ?? 0, filter: configs[0]?.filter ?? 'NB', rx: Array.from({ length: this.n }, () => new Receiver()), req }
  }
  private canSubscribe(): boolean { return typeof (this.engine as unknown as { subscribe?: unknown }).subscribe === 'function' }

  /** Subscribe one LOFAR stream per buoy: RES (res/filter/vernierHz) or a named analytic band preset. */
  private subscribeSet(p: { res?: number; filter?: 'NB' | 'BB'; vernierHz?: number; bandPreset?: LofarBandPresetId }): LofarSet {
    const engine = this.engine!, sub = (engine as unknown as { subscribe: EngineSubscribe }).subscribe
    const ids = new Int32Array(this.n), configs: GramConfig[] = []
    try {
      for (let i = 0; i < this.n; i++) {
        const channel = engine.scenario.buoys[i].rfChannel
        // The engine keeps band/bandPreset and res/filter/vernierHz exclusive: send one family only.
        const req: Parameters<EngineSubscribe>[0] = p.bandPreset ? { channel, bandPreset: p.bandPreset } : { channel, res: p.res ?? 5, filter: p.filter ?? 'NB' }
        if (!p.bandPreset && p.vernierHz !== undefined && p.vernierHz !== null) req.vernierHz = p.vernierHz
        const c = toConfig(sub.call(engine, req))
        // Band streams emit once per host step (skipToLatest), so the display's time axis uses the host row rate.
        if (p.bandPreset) c.rowRateHz = this.rowRateHz
        ids[i] = c.streamId; configs.push(c)
      }
    } catch (e) { for (const c of configs) engine.unsubscribe(c.streamId); throw e }
    const req: LofarSet['req'] = p.bandPreset ? { bandPreset: p.bandPreset } : { res: p.res ?? 5, filter: p.filter ?? 'NB', ...(p.vernierHz !== undefined && p.vernierHz !== null ? { vernierHz: p.vernierHz } : {}) }
    return this.makeSet(p.bandPreset ? 'band' : 'res', ids, configs, req)
  }

  /** RES/filter/vernier change for every LOFAR stream; re-announces the streams (same ids, same frame size). */
  private setGram(msg: Extract<ToWorker, { type: 'setGram' }>): void {
    if (this.active.mode !== 'res') throw new Error('setGram needs a RES-mode init')
    const engine = this.engine!
    const patch: { res?: number; filter?: 'NB' | 'BB'; vernierHz?: number | null } = {}
    if (msg.res !== undefined) patch.res = msg.res
    if (msg.filter !== undefined) patch.filter = msg.filter
    if (msg.vernierHz !== undefined) patch.vernierHz = msg.vernierHz
    if (this.pendingGen) this.dropPending()
    this.cancelDrains()
    const a = this.active
    a.configs = a.configs.map((c) => {
      const res = patch.res ?? c.res
      if (res === undefined) throw new Error('setGram needs a RES stream')
      const opts: { filter?: 'NB' | 'BB'; vernierHz?: number | null } = {}
      if (patch.filter !== undefined) opts.filter = patch.filter
      if (patch.vernierHz !== undefined) opts.vernierHz = patch.vernierHz
      return toConfig(engine.setViewRes(c.streamId, res, opts))
    })
    a.filter = a.configs[0]?.filter ?? 'NB'
    if (patch.res !== undefined) a.req.res = patch.res
    if (patch.filter !== undefined) a.req.filter = patch.filter
    if (patch.vernierHz === null) delete a.req.vernierHz; else if (patch.vernierHz !== undefined) a.req.vernierHz = patch.vernierHz
    for (const r of a.rx) r.reset()
    this.post({ v: 1, type: 'streams', configs: [...a.configs, ...this.demonConfigs] })
    for (let i = 0; i < a.configs.length; i++) {
      const c = a.configs[i]!
      const d = new HistoryDrain(engine)
      const ev = d.start(c.streamId, c.res ?? null, this.historyRows, this.visibleRows, i)
      this.drains.set(c.streamId, d)
      if (ev) this.postDrain(ev)
    }
    this.scheduleDrainPumps()
  }

  private postDrain(ev: DrainEvent): void {
    const msg = {
      v: 1 as const, type: 'drainProgress' as const,
      streamId: ev.streamId, handleId: ev.handleId, fromRow: ev.fromRow, toRow: ev.toRow,
      filledFrom: ev.filledFrom, totalRows: ev.totalRows, state: ev.state, bins: ev.bins, data: ev.data,
      ...(ev.bearingDeg ? { bearingDeg: ev.bearingDeg } : {}),
    }
    const xfer: Transferable[] = ev.bearingDeg ? [ev.data.buffer, ev.bearingDeg.buffer] : [ev.data.buffer]
    this.post(msg, xfer)
  }

  private cancelDrains(): void {
    if (this.drainTimer) { this.cancelSchedule(this.drainTimer as number); this.drainTimer = 0 }
    for (const d of this.drains.values()) d.release()
    this.drains.clear()
  }

  private scheduleDrainPumps(): void {
    if (this.drainTimer) { this.cancelSchedule(this.drainTimer as number); this.drainTimer = 0 }
    let running = false
    for (const d of this.drains.values()) if (d.isRunning) { running = true; break }
    if (!running) return
    this.drainTimer = this.schedule(() => this.pumpDrains(), 16)
  }

  private pumpDrains(): void {
    this.drainTimer = 0
    for (const d of this.drains.values()) {
      if (!d.isRunning) continue
      const ev = d.pump({ budgetMs: 16 })
      if (ev) this.postDrain(ev)
    }
    this.scheduleDrainPumps()
  }

  /**
   * Gram handoff, step 1: subscribe a fresh stream per buoy with the new settings (RES, or a band preset),
   * alongside the displayed set. A newer request supersedes (unsubscribes) any older pending set, so rapid
   * changes never leak engine streams.
   */
  private subscribeGram(msg: Extract<ToWorker, { type: 'subscribeGram' }>): void {
    if (!this.canSubscribe() || (!msg.bandPreset && typeof (this.engine as unknown as { setGram?: unknown }).setGram !== 'function')) throw new Error('subscribeGram needs an m3-res engine')
    if (this.pendingGen) this.dropPending()
    const set = this.subscribeSet(msg.bandPreset ? { bandPreset: msg.bandPreset } : { res: msg.res, filter: msg.filter, vernierHz: msg.vernierHz })
    this.pending = set; this.pendingGen = msg.gen
    this.ensurePool(set.bins)
    this.post({ v: 1, type: 'pendingStreams', gen: msg.gen, configs: set.configs })
  }

  /** Gram handoff, step 2: the pending set becomes the displayed set; the old displayed streams stop. */
  private promoteGram(gen: number): void {
    if (!this.pending || gen !== this.pendingGen) return // stale (superseded) promote: ignore
    const engine = this.engine!, old = this.active
    // Legacy registered streams are pull-only (no work unless read); unsubscribe drops them too.
    for (let i = 0; i < old.ids.length; i++) engine.unsubscribe(old.ids[i])
    this.active = this.pending; this.pending = undefined; this.pendingGen = 0
    this.trimPools()
    this.post({ v: 1, type: 'streams', configs: [...this.active.configs, ...this.demonConfigs] })
  }

  private dropPending(): void {
    const engine = this.engine!, p = this.pending
    if (p) for (let i = 0; i < p.ids.length; i++) engine.unsubscribe(p.ids[i])
    this.pending = undefined; this.pendingGen = 0
    this.trimPools()
  }

  /**
   * m3-fe-drop: lay buoys through the engine's dropBuoy (live from now), then give each one a LOFAR stream matching
   * the displayed set (RES, band preset or legacy), a pending-set stream during a gram handoff, and a DEMON stream
   * when DEMON is on. Frame pools are rebuilt for the new width (event-time allocation only; the step loop stays
   * allocation-free). Announces the new stream set, the pending set (same gen), the tactical picture, then 'dropped'.
   */
  private dropBuoys(msg: Extract<ToWorker, { type: 'dropBuoys' }>): void {
    const engine = this.engine!, s = engine.scenario
    const used = new Set(s.buoys.map((b) => b.rfChannel)), channels: number[] = []
    let error: string | undefined
    for (const d of (Array.isArray(msg.buoys) ? msg.buoys : [])) {
      if (s.buoys.length >= MAX_FIELD_BUOYS) { error = `Field full (${MAX_FIELD_BUOYS} buoys)`; break }
      if ((d.kind !== 'omni' && d.kind !== 'difar') || !Number.isFinite(d.x) || !Number.isFinite(d.y) || Math.abs(d.x) > 1e6 || Math.abs(d.y) > 1e6) { error = 'Invalid drop'; break }
      let ch = Number.isInteger(d.channel) && d.channel! >= 1 && d.channel! <= 9999 ? d.channel! : 1
      for (let k = 0; used.has(ch) && k < 9999; k++) ch = (ch % 9999) + 1
      if (used.has(ch)) { error = 'No free RF channel'; break }
      try {
        engine.dropBuoy({ channel: ch, kind: d.kind, x: d.x, y: d.y, hydrophoneDepthM: d.depthM ?? DROP_DEPTH_M[d.kind], lifeS: d.lifeS ?? DROP_LIFE_S, dropAltitudeM: d.dropAltitudeM, descentRateMps: d.descentRateMps, integrationTimeS: d.integrationTimeS })
        this.attachBuoy(s.buoys.length - 1, d)
      } catch (e) { error = e instanceof Error ? e.message : String(e); break }
      used.add(ch); channels.push(ch)
    }
    if (channels.length) {
      this.retiredN.add(this.n); this.n = s.buoys.length; this.retiredN.delete(this.n)
      this.pools = new Map(); this.ensurePool(this.active.bins); if (this.pending) this.ensurePool(this.pending.bins)
      if (this.demonIds.length) { this.demonPool = []; for (let k = 0; k < POOL_FRAMES; k++) this.demonPool.push(this.newDemonFrame()) }
      this.post({ v: 1, type: 'streams', configs: [...this.active.configs, ...this.demonConfigs] })
      if (this.pending) this.post({ v: 1, type: 'pendingStreams', gen: this.pendingGen, configs: this.pending.configs })
      this.updateTactical(); this.post(this.tactical!); this.postBearingBt(false)
    }
    this.post({ v: 1, type: 'dropped', seq: msg.seq, source: msg.source, channels, ...(error ? { error } : {}) })
  }

  /** Streams + display records for the buoy just added at index i. */
  private attachBuoy(i: number, _d: DropSpec): void {
    const engine = this.engine!, b = engine.scenario.buoys[i]
    const add = (set: LofarSet) => {
      let c: GramConfig, id: number
      if (set.mode === 'legacy') {
        id = LEGACY_DROP_ID + i
        engine.registerStream(id, b.rfChannel)
        const c0 = set.configs[0]
        c = { v: 1, type: 'gramConfig', streamId: id, kind: 'lofar', channel: b.rfChannel, bins: c0?.bins ?? engine.scenario.bins, f0: c0?.f0 ?? 0, fBin: c0?.fBin ?? 1, rowRateHz: this.rowRateHz, dbFloor: c0?.dbFloor ?? 40, dbCeil: c0?.dbCeil ?? 110 }
      } else {
        const sub = (engine as unknown as { subscribe: EngineSubscribe }).subscribe
        const r = set.req
        c = toConfig(sub.call(engine, r.bandPreset ? { channel: b.rfChannel, bandPreset: r.bandPreset }
          : { channel: b.rfChannel, res: r.res ?? 5, filter: r.filter ?? 'NB', ...(r.vernierHz !== undefined ? { vernierHz: r.vernierHz } : {}) }))
        if (set.mode === 'band') c.rowRateHz = this.rowRateHz
        id = c.streamId
      }
      const ids = new Int32Array(set.ids.length + 1); ids.set(set.ids); ids[set.ids.length] = id
      set.ids = ids; set.configs = [...set.configs, c]; set.rx.push(new Receiver())
    }
    add(this.active)
    if (this.pending) add(this.pending)
    if (this.demonIds.length) {
      const sub = (engine as unknown as { subscribe: (r: { kind: 'demon'; buoyId: number; band?: [number, number] }) => number }).subscribe
      const all = (engine as unknown as { configs: () => GramConfig[] }).configs
      const id = sub.call(engine, { kind: 'demon', buoyId: Number(b.id.replace(/\D/g, '')), band: [...DEMON_CARRIER_BAND] as [number, number] })
      const dc = all.call(engine).find((c) => c.streamId === id)!
      this.demonIds.push(id)
      this.demonConfigs = [...this.demonConfigs, { v: 1, type: 'gramConfig', streamId: id, kind: 'demon', channel: dc.channel, bins: dc.bins, f0: dc.f0, fBin: dc.fBin, rowRateHz: this.rowRateHz, dbFloor: dc.dbFloor, dbCeil: dc.dbCeil, ...(dc.demodBandHz ? { demodBandHz: dc.demodBandHz } : {}) }]
    }
    const typ = feBuoyType(b)
    this.tactical!.buoys.push({ id: b.rfChannel, channel: b.rfChannel, kind: typ, type: typ, x: b.x, y: b.y, hydrophoneDepthM: b.depth, batteryFrac: 1, lifeRemainingS: b.life, state: 'live' })
  }

  private ensurePool(bins: number): void {
    if (!bins || this.pools.has(bins)) return
    const pool: Frame[] = []
    for (let i = 0; i < POOL_FRAMES; i++) pool.push(this.newFrame(bins))
    this.pools.set(bins, pool)
  }
  /** Free frame pools no live set uses (frames of that size still in flight are dropped on release). */
  private trimPools(): void {
    for (const b of [...this.pools.keys()]) if (b !== this.active.bins && b !== this.pending?.bins) this.pools.delete(b)
  }

  /** Live engine subscriptions (test introspection: proves unsubscribe really stops streams). */
  liveStreamCount(): number { return (this.engine as unknown as { configs?: () => unknown[] })?.configs?.().length ?? 0 }
  /** Stream ids the host is generating LOFAR rows for: displayed set, then pending set. */
  lofarStreamIds(): { active: number[]; pending: number[]; pendingGen: number; mode: LofarSet['mode']; pools: number[] } {
    return { active: Array.from(this.active.ids), pending: Array.from(this.pending?.ids ?? []), pendingGen: this.pendingGen, mode: this.active.mode, pools: [...this.pools.keys()] }
  }

  /** Forwards to the engine's v1.1 setSurfaceTraffic when present; a no-op on v1 engines. */
  private setSurfaceTraffic(value: number): void {
    if (!Number.isFinite(value)) throw new Error('surfaceTraffic must be a number')
    const e = this.engine as unknown as { setSurfaceTraffic?: (v: number) => void } | undefined
    e?.setSurfaceTraffic?.(Math.max(0, Math.min(1, value)))
  }

  private newFrame(bins: number): Frame {
    const streamIds = new Int32Array(this.n)
    for (let i = 0; i < this.n; i++) streamIds[i] = i + 1
    return { streamIds, rowIndex: new Uint32Array(this.n), data: new Float32Array(this.n * bins), bearingDeg: new Float32Array(this.n * bins) }
  }

  private newDemonFrame(): Frame {
    const n = this.demonIds.length
    return { streamIds: Int32Array.from(this.demonIds), rowIndex: new Uint32Array(n), data: new Float32Array(n * this.demonBins) }
  }

  private release(buffers: ArrayBuffer[]): void {
    // Frames come back as [ids, rowIndex, data] plus, for LOFAR frames, an optional bearingDeg buffer of data's size.
    for (let k = 0; k < buffers.length; k += 3) {
      if (k + 3 > buffers.length) throw new Error('Release must return whole frames')
      const [s, r, d] = [buffers[k], buffers[k + 1], buffers[k + 2]]
      const next = buffers[k + 3]
      const w = s.byteLength / 4, current = w === this.n
      const lofarShaped = (current || this.retiredN.has(w)) && r.byteLength === s.byteLength && d.byteLength > s.byteLength
      const pool = lofarShaped && current ? this.pools.get(d.byteLength / (this.n * 4)) : undefined
      // The bearing buffer is consumed even when its pool was retired (RES ↔ band), so the triples stay aligned.
      const brg = lofarShaped && next && next.byteLength === d.byteLength ? next : undefined
      if (brg) k++
      const dn = this.demonIds.length
      if (!pool && !brg && dn && s.byteLength === dn * 4 && r.byteLength === dn * 4 && d.byteLength === dn * this.demonBins * 4) {
        if (this.demonPool.length >= POOL_FRAMES) throw new Error('Pool capacity exceeded')
        this.demonPool.push({ streamIds: new Int32Array(s), rowIndex: new Uint32Array(r), data: new Float32Array(d) })
        continue
      }
      // Stale buffers from a previous init or a retired set (different size) are silently dropped.
      if (!pool) continue
      if (pool.length >= POOL_FRAMES) throw new Error('Pool capacity exceeded')
      pool.push({ streamIds: new Int32Array(s), rowIndex: new Uint32Array(r), data: new Float32Array(d), bearingDeg: brg ? new Float32Array(brg) : new Float32Array(d.byteLength / 4) })
    }
  }

  /** CUT mode: open Acoustics renderCut and drain its LOFAR (+ optional DEMON) into the host pools. */
  private initCut(msg: Extract<ToWorker, { type: 'init' }>, cutId: string): void {
    this.disposeLiveCut()
    const session = renderCut(cutId)
    this.cutSession = session
    this.engine = session.engine
    this.n = 1
    this.dt = 1 / msg.rowRateHz
    this.rowRateHz = msg.rowRateHz
    this.rowCount = 0
    this.pending = undefined
    this.pendingGen = 0
    this.pools = new Map()
    this.retiredN.clear()
    const lc = session.lofar
    const cfg: GramConfig = {
      v: 1, type: 'gramConfig', streamId: lc.streamId, kind: 'lofar', channel: lc.channel,
      bins: lc.bins, f0: lc.f0, fBin: lc.fBin, rowRateHz: msg.rowRateHz,
      dbFloor: lc.dbFloor, dbCeil: lc.dbCeil,
    }
    this.active = this.makeSet('legacy', new Int32Array([lc.streamId]), [cfg], {})
    this.ensurePool(lc.bins)
    this.tactical = this.makeTactical()
    const configs: GramConfig[] = this.active.configs.slice()
    this.demonIds = []
    this.demonPool = []
    this.demonBins = 0
    if (msg.demon !== false) {
      try {
        const all = (session.engine as unknown as { configs: () => GramConfig[] }).configs()
        const dc = all.find((c) => c.streamId === session.demonStreamId && c.kind === 'demon')
        if (dc) {
          this.demonIds = [session.demonStreamId]
          this.demonBins = dc.bins
          configs.push({
            v: 1, type: 'gramConfig', streamId: dc.streamId, kind: 'demon', channel: dc.channel,
            bins: dc.bins, f0: dc.f0, fBin: dc.fBin, rowRateHz: msg.rowRateHz,
            dbFloor: dc.dbFloor, dbCeil: dc.dbCeil,
          })
          for (let k = 0; k < POOL_FRAMES; k++) this.demonPool.push(this.newDemonFrame())
        }
      } catch { this.demonIds = []; this.demonBins = 0 }
    }
    this.demonConfigs = configs.filter((c) => c.kind === 'demon')
    this.post({ v: 1, type: 'streams', configs })
    this.post(this.tactical)
  }

  /** Advance one row period. With no free frame the sim waits (backpressure never drops sim time). */
  private step(): void {
    if (this.cutSession) return this.stepCut()
    this.pumpDrains()
    const engine = this.engine!, a = this.active, pool = this.pools.get(a.bins)!
    const frame = pool.pop()
    if (!frame) return
    this.steerOrbit()
    engine.advance(this.dt)
    // RES streams are phase-staggered (rowPhaseS), so only some fall due each step. Streams without a row
    // this step get streamId -1 (the display skips them); skip the post when none is due.
    const due = a.mode === 'legacy' || this.anyReady(a.ids)
    if (!due) pool.push(frame)
    else {
      this.writeLofar(frame, a)
      this.rowCount++
      this.postFrame(frame)
    }
    // Pending handoff set: its own frame pool (bins may differ) and gramRows message. No free frame → its rows
    // stay ready in the engine and drain on a later step.
    const p = this.pending
    if (p && this.anyReady(p.ids)) {
      const pf = this.pools.get(p.bins)?.pop()
      if (pf) { this.writeLofar(pf, p); this.postFrame(pf) }
    }
    if (due) this.stepDemon() // DEMON skipToLatest alongside displayed LOFAR rows (same simT)
    this.updateTactical()
    this.post(this.tactical!)
    this.postBearingBt(false)
  }

  private anyReady(ids: Int32Array): boolean {
    const e = this.engine as unknown as { rowsReady: (id: number) => number }
    for (let i = 0; i < ids.length; i++) if (e.rowsReady(ids[i]) > 0) return true
    return false
  }

  /**
   * CUT scrubber seek: first-paint the newest FIRST_ROWS, then progressively backfill up to
   * FULL_ROWS in idle chunks (generation token cancels stale work). Play/pause preserved.
   */
  private seekCut(targetS: number, windowRows?: number): void {
    if (!this.cutSession) throw new Error('seekCut requires CUT mode')
    const cutId = this.cutSession.cut.id
    const firstRows = windowRows ?? CUT_SEEK_FIRST_ROWS
    const fullRows = Math.max(firstRows, CUT_SEEK_FULL_ROWS)
    this.cutFirstRows = firstRows
    this.cutFullRows = fullRows
    this.cutDemonOn = this.demonIds.length > 0
    this.cutRowRate = this.rowRateHz

    // Cancel any in-flight backfill (disposes orphan session); this seek owns the new generation.
    this.cancelCutBackfill()
    const gen = this.cutSeekGen

    const filled = fillCutSeekFast(cutId, targetS, this.cutSeekBuf, firstRows)
    this.installCutSession(filled.session, this.cutDemonOn, this.cutRowRate)
    this.postCutSeeked(gen, 'first', filled.simT, filled.streamId, filled.bins, filled.rowCount, this.cutSeekBuf, filled.elapsedMs, fullRows, filled.cpuMs)
    this.updateTactical()
    this.post(this.tactical!)
    this.lastBtT = Number.NEGATIVE_INFINITY
    this.postBearingBt(true)

    // Progressive backfill: a fresh fill of the full window, posted in idle chunks.
    if (fullRows > firstRows && targetS > 0) {
      this.cutBackfill = new CutSeekPlayback(cutId, targetS, this.cutBackfillBuf, fullRows)
      this.armCutBackfill(gen)
    }
  }

  private installCutSession(session: CutSession, demonOn: boolean, rowRate: number): void {
    if (this.cutSession && this.cutSession !== session) disposeCutSession(this.cutSession)
    this.cutSession = session
    this.engine = session.engine
    this.n = 1
    this.pending = undefined
    this.pendingGen = 0
    this.retiredN.clear()
    const lc = session.lofar
    const cfg: GramConfig = {
      v: 1, type: 'gramConfig', streamId: lc.streamId, kind: 'lofar', channel: lc.channel,
      bins: lc.bins, f0: lc.f0, fBin: lc.fBin, rowRateHz: rowRate,
      dbFloor: lc.dbFloor, dbCeil: lc.dbCeil,
    }
    this.active = this.makeSet('legacy', new Int32Array([lc.streamId]), [cfg], {})
    this.ensurePool(lc.bins)
    this.tactical = this.makeTactical()
    const configs: GramConfig[] = this.active.configs.slice()
    this.demonIds = []
    this.demonPool = []
    this.demonBins = 0
    this.demonConfigs = []
    if (demonOn) {
      try {
        const all = (session.engine as unknown as { configs: () => GramConfig[] }).configs()
        const dc = all.find((c) => c.streamId === session.demonStreamId && c.kind === 'demon')
        if (dc) {
          this.demonIds = [session.demonStreamId]
          this.demonBins = dc.bins
          configs.push({
            v: 1, type: 'gramConfig', streamId: dc.streamId, kind: 'demon', channel: dc.channel,
            bins: dc.bins, f0: dc.f0, fBin: dc.fBin, rowRateHz: rowRate,
            dbFloor: dc.dbFloor, dbCeil: dc.dbCeil,
          })
          for (let k = 0; k < POOL_FRAMES; k++) this.demonPool.push(this.newDemonFrame())
        }
      } catch { this.demonIds = []; this.demonBins = 0 }
    }
    this.demonConfigs = configs.filter((c) => c.kind === 'demon')
    this.rowCount = 0
    this.post({ v: 1, type: 'streams', configs })
  }

  private postCutSeeked(
    gen: number,
    phase: 'first' | 'backfill' | 'done',
    simT: number,
    streamId: number,
    bins: number,
    rowCount: number,
    buf: CutSeekBuffers,
    elapsedMs: number,
    fullRows: number,
    cpuMs = 0,
  ): void {
    const data = new Float32Array(rowCount * bins)
    if (rowCount) data.set(buf.data.subarray(0, rowCount * bins))
    const rowIndex = new Uint32Array(rowCount)
    if (rowCount) rowIndex.set(buf.rowIndex.subarray(0, rowCount))
    this.post({
      v: 1, type: 'cutSeeked', simT, streamId, bins, rowCount, rowIndex, data,
      elapsedMs, cpuMs, gen, phase, fullRows,
    }, [rowIndex.buffer, data.buffer])
  }

  private armCutBackfill(gen: number): void {
    if (gen !== this.cutSeekGen) return
    const id = this.schedule(() => this.continueCutBackfill(gen), 0)
    this.cutBackfillTimer = (id as number) || 0
  }

  /** Idle slice: write CHUNK rows of the full window; on done, swap the live session to the backfill engine. */
  private continueCutBackfill(gen: number): void {
    this.cutBackfillTimer = 0
    if (gen !== this.cutSeekGen) return
    const fill = this.cutBackfill
    if (!fill) return
    const t0 = performance.now()
    fill.writeMore(CUT_SEEK_CHUNK_ROWS)
    // Keep writing while we still have budget in this slice (~6 ms) so desktop finishes under ~400 ms.
    while (!fill.done && performance.now() - t0 < 8) fill.writeMore(CUT_SEEK_CHUNK_ROWS)

    if (!fill.done) {
      // Silent progress — final window is only correct once every row from t=0 has been written
      // (LOFAR rowIndex seeds noise). First paint stays on screen until phase=done replaces it.
      this.armCutBackfill(gen)
      return
    }

    // Done: compact ring, install the playback session at target, post the full window.
    fill.compact()
    this.installCutSession(fill.session, this.cutDemonOn, this.cutRowRate)
    this.rowCount = fill.rowCount > 0 ? fill.out.rowIndex[fill.rowCount - 1]! + 1 : 0
    this.postCutSeeked(gen, 'done', fill.session.simT, fill.streamId, fill.bins, fill.rowCount, fill.out, fill.elapsedMs, this.cutFullRows, fill.cpuMs)
    this.updateTactical()
    this.post(this.tactical!)
    this.lastBtT = Number.NEGATIVE_INFINITY
    this.postBearingBt(true)
    this.cutBackfill = null
  }

  /** Drain one LOFAR (+ DEMON) row from the Acoustics CutSession. */
  private stepCut(): void {
    const session = this.cutSession!, a = this.active, pool = this.pools.get(a.bins)!
    const frame = pool.pop()
    if (!frame) return
    this.steerOrbit()
    const idx = session.writeLofarRow(frame.data, 0)
    if (idx < 0) {
      pool.push(frame)
      // Cut finished (or already disposed): tear down once; further writers stay at -1.
      if (session.done) disposeCutSession(session)
      this.updateTactical()
      this.post(this.tactical!)
      this.postBearingBt(false)
      return
    }
    frame.streamIds[0] = a.ids[0]
    frame.rowIndex[0] = this.rowCount++
    const e = this.engine as unknown as { writeBearingRow?: (id: number, out: Float32Array, off: number) => void }
    if (frame.bearingDeg) {
      if (e.writeBearingRow) e.writeBearingRow.call(this.engine, a.ids[0], frame.bearingDeg, 0)
      else frame.bearingDeg.fill(NaN)
    }
    if (this.rxEnabled && a.rx[0]) a.rx[0].process(frame.data, 0, a.bins, this.dt)
    this.postFrame(frame)
    if (this.demonIds.length && this.demonPool.length) {
      const df = this.demonPool.pop()!
      const di = session.writeDemonRow(df.data, 0)
      if (di < 0) this.demonPool.push(df)
      else {
        df.streamIds[0] = this.demonIds[0]
        df.rowIndex[0] = Math.max(0, di)
        const rows: GramRows = { v: 1, type: 'gramRows', simT: this.engine!.time, ...df }
        this.post(rows, [df.streamIds.buffer, df.rowIndex.buffer, df.data.buffer])
      }
    }
    this.updateTactical()
    this.post(this.tactical!)
    this.postBearingBt(false)
  }

  private writeLofar(frame: Frame, set: LofarSet): void {
    const engine = this.engine!, bins = set.bins
    const e = engine as unknown as { writeBearingRow?: (id: number, out: Float32Array, off: number) => void }
    const wb = e.writeBearingRow
    // NB rows are already TPSW-normalised; the AGC model only applies to absolute (BB / legacy / band) levels.
    const rxOn = this.rxEnabled && (set.mode !== 'res' || set.filter === 'BB')
    for (let i = 0; i < this.n; i++) {
      const id = set.ids[i], off = i * bins
      frame.streamIds[i] = id
      // Band streams are due at 4 Hz; skipToLatest keeps one newest row per host step (no N-write drain).
      let idx = set.mode === 'band' ? engine.skipToLatest(id, frame.data, off) : engine.writeRow(id, frame.data, off)
      if (set.mode !== 'legacy' && idx < 0) { frame.streamIds[i] = -1; frame.rowIndex[i] = 0; continue }
      frame.rowIndex[i] = set.mode === 'legacy' ? this.rowCount : Math.max(0, idx)
      if (frame.bearingDeg) {
        if (wb) wb.call(engine, id, frame.bearingDeg, off)
        else frame.bearingDeg.fill(NaN, off, off + bins)
      }
      if (rxOn) set.rx[i].process(frame.data, off, bins, set.mode === 'res' ? 1 / (set.configs[0]?.rowRateHz || 0.5) : this.dt)
    }
  }

  private postFrame(frame: Frame): void {
    const rows: GramRows = { v: 1, type: 'gramRows', simT: this.engine!.time, ...frame }
    const bufs: Transferable[] = [frame.streamIds.buffer, frame.rowIndex.buffer, frame.data.buffer]
    if (frame.bearingDeg) bufs.push(frame.bearingDeg.buffer)
    this.post(rows, bufs)
  }

  /**
   * One DEMON row per stream per host step via skipToLatest (same latest-only path as band LOFAR).
   * After a tab-throttle / stall gap the engine may owe many 4 Hz rows; we jump to the newest
   * instead of draining the backlog (no stutter / CPU spike). Display rowRateHz is the host rate
   * so the DEMON time axis stays locked to LOFAR. Skipped if no frame is free.
   */
  private stepDemon(): void {
    if (!this.demonIds.length) return
    const frame = this.demonPool.pop()
    if (!frame) return
    const engine = this.engine!
    let any = false
    for (let i = 0; i < this.demonIds.length; i++) {
      const id = this.demonIds[i], off = i * this.demonBins
      frame.streamIds[i] = id
      const idx = engine.skipToLatest(id, frame.data, off)
      if (idx < 0) frame.data.fill(NaN, off, off + this.demonBins)
      else any = true
      frame.rowIndex[i] = Math.max(0, idx)
    }
    if (!any) { this.demonPool.push(frame); return }
    const rows: GramRows = { v: 1, type: 'gramRows', simT: engine.time, ...frame }
    this.post(rows, [frame.streamIds.buffer, frame.rowIndex.buffer, frame.data.buffer])
  }

  /** Simple clockwise orbit autopilot around the field centre for the fictional aircraft. */
  private steerOrbit(): void {
    const o = this.engine!.scenario.ownship
    const r = Math.hypot(o.x, o.y)
    const theta = Math.atan2(o.x, o.y)
    const correction = Math.max(-0.6, Math.min(0.6, ((r - ORBIT_RADIUS_M) / ORBIT_RADIUS_M) * 2))
    o.course = theta + Math.PI / 2 + correction
  }



  private sendBearingFromPeak(msg: Extract<ToWorker, { type: 'sendBearingFromPeak' }>): void {
    try {
      const freq = msg.freqHz !== undefined ? msg.freqHz : msg.band
      if (freq === undefined) throw new Error('Missing ALI frequency')
      const r = this.engine!.sendBearingFromPeak(msg.buoyId, freq, msg.atSimTime)
      this.post({ v: 1, type: 'aliPeakBearing', seq: msg.seq, bearingDeg: r.bearingDeg, sigmaDeg: r.sigmaDeg, snrDb: r.snrDb, freqHz: r.freqHz })
    } catch (e) {
      this.post({ v: 1, type: 'aliPeakBearing', seq: msg.seq, bearingDeg: 0, sigmaDeg: 90, snrDb: 0, freqHz: msg.freqHz ?? 0, error: e instanceof Error ? e.message : String(e) })
    }
  }

  private dropBtBuoys(msg: Extract<ToWorker, { type: 'dropBtBuoys' }>): void {
    const engine = this.engine!
    const out: import('./contract').BtDrop[] = []
    let err: string | undefined
    try {
      for (const d of msg.drops) {
        const drop = engine.dropBtBuoy({ x: d.x, y: d.y, id: d.id })
        const mapped = {
          id: drop.id, x: drop.x, y: drop.y,
          profile: {
            profile: drop.profile.profile,
            layerDepthM: drop.profile.layerDepthM,
            sonicLayerDepthM: drop.profile.sonicLayerDepthM,
            thermoclineBaseM: drop.profile.thermoclineBaseM,
            salinityPsu: drop.profile.salinityPsu,
            outOfRange: drop.profile.outOfRange?.any,
            ...(drop.profile.deepChannelAxisM !== undefined ? { deepChannelAxisM: drop.profile.deepChannelAxisM } : {}),
          },
        }
        out.push(mapped)
        this.btDrops.push(mapped)
      }
    } catch (e) { err = e instanceof Error ? e.message : String(e) }
    this.post({ v: 1, type: 'btDropped', seq: msg.seq, drops: out, ...(err ? { error: err } : {}) })
    this.updateTactical()
  }

  private makeTactical(): Tactical {
    const s = this.engine!.scenario
    const buoys: TacticalBuoy[] = s.buoys.map((b) => {
      const typ = feBuoyType(b)
      return {
        id: b.rfChannel, channel: b.rfChannel, kind: typ, type: typ,
        x: b.x, y: b.y, hydrophoneDepthM: b.depth, batteryFrac: 1, lifeRemainingS: b.life, state: 'falling' as const,
      }
    })
    const t: Tactical = {
      v: 1, type: 'tactical', simT: 0,
      aircraft: { x: 0, y: 0, altM: AIRCRAFT_ALT_M, hdgDeg: 0, gsMps: 0 },
      buoys, bearings: [],
    }
    this.tactical = t
    this.updateTactical()
    return t
  }


  private feIdForEngineBuoy(engineId: number): number {
    const s = this.engine?.scenario.buoys
    if (!s) return engineId
    for (let i = 0; i < s.length; i++) {
      const b = s[i]!
      if (engineNumericId(b, i) === engineId) return b.rfChannel
    }
    return engineId
  }

  /** Drop a pending bearing-time history fill. Generation bumps so a late timer is a no-op. */
  private cancelBtFill(): void {
    this.btFillGen++
    if (this.btFillTimer !== undefined) {
      clearTimeout(this.btFillTimer)
      this.btFillTimer = undefined
    }
  }

  /** Post live or history bearing-time rows. `replace` clears the display ring (seek / cut / new sim).
   *  History refill uses its own setTimeout so CUT first-paint stays off the 250 ms seek budget,
   *  and so tests that drain LOFAR backfill synchronously do not also pull a 15 min BT fill onto the seek path.
   */
  private postBearingBt(replace: boolean): void {
    const engine = this.engine
    if (!engine || typeof engine.bearingEnergyHistory !== 'function') return
    if (replace) {
      this.post({ v: 1, type: 'bearingBt', replace: true, energy: [], entries: [] })
      this.lastBtT = Number.NEGATIVE_INFINITY
      this.cancelBtFill()
      const gen = this.btFillGen
      const handle = setTimeout(() => {
        if (this.btFillTimer === handle) this.btFillTimer = undefined
        if (gen === this.btFillGen) this.postBearingBtFill()
      }, 0)
      if (handle && typeof handle === 'object' && 'unref' in handle && typeof (handle as { unref: () => void }).unref === 'function') {
        (handle as { unref: () => void }).unref()
      }
      this.btFillTimer = handle
      return
    }
    this.postBearingBtLive()
  }

  private postBearingBtLive(): void {
    const engine = this.engine
    if (!engine || typeof engine.bearingEnergyHistory !== 'function') return
    try {
      const t = engine.time
      if (!(t >= this.lastBtT + 1 - 1e-9)) return
      const t0 = Math.max(0, t - 1.001)
      const energy = engine.bearingEnergyHistory(undefined, t0, t).map((row) =>
        feBearingEnergyRow(row, this.feIdForEngineBuoy(row.buoyId)))
      const entries = engine.bearingTimeHistory(t0, t).map((e) => ({
        ...e, buoyId: this.feIdForEngineBuoy(e.buoyId),
      }))
      if (energy.length === 0 && entries.length === 0) return
      this.lastBtT = Math.max(this.lastBtT, t)
      this.post({ v: 1, type: 'bearingBt', replace: false, energy, entries })
    } catch { /* a missing book must not break the gram step */ }
  }

  private postBearingBtFill(): void {
    const engine = this.engine
    if (!engine || typeof engine.bearingEnergyHistory !== 'function') return
    try {
      const t1 = engine.time
      const t0 = Math.max(0, t1 - 900)
      const energy = engine.bearingEnergyHistory(undefined, t0, t1).map((row) =>
        feBearingEnergyRow(row, this.feIdForEngineBuoy(row.buoyId)))
      const entries = engine.bearingTimeHistory(t0, t1).map((e) => ({
        ...e, buoyId: this.feIdForEngineBuoy(e.buoyId),
      }))
      this.lastBtT = t1
      this.post({ v: 1, type: 'bearingBt', replace: true, energy, entries })
    } catch { /* cut engines without a book must not break seek */ }
  }

  private updateTactical(): void {
    const engine = this.engine!, s = engine.scenario, t = this.tactical!
    t.simT = s.time
    t.aircraft.x = s.ownship.x; t.aircraft.y = s.ownship.y
    t.aircraft.hdgDeg = rad2deg(s.ownship.course); t.aircraft.gsMps = s.ownship.speed
    for (let i = 0; i < s.buoys.length; i++) {
      const b = s.buoys[i], tb = t.buoys[i]
      const alive = isAlive(b, s.time)
      const deployedAt = b.deployedAt ?? 0
      const remaining = Math.max(0, deployedAt + b.life - s.time)
      tb.x = b.x; tb.y = b.y; tb.hydrophoneDepthM = b.depth
      const typ = feBuoyType(b); tb.type = typ; tb.kind = typ
      const r = this.active.rx[i]
      if (r && this.rxEnabled && (this.active.mode !== 'res' || this.active.filter === 'BB')) { if (tb.rx) { tb.rx.gainDb = r.gainDb; tb.rx.overload = r.overload } else tb.rx = { gainDb: r.gainDb, overload: r.overload } } else tb.rx = undefined
      tb.state = s.time < deployedAt ? 'falling' : alive ? 'live' : 'dead'
      tb.lifeRemainingS = s.time < deployedAt ? b.life : remaining
      tb.batteryFrac = Math.min(1, tb.lifeRemainingS / b.life)
      if (typeof engine.buoyStatus === 'function') {
        try { const res: ResLevel = isResLevel(this.active.req.res) ? this.active.req.res : 9; const st = engine.buoyStatus(i, res); tb.status = { phase: st.phase, fill: st.fill, etaSeconds: st.etaSeconds, splashTime: st.splashTime, liveTime: st.liveTime, isTuned: st.isTuned } }
        catch { tb.status = undefined }
      }
    }
    // Sonya's autoBearings(atSimTime): quality is SNR dB, floor 10. Not generator placeholder lines.
    try {
      t.bearings = engine.autoBearings(engine.time).map((b) => ({
        buoyId: b.buoyId, freqHz: b.freqHz, brgDeg: b.brgDeg, quality: b.quality,
        contactId: b.contactId, snrDb: b.snrDb, sigmaDeg: b.sigmaDeg,
      }))
    } catch { t.bearings = [] }
    // Reveal: engine.truthContacts() only (undefined in crew when allowRevealLocation is false).
    // Never allContacts / allTruthContacts / scenario.contacts for the plot.
    const revealed = engine.truthContacts(engine.time)
    t.truth = revealed ? { contacts: revealed } : undefined
    t.aisTracks = plotContactSource(engine)
    t.btDrops = this.btDrops
  }
}
