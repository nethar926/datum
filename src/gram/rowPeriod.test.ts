import { describe, expect, it } from 'vitest'
import { rowPeriodS, sonyaResRowPeriodS } from './rowPeriod'

describe('rowPeriodS', () => {
  it('Sonya formula: RES 1 is 8 s, RES 2 is 4 s, RES 5 is 2 s', () => {
    expect(sonyaResRowPeriodS(1)).toBeCloseTo(8, 12)
    expect(sonyaResRowPeriodS(2)).toBeCloseTo(4, 12)
    expect(sonyaResRowPeriodS(5)).toBeCloseTo(2, 12)
    expect(sonyaResRowPeriodS(3)).toBeCloseTo(2, 12)
    expect(sonyaResRowPeriodS(9)).toBeCloseTo(2, 12)
  })

  it('prefers the engine-reported rowRateHz, matching Sonya for RES 1 / 2 / 5', () => {
    expect(rowPeriodS({ res: 1, rowRateHz: 0.125 })).toBeCloseTo(8, 12)
    expect(rowPeriodS({ res: 2, rowRateHz: 0.25 })).toBeCloseTo(4, 12)
    expect(rowPeriodS({ res: 5, rowRateHz: 0.5 })).toBeCloseTo(2, 12)
    // A reported rate wins even if it disagrees with the formula.
    expect(rowPeriodS({ res: 1, rowRateHz: 0.5 })).toBeCloseTo(2, 12)
  })

  it('falls back to Sonya when the engine does not report a rate', () => {
    expect(rowPeriodS({ res: 1, rowRateHz: 0 })).toBeCloseTo(8, 12)
    expect(rowPeriodS({ res: 2, rowRateHz: NaN })).toBeCloseTo(4, 12)
    expect(rowPeriodS({ res: 5, rowRateHz: -Infinity })).toBeCloseTo(2, 12)
    expect(rowPeriodS(null, 1)).toBeCloseTo(8, 12)
    expect(rowPeriodS(undefined, 2)).toBeCloseTo(4, 12)
    expect(rowPeriodS(undefined, 5)).toBeCloseTo(2, 12)
  })
})
