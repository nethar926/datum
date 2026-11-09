import { describe, expect, it } from 'vitest'
import { difarBrightnessFromPower, difarRgbFromPowerAndHue, lmNullStaysDark } from './difarBrightness'

describe('DIFAR brightness from power', () => {
  it('maps power 0..1 to brightness with no bearing leakage', () => {
    expect(difarBrightnessFromPower(0)).toBe(0)
    expect(difarBrightnessFromPower(1)).toBe(1)
    expect(difarBrightnessFromPower(0.4)).toBeCloseTo(0.4)
    expect(difarBrightnessFromPower(-1)).toBe(0)
    expect(difarBrightnessFromPower(2)).toBe(1)
  })
  it('scales hue by power so LM nulls stay dark', () => {
    const red: [number, number, number] = [255, 0, 0]
    expect(difarRgbFromPowerAndHue(red, 0)).toEqual([0, 0, 0])
    expect(difarRgbFromPowerAndHue(red, 1)).toEqual([255, 0, 0])
    expect(difarRgbFromPowerAndHue(red, 0.1)).toEqual([26, 0, 0])
    expect(lmNullStaysDark(0.05)).toBe(true)
    expect(lmNullStaysDark(0.9)).toBe(false)
  })
})
