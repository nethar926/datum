import * as Acoustics from '@acoustics'
import { AcousticEngine, isAlive } from '@acoustics'
import type { Band, Bearing, FromWorker, GramConfig, GramRows, Tactical, TacticalBuoy, TruthContact, ToWorker } from './contract'
import { buildScenario } from '../scenarios/training'

export const BANDS: Record<Band, { fmax: number; bins: number }> = {
  lofar1k: { fmax: 1000, bins: 2048 },
  lofar2k: { fmax: 2000, bins: 2048 },
}
export const POOL_FRAMES = 3
const ORBIT_RADIUS_M = 7000
const AIRCRAFT_ALT_M = 450 // display value for the fictional patrol aircraft

type Post = (msg: FromWorker, transfer?: Transferable[]) => void
interface Frame { streamIds: Int32Array; rowIndex: Uint32Array; data: Float32Array }
const rad2deg = (r: number) => ((((r * 180) / Math.PI) % 360) + 360) % 360

/** Worker-side host: owns an AcousticEngine and speaks the data contract. Pure enough to unit test without a Worker. */
export class SimHost {
  private engine?: AcousticEngine
  private pool: Frame[] = []
  /** DEMON streams (v1.1 engines): own pool and own gramRows message, since bins differ from LOFAR. */
  private demonPool: Frame[] = []
  private demonIds: number[] = []
  private demonBins = 0
  private bins = 0
  private n = 0
  private dt = 0.5
  private rowCount = 0
  private tactical?: Tactical
  constructor(private readonly post: Post) {}

  handle(msg: ToWorker): void {
    try {
      if (msg.type === 'init') return this.init(msg)
      if (!this.engine) throw new Error('Initialize first')
      if (msg.type === 'release') return this.release(msg.buffers)
      if (msg.type === 'step') return this.step()
      if (msg.type === 'setSurfaceTraffic') return this.setSurfaceTraffic(msg.value)
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
    this.bins = band.bins
    this.n = engine.scenario.buoys.length
    this.dt = 1 / msg.rowRateHz
    this.rowCount = 0
    this.pool = []
    for (let i = 0; i < POOL_FRAMES; i++) this.pool.push(this.newFrame())
    this.tactical = this.makeTactical()
    const fBin = band.fmax / (band.bins - 1)
    const configs: GramConfig[] = engine.scenario.buoys.map((b, i) => ({
      v: 1, type: 'gramConfig', streamId: i + 1, kind: 'lofar', channel: b.rfChannel,
      bins: band.bins, f0: 0, fBin, rowRateHz: msg.rowRateHz, dbFloor: 40, dbCeil: 110,
    }))
    this.demonIds = []; this.demonPool = []; this.demonBins = 0
    const sub = (engine as unknown as { subscribe?: (r: { kind: 'demon'; buoyId: number }) => number }).subscribe
    const all = (engine as unknown as { configs?: () => GramConfig[] }).configs
    if (typeof sub === 'function' && typeof all === 'function') {
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
    this.post({ v: 1, type: 'streams', configs })
    this.post(this.tactical)
    if (msg.surfaceTraffic !== undefined) this.setSurfaceTraffic(msg.surfaceTraffic)
  }

  /** Forwards to the engine's v1.1 setSurfaceTraffic when present; a no-op on v1 engines. */
  private setSurfaceTraffic(value: number): void {
    if (!Number.isFinite(value)) throw new Error('surfaceTraffic must be a number')
    const e = this.engine as unknown as { setSurfaceTraffic?: (v: number) => void } | undefined
    e?.setSurfaceTraffic?.(Math.max(0, Math.min(1, value)))
  }

  private newFrame(): Frame {
    const streamIds = new Int32Array(this.n)
    for (let i = 0; i < this.n; i++) streamIds[i] = i + 1
    return { streamIds, rowIndex: new Uint32Array(this.n), data: new Float32Array(this.n * this.bins) }
  }

  private newDemonFrame(): Frame {
    const n = this.demonIds.length
    return { streamIds: Int32Array.from(this.demonIds), rowIndex: new Uint32Array(n), data: new Float32Array(n * this.demonBins) }
  }

  private release(buffers: ArrayBuffer[]): void {
    if (buffers.length % 3 !== 0) throw new Error('Release must return whole frames')
    for (let k = 0; k < buffers.length; k += 3) {
      const [s, r, d] = [buffers[k], buffers[k + 1], buffers[k + 2]]
      const dn = this.demonIds.length
      if (dn && s.byteLength === dn * 4 && r.byteLength === dn * 4 && d.byteLength === dn * this.demonBins * 4 && d.byteLength !== this.n * this.bins * 4) {
        if (this.demonPool.length >= POOL_FRAMES) throw new Error('Pool capacity exceeded')
        this.demonPool.push({ streamIds: new Int32Array(s), rowIndex: new Uint32Array(r), data: new Float32Array(d) })
        continue
      }
      if (this.pool.length >= POOL_FRAMES) throw new Error('Pool capacity exceeded')
      // Stale buffers from a previous init (different size) are silently dropped.
      if (s.byteLength !== this.n * 4 || r.byteLength !== this.n * 4 || d.byteLength !== this.n * this.bins * 4) continue
      this.pool.push({ streamIds: new Int32Array(s), rowIndex: new Uint32Array(r), data: new Float32Array(d) })
    }
  }

  /** Advance one row period. With no free frame the sim waits (backpressure never drops sim time). */
  private step(): void {
    const engine = this.engine!
    const frame = this.pool.pop()
    if (!frame) return
    this.steerOrbit()
    engine.advance(this.dt)
    for (let i = 0; i < this.n; i++) {
      frame.streamIds[i] = i + 1
      frame.rowIndex[i] = this.rowCount
      engine.writeRow(i + 1, frame.data, i * this.bins)
    }
    this.rowCount++
    const rows: GramRows = { v: 1, type: 'gramRows', simT: engine.time, ...frame }
    this.post(rows, [frame.streamIds.buffer, frame.rowIndex.buffer, frame.data.buffer])
    this.stepDemon()
    this.updateTactical()
    this.post(this.tactical!)
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
