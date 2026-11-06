import type { ScenarioParams } from '../scenarios/acousticsApi'

/** Random-start boat filter. Plant buckets follow the acoustics rarity keys (AIP is a diesel bucket). */
export type PlantPick = 'diesel' | 'nuclear' | 'any'
export const PLANT_PICKS: { id: PlantPick; label: string }[] = [{ id: 'diesel', label: 'Diesel' }, { id: 'nuclear', label: 'Nuke' }, { id: 'any', label: 'Any' }]
export const DIESEL_KEYS = ['dieselDirect', 'dieselGearReduction', 'dieselElectric', 'aip'] as const
export const NUCLEAR_KEYS = ['nuclearGearReduction', 'nuclearElectric'] as const
export const SIM_START_KEY = 'datum.simStart'

export const plantOfKey = (k: string): 'diesel' | 'nuclear' | null =>
  (DIESEL_KEYS as readonly string[]).includes(k) ? 'diesel' : (NUCLEAR_KEYS as readonly string[]).includes(k) ? 'nuclear' : null

/** Zero the other plant's weights, keeping relative rarity inside the picked plant. Falls back to equal weights if the pick had none. */
export function applyPlant(p: ScenarioParams, plant: PlantPick): ScenarioParams {
  if (plant === 'any') return p
  const w: Record<string, number> = {}
  let total = 0
  for (const [k, v] of Object.entries(p.rarityWeights)) { const keep = plantOfKey(k) === plant; w[k] = keep ? v : 0; if (keep) total += v }
  if (total <= 0) for (const k of plant === 'diesel' ? DIESEL_KEYS : NUCLEAR_KEYS) w[k] = 1
  return { ...p, rarityWeights: w }
}

/** Which plant the weights currently allow (for showing state in Advanced). */
export function plantOfWeights(w: Record<string, number>): PlantPick {
  let d = 0, n = 0
  for (const [k, v] of Object.entries(w)) { const pl = plantOfKey(k); if (pl === 'diesel') d += v; else if (pl === 'nuclear') n += v }
  return d > 0 && n <= 0 ? 'diesel' : n > 0 && d <= 0 ? 'nuclear' : 'any'
}

export interface SimStartPrefs { diff: 'easy' | 'regular' | 'difficult'; plant: PlantPick; lastSeed?: number }
export const DEFAULT_SIM_START: SimStartPrefs = { diff: 'regular', plant: 'any' }
export function loadSimStart(): SimStartPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(SIM_START_KEY) ?? 'null') as Partial<SimStartPrefs> | null
    return {
      diff: v && ['easy', 'regular', 'difficult'].includes(v.diff as string) ? v.diff as SimStartPrefs['diff'] : DEFAULT_SIM_START.diff,
      plant: v && ['diesel', 'nuclear', 'any'].includes(v.plant as string) ? v.plant as PlantPick : DEFAULT_SIM_START.plant,
      ...(v && parseSeed(String(v.lastSeed ?? '')) !== null ? { lastSeed: parseSeed(String(v.lastSeed))! } : {}),
    }
  } catch { return { ...DEFAULT_SIM_START } }
}
export function saveSimStart(p: SimStartPrefs) { try { localStorage.setItem(SIM_START_KEY, JSON.stringify(p)) } catch { /* private mode */ } }

export const SEED_MAX = 4294967295
/** Trainee-typed seed: digits only after stripping "#", spaces, commas; 0..2^32-1. Null if not a seed. */
export function parseSeed(s: string): number | null {
  const t = s.replace(/[#\s,_]/g, '')
  if (!/^\d{1,10}$/.test(t)) return null
  const v = Number(t)
  return v <= SEED_MAX ? v : null
}
export const randomSeed = () => (Math.random() * 2 ** 31) >>> 0
