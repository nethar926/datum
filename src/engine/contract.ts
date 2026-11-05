// Worker ⇄ Display messages, data contract v1 (docs/data-contract.md). M1 subset.
export const CONTRACT_V = 1 as const

export type GramKind = 'lofar' | 'demon' | 'bearing'
export interface GramConfig {
  v: 1; type: 'gramConfig'; streamId: number; kind: GramKind; channel: number
  bins: number; f0: number; fBin: number; rowRateHz: number; dbFloor: number; dbCeil: number
}
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
}
export interface StreamSet { v: 1; type: 'streams'; configs: GramConfig[] }
export interface WorkerError { v: 1; type: 'error'; message: string }
export type FromWorker = StreamSet | GramRows | Tactical | WorkerError

import type { ScenarioParams } from '../scenarios/acousticsApi'
export type Band = 'lofar1k' | 'lofar2k'
export type ToWorker =
  | { type: 'init'; seed: number; scenarioId: string; band: Band; rowRateHz: number; params?: ScenarioParams; surfaceTraffic?: number; demon?: boolean }
  | { type: 'setReceiver'; enabled: boolean }
  | { type: 'setSurfaceTraffic'; value: number }      // 0 none … 1 heavy
  | { type: 'step' }                                    // advance one row period of sim time
  | { type: 'release'; buffers: ArrayBuffer[] }
