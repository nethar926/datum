import * as Acoustics from '@acoustics'
import { Receiver } from './receiver'
import { AcousticEngine, isAlive } from '@acoustics'
import type { Band, Bearing, FromWorker, GramConfig, GramRows, LofarBandPresetId, Tactical, TacticalBuoy, TruthContact, ToWorker } from './contract'
import { buildScenario } from '../scenarios/training'

export const BANDS: Record<Band, { fmax: number; bins: number }> = {
  lofar1k: { fmax: 1000, bins: 2048 },
  lofar2k: { fmax: 2000, bins: 2048 },
}
export const POOL_FRAMES = 3
const ORBIT_RADIUS_M = 7000
const AIRCRAFT_ALT_M = 450 // display value for the fictional patrol aircraft

type Post = (msg: FromWorker, transfer?: Transferable[]) => void
interface Frame { streamIds: Int32Array; rowIndex: Uint32Array; data: Float32Array; bearingDeg?: Float32Array }
type EngineSubscribe = (req: { channel: number; res?: number; filter?: 'NB' | 'BB'; vernierHz?: number; bandPreset?: LofarBandPresetId }) => GramConfig & { simT?: number }
type EngineSetGram = (id: number, p: { res?: number; filter?: 'NB' | 'BB'; vernierHz?: number | null }) => GramConfig & { simT?: number }
/** Engine gramConfig → display contract (drops simT; keeps the RES fields). */
const toConfig = (c: GramConfig & { simT?: number }): GramConfig => { const { simT: _t, ...rest } = c; return { ...rest, type: 'gramConfig', v: 1 } }
const rad2deg = (r: number) => ((((r * 180) / Math.PI) % 360) + 360) % 360

/**
 * One LOFAR stream per buoy, all alike. 'legacy' = the engine's registered pull streams (always a row);
 * 'res' = m3-res zoom-FFT subscriptions (rows every P s, phase-staggered); 'band' = m3-bands analytic
 * subscriptions with a named bandPreset (4 Hz in the engine, drained to the newest row once per host step).
 */
interface LofarSet { mode: 'legacy' | 'res' | 'band'; ids: Int32Array; configs: GramConfig[]; bins: number; filter: 'NB' | 'BB'; rx: Receiver[] }

/** Worker-side host: owns an AcousticEngine and speaks the data contract. Pure enough to unit test without a Worker. */
export class SimHost {
  private engine?: AcousticEngine
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
  private rxEnabled = true
  private demonConfigs: GramConfig[] = []
  /** Displayed LOFAR set (one receiver front end per stream; rxEnabled=false gives an ideal receiver). */
  private active: LofarSet = { mode: 'legacy', ids: new Int32Array(0), configs: [], bins: 0, filter: 'NB', rx: [] }
  /** m3-fe-gram-handoff: pending set (pendingGen > 0 while one exists), filling alongside the displayed one. */
  private pending?: LofarSet
  private pendingGen = 0
  constructor(private readonly post: Post) {}

  handle(msg: ToWorker): void {
    try {
      if (msg.type === 'init') return this.init(msg)
      if (!this.engine) throw new Error('Initialize first')
      if (msg.type === 'release') return this.release(msg.buffers)
      if (msg.type === 'step') return this.step()
      if (msg.type === 'setSurfaceTraffic') return this.setSurfaceTraffic(msg.value)
      if (msg.type === 'setGram') return this.setGram(msg)
      if (msg.type === 'subscribeGram') return this.subscribeGram(msg)
      if (msg.type === 'promoteGram') return this.promoteGram(msg.gen)
      if (msg.type === 'dropGram') { if (msg.gen === this.pendingGen) this.dropPending(); return }
      if (msg.type === 'setReceiver') { this.rxEnabled = !!msg.enabled; for (const r of this.active.rx) r.reset(); for (const r of this.pending?.rx ?? []) r.reset(); return }
      throw new Error('Unknown message')
    } catch (e) {
      this.post({ v: 1, type: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }

  private init(msg: Extract<ToWorker, { type: 'init' }>): void {
    const band = BANDS[msg.band]
    if (!band) throw new Error('Unknown band')
    if (!Number.isFinite(msg.rowRateHz) || msg.rowRateHz < 0.25 || msg.rowRateHz > 8) throw new Error('rowRateHz out of range')
    const gen = (Acoustics as unknown as { generateScenario?: (p: unknown) => ConstructorParameters<typeof AcousticEngine>[0] }).generateScenario
    const engine = new AcousticEngine(msg.params && gen ? gen(msg.params) : buildScenario(msg.scenarioId, msg.seed >>> 0, band.fmax, band.bins))
    this.engine = engine
    this.n = engine.scenario.buoys.length
    this.dt = 1 / msg.rowRateHz; this.rowRateHz = msg.rowRateHz
    this.rowCount = 0
    this.pending = undefined; this.pendingGen = 0
    this.pools = new Map()
    const setGram = (engine as unknown as { setGram?: EngineSetGram }).setGram
    const ids = new Int32Array(this.n); for (let i = 0; i < this.n; i++) ids[i] = i + 1
    if (msg.gram && typeof setGram === 'function') {
      const configs = engine.scenario.buoys.map((_, i) => toConfig(setGram.call(engine, i + 1, { res: msg.gram!.res, filter: msg.gram!.filter })))
      this.active = this.makeSet('res', ids, configs)
    } else if (msg.bandPreset && this.canSubscribe()) {
      this.active = this.subscribeSet({ bandPreset: msg.bandPreset })
    } else {
      const fBin = band.fmax / (band.bins - 1)
      this.active = this.makeSet('legacy', ids, engine.scenario.buoys.map((b, i) => ({
        v: 1, type: 'gramConfig', streamId: i + 1, kind: 'lofar', channel: b.rfChannel,
        bins: band.bins, f0: 0, fBin, rowRateHz: msg.rowRateHz, dbFloor: 40, dbCeil: 110,
      })))
    }
    this.ensurePool(this.active.bins)
    this.tactical = this.makeTactical()
    const configs: GramConfig[] = this.active.configs.slice()
    this.demonIds = []; this.demonPool = []; this.demonBins = 0
    const sub = (engine as unknown as { subscribe?: (r: { kind: 'demon'; buoyId: number }) => number }).subscribe
    const all = (engine as unknown as { configs?: () => GramConfig[] }).configs
    if (msg.demon !== false && typeof sub === 'function' && typeof all === 'function') {
      try {
        engine.scenario.buoys.forEach((b, i) => {
          const id = (b as { id?: string }).id
          this.demonIds.push(sub.call(engine, { kind: 'demon', buoyId: Number(String(id ?? '').replace(/\D/g, '')) || i + 1 }))
        })
        const dc = all.call(engine).filter((c) => c.kind === 'demon' && this.demonIds.includes(c.streamId))
        if (dc.length === this.demonIds.length && dc.length) {
          this.demonBins = dc[0].bins
          // Rows are emitted once per host step, so the display's time axis uses the host row rate.
          for (const c of dc) configs.push({ v: 1, type: 'gramConfig', streamId: c.streamId, kind: 'demon', channel: c.channel, bins: c.bins, f0: c.f0, fBin: c.fBin, rowRateHz: msg.rowRateHz, dbFloor: c.dbFloor, dbCeil: c.dbCeil })
          for (let k = 0; k < POOL_FRAMES; k++) this.demonPool.push(this.newDemonFrame())
        } else this.demonIds = []
      } catch { this.demonIds = []; this.demonBins = 0 }
    }
    this.demonConfigs = configs.filter((c) => c.kind === 'demon')
    this.post({ v: 1, type: 'streams', configs })
    this.post(this.tactical)
    if (msg.surfaceTraffic !== undefined) this.setSurfaceTraffic(msg.surfaceTraffic)
  }

  private makeSet(mode: LofarSet['mode'], ids: Int32Array, configs: GramConfig[]): LofarSet {
    return { mode, ids, configs, bins: configs[0]?.bins ?? 0, filter: configs[0]?.filter ?? 'NB', rx: Array.from({ length: this.n }, () => new Receiver()) }
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
        // Band streams are drained once per host step, so the display's time axis uses the host row rate.
        if (p.bandPreset) c.rowRateHz = this.rowRateHz
        ids[i] = c.streamId; configs.push(c)
      }
    } catch (e) { for (const c of configs) engine.unsubscribe(c.streamId); throw e }
    return this.makeSet(p.bandPreset ? 'band' : 'res', ids, configs)
  }

  /** RES/filter/vernier change for every LOFAR stream; re-announces the streams (same ids, same frame size). */
  private setGram(msg: Extract<ToWorker, { type: 'setGram' }>): void {
    if (this.active.mode !== 'res') throw new Error('setGram needs a RES-mode init')
    const engine = this.engine!, set = (engine as unknown as { setGram: EngineSetGram }).setGram
    const patch: { res?: number; filter?: 'NB' | 'BB'; vernierHz?: number | null } = {}
    if (msg.res !== undefined) patch.res = msg.res
    if (msg.filter !== undefined) patch.filter = msg.filter
    if (msg.vernierHz !== undefined) patch.vernierHz = msg.vernierHz
    if (this.pendingGen) this.dropPending()
    const a = this.active
    a.configs = a.configs.map((c) => toConfig(set.call(engine, c.streamId, patch)))
    a.filter = a.configs[0]?.filter ?? 'NB'
    for (const r of a.rx) r.reset()
    this.post({ v: 1, type: 'streams', configs: [...a.configs, ...this.demonConfigs] })
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
      const lofarShaped = s.byteLength === this.n * 4 && r.byteLength === this.n * 4 && d.byteLength > this.n * 4
      const pool = lofarShaped ? this.pools.get(d.byteLength / (this.n * 4)) : undefined
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

  /** Advance one row period. With no free frame the sim waits (backpressure never drops sim time). */
  private step(): void {
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
    if (due) this.stepDemon() // DEMON drains alongside displayed LOFAR rows, as before
    this.updateTactical()
    this.post(this.tactical!)
  }

  private anyReady(ids: Int32Array): boolean {
    const e = this.engine as unknown as { rowsReady: (id: number) => number }
    for (let i = 0; i < ids.length; i++) if (e.rowsReady(ids[i]) > 0) return true
    return false
  }

  private writeLofar(frame: Frame, set: LofarSet): void {
    const engine = this.engine!, bins = set.bins
    const e = engine as unknown as { writeBearingRow?: (id: number, out: Float32Array, off: number) => void; rowsReady: (id: number) => number }
    const wb = e.writeBearingRow
    // NB rows are already TPSW-normalised; the AGC model only applies to absolute (BB / legacy / band) levels.
    const rxOn = this.rxEnabled && (set.mode !== 'res' || set.filter === 'BB')
    for (let i = 0; i < this.n; i++) {
      const id = set.ids[i], off = i * bins
      frame.streamIds[i] = id
      let idx = engine.writeRow(id, frame.data, off)
      // Band subscriptions are ready at 4 Hz; drain to the newest so the display stays current (engine has no skip).
      if (set.mode === 'band') while (idx >= 0 && e.rowsReady(id) > 0) idx = engine.writeRow(id, frame.data, off)
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

  /** One DEMON row per stream per step (draining any extra ready rows so the display stays current). Skipped if no frame is free. */
  private stepDemon(): void {
    if (!this.demonIds.length) return
    const frame = this.demonPool.pop()
    if (!frame) return
    const e = this.engine as unknown as { writeRow: (id: number, out: Float32Array, off: number) => number; rowsReady?: (id: number) => number }
    let any = false
    for (let i = 0; i < this.demonIds.length; i++) {
      const id = this.demonIds[i], off = i * this.demonBins
      frame.streamIds[i] = id
      let idx = -1
      do { const r = e.writeRow(id, frame.data, off); if (r < 0) break; idx = r } while ((e.rowsReady?.(id) ?? 0) > 0)
      if (idx < 0) frame.data.fill(NaN, off, off + this.demonBins)
      else any = true
      frame.rowIndex[i] = Math.max(0, idx)
    }
    if (!any) { this.demonPool.push(frame); return }
    const rows: GramRows = { v: 1, type: 'gramRows', simT: this.engine!.time, ...frame }
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

  private makeTactical(): Tactical {
    const s = this.engine!.scenario
    const buoys: TacticalBuoy[] = s.buoys.map((b) => ({
      id: b.rfChannel, channel: b.rfChannel, kind: b.type === 'passive-omni' ? 'omni' : 'difar',
      x: b.x, y: b.y, hydrophoneDepthM: b.depth, batteryFrac: 1, lifeRemainingS: b.life, state: 'falling',
    }))
    const contacts: TruthContact[] = s.contacts.map((c, i) => ({ id: i + 1, label: c.params.label, x: c.x, y: c.y, crsDeg: 0, spdMps: 0 }))
    const t: Tactical = {
      v: 1, type: 'tactical', simT: 0,
      aircraft: { x: 0, y: 0, altM: AIRCRAFT_ALT_M, hdgDeg: 0, gsMps: 0 },
      buoys, bearings: [], truth: { contacts },
    }
    this.tactical = t
    this.updateTactical()
    return t
  }

  private updateTactical(): void {
    const engine = this.engine!, s = engine.scenario, t = this.tactical!
    t.simT = s.time
    t.aircraft.x = s.ownship.x; t.aircraft.y = s.ownship.y
    t.aircraft.hdgDeg = rad2deg(s.ownship.course); t.aircraft.gsMps = s.ownship.speed
    const bearings: Bearing[] = []
    for (let i = 0; i < s.buoys.length; i++) {
      const b = s.buoys[i], tb = t.buoys[i]
      const alive = isAlive(b, s.time)
      const remaining = Math.max(0, b.deployedAt + b.life - s.time)
      tb.x = b.x; tb.y = b.y; tb.hydrophoneDepthM = b.depth
      const r = this.active.rx[i]
      if (r && this.rxEnabled && (this.active.mode !== 'res' || this.active.filter === 'BB')) { if (tb.rx) { tb.rx.gainDb = r.gainDb; tb.rx.overload = r.overload } else tb.rx = { gainDb: r.gainDb, overload: r.overload } } else tb.rx = undefined
      tb.state = s.time < b.deployedAt ? 'falling' : alive ? 'live' : 'dead'
      tb.lifeRemainingS = s.time < b.deployedAt ? b.life : remaining
      tb.batteryFrac = Math.min(1, tb.lifeRemainingS / b.life)
      if (alive && b.type === 'difar') {
        const g = engine.generators[i]
        for (let k = 0; k < g.lineCount; k++) {
          const l = g.lines[k]
          bearings.push({ buoyId: b.rfChannel, freqHz: l.freqHz, brgDeg: l.brgDeg, quality: l.quality })
        }
      }
    }
    t.bearings = bearings
    // m3-lines engines publish full truth (propulsion, TPK, propulsor, speed-gated lines); use it as is.
    // The engine reuses those records, and postMessage clones them, so this allocates nothing per step.
    const et = (engine as unknown as { tactical?: () => { truth?: { contacts: TruthContact[] } } }).tactical?.().truth
    if (et?.contacts) { t.truth = et; return }
    // Contacts can be added/removed at runtime (v1.1 surface traffic); resync the truth list when the count changes.
    if (t.truth!.contacts.length !== s.contacts.length)
      t.truth!.contacts = s.contacts.map((c, i) => ({ id: i + 1, label: c.params?.label ?? `C${i + 1}`, x: c.x, y: c.y, crsDeg: 0, spdMps: 0 }))
    const contacts = t.truth!.contacts
    for (let i = 0; i < s.contacts.length; i++) {
      const c = s.contacts[i], tc = contacts[i]
      tc.x = c.x; tc.y = c.y; tc.crsDeg = rad2deg(c.course); tc.spdMps = c.speed
    }
  }
}
