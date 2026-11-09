import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as A from '@acoustics'
import { scenarioPoolWeights } from '@acoustics'
import { acousticsV11 } from '../scenarios/acousticsApi'
import {
  applyPlant, plantOfWeights, DIESEL_KEYS, NUCLEAR_KEYS,
  loadSimStart, saveSimStart, migratePlantPick, SIM_START_KEY, DEFAULT_SIM_START, parseSeed,
} from './simStart'

const api = acousticsV11
const gen = (A as unknown as { generateScenario: (p: unknown) => { contacts: { category: string; catalogRef?: { classId: string } }[] } }).generateScenario
const classes = (A as unknown as { catalog: { classes: { id: string; plant: string }[] } }).catalog.classes
const plantOf = (id: string) => classes.find((c) => c.id === id)?.plant


const poolNonEmpty = (w: Record<string, number>) => {
  const pool = scenarioPoolWeights(w as Parameters<typeof scenarioPoolWeights>[0])
  expect(NUCLEAR_KEYS.every((k) => pool[k] === 0)).toBe(true)
  expect(DIESEL_KEYS.some((k) => pool[k] > 0)).toBe(true)
  return pool
}

const mem = new Map<string, string>()
beforeEach(() => {
  mem.clear()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => mem.clear(),
  })
})
afterEach(() => { vi.unstubAllGlobals() })

describe('SIM start plant filter', () => {
  it('rarity keys cover the catalog buckets', () => {
    const keys = Object.keys(api.presetToParams!('regular', 1).rarityWeights).sort()
    expect(keys).toEqual([...DIESEL_KEYS, ...NUCLEAR_KEYS].sort())
  })

  it("any leaves every non-nuclear weight unchanged and zeroes nuclear", () => {
    // Build a pre-clamp weight map that still has nuclear > 0 so the zeroing is visible.
    const base = api.presetToParams!('regular', 7)
    const withNuke = {
      ...base,
      rarityWeights: {
        ...base.rarityWeights,
        nuclearGearReduction: 40,
        nuclearElectric: 2,
      } as typeof base.rarityWeights,
    }
    const before = { ...withNuke.rarityWeights }
    const out = applyPlant(withNuke, 'any')
    for (const k of DIESEL_KEYS) expect(out.rarityWeights[k as keyof typeof before]).toBe(before[k as keyof typeof before])
    for (const k of NUCLEAR_KEYS) expect(out.rarityWeights[k]).toBe(0)
    // Identity: diesel-only applyPlant still works on the clamped preset.
    const clamped = api.presetToParams!('regular', 7)
    expect(applyPlant(clamped, 'any').rarityWeights.nuclearGearReduction).toBe(0)
    expect(applyPlant(clamped, 'any').rarityWeights.nuclearElectric).toBe(0)
  })

  it('diesel only ever draws diesel boats across difficulties and seeds', () => {
    for (const d of ['easy', 'regular', 'difficult'] as const) for (let seed = 1; seed <= 40; seed++) {
      const p = applyPlant({ ...api.presetToParams!(d, seed), subCount: 3 }, 'diesel')
      expect(plantOfWeights(p.rarityWeights)).toBe('diesel')
      const subs = gen(api.clampParams!(p)).contacts.filter((c) => c.category === 'subsurface')
      expect(subs.length).toBe(3)
      for (const s of subs) expect(plantOf(s.catalogRef!.classId)).toBe('diesel')
    }
  })

  it("legacy nuclear-only setting falls back to any: never draws nuclear, pool never empty", () => {
    expect(migratePlantPick('nuclear')).toBe('any')
    // Acoustics-side: nuclear-only weights still yield a non-empty diesel pool via scenarioPoolWeights fallback.
    poolNonEmpty({ dieselDirect: 0, dieselGearReduction: 0, dieselElectric: 0, aip: 0, nuclearGearReduction: 80, nuclearElectric: 20 })
    for (const d of ['easy', 'regular', 'difficult'] as const) for (let seed = 1; seed <= 40; seed++) {
      // Saved nuclear-only → treat as any (Coming soon).
      const p = applyPlant({ ...api.presetToParams!(d, seed), subCount: 3 }, 'nuclear')
      const weights = p.rarityWeights
      expect(NUCLEAR_KEYS.every((k) => weights[k] === 0)).toBe(true)
      expect(DIESEL_KEYS.some((k) => weights[k] > 0)).toBe(true)
      poolNonEmpty(weights)
      const clamped = api.clampParams!(p)
      expect(NUCLEAR_KEYS.every((k) => clamped.rarityWeights[k] === 0)).toBe(true)
      expect(DIESEL_KEYS.some((k) => clamped.rarityWeights[k] > 0)).toBe(true)
      poolNonEmpty(clamped.rarityWeights)
      const subs = gen(clamped).contacts.filter((c) => c.category === 'subsurface')
      expect(subs.length).toBe(3)
      for (const s of subs) expect(plantOf(s.catalogRef!.classId)).toBe('diesel')
    }
  })

  it('falls back to equal weights when the picked plant had none', () => {
    const p = api.presetToParams!('regular', 3)
    const zeroD = { ...p, rarityWeights: { ...p.rarityWeights, dieselDirect: 0, dieselGearReduction: 0, dieselElectric: 0, aip: 0 } }
    expect(plantOfWeights(applyPlant(zeroD, 'diesel').rarityWeights)).toBe('diesel')
  })
})

describe('SIM start plant preference migration', () => {
  it('loads legacy nuclear-only, migrates to any, persists, and draws no nuclear boats', () => {
    saveSimStart({ diff: 'difficult', plant: 'nuclear', lastSeed: 42 })
    // Force the raw legacy value into storage (saveSimStart would already migrate if called with nuclear via UI,
    // but older builds wrote plant:'nuclear' directly).
    mem.set(SIM_START_KEY, JSON.stringify({ diff: 'difficult', plant: 'nuclear', lastSeed: 42 }))
    const loaded = loadSimStart()
    expect(loaded.plant).toBe('any')
    expect(loaded.diff).toBe('difficult')
    expect(loaded.lastSeed).toBe(42)
    expect(JSON.parse(mem.get(SIM_START_KEY)!).plant).toBe('any')
    // Second load is already migrated.
    expect(loadSimStart().plant).toBe('any')
    expect(migratePlantPick('nuclear')).toBe('any')
    expect(migratePlantPick('diesel')).toBe('diesel')
    expect(migratePlantPick('any')).toBe('any')
    expect(migratePlantPick(undefined)).toBe(DEFAULT_SIM_START.plant)

    // Acoustics: migrated any weights and raw legacy nuclear-only both yield a non-empty diesel pool.
    const migrated = applyPlant(api.presetToParams!('regular', 1), loaded.plant)
    poolNonEmpty(migrated.rarityWeights)
    poolNonEmpty({ dieselDirect: 0, dieselGearReduction: 0, dieselElectric: 0, aip: 0, nuclearGearReduction: 99, nuclearElectric: 1 })

    for (const d of ['easy', 'regular', 'difficult'] as const) {
      for (let seed = 0; seed < 10; seed++) {
        const p = applyPlant({ ...api.presetToParams!(d, seed), subCount: 2, seed }, loaded.plant)
        poolNonEmpty(p.rarityWeights)
        const subs = gen(api.clampParams!(p)).contacts.filter((c) => c.category === 'subsurface')
        expect(subs.length).toBeGreaterThan(0)
        for (const s of subs) expect(plantOf(s.catalogRef!.classId)).toBe('diesel')
      }
    }
  })
})

describe('seed field', () => {
  it('parses typed and pasted seeds', () => {
    expect(parseSeed('12345')).toBe(12345)
    expect(parseSeed(' #1,820,590,169 ')).toBe(1820590169)
    expect(parseSeed('0')).toBe(0)
    expect(parseSeed('4294967295')).toBe(4294967295)
    for (const bad of ['', 'abc', '-3', '1.5', '4294967296', '12345678901']) expect(parseSeed(bad)).toBeNull()
  })
  it('same seed + settings replays the same scenario; a different seed does not', () => {
    for (const plant of ['diesel', 'any'] as const) {
      const p = applyPlant(api.presetToParams!('regular', 9001), plant)
      const a = JSON.stringify(gen(api.clampParams!({ ...p, seed: 9001 })))
      expect(JSON.stringify(gen(api.clampParams!({ ...p, seed: 9001 })))).toBe(a)
      expect(JSON.stringify(gen(api.clampParams!({ ...applyPlant(api.presetToParams!('regular', 9002), plant), seed: 9002 })))).not.toBe(a)
    }
  })
})
