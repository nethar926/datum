import { describe, expect, it } from 'vitest'
import { dropBtBuoy } from '@acoustics'
import {
  btGlyphLabel, btMarkers, engineBtDrop, engineBtProfile, formatBtDepth, fromEngineDrop, hitBtDrop,
} from './btStyle'

describe('BT / SSP style', () => {
  it('drop returns the profile and is not a scenario buoy', () => {
    const d = engineBtDrop(11, { x: 100, y: -40, id: 9 })
    expect(d.id).toBe(9)
    expect(d.x).toBe(100)
    expect(d.y).toBe(-40)
    expect(d.profile.profile.length).toBeGreaterThan(8)
    const raw = dropBtBuoy(11, { x: 100, y: -40, id: 9 })
    expect(d.profile.layerDepthM).toBe(raw.profile.layerDepthM)
    expect(d.profile.sonicLayerDepthM).toBe(raw.profile.sonicLayerDepthM)
    expect(d.profile.thermoclineBaseM).toBe(raw.profile.thermoclineBaseM)
    expect(d.profile.deepChannelAxisM).toBe(raw.profile.deepChannelAxisM)
    expect(fromEngineDrop(raw).profile.profile).toHaveLength(raw.profile.profile.length)
  })

  it('hides the channel-axis marker when the minimum is at the seafloor', () => {
    const withAxis = { profile: [], layerDepthM: 40, sonicLayerDepthM: 50, thermoclineBaseM: 200, deepChannelAxisM: 800, salinityPsu: 35 }
    expect(btMarkers(withAxis).map((m) => m.key)).toEqual(['layer', 'sonic', 'thermocline', 'channel'])
    const seafloor = { profile: [], layerDepthM: 40, sonicLayerDepthM: 50, thermoclineBaseM: 200, salinityPsu: 35 }
    expect(btMarkers(seafloor).map((m) => m.key)).toEqual(['layer', 'sonic', 'thermocline'])
  })

  it('formats depth in the Settings unit, including feet', () => {
    expect(formatBtDepth(30.48, 'ft')).toBe('100 ft')
    expect(formatBtDepth(30.48, 'm')).toBe('30 m')
    expect(formatBtDepth(0.9144, 'yds')).toBe('1 yds')
  })

  it('labels the diamond glyph and hits the nearest drop', () => {
    expect(btGlyphLabel(3)).toBe('BT3')
    const p = engineBtProfile(11)
    const drops = [{ id: 1, x: 0, y: 0, profile: p }, { id: 2, x: 100, y: 0, profile: p }]
    expect(hitBtDrop(drops, 4, 0, (x) => x, (y) => y)).toBe(1)
    expect(hitBtDrop(drops, 1000, 1000, (x) => x, (y) => y)).toBeNull()
  })

  it('is deterministic by seed', () => {
    expect(engineBtProfile(11)).toEqual(engineBtProfile(11))
    expect(engineBtProfile(11).layerDepthM).not.toBe(engineBtProfile(17).layerDepthM)
  })
})
