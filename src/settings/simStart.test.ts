import { describe, expect, it } from 'vitest'
import * as A from '@acoustics'
import { acousticsV11 } from '../scenarios/acousticsApi'
import { applyPlant, plantOfWeights, DIESEL_KEYS, NUCLEAR_KEYS } from './simStart'

const api = acousticsV11
const gen = (A as unknown as { generateScenario: (p: unknown) => { contacts: { category: string; catalogRef?: { classId: string } }[] } }).generateScenario
const classes = (A as unknown as { catalog: { classes: { id: string; plant: string }[] } }).catalog.classes
const plantOf = (id: string) => classes.find((c) => c.id === id)?.plant

describe('SIM start plant filter', () => {
  it('rarity keys cover the catalog buckets', () => {
    const keys = Object.keys(api.presetToParams!('regular', 1).rarityWeights).sort()
    expect(keys).toEqual([...DIESEL_KEYS, ...NUCLEAR_KEYS].sort())
  })
  it('any leaves weights alone', () => {
    const p = api.presetToParams!('regular', 7)
    expect(applyPlant(p, 'any')).toBe(p)
    expect(plantOfWeights(p.rarityWeights)).toBe('any')
  })
  for (const plant of ['diesel', 'nuclear'] as const) {
    it(`${plant} only ever draws ${plant} boats across difficulties and seeds`, () => {
      for (const d of ['easy', 'regular', 'difficult'] as const) for (let seed = 1; seed <= 40; seed++) {
        const p = applyPlant({ ...api.presetToParams!(d, seed), subCount: 3 }, plant)
        expect(plantOfWeights(p.rarityWeights)).toBe(plant)
        const subs = gen(api.clampParams!(p)).contacts.filter((c) => c.category === 'subsurface')
        expect(subs.length).toBe(3)
        for (const s of subs) expect(plantOf(s.catalogRef!.classId)).toBe(plant)
      }
    })
  }
  it('falls back to equal weights when the picked plant had none', () => {
    const p = api.presetToParams!('regular', 3)
    const zeroD = { ...p, rarityWeights: { ...p.rarityWeights, dieselDirect: 0, dieselGearReduction: 0, dieselElectric: 0, aip: 0 } }
    expect(plantOfWeights(applyPlant(zeroD, 'diesel').rarityWeights)).toBe('diesel')
  })
})
