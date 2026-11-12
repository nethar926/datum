/**
 * Buoy-sequence seam — mirrors native `BuoyPhase.swift` / `BuoySequence`.
 * Sonya's names: per drop `dropAltitudeM` (457.2) and `descentRateMps` (9);
 * scenario `integrationTimeS` 5…10 default 5. `buoyStatus` phases: loaded,
 * deployed, descending, integrating, tuned, plus fill, etaSeconds (sim seconds),
 * splashTime and liveTime.
 *
 * Phase timing comes from the engine's buoyStatus. The app never counts time
 * itself. Descending countdown and descent fill are gated on engine fields;
 * today's engine (691adfd) does not yet report them — do not invent them from
 * altitude / 9. The FE's INTEGRATE_MS wall timer in detune.ts is health-only
 * and is not used for these gram-lifecycle labels.
 */

export const DROP_ALTITUDE_M = 457.2
export const DESCENT_RATE_MPS = 9
export const INTEGRATION_TIME_S_DEFAULT = 5
export const INTEGRATION_TIME_S_RANGE: readonly [number, number] = [5, 10]
export const DESCENT_DURATION_S = DROP_ALTITUDE_M / DESCENT_RATE_MPS
export const METRES_PER_FOOT = 0.3048
export const ALTITUDE_FEET_OPTIONS = [1000, 1500, 2000, 2500, 3000] as const
export const DEFAULT_ALTITUDE_FEET = 1500
export const INTEGRATION_TIME_S_OPTIONS = [5, 6, 7, 8, 9, 10] as const

export function metresFromFeet(ft: number): number { return ft * METRES_PER_FOOT }
export function feetFromMetres(m: number): number { return m / METRES_PER_FOOT }
export function clampIntegrationTimeS(s: number): number {
  const [lo, hi] = INTEGRATION_TIME_S_RANGE
  return Math.min(hi, Math.max(lo, s))
}

/** Wilson's Nov 10 labels (title case, full words — never all-caps or one-word short forms). */
export const GRAM_PHASE_LABEL = {
  loaded: 'Buoy Loaded',
  deployed: 'Buoy Deployed',
  descending: 'Descending',
  integrating: 'Integrating',
  tuned: 'Tuned',
} as const

export type GramPhaseName = keyof typeof GRAM_PHASE_LABEL
export const DETUNED_LABEL = 'Detuned'
export const GRAM_PHASE_ORDER: readonly GramPhaseName[] = [
  'loaded', 'deployed', 'descending', 'integrating', 'tuned',
]

export type StartMode = 'placed' | 'unplaced'
export type UnplacedLayout = 'pattern' | 'manual'
export const START_MODE_LABEL: Record<StartMode, string> = { placed: 'Placed', unplaced: 'Unplaced' }
export const UNPLACED_LAYOUT_LABEL: Record<UnplacedLayout, string> = {
  pattern: 'Standard pattern on Start',
  manual: 'Manual',
}

/** Engine status reading — the one mapping (`fromEngine`). */
export type EngineBuoyStatusReading = {
  phase: GramPhaseName
  fill: number
  etaSeconds: number
  splashTime?: number | null
  liveTime?: number | null
}

export function fromEngine(
  phase: string,
  fill: number,
  etaSeconds: number,
  splashTime?: number | null,
  liveTime?: number | null,
): EngineBuoyStatusReading | null {
  if (!(phase in GRAM_PHASE_LABEL)) return null
  return { phase: phase as GramPhaseName, fill, etaSeconds, splashTime: splashTime ?? null, liveTime: liveTime ?? null }
}

export type MappedGramPhase =
  | { name: 'loaded' }
  | { name: 'deployed' }
  | { name: 'descending'; etaS?: number | null; fill?: number | null }
  | { name: 'integrating'; rows?: number; needed?: number; etaS?: number | null }
  | { name: 'tuned' }

/** Map an engine reading to the gram phase. Countdown/fill gated on engine values. */
export function mapEngineReading(r: EngineBuoyStatusReading, screenRows = 600): MappedGramPhase {
  switch (r.phase) {
    case 'loaded': return { name: 'loaded' }
    case 'deployed': return { name: 'deployed' }
    case 'descending': {
      const eta = Number.isFinite(r.etaSeconds) && r.etaSeconds > 0 ? r.etaSeconds : null
      const fill = r.fill > 0 ? Math.min(1, r.fill) : null
      return { name: 'descending', etaS: eta, fill }
    }
    case 'tuned': return { name: 'tuned' }
    case 'integrating': {
      const need = Math.max(1, screenRows)
      const rows = Math.min(need - 1, Math.max(1, Math.round(r.fill * need)))
      return { name: 'integrating', rows, needed: need, etaS: r.etaSeconds }
    }
  }
}

export function phaseLabel(p: MappedGramPhase | GramPhaseName): string {
  const name = typeof p === 'string' ? p : p.name
  return GRAM_PHASE_LABEL[name]
}

/** Integration / engine progress 0…1 (plot ring). Distinct from `symbolFill`. */
export function phaseFill(p: MappedGramPhase): number {
  switch (p.name) {
    case 'loaded':
    case 'deployed': return 0
    case 'descending': return Math.min(1, Math.max(0, p.fill ?? 0))
    case 'integrating': {
      if (p.rows == null || p.needed == null || p.needed <= 0) return 0
      return Math.min(1, Math.max(0, p.rows / p.needed))
    }
    case 'tuned': return 1
  }
}

/**
 * Variable-colour fill for the buoy symbol, stepped in sync with the five gram phases.
 * Loaded 0, Deployed 0.25, Descending 0.5 (or 0.25…0.5 from engine fill),
 * Integrating 0.55…0.95 from engine progress, Tuned 1. No local timers.
 */
export function symbolFill(p: MappedGramPhase): number {
  switch (p.name) {
    case 'loaded': return 0
    case 'deployed': return 0.25
    case 'descending':
      if (p.fill != null) return 0.25 + 0.25 * Math.min(1, Math.max(0, p.fill))
      return 0.5
    case 'integrating': return 0.55 + 0.40 * phaseFill(p)
    case 'tuned': return 1
  }
}

/** m:ss, or h:mm:ss from an hour. Matches native `BuoyPhase.clock`. */
export function clock(s: number): string {
  const t = Math.ceil(s), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`
}

/** Descending countdown or integrating progress. Nil when the engine did not provide eta. */
export function phaseDetail(p: MappedGramPhase, rate = 1, playing = true): string | null {
  if (p.name === 'descending') {
    const eta = p.etaS
    if (eta == null || !Number.isFinite(eta) || eta < 0) return null
    if (!playing || rate <= 0) return 'paused'
    return `~${clock(eta / rate)}`
  }
  if (p.name === 'integrating') {
    if (p.rows == null || p.needed == null) {
      const eta = p.etaS
      if (eta == null || !Number.isFinite(eta) || eta < 0) return null
      if (!playing || rate <= 0) return 'paused'
      return `~${clock(eta / rate)}`
    }
    const pct = `${Math.floor(phaseFill(p) * 100)}%`
    const eta = p.etaS
    if (eta != null && Number.isFinite(eta) && eta >= 0) {
      if (!playing || rate <= 0) return `${pct} · paused`
      return `${pct} · ~${clock(eta / rate)}`
    }
    return `${pct} · ${p.rows}/${p.needed} rows`
  }
  return null
}


/** App-side derivation when the engine has no status for the stream. Never invents descending. */
export function derivedGramPhase(opts: {
  simTime: number; deployedAt: number; feeding: boolean; rowRateHz: number; rowsNeeded: number
}): MappedGramPhase {
  const { simTime, deployedAt, feeding, rowRateHz, rowsNeeded } = opts
  if (simTime + 1e-9 < deployedAt) return { name: 'loaded' }
  const rows = Math.floor((simTime - deployedAt) * Math.max(0, rowRateHz))
  if (!feeding || rows < 1) return { name: 'deployed' }
  const needed = Math.max(1, rowsNeeded)
  return rows >= needed ? { name: 'tuned' } : { name: 'integrating', rows, needed }
}

// ---------- Settings prefs (localStorage; injectable for tests) ----------

export const SEQUENCE_PREFS_KEY = 'datum.buoySequence'

export type SequencePrefs = {
  startMode: StartMode
  unplacedLayout: UnplacedLayout
  dropAltitudeM: number
  integrationTimeS: number
}

export const DEFAULT_SEQUENCE_PREFS: SequencePrefs = {
  startMode: 'placed',
  unplacedLayout: 'pattern',
  dropAltitudeM: DROP_ALTITUDE_M,
  integrationTimeS: INTEGRATION_TIME_S_DEFAULT,
}

export type StorageLike = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

function defaultStorage(): StorageLike | null {
  try { return typeof localStorage !== 'undefined' ? localStorage : null } catch { return null }
}

export function loadSequencePrefs(storage: StorageLike | null = defaultStorage()): SequencePrefs {
  const d = { ...DEFAULT_SEQUENCE_PREFS }
  if (!storage) return d
  try {
    const raw = JSON.parse(storage.getItem(SEQUENCE_PREFS_KEY) ?? 'null') as Partial<SequencePrefs> | null
    if (!raw) return d
    const startMode: StartMode = raw.startMode === 'unplaced' ? 'unplaced' : 'placed'
    const unplacedLayout: UnplacedLayout = raw.unplacedLayout === 'manual' ? 'manual' : 'pattern'
    const dropAltitudeM = typeof raw.dropAltitudeM === 'number' && raw.dropAltitudeM > 0 && Number.isFinite(raw.dropAltitudeM)
      ? raw.dropAltitudeM : DROP_ALTITUDE_M
    const integrationTimeS = typeof raw.integrationTimeS === 'number'
      ? clampIntegrationTimeS(raw.integrationTimeS) : INTEGRATION_TIME_S_DEFAULT
    return { startMode, unplacedLayout, dropAltitudeM, integrationTimeS }
  } catch { return d }
}

export function saveSequencePrefs(p: SequencePrefs, storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return
  try { storage.setItem(SEQUENCE_PREFS_KEY, JSON.stringify(p)) } catch { /* private mode */ }
}

export function preferredAltitudeFeet(p: SequencePrefs = loadSequencePrefs()): number {
  const ft = Math.round(feetFromMetres(p.dropAltitudeM))
  return ALTITUDE_FEET_OPTIONS.reduce((best, o) => Math.abs(o - ft) < Math.abs(best - ft) ? o : best, DEFAULT_ALTITUDE_FEET)
}

/** Unplaced: defer scenario buoys so empty grams show Buoy Loaded. Does not invent phase times. */
/** Settings start mode → engine `buoyStartMode` / `autoDropPattern` and drop geometry. */
export function engineStartOptions(prefs: SequencePrefs = loadSequencePrefs()): {
  buoyStartMode: StartMode
  autoDropPattern: boolean
  dropAltitudeM: number
  descentRateMps: number
  integrationTimeS: number
} {
  return {
    buoyStartMode: prefs.startMode,
    autoDropPattern: prefs.startMode === 'unplaced' && prefs.unplacedLayout === 'pattern',
    dropAltitudeM: prefs.dropAltitudeM,
    descentRateMps: DESCENT_RATE_MPS,
    integrationTimeS: prefs.integrationTimeS,
  }
}

export function effectiveDropRun(explicit: boolean | undefined, prefs: SequencePrefs = loadSequencePrefs()): boolean {
  if (explicit !== undefined) return explicit
  return false
}

// ---------- 30 fps / 64-buoy frame budget (CPU-side; device verifies real vsync) ----------

export const FRAME_TARGET_FPS = 30
export const FRAME_BUDGET_S = 1 / FRAME_TARGET_FPS
export const FRAME_BUOY_COUNT = 64

export type FrameBuoy = { channel: number; x: number; y: number; health: 'working' | 'integrating' | 'detuned' | 'dead' }
export type FramePt = { x: number; y: number }
export type FrameCamera = { spanM: number; cx: number; cy: number }

export function sampleFrameBuoys(n = FRAME_BUOY_COUNT): FrameBuoy[] {
  const healths: FrameBuoy['health'][] = ['working', 'integrating', 'detuned', 'dead']
  return Array.from({ length: n }, (_, i) => ({
    channel: i + 1,
    x: ((i % 8) * 800) - 2800,
    y: (Math.floor(i / 8) * 800) - 2800,
    health: healths[i % 4],
  }))
}

export function sampleFrameTrack(n = 240): FramePt[] {
  return Array.from({ length: n }, (_, i) => ({ x: i * 40 - 2000, y: i * 12 }))
}

/** CPU work of one plot frame: project buoys + jet track, splash radii, integrating arcs. */
export function preparePlotFrame(
  buoys: FrameBuoy[],
  track: FramePt[],
  camera: FrameCamera,
  width: number,
  height: number,
  now: number,
): number {
  const mpp = camera.spanM / Math.min(width, height)
  let n = 0
  for (const b of buoys) {
    const sx = width / 2 + (b.x - camera.cx) / mpp
    const sy = height / 2 - (b.y - camera.cy) / mpp
    void sx; void sy
    if (b.health === 'integrating') {
      const p = (b.channel % 10) / 10
      const start = -Math.PI / 2
      const end = start + p * 2 * Math.PI
      void (Math.cos(end) + Math.sin(end))
    }
    // splash fade (700 ms), keyed on channel so the path is exercised
    const age = (now + b.channel * 0.01) % 0.7
    const k = age / 0.7
    void (6 + 22 * k) * (1 - k)
    n++
  }
  for (const p of track) {
    void (width / 2 + (p.x - camera.cx) / mpp)
    void (height / 2 - (p.y - camera.cy) / mpp)
    n++
  }
  return n
}

export function measurePlotFrame(buoyCount = FRAME_BUOY_COUNT, repeats = 30): { seconds: number; marks: number } {
  const buoys = sampleFrameBuoys(buoyCount)
  const track = sampleFrameTrack()
  const camera: FrameCamera = { spanM: 18000, cx: 0, cy: 0 }
  preparePlotFrame(buoys, track, camera, 390, 844, 10) // warm
  const t0 = performance.now()
  let marks = 0
  for (let r = 0; r < repeats; r++) {
    marks = preparePlotFrame(buoys, track, camera, 390, 844, 10 + r * FRAME_BUDGET_S)
  }
  return { seconds: (performance.now() - t0) / 1000 / Math.max(1, repeats), marks }
}
