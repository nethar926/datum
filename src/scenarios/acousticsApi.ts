/**
 * Optional acoustics v1.1 functions (presets, CPA/Lloyd fits, scenario generation). They are looked up on the
 * acoustics namespace at runtime so the display works before and after m2-acoustics merges, with no code change.
 */
import * as Acoustics from '@acoustics'

export type Difficulty = 'easy' | 'regular' | 'difficult'
/** Mirror of acoustics ScenarioParams (v1.1). Plain operator-editable data. */
export interface ScenarioParams {
  subCount: number
  rarityWeights: Record<string, number>
  opState: { speedKn: [number, number]; depthM: [number, number]; quietProb: number; cavitationAllowed: boolean }
  seaState: number; surfaceTraffic: number; cpaRangeKm: [number, number]; buoyLifeMin: number; seed: number
}
interface V11 {
  presetToParams: (d: Difficulty, seed: number) => ScenarioParams
  clampParams: (v: unknown) => ScenarioParams
  fitCpaFromDoppler: (samples: { tS: number; fHz: number }[]) => { ok: boolean; f0: number; speed: number; tCPA: number; rCPA: number }
  fitLloydsMirror: (samples: { simT: number; spacingHz: number }[], opts: { zrM: number; cMps?: number; rangeSource?: { kind: 'cpaFit' | 'manual'; rCPA: number; speed: number; tCPA?: number } | 'none' }) =>
    { ok: boolean; basis: 'cpaFit' | 'manual' | 'none'; zs: number; depthRatio: number; rCPA: number; speed: number; tCPA: number; residualRms: number }
}
const ns = Acoustics as unknown as Partial<V11>
export const acousticsV11 = {
  presetToParams: typeof ns.presetToParams === 'function' ? ns.presetToParams : null,
  clampParams: typeof ns.clampParams === 'function' ? ns.clampParams : null,
  fitCpaFromDoppler: typeof ns.fitCpaFromDoppler === 'function' ? ns.fitCpaFromDoppler : null,
  fitLloydsMirror: typeof ns.fitLloydsMirror === 'function' ? ns.fitLloydsMirror : null,
}

/** Surface traffic slider stops (display labels; the engine takes the 0..1 value). */
export const TRAFFIC_STOPS = [
  { v: 0, label: 'None' }, { v: 0.25, label: 'Light' }, { v: 0.5, label: 'Moderate' }, { v: 1, label: 'Heavy' },
] as const
export function trafficLabel(v: number): string {
  let best: (typeof TRAFFIC_STOPS)[number] = TRAFFIC_STOPS[0]
  for (const s of TRAFFIC_STOPS) if (Math.abs(s.v - v) < Math.abs(best.v - v)) best = s
  return Math.abs(best.v - v) < 0.06 ? best.label : `${best.label}~`
}
