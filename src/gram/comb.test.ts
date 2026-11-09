import { describe, expect, it } from 'vitest'
import {
  COMB_SIDEBANDS_DEFAULT,
  clampSidebands,
  combMatchedCount,
  combSeries,
  combSidebandSlots,
  combText,
  nearestCombOrder,
  snapCombMarks,
  snapToPeakHz,
  spacingFromDrag,
} from './comb'

describe('comb geometry', () => {
  it('places sidebands at centre ± k·spacing', () => {
    const s = combSeries(100, 10, 3, 0, 200)
    expect(s.map((m) => m.n)).toEqual([-3, -2, -1, 0, 1, 2, 3])
    expect(s.map((m) => m.hz)).toEqual([70, 80, 90, 100, 110, 120, 130])
  })

  it('clamps marks at 0 Hz / band edges', () => {
    const lo = combSeries(5, 4, 3, 0, 100)
    expect(lo.every((m) => m.hz >= 0)).toBe(true)
    expect(lo.find((m) => m.n === -2)?.hz).toBe(0) // 5-8 = -3 → clamp 0
    expect(lo.find((m) => m.n === -1)?.hz).toBe(1)
    const hi = combSeries(95, 10, 2, 0, 100)
    expect(hi.find((m) => m.n === 1)?.hz).toBe(100) // 105 → clamp
    expect(hi.find((m) => m.n === 2)?.hz).toBe(100) // 115 → clamp
  })

  it('clampSidebands respects 1..10', () => {
    expect(clampSidebands(0)).toBe(1)
    expect(clampSidebands(99)).toBe(10)
    expect(clampSidebands(COMB_SIDEBANDS_DEFAULT)).toBe(5)
  })

  it('nearestCombOrder and spacingFromDrag round-trip', () => {
    expect(nearestCombOrder(100, 8, 100)).toBe(0)
    expect(nearestCombOrder(100, 8, 124)).toBe(3)
    expect(spacingFromDrag(100, 2, 116)).toBe(8)
  })
})

describe('comb peak snap', () => {
  it('snaps to a local max in a synthetic row', () => {
    const bins = 64
    const f0 = 0
    const fBin = 1
    const row = new Float32Array(bins).fill(-20)
    row[40] = 5 // peak at 40 Hz
    row[39] = 0
    row[41] = 0
    expect(snapToPeakHz(row, f0, fBin, 42, 4)).toBe(40)
    expect(snapToPeakHz(row, f0, fBin, 10, 2)).toBeNull()
  })

  it('snapCombMarks counts matched sidebands', () => {
    const bins = 200
    const fBin = 1
    const row = new Float32Array(bins).fill(-30)
    const centre = 100
    const spacing = 10
    for (const n of [-2, -1, 1, 2]) {
      const b = centre + n * spacing
      row[b] = 8
      row[b - 1] = 1
      row[b + 1] = 1
    }
    row[centre] = 10
    const marks = snapCombMarks(centre, spacing, 3, row, 0, fBin, 0, 199)
    expect(combMatchedCount(marks)).toBe(4) // ±1 ±2; ±3 absent
    expect(marks.find((m) => m.n === 0)?.snappedHz).toBe(100)
  })
})

describe('comb readout', () => {
  it('labels spacing as PSR est. and reports matched/slots', () => {
    expect(combText(null, null, 5)).toMatch(/PIN CENTRE/)
    expect(combText(120.5, null, 5)).toMatch(/CENTRE 120\.50 HZ/)
    const t = combText(120.5, 7.25, 5, 6)
    expect(t).toContain('PSR EST. 7.25 HZ')
    expect(t).toContain(`6/${combSidebandSlots(5)} MATCHED`)
  })
})
