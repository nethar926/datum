import { describe, expect, it } from 'vitest'
import { catalog } from '@acoustics'
import { msrWorkback } from './msrWorkback'

describe('msrWorkback', () => {
  it('ranks classes for a shaft-rate fundamental mark', () => {
    const c = catalog.classes.find((x) => x.idKeys.harmonicFamilies.some((f) => f.lineFamily === 'PSR' && f.fundamentalHz[1] > 1))!
    const psr = c.idKeys.harmonicFamilies.find((f) => f.lineFamily === 'PSR')!
    const mark = psr.fundamentalHz[1] * 0.5 // mid-ish of envelope
    const r = msrWorkback({ markHz: mark, n: 1, type: 'shaft', tolHz: 0.5 })
    expect(r.impliedFundHz).toBeCloseTo(mark, 6)
    expect(r.hits.some((h) => h.classId === c.id)).toBe(true)
    // Sorted by delta
    for (let i = 1; i < r.hits.length; i++) expect(r.hits[i].deltaHz).toBeGreaterThanOrEqual(r.hits[i - 1].deltaHz)
  })
  it('works from a missing fundamental (harmonic n)', () => {
    const c = catalog.classes.find((x) => (x.propeller?.blades ?? 0) >= 5)!
    const br = c.idKeys.harmonicFamilies.find((f) => f.lineFamily === 'BR')!
    const fund = br.fundamentalHz[1] * 0.4
    const n = 3
    const r = msrWorkback({ markHz: fund * n, n, type: 'blade', tolHz: 1 })
    expect(r.impliedFundHz).toBeCloseTo(fund, 5)
    const hit = r.hits.find((h) => h.classId === c.id)
    expect(hit).toBeTruthy()
    expect(hit!.impliedShaftHz).toBeCloseTo(fund / c.propeller!.blades, 5)
  })
  it('rejects non-positive marks', () => {
    expect(msrWorkback({ markHz: 0, n: 1, type: 'shaft' }).hits).toEqual([])
  })
})
