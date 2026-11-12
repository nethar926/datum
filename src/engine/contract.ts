// Worker ⇄ Display messages, data contract v1 (docs/data-contract.md). M1 subset.
export const CONTRACT_V = 1 as const

export type GramKind = 'lofar' | 'demon' | 'bearing'
export interface GramConfig {
  v: 1; type: 'gramConfig'; streamId: number; kind: GramKind; channel: number
  bins: number; f0: number; fBin: number; rowRateHz: number; dbFloor: number; dbCeil: number
  /** m3-res fields: present only on RES grams. dB scale comes from dbFloor/dbCeil (NB 0–30, BB 40–110). */
  res?: number; filter?: GramFilter; bandHz?: number; fcHz?: number; enbwHz?: number; bandLimited?: boolean; liveBins?: number
  /** m3-res row phase: this stream's rows fall at k·P + rowPhaseS. */
  rowPhaseS?: number
  /** m3-bands: named analytic LOFAR band, stamped only when the preset alone set the band edges. */
  bandPreset?: LofarBandPresetId
  /** DEMON carrier band used at subscribe (Hz). */
  demodBandHz?: [number, number]
}
/** m3-bands analytic LOFAR band presets (engine: ELF 0–50, VLF 0–200, LF 0–500, MF 0–2000 Hz). */
export type LofarBandPresetId = 'ELF' | 'VLF' | 'LF' | 'MF'
export type GramFilter = 'NB' | 'BB'
/** band set = analytic band-preset gram (RES off); res/filter are kept for the way back to RES. */
export interface GramSettings { res: number; filter: GramFilter; band?: LofarBandPresetId }
export interface GramRows {
  v: 1; type: 'gramRows'; simT: number
  streamIds: Int32Array; rowIndex: Uint32Array; data: Float32Array
  /** m3-difar-bearing: per-bin bearing (deg true 0..360, NaN for omni), same layout as data. */
  bearingDeg?: Float32Array
}
export type BuoyKind = 'omni' | 'difar' | 'dicass' | 'vlad' | 'bt'
export interface TacticalBuoy {
  id: number; channel: number; kind: BuoyKind; x: number; y: number; hydrophoneDepthM: number
  batteryFrac: number; lifeRemainingS: number; state: 'falling' | 'live' | 'dead'
  /** Receiver front end: AGC gain relative to settled (dB) and whether the last row clipped. */
  rx?: { gainDb: number; overload: boolean }
  /** Engine deploy-sequence status (phase, fill, etaSeconds, splashTime, liveTime). */
  status?: { phase: string; fill: number; etaSeconds: number; splashTime: number; liveTime: number; isTuned?: boolean }
}
export interface Bearing { buoyId: number; freqHz: number; brgDeg: number; quality: number }
export interface TruthContact { id: number; label: string; x: number; y: number; crsDeg: number; spdMps: number
  /** v1.2 (m3-lines) fields, optional so older engines still work. */
  active?: boolean; depthM?: number; spdKts?: number
  propulsion?: import('../gram/truthFamilies').PropulsionTruthLite; lines?: import('../gram/truthFamilies').TruthLineLite[]
  speedGated?: import('../gram/truthFamilies').SpeedGatedLite[]; sourceId?: string; category?: 'surface' | 'subsurface'
}
export interface Tactical {
  v: 1; type: 'tactical'; simT: number
  aircraft: { x: number; y: number; altM: number; hdgDeg: number; gsMps: number }
  buoys: TacticalBuoy[]; bearings: Bearing[]; truth?: { contacts: TruthContact[] }
  /** Surface-only AIS from AcousticEngine.aisTracks (plotContactSource). */
  aisTracks?: { id: string; name: string; x: number; y: number; crsDeg: number; spdMps: number }[]
}
export interface StreamSet { v: 1; type: 'streams'; configs: GramConfig[] }
export interface WorkerError { v: 1; type: 'error'; message: string }
/** m3-fe-gram-handoff: a second LOFAR stream set subscribed with new RES/filter/vernier settings, rows flowing
 * alongside the displayed set until the display promotes it (gen matches the client's subscribeGram). */
export interface PendingStreamSet { v: 1; type: 'pendingStreams'; gen: number; configs: GramConfig[] }
/** m3-fe-drop: one buoy to lay (engine dropBuoy). channel is a suggestion; the host bumps it to a free RF channel. */
export interface DropSpec { kind: 'omni' | 'difar'; x: number; y: number; channel?: number; depthM?: number; lifeS?: number; dropAltitudeM?: number; descentRateMps?: number; integrationTimeS?: number }
export type DropSource = 'manual' | 'auto'
/** m3-fe-drop: reply to dropBuoys (after the new streams + tactical): the RF channels laid, or why it stopped short. */
export interface BuoysDropped { v: 1; type: 'dropped'; seq: number; source: DropSource; channels: number[]; error?: string }
/** CUT seek: bulk LOFAR window ending at simT (FE-side silent drain; no visible fast-forward). */
export type CutSeekPhase = 'first' | 'backfill' | 'done'
export interface CutSeeked {
  v: 1; type: 'cutSeeked'; simT: number; streamId: number; bins: number; rowCount: number
  rowIndex: Uint32Array; data: Float32Array; bearingDeg?: Float32Array
  /** Host-measured fill latency (ms) for this message's rows. */
  elapsedMs: number
  /** Monotonic seek generation — a newer scrub cancels stale backfills. */
  gen: number
  phase: CutSeekPhase
  /** Total rows the backfill is aiming for (FULL). */
  fullRows: number
}
/** Chunked history drain progress: inclusive [fromRow, toRow], packed oldest-first landed rows. */
export interface DrainProgress {
  v: 1; type: 'drainProgress'
  streamId: number; handleId: number; fromRow: number; toRow: number
  filledFrom: number; totalRows: number
  state: 'running' | 'done' | 'cancelled'
  bins: number
  data: Float32Array
  bearingDeg?: Float32Array
}
export type FromWorker = StreamSet | GramRows | Tactical | WorkerError | PendingStreamSet | BuoysDropped | CutSeeked | DrainProgress

import type { ScenarioParams } from '../scenarios/acousticsApi'
export type Band = 'lofar1k' | 'lofar2k'
export type ToWorker =
  | { type: 'init'; seed: number; scenarioId: string; band: Band; rowRateHz: number; params?: ScenarioParams; surfaceTraffic?: number; demon?: boolean
      /** RES mode for every LOFAR stream (1024 bins, rows every P s). Omit for the legacy 4 Hz gram. */
      gram?: GramSettings
      /** m3-bands: with no gram, subscribe this analytic band preset per buoy (RES off). */
      bandPreset?: LofarBandPresetId
      buoyStartMode?: 'placed' | 'unplaced'
      autoDropPattern?: boolean
      dropAltitudeM?: number
      descentRateMps?: number
      integrationTimeS?: number }
  | { type: 'setReceiver'; enabled: boolean }
  | { type: 'setSurfaceTraffic'; value: number }      // 0 none … 1 heavy
  | { type: 'setGram'; res?: number; filter?: GramFilter; vernierHz?: number | null } // all LOFAR streams
  /** Gram handoff: subscribe a pending LOFAR stream per buoy with these settings (drops any older pending set). */
  | { type: 'subscribeGram'; gen: number; res?: number; filter?: GramFilter; vernierHz?: number
      /** m3-bands: subscribe the analytic band preset instead (exclusive with res/filter/vernierHz in the engine). */
      bandPreset?: LofarBandPresetId }
  /** Pending set `gen` becomes the displayed set; the old displayed streams are unsubscribed. */
  | { type: 'promoteGram'; gen: number }
  /** Unsubscribe pending set `gen` (superseded or abandoned). */
  | { type: 'dropGram'; gen: number }
  /** m3-fe-drop: lay buoys now; each gets a LOFAR stream like the field's (and a pending one during a handoff). */
  | { type: 'dropBuoys'; seq: number; source: DropSource; buoys: DropSpec[] }
  | { type: 'step' }                                    // advance one row period of sim time
  /** CUT mode: silent seek to simT; host posts cutSeeked + tactical (preserves play/pause on the client). */
  | { type: 'seekCut'; simT: number; windowRows?: number }
  /** CUT mode: dispose the live CutSession (+ abandoned backfill) without leaving the worker. */
  | { type: 'disposeCut' }
  | { type: 'release'; buffers: ArrayBuffer[] }
