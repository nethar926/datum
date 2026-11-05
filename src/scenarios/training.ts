import type { Scenario } from '@acoustics'
import { fictionalSignature, lloydsCpaScenario } from '@acoustics'

// Seeded training scenarios. Everything is fictional: invented hulls, nations and signatures.
// The operator flies a generic, unnamed maritime patrol aircraft.
export const SCENARIOS = ['ridgeline-field', 'm2-lloyds-cpa'] as const
export const SCENARIO_LABEL: Record<ScenarioId, string> = { 'ridgeline-field': 'Ridgeline field', 'm2-lloyds-cpa': "Lloyd's / CPA pass" }
export type ScenarioId = (typeof SCENARIOS)[number]

const kn = (k: number) => k * 0.5144444444444445
const deg = (d: number) => (d * Math.PI) / 180

export function buildScenario(id: string, seed: number, fmax: number, bins: number): Scenario {
  if (id === 'm2-lloyds-cpa') {
    // Acoustics' fictional cavitating CPA pass, re-binned to the selected display band.
    const s = lloydsCpaScenario(seed)
    s.bins = bins; s.fmax = s.fMax = fmax; s.fBin = fmax / (bins - 1); s.band = [0, fmax]
    return s
  }
  if (id !== 'ridgeline-field') throw new Error(`Unknown scenario ${id}`)
  const contact = (cid: string, x: number, y: number, depth: number, crs: number, spdKn: number, p: Partial<typeof fictionalSignature>) => ({
    id: cid, x, y, depth, course: deg(crs), speed: kn(spdKn),
    motion: [{ at: 0, course: deg(crs), speed: kn(spdKn), depth }],
    params: { ...fictionalSignature, ...p },
  })
  const buoy = (n: number, type: 'difar' | 'passive-omni', x: number, y: number, deployedAt = 0) => ({
    id: `buoy-${n}`, rfChannel: n, type, x, y, depth: type === 'difar' ? 60 : 150, course: 0, speed: 0, deployedAt, life: 4 * 3600,
  })
  return {
    v: 1, seed, mode: 'aviation', bins, fmax, time: 0,
    ownship: { x: 0, y: 7000, depth: 0, course: deg(90), speed: 110 },
    environment: { seaState: 2, shipping: 'moderate', soundSpeed: 1500, spreading: 'hybrid', transition: 2000 },
    contacts: [
      contact('k1', -2600, 1400, 90, 95, 6, { label: 'Fictional SSK "Orrin" (Valdran Navy)', shaftHz: 2.1, blades: 5, tonalHz: 72, levelDb: 140 }),
      contact('k2', 3200, -1200, 15, 290, 11, { label: 'Fictional merchant "Kestrel Line"', shaftHz: 1.4, blades: 4, tonalHz: 50, levelDb: 152 }),
      contact('k3', 1200, 2600, 120, 210, 4, { label: 'Fictional SSN "Varn" class', shaftHz: 3.3, blades: 7, tonalHz: 117, levelDb: 138 }),
    ],
    buoys: [
      buoy(11, 'difar', -2000, 2000), buoy(12, 'difar', 2000, 2000),
      buoy(13, 'difar', -2000, -2000), buoy(14, 'difar', 2000, -2000),
      buoy(21, 'passive-omni', 0, 0), buoy(22, 'passive-omni', 0, 4000, 600),
    ],
  }
}
