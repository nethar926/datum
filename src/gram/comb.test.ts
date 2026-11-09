import { describe, expect, it } from 'vitest'
import {
  COMB_PEAK_DB_OVER_MEDIAN,
  COMB_SIDEBANDS_DEFAULT,
  clampSidebands,
  combLabelStride,
  combLabelVisible,
  combMatchedCount,
  combSeries,
  combSidebandSlots,
  combText,
  evaluateComb,
  findMatchedPeakHz,
  fitCombFromPeaks,
  matchToleranceHz,
  nearestCombOrder,
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
    expect(lo.find((m) => m.n === -2)?.hz).toBe(0)
    expect(lo.find((m) => m.n === -1)?.hz).toBe(1)
    const hi = combSeries(95, 10, 2, 0, 100)
    expect(hi.find((m) => m.n === 1)?.hz).toBe(100)
    expect(hi.find((m) => m.n === 2)?.hz).toBe(100)
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

describe('comb MATCHED gate (strict local peak)', () => {
  const f0 = 0
  const fBin = 1

  function peakRow(peaks: number[], floor = -30, height = 10): Float32Array {
    const row = new Float32Array(200).fill(floor)
    for (const b of peaks) {
      row[b - 1] = floor + 1
      row[b] = height
      row[b + 1] = floor + 1
    }
    return row
  }

  it('findMatchedPeakHz requires local max ≥ median + dB within tolerance', () => {
    const row = peakRow([40])
    expect(findMatchedPeakHz(row, f0, fBin, 40, 10)).toBe(40)
    expect(findMatchedPeakHz(row, f0, fBin, 10, 10)).toBeNull()
    // Soft shoulder / monotone rise must NOT match (no soft argmax fallback).
    const rise = new Float32Array(80).fill(-20)
    for (let b = 36; b <= 44; b++) rise[b] = -20 + (b - 36) * 0.5
    expect(findMatchedPeakHz(rise, f0, 0.5, 20, 2)).toBeNull()
  })

  it('evaluateComb keeps geometric hz; peaks are separate; always has C', () => {
    const centre = 100
    const spacing = 10
    const row = peakRow([80, 90, 100, 110, 120]) // ±1 ±2 + centre; no ±3
    // Nudge peaks slightly off grid — marks must stay on grid.
    row[91] = 10; row[90] = -29; row[92] = -29
    row[89] = -29
    const marks = evaluateComb(centre, spacing, 3, row, f0, fBin, 0, 199)
    expect(marks.find((m) => m.n === 0)?.hz).toBe(100)
    // Geometric positions unchanged even when peak is at 91 for n=-1 target 90
    expect(marks.find((m) => m.n === -1)?.hz).toBe(90)
    expect(marks.find((m) => m.n === -1)?.peakHz).toBe(91)
    expect(combMatchedCount(marks)).toBe(4) // ±1±2; ±3 absent (91 is within tol of 90)
  })

  it('noise-only rows give low MATCHED (no soft fallback)', () => {
    // Pseudorandom-ish noise without clear local peaks above median+3dB near the grid.
    const row = new Float32Array(200)
    for (let i = 0; i < row.length; i++) row[i] = -25 + ((i * 17) % 7) * 0.15
    const marks = evaluateComb(100, 10, 5, row, f0, fBin, 0, 199)
    expect(combMatchedCount(marks)).toBeLessThanOrEqual(2)
  })

  it('wrong spacing (1.5× drawn) scores clearly lower than drawn spacing', () => {
    const centre = 100
    const drawn = 10
    const row = peakRow(
      Array.from({ length: 11 }, (_, i) => centre + (i - 5) * drawn),
      -30,
      12,
    )
    const good = evaluateComb(centre, drawn, 5, row, f0, fBin, 0, 199)
    const bad = evaluateComb(centre, drawn * 1.5, 5, row, f0, fBin, 0, 199)
    expect(combMatchedCount(good)).toBe(10)
    expect(combMatchedCount(bad)).toBeLessThan(combMatchedCount(good) - 2)
  })

  it('matchToleranceHz uses max(0.5·fBin, 15% spacing)', () => {
    expect(matchToleranceHz(1, 10)).toBeCloseTo(1.5, 5) // 15% of 10
    expect(matchToleranceHz(2, 1)).toBeCloseTo(1, 5) // 0.5*2
    expect(COMB_PEAK_DB_OVER_MEDIAN).toBe(3)
  })
})

describe('comb label thinning + fit', () => {
  it('thins labels when px gap is tight', () => {
    expect(combLabelStride(30, 2.26)).toBe(1) // ~68 px ≥ 28
    expect(combLabelStride(11, 2.26)).toBeGreaterThan(1) // ~25 px < 28
    expect(combLabelVisible(0, 2)).toBe(true)
    expect(combLabelVisible(1, 2)).toBe(false)
    expect(combLabelVisible(2, 2)).toBe(true)
  })

  it('fitCombFromPeaks recovers centre and spacing', () => {
    const peaks = [-3, -2, -1, 0, 1, 2, 3].map((n) => ({ n, peakHz: 313.3 + n * 2.257 }))
    const fit = fitCombFromPeaks(peaks)!
    expect(fit.centreHz).toBeCloseTo(313.3, 5)
    expect(fit.spacingHz).toBeCloseTo(2.257, 5)
  })
})

describe('comb readout', () => {
  it('labels spacing as PSR est. and reports matched/slots (compact)', () => {
    expect(combText(null, null, 5)).toMatch(/pin centre/i)
    expect(combText(120.5, null, 5)).toMatch(/C 120\.50 Hz/)
    const t = combText(120.5, 1.25, 5, 6)
    expect(t).toContain('PSR est 1.25 Hz')
    expect(t).toContain(`6/${combSidebandSlots(5)}`)
    expect(t.length).toBeLessThan(56)
  })
})
