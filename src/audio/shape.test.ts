import { describe, expect, it } from 'vitest'
import { dbToLinear, limitBuffer, normalizePeak, rowToMagnitudes, softLimit } from './shape'

describe('dbToLinear', () => {
  it('maps floor→0, ceil→1, mid compressively', () => {
    expect(dbToLinear(0, 0, 30)).toBe(0)
    expect(dbToLinear(30, 0, 30)).toBe(1)
    expect(dbToLinear(15, 0, 30)).toBeCloseTo(0.25, 5)
  })
  it('NaN and below-floor → 0', () => {
    expect(dbToLinear(NaN, 0, 30)).toBe(0)
    expect(dbToLinear(-10, 0, 30)).toBe(0)
  })
})

describe('rowToMagnitudes + normalizePeak', () => {
  it('shapes a row and normalises the peak', () => {
    const src = new Float32Array([0, 10, 30, NaN, 20])
    const out = new Float32Array(5)
    const peak = rowToMagnitudes(src, 0, 5, 0, 30, out)
    expect(peak).toBe(1)
    expect(out[2]).toBe(1)
    expect(out[3]).toBe(0)
    normalizePeak(out, 5, 0.85)
    expect(out[2]).toBeCloseTo(0.85, 5)
    expect(out[1]).toBeLessThan(out[2]!)
  })
})

describe('softLimit', () => {
  it('passes below threshold and compresses above', () => {
    expect(softLimit(0.3, 0.7)).toBeCloseTo(0.3, 6)
    expect(Math.abs(softLimit(2, 0.7))).toBeLessThan(1)
    expect(Math.abs(softLimit(-2, 0.7))).toBeLessThan(1)
  })
  it('limitBuffer keeps peak ≤ ~1', () => {
    const buf = new Float32Array([0.2, 1.5, -3, 0.5])
    const p = limitBuffer(buf, 0.7)
    expect(p).toBeLessThanOrEqual(1)
    expect(Math.max(...buf.map(Math.abs))).toBeLessThanOrEqual(1)
  })
})
