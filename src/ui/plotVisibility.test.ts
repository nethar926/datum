import { afterEach, describe, expect, it, vi } from 'vitest'
import { hideLandscapePlot, loadLandscapePlotHidden, saveLandscapePlotHidden } from './plotVisibility'

describe('landscape plot visibility', () => {
  it('defaults to the normal split until explicitly hidden', () => {
    expect(hideLandscapePlot(false, false, false, 'live')).toBe(false)
    expect(hideLandscapePlot(true, false, false, 'live')).toBe(true)
  })
  it('never changes portrait grabber or hinge layouts', () => {
    expect(hideLandscapePlot(true, true, false, 'live')).toBe(false)
    expect(hideLandscapePlot(true, false, true, 'live')).toBe(false)
  })
  it('keeps the dedicated Plot tab accessible and leaves other tabs alone', () => {
    for (const tab of ['plot', 'cuts', 'settings']) expect(hideLandscapePlot(true, false, false, tab)).toBe(false)
  })
})

describe('landscape plot preference persistence', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('restores hidden and shown choices across fresh loads', () => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    })
    expect(loadLandscapePlotHidden()).toBe(false)
    saveLandscapePlotHidden(true)
    expect(loadLandscapePlotHidden()).toBe(true)
    // Temporary portrait/hinge layouts must not replace the saved preference.
    expect(hideLandscapePlot(loadLandscapePlotHidden(), true, false, 'live')).toBe(false)
    expect(hideLandscapePlot(loadLandscapePlotHidden(), false, true, 'live')).toBe(false)
    expect(hideLandscapePlot(loadLandscapePlotHidden(), false, false, 'live')).toBe(true)
    saveLandscapePlotHidden(false)
    expect(loadLandscapePlotHidden()).toBe(false)
  })

  it('ignores corrupt or obsolete stored values', () => {
    for (const value of [null, '', 'true', 'invalid', '0']) {
      vi.stubGlobal('localStorage', { getItem: () => value })
      expect(loadLandscapePlotHidden()).toBe(false)
    }
  })

  it('keeps the app usable when storage access is denied', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
    })
    expect(loadLandscapePlotHidden()).toBe(false)
    expect(() => saveLandscapePlotHidden(true)).not.toThrow()
  })
})
