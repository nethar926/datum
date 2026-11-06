import { describe, expect, it } from 'vitest'
import { buildCompendium, matchClasses } from '@acoustics'
import { EMPTY_NARROW, NARROW_FAMILIES, keyLabel, toObservations } from './narrow'
import { familyLineRow, truthRows, type TruthContactLite } from '../gram/truthFamilies'

type K = { id: string; idKeys?: { vaneCount?: [number, number] } }
describe('VANE / HYDP narrow-down + truth', () => {
  it('lists VANE and HYDP as tickable families', () => {
    expect(NARROW_FAMILIES).toContain('VANE')
    expect(NARROW_FAMILIES).toContain('HYDP')
  })
  it('maps vane inputs to matchClasses keys with labels', () => {
    expect(toObservations({ ...EMPTY_NARROW, vaneRateHz: '1840', vaneCount: '23' })).toEqual({ vaneRateHz: 1840, vaneCount: 23 })
    expect(keyLabel('vaneRateHz')).toBe('VANE')
    expect(keyLabel('vaneCount')).toBe('VANES')
  })
  it('a real catalog vane count ranks a vane-carrying (nuclear) class first', () => {
    const classes = buildCompendium().classes as unknown as K[]
    const nuke = classes.find((c) => c.idKeys?.vaneCount)
    expect(nuke).toBeTruthy()
    const n = nuke!.idKeys!.vaneCount!
    const [top] = matchClasses(toObservations({ ...EMPTY_NARROW, vaneCount: String((n[0] + n[1]) / 2) }))
    expect(top.ruledOutBy).toEqual([])
    expect(classes.find((c) => c.id === top.id)?.idKeys?.vaneCount).toBeTruthy()
  })
  it('truth shows behaviour and TURBINE / VANE / HYDP fundamentals, HYDP live while off nominal', () => {
    const c: TruthContactLite = { id: 1, label: 'Test 1', spdMps: 5, crsDeg: 90, behaviour: 'patrol',
      lines: [{ lineFamily: 'TURBINE', fundamentalHz: 80, harmonic: 1 }, { lineFamily: 'VANE', fundamentalHz: 1840, harmonic: 1 }, { lineFamily: 'VANE', fundamentalHz: 1840, harmonic: 2 },
        { lineFamily: 'HYDP', fundamentalHz: 367.8, harmonic: 1, freqHz: 373.3 }] }
    const rows = truthRows(c)
    expect(rows).toContain('BEHAVIOUR PATROL')
    expect(rows).toContain('TURBINE 80.00 HZ  VANE 1840 HZ  HYDP 373.3 → 367.8 HZ')
    expect(familyLineRow({ ...c, lines: [{ lineFamily: 'HYDP', fundamentalHz: 367.8, freqHz: 367.85 }] })).toBe('HYDP 367.80 HZ')
    expect(familyLineRow({ id: 2, spdMps: 1, crsDeg: 0 })).toBeNull()
  })
})
