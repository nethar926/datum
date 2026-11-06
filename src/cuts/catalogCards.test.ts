import { describe, expect, it } from 'vitest'
import { catalog } from '@acoustics'
import { catalogIdCard, catalogIdCards, deriveBehaviour } from './catalogCards'

describe('deriveBehaviour', () => {
  it('tags AC stable vs DC wander and EDA engine coupling', () => {
    expect(deriveBehaviour({ kind: 'electrical', stability: 'stable', width: 'discrete' })).toMatchObject({ power: 'AC', behaviour: expect.arrayContaining(['stable']) })
    expect(deriveBehaviour({ kind: 'dcvr', stability: 'unstable' }).behaviour).toContain('unstable')
    expect(deriveBehaviour({ kind: 'ssma', stability: 'unstable' }).power).toBe('DC')
    expect(deriveBehaviour({ eda: true, ramp: true }).behaviour).toEqual(expect.arrayContaining(['tracks-engine', 'on-with-engine', 'ramping']))
  })
})

describe('catalogIdCards vs acoustics catalog', () => {
  const cards = catalogIdCards(catalog)
  it('one card per catalog class', () => {
    expect(cards.length).toBe(catalog.classes.length)
    const ids = new Set(cards.map((c) => c.id))
    for (const c of catalog.classes) expect(ids.has(c.id)).toBe(true)
  })
  it('every card line family/envelope agrees with that class catalog entry', () => {
    for (const raw of catalog.classes) {
      const card = catalogIdCard(raw)
      const x = raw as {
        id: string; shafts?: number; params?: { blades?: number; shafts?: number; electricalHz?: number }
        propeller?: { shafts: number; blades: number }; idKeys?: {
          gridHz?: number
          harmonicFamilies?: { lineFamily: string; fundamentalHz: [number, number]; orders: [number, number] }[]
          hydp?: { nominalHz: [number, number] }
          giveaways?: string[]
        }
        hydp?: { nominalHz: number }; edas?: { name: string }[]; aux?: { kind: string; id: string }[]
        plant?: string; blades?: number
      }
      expect(card.id).toBe(x.id)
      expect(card.shafts).toBe(x.propeller?.shafts ?? x.shafts ?? x.params?.shafts ?? 1)
      expect(card.blades).toBe(x.propeller?.blades ?? x.params?.blades ?? 0)
      expect(card.gridHz).toBe(x.idKeys?.gridHz ?? x.params?.electricalHz)
      expect(card.plant).toBe(x.plant)
      // Every idKeys harmonic family appears on the card with the same envelope.
      for (const f of x.idKeys?.harmonicFamilies ?? []) {
        const line = card.lines.find((l) => l.family === f.lineFamily)
        expect(line, `${x.id} missing ${f.lineFamily}`).toBeTruthy()
        expect(line!.fundamentalHz).toEqual(f.fundamentalHz)
        expect(line!.orders).toEqual(f.orders)
      }
      // EDA names from catalog.
      for (const e of x.edas ?? []) {
        expect(card.lines.some((l) => l.family === 'EDA' && l.label === String(e.name).toUpperCase())).toBe(true)
      }
      // SSMA aux surfaces as SSMA classifying line.
      for (const a of x.aux ?? []) {
        if (a.kind === 'ssma') expect(card.lines.some((l) => l.family === 'SSMA')).toBe(true)
      }
      if (x.hydp || x.idKeys?.hydp) {
        const hydp = card.lines.find((l) => l.family === 'HYDP')
        expect(hydp).toBeTruthy()
        if (x.idKeys?.hydp) expect(hydp!.fundamentalHz).toEqual(x.idKeys.hydp.nominalHz)
      }
      if (x.idKeys?.giveaways) expect(card.giveaways).toEqual(x.idKeys.giveaways)
    }
  })
})
