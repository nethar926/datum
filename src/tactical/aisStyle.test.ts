import { describe, expect, it, beforeEach } from 'vitest'
import {
  AIS_AFFILIATION_RGB, AIS_GLYPH, DEFAULT_AIS_AFFILIATION,
  aisAffiliation, aisAvoidsCrease, aisCardFrame, aisInfoFromTrack,
  resetAisAffiliations, setAisAffiliation, type AisEngineTrack, type AisTrackSource,
} from './aisStyle'
import { aisContacts, aisEffective, aisAvailable, revealContacts, type PlotDifficulty } from './plotLayerPolicy'

beforeEach(() => { resetAisAffiliations() })

const lumen: AisEngineTrack = {
  id: 'surface-lumen', name: 'MV LUMEN', x: 100, y: 200, crsDeg: 47, spdMps: 6.17,
}

describe('AIS style', () => {
  it('uses a sailboat placeholder and starts unknown / yellow', () => {
    expect(AIS_GLYPH).toBe('sailboat')
    expect(aisAffiliation('surface-lumen')).toBe(DEFAULT_AIS_AFFILIATION)
    expect(AIS_AFFILIATION_RGB.unknown).toBe('#ffd60a')
  })

  it('colours and persists affiliation per contact for the session', () => {
    setAisAffiliation('surface-lumen', 'suspect')
    setAisAffiliation('surface-narwhal', 'friendly')
    expect(aisAffiliation('surface-lumen')).toBe('suspect')
    expect(AIS_AFFILIATION_RGB.suspect).toBe('#ff453a')
    expect(aisAffiliation('surface-narwhal')).toBe('friendly')
    expect(AIS_AFFILIATION_RGB.friendly).toBe('#0a84ff')
    setAisAffiliation('surface-lumen', 'neutral')
    expect(aisAffiliation('surface-lumen')).toBe('neutral')
    expect(AIS_AFFILIATION_RGB.neutral).toBe('#30d158')
    setAisAffiliation('surface-lumen', 'unknown')
    expect(aisAffiliation('surface-lumen')).toBe('unknown')
    expect(aisAffiliation('surface-narwhal')).toBe('friendly')
    resetAisAffiliations()
    expect(aisAffiliation('surface-narwhal')).toBe('unknown')
  })

  it('fills the card from existing contact data without inventing class or type', () => {
    const info = aisInfoFromTrack(lumen)
    expect(info.callsign).toBe('MV LUMEN')
    expect(info.shipClass).toBeUndefined()
    expect(info.type).toBeUndefined()
    expect(info.crsDeg).toBe(47)
    expect(info.spdMps).toBe(6.17)
    expect(info.x).toBe(100)
    expect(info.y).toBe(200)
    expect(info.callsign.toLowerCase()).not.toContain('fictional ')
  })

  it("overlays Sonya's seam callsign, class, and type", () => {
    const source: AisTrackSource = {
      aisTrack: (id) => id === 'surface-lumen'
        ? { id, callsign: 'CS-NARWHAL', name: 'MV LUMEN', shipClass: 'trawler', type: 'fishing',
            x: 110, y: 220, crsDeg: 12, spdMps: 4 }
        : undefined,
    }
    const info = aisInfoFromTrack(lumen, source)
    expect(info.callsign).toBe('CS-NARWHAL')
    expect(info.shipClass).toBe('trawler')
    expect(info.type).toBe('fishing')
    expect(info.crsDeg).toBe(12)
    expect(info.spdMps).toBe(4)
  })

  it('keeps the AIS card inside the plot and off the hinge crease', () => {
    const plot = { x: 0, y: 0, width: 400, height: 600 }
    const frame = aisCardFrame(50, 50, plot)!
    expect(frame.x).toBeGreaterThanOrEqual(plot.x)
    expect(frame.y).toBeGreaterThanOrEqual(plot.y)
    expect(frame.x + frame.width).toBeLessThanOrEqual(plot.x + plot.width)
    expect(frame.y + frame.height).toBeLessThanOrEqual(plot.y + plot.height)
    const crease = { x: 300, y: 0, width: 24, height: 600 }
    const clipped = aisCardFrame(310, 200, plot, crease)!
    expect(aisAvoidsCrease(clipped, crease)).toBe(true)
    expect(clipped.x + clipped.width).toBeLessThanOrEqual(crease.x)
  })

  it('keeps AIS toggle / Reveal-never-ships / difficult-unavailable rules', () => {
    const ship = { id: 1, label: 'MV LUMEN', x: 0, y: 0, crsDeg: 0, spdMps: 0, category: 'surface' as const, active: true }
    const sub = { id: 2, label: 'S1', x: 0, y: 0, crsDeg: 0, spdMps: 0, category: 'subsurface' as const, active: true, depthM: 80 }
    expect(aisAvailable('difficult' as PlotDifficulty)).toBe(false)
    expect(aisEffective(true, 'regular' as PlotDifficulty)).toBe(true)
    expect(aisEffective(true, 'difficult' as PlotDifficulty)).toBe(false)
    expect(revealContacts([ship, sub], true).map((c) => c.id)).toEqual([2])
    expect(aisContacts([ship], false, 'regular' as PlotDifficulty)).toEqual([])
    expect(aisContacts([ship, sub], true, 'regular' as PlotDifficulty).map((c) => c.id)).toEqual([1])
    expect(aisContacts([ship], true, 'difficult' as PlotDifficulty)).toEqual([])
  })
})
