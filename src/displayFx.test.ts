import { describe, expect, it, beforeEach } from 'vitest'
import {
  BLOOM_SURFACES, DEFAULT_DISPLAY_BLOOM, bloomAppliesPass, bloomAppliesTo, bloomFilterId,
  extraBloomPasses, loadDisplayBloom, resetDisplayBloomForTests, runBloomPass, saveDisplayBloom,
} from './displayFx'
import { FRAME_BUDGET_S, measurePlaneFrame } from './tactical/planeRoute'

beforeEach(() => { resetDisplayBloomForTests() })

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
