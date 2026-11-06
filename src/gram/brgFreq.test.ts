import { describe, expect, it } from 'vitest'
import type { Bearing, GramConfig } from '../engine/contract'
import {
  BRG_SPREAD_HZ, BearingHistory, OMNI_BRG_MSG, bearingFromTracked, formatBrgHud, freqToBin,
  resolveBearingAt, sampleBearingAt,
} from './brgFreq'

const cfg = (bins = 100, f0 = 0, fBin = 1): GramConfig => ({
  v: 1, type: 'gramConfig', streamId: 1, kind: 'lofar', channel: 12,
  bins, f0, fBin, rowRateHz: 4, dbFloor: 0, dbCeil: 30,
})

describe('freq → bin', () => {
  it('maps Hz onto the gram grid', () => {
    expect(freqToBin(cfg(), 178.8)).toBeCloseTo(178.8, 6)
    expect(freqToBin(cfg(2048, 0, 0.5), 100)).toBeCloseTo(200, 6)
  })
})

describe('BearingHistory + sampleBearingAt', () => {
  it('circular-means bearings across a band and recent rows', () => {
    const c = cfg(64, 0, 1)
    const hist = new BearingHistory(8, c.bins)
    // Two rows: bearings near 10° and 20° around bin 50 → mean ≈ 15°.
    const row = new Float32Array(c.bins).fill(NaN)
    for (let b = 48; b <= 52; b++) row[b] = 10
    hist.push(row, 0)
    for (let b = 48; b <= 52; b++) row[b] = 20
    hist.push(row, 0)
    const deg = sampleBearingAt(hist, c, 50, BRG_SPREAD_HZ, 8)
    expect(deg).not.toBeNull()
    expect(deg!).toBeCloseTo(15, 0)
  })
  it('handles wrap-around near 0/360', () => {
    const c = cfg(32, 0, 1)
    const hist = new BearingHistory(4, c.bins)
    const row = new Float32Array(c.bins).fill(NaN)
    row[10] = 350; row[11] = 10
    hist.push(row, 0)
    const deg = sampleBearingAt(hist, c, 10.5, 2, 4)
    expect(deg).not.toBeNull()
    // Circular mean of 350 and 10 is 0.
    expect(deg!).toBeGreaterThanOrEqual(0)
    expect(deg!).toBeLessThan(5)
  })
  it('returns null when the band is all NaN (omni / quiet)', () => {
    const c = cfg(32, 0, 1)
    const hist = new BearingHistory(4, c.bins)
    hist.push(new Float32Array(c.bins).fill(NaN), 0)
    expect(sampleBearingAt(hist, c, 16)).toBeNull()
  })
  it('pushes without allocating a new buffer each time', () => {
    const hist = new BearingHistory(4, 16)
    const src = new Float32Array(16)
    const before = hist.size
    hist.push(src, 0); hist.push(src, 0); hist.push(src, 0)
    expect(hist.size).toBe(before + 3)
    expect(hist.size).toBeLessThanOrEqual(4)
  })
})

describe('tracked-line fallback + resolve', () => {
  const lines: Bearing[] = [
    { buoyId: 2, freqHz: 178.8, brgDeg: 47.2, quality: 0.9 },
    { buoyId: 2, freqHz: 60, brgDeg: 200, quality: 0.5 },
    { buoyId: 3, freqHz: 178.8, brgDeg: 10, quality: 0.9 },
  ]
  it('picks the nearest tracked line on this buoy within spread', () => {
    expect(bearingFromTracked(lines, 2, 178.5, 1.5)).toBeCloseTo(47.2, 5)
    expect(bearingFromTracked(lines, 2, 100, 1.5)).toBeNull()
    expect(bearingFromTracked(lines, 9, 178.8, 1.5)).toBeNull()
  })
  it('resolveBearingAt falls back to tracked when history is empty', () => {
    expect(resolveBearingAt(null, cfg(), 178.8, 2, lines)).toBeCloseTo(47.2, 5)
    const hist = new BearingHistory(4, 100)
    hist.push(new Float32Array(100).fill(NaN), 0)
    expect(resolveBearingAt(hist, cfg(), 178.8, 2, lines)).toBeCloseTo(47.2, 5)
  })
})

describe('HUD copy', () => {
  it('formats BRG deg @ Hz · Bchannel', () => {
    expect(formatBrgHud(47.2, 178.8, 12)).toBe('BRG 047° @ 178.8 Hz · B12')
    expect(formatBrgHud(359.6, 9.25, 3)).toBe('BRG 000° @ 9.25 Hz · B3')
    expect(OMNI_BRG_MSG).toMatch(/omni/i)
  })
})
