import { describe, expect, it } from 'vitest'
import { buildCompendium, matchClasses } from '@acoustics'
import { EMPTY_NARROW, constraintCount, keyLabel, rankIds, toObservations } from './narrow'

describe('narrow-down form', () => {
  it('turns an empty form into no constraints', () => {
    expect(toObservations(EMPTY_NARROW)).toEqual({})
    expect(constraintCount(toObservations(EMPTY_NARROW))).toBe(0)
  })
  it('ignores blank, half-typed and non-positive numbers', () => {
    const o = toObservations({ ...EMPTY_NARROW, blades: '7.', tpk: 'abc', hydpHz: '-3', gearRatio: ' ' })
    expect(o).toEqual({ brToPsr: 7 })
  })
  it('maps every field to matchClasses observation keys', () => {
    const o = toObservations({ ...EMPTY_NARROW, gridHz: '50', mode: 'SNORK', lineFamilies: ['CFR', 'MSR'], csrHz: '9', psrHz: '2.5', blades: '7', edaCfrMultiples: '10.5, 27.75;x' })
    expect(o).toEqual({ gridHz: 50, mode: 'SNORK', lineFamilies: ['CFR', 'MSR'], familyFundamentalsHz: { CSR: 9, PSR: 2.5 }, brToPsr: 7, edaCfrMultiples: [10.5, 27.75] })
    expect(constraintCount(o)).toBe(9)
  })
  it('labels matcher keys in operator words', () => {
    expect(keyLabel('brToPsr')).toBe('BLADES (BR÷PSR)')
    expect(keyLabel('lineFamily:MSR')).toBe('MSR SEEN')
    expect(keyLabel('edaCfrMultiple:27.75')).toBe('EDA ×27.75')
    expect(keyLabel('fundamental:PSR')).toBe('PSR HZ')
  })
})

describe('narrow-down ranking', () => {
  const classes = buildCompendium().classes
  const ids = classes.map((c) => c.id)
  it('keeps catalog order with no constraints', () => {
    expect(rankIds(ids, undefined, true).map((r) => r.id)).toEqual(ids)
  })
  it('puts the only 27.75 EDA class first and can hide the ruled-out ones', () => {
    const m = matchClasses(toObservations({ ...EMPTY_NARROW, edaCfrMultiples: '27.75' }))
    const ranked = rankIds(ids, m, false)
    expect(ranked).toHaveLength(ids.length)
    expect(ranked[0].match?.ruledOutBy).toEqual([])
    const kept = rankIds(ids, m, true)
    expect(kept.length).toBe(1)
    expect(kept[0].id).toBe(ranked[0].id)
  })
  it('respects the nation/plant filter: only filtered ids come back', () => {
    const m = matchClasses({ gridHz: 50 })
    const sub = ids.slice(0, 5)
    expect(rankIds(sub, m, false).map((r) => r.id).sort()).toEqual([...sub].sort())
  })
})
