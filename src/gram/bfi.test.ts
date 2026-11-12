import { describe, expect, it } from 'vitest'
import {
  BFI_DEFAULT_PRESET, BFI_DEFAULT_RANGES, BFI_PRESETS, BFI_WINDOW_S,
  bfiAlpha, bfiAvailable, bfiContrast, bfiFade, bfiPoints, bfiPointsFromBandSamples,
  bfiPresetTitle, bfiRangeFor, bfiX, bfiY, clampBfiRange,
} from './bfi'
import { rowPeriodS } from './rowPeriod'

function rows(n: number, rowRateHz: number, rowTimes?: number[], tNewest?: number) {
  const power = Array.from({ length: n }, () => new Float32Array([20]))
  const brg = Array.from({ length: n }, () => new Float32Array([45]))
  return bfiPoints({
    powerNewestFirst: power, bearingNewestFirst: brg,
    f0: 0, fBin: 1, fLo: 0, fHi: 10, rowRateHz,
    rowTimesNewestFirst: rowTimes, tNewestRowSim: tNewest,
    rowPeriodS: 1 / rowRateHz,
  })
}

describe('BFI Bearing Frequency Indication', () => {
  it('is available on DIFAR only and fades linearly over 30 s', () => {
    expect(bfiAvailable(true)).toBe(true)
    expect(bfiAvailable(false)).toBe(false)
    expect(BFI_WINDOW_S).toBe(30)
    expect(bfiFade(0)).toBe(1)
    expect(bfiFade(15)).toBeCloseTo(0.5, 6)
    expect(bfiFade(30)).toBe(0)
    expect(bfiFade(40)).toBe(0)
    expect(bfiFade(-1)).toBe(1)
    expect(bfiAlpha(100, 100)).toBe(1)
    expect(bfiAlpha(100, 85)).toBeCloseTo(0.5, 6)
    expect(bfiAlpha(100, 70)).toBe(0)
    expect(bfiAlpha(100, 60)).toBe(0)
  })

  it('shows about 4 visible rows at RES 1 and 15 at RES 5', () => {
    // RES 1: P = 8 s (rowRateHz = 0.125). Ages 0, 8, 16, 24 visible; 32 is gone.
    expect(rowPeriodS({ res: 1, rowRateHz: 0.125 })).toBeCloseTo(8, 12)
    const res1 = rows(8, 0.125)
    const ages1 = [...new Set(res1.map((p) => p.ageS))].sort((a, b) => a - b)
    expect(ages1).toHaveLength(4)
    expect(ages1[0]).toBeCloseTo(0, 12)
    expect(ages1[1]).toBeCloseTo(8, 12)
    expect(ages1[2]).toBeCloseTo(16, 12)
    expect(ages1[3]).toBeCloseTo(24, 12)
    expect(ages1.some((a) => Math.abs(a - 32) < 1e-9)).toBe(false)
    expect(bfiAlpha(32, 0)).toBe(0)

    // RES 5: P = 2 s (0.5 Hz). Ages 0, 2, …, 28 → 15 rows.
    expect(rowPeriodS({ res: 5, rowRateHz: 0.5 })).toBeCloseTo(2, 12)
    const res5 = rows(20, 0.5)
    const ages5 = [...new Set(res5.map((p) => p.ageS))].sort((a, b) => a - b)
    expect(ages5).toHaveLength(15)
    expect(ages5[0]).toBeCloseTo(0, 12)
    expect(ages5[ages5.length - 1]).toBeCloseTo(28, 12)
    expect(ages5.some((a) => Math.abs(a - 30) < 1e-9)).toBe(false)
  })

  it('freezes the fade on pause (tNewest held) and fades when a new row arrives', () => {
    const rate = 0.125
    const times = Array.from({ length: 8 }, (_, i) => (7 - i) / rate)
    const tNewest = times[0]
    const a = rows(times.length, rate, times, tNewest)
    const b = rows(times.length, rate, times, tNewest)
    expect(a.map((p) => p.alpha)).toEqual(b.map((p) => p.alpha))
    expect(a.map((p) => p.ageS)).toEqual(b.map((p) => p.ageS))
    expect(new Set(a.map((p) => p.ageS)).size).toBe(4)
    // The same physical row (times[1]) fades further only when tNewest advances.
    expect(a[1].alpha).toBeCloseTo(1 - 8 / 30, 6)
    const later = [tNewest + 8, ...times]
    const c = rows(later.length, rate, later, tNewest + 8)
    expect(c[2].ageS).toBeCloseTo(16, 12)
    expect(c[2].alpha).toBeCloseTo(1 - 16 / 30, 6)
    expect(c[2].alpha).toBeLessThan(a[1].alpha)
  })

  it('places bearing on the horizontal axis and frequency on the vertical', () => {
    expect(bfiX(0, 360)).toBeCloseTo(0, 12)
    expect(bfiX(90, 360)).toBeCloseTo(90, 12)
    expect(bfiX(180, 360)).toBeCloseTo(180, 12)
    expect(bfiX(360, 360)).toBeCloseTo(360, 12)
    expect(bfiY(200, 100, 200, 100)).toBeCloseTo(0, 12)   // high freq at the top
    expect(bfiY(100, 100, 200, 100)).toBeCloseTo(100, 12) // low freq at the bottom
    expect(bfiY(150, 100, 200, 100)).toBeCloseTo(50, 12)
  })

  it('lands a 20 dB bin at 90° and 200 Hz', () => {
    const power = new Float32Array(8).fill(NaN)
    power[4] = 20
    // Web layout: one deg per bin. Native interleaved also accepted.
    const brg = new Float32Array(8).fill(NaN)
    brg[4] = 90
    const pts = bfiPoints({
      powerNewestFirst: [power], bearingNewestFirst: [brg],
      f0: 0, fBin: 50, fLo: 0, fHi: 400, rowRateHz: 0.5,
    })
    expect(pts).toHaveLength(1)
    expect(pts[0].bearingDeg).toBeCloseTo(90, 12)
    expect(pts[0].freqHz).toBeCloseTo(200, 12)
    expect(pts[0].db).toBe(20)
    expect(pts[0].ageS).toBeCloseTo(0, 12)
    expect(pts[0].alpha).toBe(1)
    expect(bfiX(pts[0].bearingDeg, 360)).toBeCloseTo(90, 12)
    expect(bfiY(pts[0].freqHz, 0, 400, 400)).toBeCloseTo(200, 12)
  })

  it('lands the same point from an interleaved deg,conf ring', () => {
    const power = new Float32Array(8).fill(NaN)
    power[4] = 20
    const brg = new Float32Array(16).fill(NaN)
    brg[8] = 90; brg[9] = 1
    const pts = bfiPoints({
      powerNewestFirst: [power], bearingNewestFirst: [brg],
      f0: 0, fBin: 50, fLo: 0, fHi: 400, rowRateHz: 0.5,
    })
    expect(pts).toHaveLength(1)
    expect(pts[0].bearingDeg).toBeCloseTo(90, 12)
    expect(pts[0].freqHz).toBeCloseTo(200, 12)
  })

  it('skips NaN bearing, zero confidence, sentinel dB, and out-of-band bins', () => {
    const power = new Float32Array([10, 20, 30, -1e38])
    const brg = new Float32Array([
      NaN, 1,
      90, 0,
      180, 1, // 200 Hz, outside [0, 150]
      270, 1,
    ])
    const pts = bfiPoints({
      powerNewestFirst: [power], bearingNewestFirst: [brg],
      f0: 0, fBin: 100, fLo: 0, fHi: 150, rowRateHz: 0.5,
    })
    expect(pts).toEqual([])
  })

  it('fades an older row and drops rows past the 30 s window at RES 5', () => {
    const p0 = new Float32Array([20]), p1 = new Float32Array([20])
    const b = new Float32Array([45])
    const pts = bfiPoints({
      powerNewestFirst: [p0, p1], bearingNewestFirst: [b, b],
      f0: 0, fBin: 1, fLo: 0, fHi: 10, rowRateHz: 0.5,
    })
    expect(pts).toHaveLength(2)
    expect(pts[0].ageS).toBeCloseTo(0, 12)
    expect(pts[0].alpha).toBe(1)
    expect(pts[1].ageS).toBeCloseTo(2, 12)
    expect(pts[1].alpha).toBeCloseTo(1 - 2 / 30, 6)

    const old = Array.from({ length: 16 }, () => new Float32Array([20]))
    const obr = Array.from({ length: 16 }, () => new Float32Array([10]))
    const all = bfiPoints({
      powerNewestFirst: old, bearingNewestFirst: obr,
      f0: 0, fBin: 1, fLo: 0, fHi: 10, rowRateHz: 0.5,
    })
    expect(all).toHaveLength(15)
    expect(all[all.length - 1].ageS).toBeCloseTo(28, 12)
    expect(all[all.length - 1].alpha).toBeGreaterThan(0)
  })

  it('wraps negative and oversize bearings into 0–360', () => {
    const power = new Float32Array([20, 20])
    const brg = new Float32Array([370, -30])
    const pts = bfiPoints({
      powerNewestFirst: [power], bearingNewestFirst: [brg],
      f0: 0, fBin: 1, fLo: 0, fHi: 10, rowRateHz: 0.5,
    })
    expect(pts).toHaveLength(2)
    expect(pts[0].bearingDeg).toBeCloseTo(10, 12)
    expect(pts[1].bearingDeg).toBeCloseTo(330, 12)
  })

  it('falls back to a rowPeriodS clock until the post-deploy sync', () => {
    const period = rowPeriodS({ res: 1, rowRateHz: 0.125 })
    const tNewest = 80
    const times = Array.from({ length: 6 }, (_, i) => tNewest - i * period)
    const pts = rows(times.length, 0.125, times, tNewest)
    expect(new Set(pts.map((p) => p.ageS)).size).toBe(4)
    expect(pts[0].ageS).toBeCloseTo(0, 12)
    expect(pts[1].ageS).toBeCloseTo(period, 12)
    expect(pts[1].alpha).toBeCloseTo(1 - period / 30, 6)
    // Same tNewest (pause) freezes.
    const again = rows(times.length, 0.125, times, tNewest)
    expect(again.map((p) => p.alpha)).toEqual(pts.map((p) => p.alpha))
  })
})

describe('BFI presets, range clipping and contrast', () => {
  it('defaults to BFI 1 = 10–100, BFI 2 = 10–500, BFI 3 = 100–1000 Hz', () => {
    expect(BFI_PRESETS).toEqual([1, 2, 3])
    expect(BFI_DEFAULT_PRESET).toBe(1)
    expect(bfiPresetTitle(1)).toBe('BFI 1')
    expect(BFI_DEFAULT_RANGES).toEqual({
      1: { loHz: 10, hiHz: 100 },
      2: { loHz: 10, hiHz: 500 },
      3: { loHz: 100, hiHz: 1000 },
    })
    expect(bfiRangeFor(1)).toEqual({ loHz: 10, hiHz: 100 })
  })

  it('clamps inverted, negative and empty ranges', () => {
    expect(clampBfiRange({ loHz: 20, hiHz: 80 })).toEqual({ loHz: 20, hiHz: 80 })
    expect(clampBfiRange({ loHz: 80, hiHz: 20 })).toEqual({ loHz: 20, hiHz: 80 })
    expect(clampBfiRange({ loHz: -10, hiHz: 50 }).loHz).toBe(0)
    expect(clampBfiRange({ loHz: 40, hiHz: 40 })).toEqual({ loHz: 40, hiHz: 41 })
    expect(clampBfiRange({ loHz: Number.NaN, hiHz: 100 }).loHz).toBe(0)
  })

  it('clips points to the selected preset range', () => {
    const power = new Float32Array([20, 20, 20, 20])
    const brg = new Float32Array([10, 1, 20, 1, 30, 1, 40, 1])
    const r = BFI_DEFAULT_RANGES[1]
    const pts = bfiPoints({
      powerNewestFirst: [power], bearingNewestFirst: [brg],
      f0: 0, fBin: 50, fLo: r.loHz, fHi: r.hiHz, rowRateHz: 0.5,
    })
    expect(pts.map((p) => p.freqHz)).toEqual([50, 100])
    const wide = BFI_DEFAULT_RANGES[2]
    const all = bfiPoints({
      powerNewestFirst: [power], bearingNewestFirst: [brg],
      f0: 0, fBin: 50, fLo: wide.loHz, fHi: wide.hiHz, rowRateHz: 0.5,
    })
    expect(all.map((p) => p.freqHz)).toEqual([50, 100, 150])
  })

  it('clips Sonya band-sample seam output to the range and keeps the fade', () => {
    const pts = bfiPointsFromBandSamples([
      { bearingDeg: 90, freqHz: 5, db: 20, rowTime: 100 },
      { bearingDeg: 90, freqHz: 40, db: 20, rowTime: 100 },
      { bearingDeg: 90, freqHz: 200, db: 20, rowTime: 85 },
    ], BFI_DEFAULT_RANGES[1], 100)
    expect(pts).toHaveLength(1)
    expect(pts[0].freqHz).toBeCloseTo(40, 12)
    expect(pts[0].alpha).toBe(1)
  })

  it('is available on DIFAR only and stretches contrast so CPAs read', () => {
    expect(bfiAvailable(true)).toBe(true)
    expect(bfiAvailable(false)).toBe(false)
    expect(bfiContrast(0)).toBe(0)
    expect(bfiContrast(1)).toBeCloseTo(1, 6)
    expect(bfiContrast(-1)).toBe(0)
    expect(bfiContrast(2)).toBe(1)
    expect(bfiContrast(0.5)).toBeGreaterThan(0.5)
    expect(bfiContrast(0.12)).toBeCloseTo(0, 6)
  })
})
