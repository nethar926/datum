import { describe, expect, it, beforeEach } from 'vitest'
import {
  BLOOM_SURFACES, DEFAULT_DISPLAY_BLOOM, DEFAULT_DISPLAY_NIGHT, NIGHT_NAV_LIGHTS, bloomAppliesPass, bloomAppliesTo, bloomFilterId,
  extraBloomPasses, loadDisplayBloom, loadDisplayNight, nightAppliesTo, nightAppliesToPlaneGlyph,
  nightBeaconOn, nightLights, resetDisplayFxForTests, runBloomPass, saveDisplayBloom, saveDisplayNight,
} from './displayFx'
import { FRAME_BUDGET_S, measurePlaneFrame } from './tactical/planeRoute'

beforeEach(() => { resetDisplayFxForTests() })

describe('display bloom', () => {
  it('defaults off, persists, and Off attaches no pass', () => {
    expect(DEFAULT_DISPLAY_BLOOM).toBe('off')
    expect(loadDisplayBloom()).toBe('off')
    expect(bloomAppliesPass('off')).toBe(false)
    expect(extraBloomPasses('off')).toBe(0)
    expect(bloomFilterId('off')).toBeNull()
    for (const level of ['low', 'med', 'high'] as const) {
      saveDisplayBloom(level)
      expect(loadDisplayBloom()).toBe(level)
      expect(bloomAppliesPass(level)).toBe(true)
      expect(extraBloomPasses(level)).toBe(1)
      expect(bloomFilterId(level)).toBe(`datum-bloom-${level}`)
    }
    saveDisplayBloom('off')
    expect(loadDisplayBloom()).toBe('off')
    expect(extraBloomPasses('off')).toBe(0)
  })

  it('covers plot, chrome and overlays, and never the grams', () => {
    expect(bloomAppliesTo('plot', 'off')).toBe(false)
    expect(bloomAppliesTo('gram', 'off')).toBe(false)
    expect(bloomAppliesTo('plot', 'med')).toBe(true)
    expect(bloomAppliesTo('chrome', 'low')).toBe(true)
    expect(bloomAppliesTo('overlay', 'high')).toBe(true)
    expect(bloomAppliesTo('gram', 'low')).toBe(false)
    expect(bloomAppliesTo('gram', 'med')).toBe(false)
    expect(bloomAppliesTo('gram', 'high')).toBe(false)
    expect(BLOOM_SURFACES.exclude.some((s) => s.includes('gram-panel') || s.includes('live-gram'))).toBe(true)
    expect(BLOOM_SURFACES.include.some((s) => s.includes('plot') || s.includes('tabbar'))).toBe(true)
  })

  it('adds zero work when Off and does not allocate when On', () => {
    const scratch = new Float32Array(64).fill(0.4)
    const before = Array.from(scratch)
    runBloomPass('off', scratch)
    expect(Array.from(scratch)).toEqual(before)
    const cap = scratch.length
    runBloomPass('high', scratch)
    expect(scratch.length).toBe(cap)
    expect(Array.from(scratch)).not.toEqual(before)
    const plane = measurePlaneFrame(64, 20, 1)
    expect(plane.seconds).toBeLessThan(FRAME_BUDGET_S)
  })
})

describe('display night', () => {
  it('defaults off, persists, and Off draws no lights', () => {
    expect(DEFAULT_DISPLAY_NIGHT).toBe(false)
    expect(loadDisplayNight()).toBe(false)
    expect(nightLights(false, 0)).toEqual([])
    expect(nightAppliesToPlaneGlyph(false)).toBe(false)
    saveDisplayNight(true)
    expect(loadDisplayNight()).toBe(true)
    expect(nightAppliesToPlaneGlyph(true)).toBe(true)
    const nav = nightLights(true, 0.5)
    expect(nav.map((l) => l.name)).toEqual(['left', 'right', 'tail'])
    expect(nav[0]!.r).toBeCloseTo(0.92)
    expect(nav[1]!.g).toBeCloseTo(0.86)
    expect(nav[2]!.g).toBeGreaterThan(0.8)
    expect(nightBeaconOn(0.05)).toBe(true)
    expect(nightBeaconOn(0.5)).toBe(false)
    expect(nightLights(true, 0.05).at(-1)?.name).toBe('beacon')
    saveDisplayNight(false)
    expect(loadDisplayNight()).toBe(false)
    expect(nightLights(false, 0.05)).toEqual([])
  })

  it('is plane-glyph only and never covers grams', () => {
    expect(nightAppliesTo('gram', true)).toBe(false)
    expect(nightAppliesTo('chrome', true)).toBe(false)
    expect(nightAppliesTo('overlay', true)).toBe(false)
    expect(nightAppliesTo('plot', true)).toBe(false)
    const left = NIGHT_NAV_LIGHTS.find((l) => l.name === 'left')!
    const right = NIGHT_NAV_LIGHTS.find((l) => l.name === 'right')!
    const tail = NIGHT_NAV_LIGHTS.find((l) => l.name === 'tail')!
    expect(left.x).toBeLessThan(0)
    expect(right.x).toBeGreaterThan(0)
    expect(tail.y).toBeGreaterThan(0)
  })
})
