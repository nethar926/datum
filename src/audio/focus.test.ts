import { describe, expect, it } from 'vitest'
import { bandpassQ, biquadBandpass, focusHalfWidthHz, focusLabel, isFocusHalf } from './focus'

describe('focusHalfWidthHz', () => {
  it('returns the preset at full band', () => {
    expect(focusHalfWidthHz(10, 1000, 1000)).toBeCloseTo(10, 5)
  })
  it('narrows when zoomed', () => {
    const z = focusHalfWidthHz(10, 100, 1000) // 10× zoom
    expect(z).toBeLessThan(10)
    expect(z).toBeGreaterThanOrEqual(2)
    expect(z).toBeCloseTo(10 / Math.sqrt(10), 5)
  })
  it('never below minHalf', () => {
    expect(focusHalfWidthHz(5, 1, 1000, 2)).toBe(2)
  })
})

describe('bandpassQ + biquadBandpass', () => {
  it('Q grows as bandwidth shrinks', () => {
    expect(bandpassQ(200, 50).Q).toBeLessThan(bandpassQ(200, 5).Q)
  })
  it('coeffs are finite and a0-normalised (b0 = -b2 for BP)', () => {
    const c = biquadBandpass(123, 8, 48000)
    expect(Number.isFinite(c.b0)).toBe(true)
    expect(c.b2).toBeCloseTo(-c.b0, 8)
    expect(c.b1).toBe(0)
  })
})

describe('focusLabel / isFocusHalf', () => {
  it('formats the capsule', () => {
    expect(focusLabel(123.4, 10.2)).toBe('FOCUS 123 Hz ±10')
  })
  it('validates presets', () => {
    expect(isFocusHalf(10)).toBe(true)
    expect(isFocusHalf(7)).toBe(false)
  })
})
