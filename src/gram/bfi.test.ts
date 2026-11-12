import { describe, expect, it } from 'vitest'
import {
  BFI_WINDOW_S, bfiAvailable, bfiFade, bfiPoints, bfiRowCount,
} from './bfi'

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
  })

  it('covers whole rows at RES 1 and RES 5', () => {
    expect(bfiRowCount(0.25)).toBe(8)
    expect(bfiRowCount(0.5)).toBe(15)
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
    expect(all[all.length - 1].ageS).toBeCloseTo(14 / 0.5, 12)
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
})
