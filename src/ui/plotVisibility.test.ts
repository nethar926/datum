import { describe, expect, it } from 'vitest'
import { hideLandscapePlot } from './plotVisibility'

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
