import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { AcousticEngine, clampParams, generateScenario } from '@acoustics'
import { describe, expect, it } from 'vitest'
import {
  PLOT_DIFFICULTY_HARDEST,
  aisAvailable,
  aisContacts,
  aisDisplayTracks,
  aisEffective,
  isSubmarineContact,
  isVisible,
  revealContacts,
  visible,
  type PlotDifficulty,
  type PlotLayerContact,
} from './plotLayerPolicy'

const sub: PlotLayerContact = { category: 'subsurface', active: true }
const ship: PlotLayerContact = { category: 'surface', active: true }
const deadSub: PlotLayerContact = { category: 'subsurface', active: false }
const deadShip: PlotLayerContact = { category: 'surface', active: false }
const unknown: PlotLayerContact = { category: 'unknown', active: true }
const missing: PlotLayerContact = { active: true }

describe('plot layer policy (AIS / Reveal / difficulty)', () => {
  it('hardest difficulty is difficult and AIS is unavailable there', () => {
    expect(PLOT_DIFFICULTY_HARDEST).toBe('difficult')
    expect(aisAvailable('easy')).toBe(true)
    expect(aisAvailable('regular')).toBe(true)
    expect(aisAvailable('difficult')).toBe(false)
  })

  it('aisEffective ignores leftover on when disabled', () => {
    expect(aisEffective(true, 'regular')).toBe(true)
    expect(aisEffective(true, 'difficult')).toBe(false)
    expect(aisEffective(false, 'difficult')).toBe(false)
    expect(aisEffective(false, 'easy')).toBe(false)
  })

  it('every difficulty × AIS × Reveal combination', () => {
    const diffs: PlotDifficulty[] = ['easy', 'regular', 'difficult']
    for (const d of diffs) {
      for (const aisOn of [false, true]) {
        for (const revealOn of [false, true]) {
          const ais = aisEffective(aisOn, d)
          expect(isVisible('subsurface', true, aisOn, revealOn, d)).toBe(revealOn)
          expect(isVisible('surface', true, aisOn, revealOn, d)).toBe(ais)
          const shown = visible([sub, ship], aisOn, revealOn, d)
          const ids = shown.map((c) => c.category)
          if (revealOn) expect(ids).toContain('subsurface')
          else expect(ids).not.toContain('subsurface')
          if (ais) expect(ids).toContain('surface')
          else expect(ids).not.toContain('surface')
        }
      }
    }
  })

  it('inactive and unknown categories are hidden', () => {
    for (const d of ['easy', 'regular', 'difficult'] as const) {
      expect(isVisible('subsurface', false, true, true, d)).toBe(false)
      expect(isVisible('surface', false, true, true, d)).toBe(false)
      expect(isVisible('unknown', true, true, true, d)).toBe(false)
      expect(isVisible(undefined, true, true, true, d)).toBe(false)
      expect(visible([deadSub, deadShip, unknown, missing], true, true, d)).toEqual([])
    }
  })

  it('layer split: Reveal is subs only, AIS is surface only', () => {
    const all = [sub, ship, deadSub, deadShip, unknown]
    expect(revealContacts(all, true).every((c) => c.category === 'subsurface' && c.active !== false)).toBe(true)
    expect(revealContacts(all, true)).toEqual([sub])
    expect(revealContacts(all, false)).toEqual([])
    expect(aisContacts(all, true, 'regular')).toEqual([ship])
    expect(aisContacts(all, true, 'difficult')).toEqual([])
    expect(aisContacts(all, false, 'regular')).toEqual([])
  })
})

describe('display mapping: Reveal subs vs engine AIS', () => {
  it('isSubmarineContact uses kind when present, otherwise category', () => {
    expect(isSubmarineContact({ category: 'subsurface' })).toBe(true)
    expect(isSubmarineContact({ category: 'surface' })).toBe(false)
    expect(isSubmarineContact({ kind: 'submarine', category: 'surface' })).toBe(true)
    expect(isSubmarineContact({ kind: 'merchant', category: 'subsurface' })).toBe(false)
    expect(isSubmarineContact({ kind: 'submarine' })).toBe(true)
    expect(isSubmarineContact({})).toBe(false)
  })

  it('revealContacts returns only submarines, even if a surface contact is in the list', () => {
    const sub = { id: 's1', category: 'subsurface' as const, active: true, x: 10, y: 20 }
    const ship = { id: 'm1', category: 'surface' as const, active: true, x: 100, y: 200 }
    const tagged = { id: 's2', kind: 'submarine', category: 'subsurface' as const, active: true, x: 11, y: 21 }
    expect(revealContacts([sub, ship, tagged], true).map((c) => c.id)).toEqual(['s1', 's2'])
    expect(revealContacts([sub, ship], false)).toEqual([])
  })

  it('aisDisplayTracks is the engine AIS list as given (ids and positions preserved)', () => {
    const gramSurface = { id: 'm1', category: 'surface' as const, active: true, x: 100, y: 200 }
    const ais = [{ id: 'm1', name: 'MV ONE', x: 100, y: 200, crsDeg: 90, spdMps: 8 }]
    const shown = aisDisplayTracks(ais, true, 'regular' as PlotDifficulty)
    expect(shown).toEqual(ais)
    expect(shown[0]?.id).toBe(gramSurface.id)
    expect(shown[0]?.x).toBe(gramSurface.x)
    expect(shown[0]?.y).toBe(gramSurface.y)
    expect(aisDisplayTracks(ais, true, 'difficult' as PlotDifficulty)).toEqual([])
    expect(aisDisplayTracks(ais, false, 'regular' as PlotDifficulty)).toEqual([])
    // Empty engine list stays empty — do not invent ships from truth contacts.
    expect(aisDisplayTracks([], true, 'regular' as PlotDifficulty)).toEqual([])
  })

  it('Reveal and AIS contact-ID sets are disjoint', () => {
    const truth = [
      { id: 's1', category: 'subsurface' as const, active: true, x: 10, y: 20 },
      { id: 'm1', category: 'surface' as const, active: true, x: 100, y: 200 },
      { id: 'm2', category: 'surface' as const, active: true, x: 300, y: 50 },
    ]
    // Engine AIS after Sonya's mapping: same ids/positions as gram surface contacts.
    const engineAis = [
      { id: 'm1', x: 100, y: 200 },
      { id: 'm2', x: 300, y: 50 },
    ]
    const revIds = new Set(revealContacts(truth, true).map((c) => String(c.id)))
    const aisIds = new Set(aisDisplayTracks(engineAis, true, 'regular' as PlotDifficulty).map((c) => String(c.id)))
    expect([...revIds].some((id) => aisIds.has(id))).toBe(false)
    expect(revIds).toEqual(new Set(['s1']))
    expect(aisIds).toEqual(new Set(['m1', 'm2']))
    // Positions of shared-id AIS ships match the gram surface contacts.
    for (const ship of engineAis) {
      const gram = truth.find((c) => c.id === ship.id)
      expect(gram).toBeDefined()
      expect(ship.x).toBe(gram!.x)
      expect(ship.y).toBe(gram!.y)
    }
  })
})

const revealFxPath = fileURLToPath(new URL('../../ios/DatumAcoustics/Fixtures/reveal-seed7.json', import.meta.url))
const aisFxPath = fileURLToPath(new URL('../../ios/DatumAcoustics/Fixtures/ais-tracks-seed7.json', import.meta.url))

function engine7() {
  return new AcousticEngine(generateScenario(clampParams({ seed: 7 })), 7)
}

describe('seed-7 parity fixtures and engine mapping', () => {
  it('Reveal shows exactly fictional-1; AIS ids match gram surface contacts at the same x/y; IDs are disjoint', () => {
    const revealFx = JSON.parse(readFileSync(revealFxPath, 'utf8')) as {
      contacts: { sourceId: string; kind: string; category: string; x: number; y: number; active: boolean }[]
    }
    const aisFx = JSON.parse(readFileSync(aisFxPath, 'utf8')) as {
      ids: string[]
      at: { t0: { id: string; x: number; y: number; callsign: string; shipClass: string; type: string }[] }
    }

    const fromFx = revealContacts(revealFx.contacts, true)
    expect(fromFx.map((c) => c.sourceId)).toEqual(['fictional-1'])
    expect(fromFx.every((c) => c.kind === 'submarine')).toBe(true)

    const e = engine7()
    const revealed = revealContacts(e.truthContacts(), true)
    expect(revealed.map((c) => c.sourceId)).toEqual(['fictional-1'])
    expect(revealed.every((c) => c.kind === 'submarine')).toBe(true)

    const ais = aisDisplayTracks(e.aisTracks(0), true, 'regular' as PlotDifficulty)
    expect(ais.map((t) => t.id)).toEqual(aisFx.ids)
    const surface = e.allTruthContacts().filter((c) => c.category === 'surface' && c.active !== false)
    expect(ais.map((t) => t.id).sort()).toEqual(surface.map((c) => c.sourceId).sort())
    for (const ship of ais) {
      const gram = surface.find((c) => c.sourceId === ship.id)
      expect(gram).toBeDefined()
      expect(ship.x).toBe(gram!.x)
      expect(ship.y).toBe(gram!.y)
      const fx = aisFx.at.t0.find((t) => t.id === ship.id)
      expect(fx).toBeDefined()
      expect(ship.x).toBe(fx!.x)
      expect(ship.y).toBe(fx!.y)
      expect(ship.shipClass).toBe(fx!.shipClass)
      expect(ship.type).toBe(fx!.type)
    }

    const revIds = new Set(revealed.map((c) => String(c.sourceId ?? c.id)))
    const aisIds = new Set(ais.map((t) => t.id))
    expect([...revIds].some((id) => aisIds.has(id))).toBe(false)
    expect(aisIds.has('fictional-1')).toBe(false)
  })

  it('crew mode with allowRevealLocation false draws no reveal', () => {
    const e = engine7()
    e.crewHostPolicy = { allowRevealLocation: false, allowAisConnectivity: true }
    expect(e.truthContacts()).toBeUndefined()
    expect(revealContacts(e.truthContacts(), true)).toEqual([])
    expect(revealContacts(undefined, true)).toEqual([])
    expect(revealContacts(null, true)).toEqual([])
  })
})
