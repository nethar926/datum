import { describe, expect, it } from 'vitest'
import {
  PLOT_DIFFICULTY_HARDEST,
  aisAvailable,
  aisContacts,
  aisEffective,
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
