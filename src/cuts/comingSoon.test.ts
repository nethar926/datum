import { describe, expect, it } from 'vitest'
import { catalog } from '@acoustics'
import { listCutSeeds } from './api'
import { isNuclearCut, isNuclearCutId, isNuclearPlant, nuclearStarterCuts, plantOfCut } from './comingSoon'

describe('comingSoon helpers', () => {
  it('derives nuclear from catalog plant, not cut id names', () => {
    for (const cut of listCutSeeds()) {
      const plant = plantOfCut(cut)
      expect(plant === 'nuclear' || plant === 'diesel').toBe(true)
      expect(isNuclearCut(cut)).toBe(plant === 'nuclear')
      expect(isNuclearCutId(cut.id)).toBe(plant === 'nuclear')
      expect(isNuclearPlant(catalog.classes.find((c) => c.id === cut.classId)?.plant)).toBe(plant === 'nuclear')
    }
    expect(nuclearStarterCuts()).toHaveLength(2)
  })
})
