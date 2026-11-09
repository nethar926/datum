import type { ScenarioParams } from '../scenarios/acousticsApi'
import { COMING_SOON_LABEL, isNuclearPlant } from '../cuts/comingSoon'

/** Random-start boat filter. Plant buckets follow the acoustics rarity keys (AIP is a diesel bucket).
 * Nuclear is Coming soon: kept in the picker as a disabled entry; procedural draws never use it. */
export type PlantPick = 'diesel' | 'nuclear' | 'any'
export const PLANT_PICKS: { id: PlantPick; label: string; comingSoon?: boolean }[] = [
  { id: 'diesel', label: 'Diesel' },
  { id: 'nuclear', label: 'Nuke', comingSoon: true },
  { id: 'any', label: 'Any' },
]
export const DIESEL_KEYS = ['dieselDirect', 'dieselGearReduction', 'dieselElectric', 'aip'] as const
export const NUCLEAR_KEYS = ['nuclearGearReduction', 'nuclearElectric'] as const
export const SIM_START_KEY = 'datum.simStart'
export { COMING_SOON_LABEL }

export const plantOfKey = (k: string): 'diesel' | 'nuclear' | null =>
  (DIESEL_KEYS as readonly string[]).includes(k) ? 'diesel' : (NUCLEAR_KEYS as readonly string[]).includes(k) ? 'nuclear' : null

export const isPlantComingSoon = (plant: PlantPick): boolean => isNuclearPlant(plant)

/** Legacy nuclear-only prefs migrate to any (Coming soon). */
export function migratePlantPick(plant: string | undefined | null): PlantPick {
  if (plant === 'diesel' || plant === 'any') return plant
  if (plant === 'nuclear') return 'any'
  return DEFAULT_SIM_START.plant
}

/** Zero nuclear buckets. For diesel, also zero the other plant. Nuclear pick is treated as any. */
export function applyPlant(p: ScenarioParams, plant: PlantPick): ScenarioParams {
  const pick = isPlantComingSoon(plant) ? 'any' : plant
  if (pick === 'any') {
    const w: Record<string, number> = { ...p.rarityWeights }
    for (const k of NUCLEAR_KEYS) w[k] = 0
    return { ...p, rarityWeights: w }
  }
  const w: Record<string, number> = {}
  let total = 0
  for (const [k, v] of Object.entries(p.rarityWeights)) {
    const keep = plantOfKey(k) === pick
    w[k] = keep ? v : 0
    if (keep) total += v
  }
  if (total <= 0) for (const k of DIESEL_KEYS) w[k] = 1
  for (const k of NUCLEAR_KEYS) w[k] = 0
  return { ...p, rarityWeights: w }
}

/** Which plant the weights currently allow (for showing state in Advanced). Nuclear-only is Coming soon → any. */
export function plantOfWeights(w: Record<string, number>): PlantPick {
  let d = 0, n = 0
  for (const [k, v] of Object.entries(w)) { const pl = plantOfKey(k); if (pl === 'diesel') d += v; else if (pl === 'nuclear') n += v }
  if (n > 0 && d <= 0) return 'any' // nuclear-only pool is Coming soon
  return d > 0 && n <= 0 ? 'diesel' : 'any'
}

export interface SimStartPrefs { diff: 'easy' | 'regular' | 'difficult'; plant: PlantPick; lastSeed?: number }
export const DEFAULT_SIM_START: SimStartPrefs = { diff: 'regular', plant: 'any' }

export function loadSimStart(): SimStartPrefs {
  try {
    const raw = localStorage.getItem(SIM_START_KEY)
    const v = JSON.parse(raw ?? 'null') as Partial<SimStartPrefs> | null
    const legacyNuclear = v?.plant === 'nuclear'
    const prefs: SimStartPrefs = {
      diff: v && ['easy', 'regular', 'difficult'].includes(v.diff as string) ? v.diff as SimStartPrefs['diff'] : DEFAULT_SIM_START.diff,
      plant: migratePlantPick(v?.plant as string | undefined),
      ...(v && parseSeed(String(v.lastSeed ?? '')) !== null ? { lastSeed: parseSeed(String(v.lastSeed))! } : {}),
    }
    // Persist migration so a reload does not keep presenting Nuke as selected.
    if (legacyNuclear) saveSimStart(prefs)
    return prefs
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
