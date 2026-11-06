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

import { parseSeed } from './simStart'
describe('seed field', () => {
  it('parses typed and pasted seeds', () => {
    expect(parseSeed('12345')).toBe(12345)
    expect(parseSeed(' #1,820,590,169 ')).toBe(1820590169)
    expect(parseSeed('0')).toBe(0)
    expect(parseSeed('4294967295')).toBe(4294967295)
    for (const bad of ['', 'abc', '-3', '1.5', '4294967296', '12345678901']) expect(parseSeed(bad)).toBeNull()
  })
  it('same seed + settings replays the same scenario; a different seed does not', () => {
    for (const plant of ['diesel', 'nuclear', 'any'] as const) {
      const p = applyPlant(api.presetToParams!('regular', 9001), plant)
      const a = JSON.stringify(gen(api.clampParams!({ ...p, seed: 9001 })))
      expect(JSON.stringify(gen(api.clampParams!({ ...p, seed: 9001 })))).toBe(a)
      expect(JSON.stringify(gen(api.clampParams!({ ...applyPlant(api.presetToParams!('regular', 9002), plant), seed: 9002 })))).not.toBe(a)
    }
  })
})
