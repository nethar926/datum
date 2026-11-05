import { describe, expect, it } from 'vitest'
import { catalog } from '@acoustics'
import { compendiumCards, filterCards } from './cards'

describe('compendium cards', () => {
  const cards = compendiumCards(catalog)
  it('has one card per catalog class, Red first', () => {
    expect(cards.length).toBe(catalog.classes.length)
    expect(new Set(cards.map((c) => c.id)).size).toBe(cards.length)
    expect(cards[0].force).toBe('Red')
  })
  it('gives every class modes, ratios and a BR key', () => {
    for (const c of cards) {
      expect(c.modes.length).toBeGreaterThan(0)
      expect(c.ratios.some((r) => r.startsWith('BR = PSR ×'))).toBe(true)
      expect(c.name.startsWith('Fictional ')).toBe(false)
    }
  })
  it('diesels list BATT with no engine lines, nukes list NUC', () => {
    for (const c of cards) {
      if (c.plant === 'diesel') expect(c.modes.find((m) => m.mode === 'BATT')?.lines).toContain('no engine lines')
      else expect(c.modes[0].mode).toBe('NUC')
    }
  })
  it('filters by plant, nation and search', () => {
    const d = filterCards(cards, { query: '', country: '', plant: 'diesel' })
    expect(d.every((c) => c.plant === 'diesel')).toBe(true)
    const n = cards[0].country
    expect(filterCards(cards, { query: '', country: n, plant: '' }).every((c) => c.country === n)).toBe(true)
    expect(filterCards(cards, { query: cards[0].name.toLowerCase(), country: '', plant: '' })[0].id).toBe(cards[0].id)
    expect(filterCards(cards, { query: 'zzqqxx', country: '', plant: '' })).toHaveLength(0)
  })
  it('derives MSR, TPK and emergency keys from synthetic classes', () => {
    const [c] = compendiumCards({ classes: [{ id: 'x', name: 'Fictional Test', country: 'Kaelun Republic', force: 'Red', plant: 'diesel', drivetrainCode: 'DEL', drivetrainLabel: 'DIESEL ELECTRIC',
      motorSlots: 124, tpk: 9, tpkMinKts: 4, propeller: { shafts: 1, blades: 7, type: 'cpp' }, aip: { kind: 'stirling', maxSpeedKts: 4 },
      emergencyPropulsor: { blades: 5, maxSpeedKts: 3 }, machinery: { engines: [{ stroke: 4, cylinders: 12, erpm: { obsMin: 600, obsMax: 900 } }, { stroke: 4, cylinders: 12, erpm: { obsMin: 600, obsMax: 900 } }], motor: {} },
      edas: [{ id: 'lop', name: 'LOP', cfrMultiple: 27.75 }, { id: 'old', perCrankRev: 6 * 10.5 }], idKeys: { hydpHz: 367.77, speedWindows: [{ kind: 'SRC', name: 'A', hz: 512, onKts: 14, offKts: 20 }, { kind: 'swath', loHz: 180, hiHz: 240, kts: [9, 13] }] },
      params: { electricalHz: 50 } }] })
    expect(c.engines).toEqual([{ count: 2, stroke: 4, cylinders: 12, erpm: [600, 900] }])
    expect(c.propType).toBe('VARIABLE PITCH')
    expect(c.ratios).toContain('MSR = shaft rate × 124 slots')
    expect(c.ratios).toContain('SPD = PSRPM ÷ 9 (valid above 4 kt)')
    expect(c.ratios).toContain('CFR = CSR × 6 (4-stroke, 12 cyl)')
    expect(c.modes.find((m) => m.mode === 'BATT')?.lines).toContain('MSR')
    expect(c.modes.some((m) => m.mode === 'AIP')).toBe(true)
    expect(c.emergency).toMatch(/5-blade/)
    expect(c.edas).toEqual([{ name: 'LOP', cfrMultiple: 27.75 }, { name: 'OLD', cfrMultiple: 10.5 }])
    expect(c.hydpHz).toBe(367.77)
    expect(c.speedFeatures).toEqual([{ kind: 'SWATH', name: '', band: '180–240 Hz', kts: [9, 13] }, { kind: 'SRC', name: 'A', band: '≈512 Hz', kts: [14, 20] }])
    expect(filterCards([c], { query: 'hydp', country: '', plant: '' })).toHaveLength(1)
  })
})
