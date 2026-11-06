import { describe, expect, it } from 'vitest'
import { mapSpectrumShift, shiftFocusHz, shiftFreq } from './shift'

describe('shiftFreq / shiftFocusHz', () => {
  it('off is identity; octave doubles', () => {
    expect(shiftFreq(80, 'off')).toBe(80)
    expect(shiftFreq(80, 'octave')).toBe(160)
    expect(shiftFocusHz(55, 'octave')).toBe(110)
  })
  it('non-finite → 0', () => {
    expect(shiftFreq(NaN, 'octave')).toBe(0)
    expect(shiftFreq(-1, 'off')).toBe(0)
  })
})

describe('mapSpectrumShift', () => {
  it('off copies', () => {
    const src = new Float32Array([0, 0.5, 1, 0.2])
    const dst = new Float32Array(4)
    mapSpectrumShift(src, 4, 'off', dst)
    expect(dst[0]).toBe(0); expect(dst[1]).toBeCloseTo(0.5); expect(dst[2]).toBeCloseTo(1); expect(dst[3]).toBeCloseTo(0.2)
  })
  it('octave stretches bins ×2', () => {
    const src = new Float32Array([0, 0.8, 0, 0])
    const dst = new Float32Array(8)
    mapSpectrumShift(src, 4, 'octave', dst)
    expect(dst[2]).toBeCloseTo(0.8, 5)
    expect(dst[3]).toBeCloseTo(0.4, 5)
    expect(dst[1]).toBe(0)
  })
})
