import { describe, expect, it } from 'vitest'
import { listCutsForPicker, listCutSeeds } from './api'
import { cutPickerIndex, cutPickerTitle } from './cutLabel'

describe('cut picker title', () => {
  it('numbers cinderlilt-cav as Cut 1 (picker order, not seed index)', () => {
    const picker = listCutsForPicker()
    expect(picker[0]?.id).toBe('cut-cinderlilt-cav')
    expect(cutPickerTitle('cut-cinderlilt-cav')).toBe('Cut 1')
    expect(cutPickerIndex('cut-cinderlilt-cav')).toBe(0)
    // Seed catalog order differs — regression that caused the 'Cut 2' header bug.
    const seedIdx = listCutSeeds().findIndex((c) => c.id === 'cut-cinderlilt-cav')
    expect(seedIdx).not.toBe(0)
    expect(`Cut ${seedIdx + 1}`).not.toBe('Cut 1')
  })

  it('matches CutPicker Cut N for every playable picker entry', () => {
    listCutsForPicker().forEach((c, i) => {
      expect(cutPickerTitle(c.id)).toBe(`Cut ${i + 1}`)
    })
  })
})
