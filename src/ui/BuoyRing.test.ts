import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { BuoyRing, buoyTuneActions } from './BuoyRing'

describe('selected buoy receiver ring', () => {
  it('preserves receiver lifecycle gates', () => {
    expect(buoyTuneActions('working')).toEqual({ canTune: false, canDetune: true })
    expect(buoyTuneActions('integrating')).toEqual({ canTune: false, canDetune: true })
    expect(buoyTuneActions('detuned')).toEqual({ canTune: true, canDetune: false })
    for (const state of ['dead', 'error'] as const) expect(buoyTuneActions(state)).toEqual({ canTune: false, canDetune: false })
  })
  it('identifies the selected buoy and keeps both receiver actions keyboard accessible', () => {
    const html = renderToStaticMarkup(createElement(BuoyRing, { channel: 4, directional: true, health: 'working', onTune() {}, onDetune() {} }))
    expect(html).toContain('Selected buoy 4 controls')
    expect(html).toContain('DIFAR buoy')
    expect(html).toContain('CH 4')
    expect(html).toMatch(/data-testid="buoy-tune" disabled=""/)
    expect(html).toContain('data-testid="buoy-detune"')
  })
  it('renders the omnidirectional symbol without changing channel identity', () => {
    const html = renderToStaticMarkup(createElement(BuoyRing, { channel: 2, directional: false, health: 'detuned', onTune() {}, onDetune() {} }))
    expect(html).toContain('Omnidirectional buoy')
    expect(html).toContain('CH 2')
    expect(html).toMatch(/data-testid="buoy-detune" disabled=""/)
  })
})
