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

  private release(buffers: ArrayBuffer[]): void {
    if (buffers.length % 3 !== 0) throw new Error('Release must return whole frames')
    if (this.pool.length + buffers.length / 3 > POOL_FRAMES) throw new Error('Pool capacity exceeded')
    for (let k = 0; k < buffers.length; k += 3) {
      const [s, r, d] = [buffers[k], buffers[k + 1], buffers[k + 2]]
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
    this.updateTactical()
    this.post(this.tactical!)
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
    const contacts = t.truth!.contacts
    for (let i = 0; i < s.contacts.length; i++) {
      const c = s.contacts[i], tc = contacts[i]
      tc.x = c.x; tc.y = c.y; tc.crsDeg = rad2deg(c.course); tc.spdMps = c.speed
    }
  }
}
