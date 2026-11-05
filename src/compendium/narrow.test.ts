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

describe('narrow-down speed windows', () => {
  it('builds SRC and SWATH observations, swapping reversed band edges', () => {
    const o = toObservations({ ...EMPTY_NARROW, srcHz: '30', srcKts: '6', swathLoHz: '400', swathHiHz: '300' })
    expect(o.speedWindows).toEqual([{ kind: 'SRC', hz: 30, speedKts: 6 }, { kind: 'SWATH', loHz: 300, hiHz: 400 }])
    expect(constraintCount(o)).toBe(2)
  })
  it('needs both swath edges', () => {
    expect(toObservations({ ...EMPTY_NARROW, swathLoHz: '300' }).speedWindows).toBeUndefined()
  })
  it('matchClasses reports them under SRC / SWATH keys with operator labels', () => {
    const [best] = matchClasses(toObservations({ ...EMPTY_NARROW, srcHz: '30' }))
    expect([...best.matched, ...best.ruledOutBy]).toContain('SRC')
    expect(keyLabel('SWATH')).toBe('SWATH WINDOW')
  })
  it('a class own swath band agrees', () => {
    const c = buildCompendium().classes.find((x) => x.idKeys.speedWindows.some((w) => w.kind === 'SWATH'))!
    const w = c.idKeys.speedWindows.find((x) => x.kind === 'SWATH')!
    const m = matchClasses(toObservations({ ...EMPTY_NARROW, swathLoHz: String(w.loHz), swathHiHz: String(w.hiHz) })).find((x) => x.id === c.id)!
    expect(m.matched).toContain('SWATH')
  })
  it('a class own SRC window agrees', () => {
    const c = buildCompendium().classes.find((x) => x.idKeys.speedWindows.some((w) => w.kind === 'SRC'))!
    const w = c.idKeys.speedWindows.find((x) => x.kind === 'SRC')!
    const m = matchClasses(toObservations({ ...EMPTY_NARROW, srcHz: String((w.loHz + w.hiHz) / 2) })).find((x) => x.id === c.id)!
    expect(m.matched).toContain('SRC')
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
