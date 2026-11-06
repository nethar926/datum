import { describe, expect, it } from 'vitest'
import { CONTRAST_DEFAULT, clampContrast, contrastRange } from './contrast'

describe('gram contrast', () => {
  it('is the identity at 1.0 (default)', () => {
    expect(CONTRAST_DEFAULT).toBe(1)
    expect(contrastRange(0, 30, 1)).toEqual({ dbFloor: 0, dbCeil: 30 })
    expect(contrastRange(40, 110, 1)).toEqual({ dbFloor: 40, dbCeil: 110 })
  })
  it('keeps the midpoint and stretches or compresses the ends', () => {
    const hi = contrastRange(0, 30, 2), lo = contrastRange(40, 110, 0.5)
    expect(hi).toEqual({ dbFloor: 7.5, dbCeil: 22.5 })
    expect(lo).toEqual({ dbFloor: 5, dbCeil: 145 })
    expect((hi.dbFloor + hi.dbCeil) / 2).toBe(15); expect((lo.dbFloor + lo.dbCeil) / 2).toBe(75)
  })
  it('clamps to 0.5–3 in 0.05 steps and survives junk', () => {
    expect(clampContrast(10)).toBe(3); expect(clampContrast(0)).toBe(0.5)
    expect(clampContrast(1.234)).toBeCloseTo(1.25); expect(clampContrast(NaN)).toBe(1)
    const r = contrastRange(0, 30, 99); expect(r.dbCeil - r.dbFloor).toBeCloseTo(10)
  })
})
