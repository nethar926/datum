/**
 * Nuclear classes/cuts are "Coming soon" (Wilson): still listed in Compendium and the
 * starter-pack picker, but marked and not selectable until nuclear grams ship.
 * Plant comes from the catalog `plant` field — never hard-coded class names.
 */
import { catalog } from '@acoustics'
import { getCutSeed, listCutSeeds, type CutSeed } from './api'

export const COMING_SOON_LABEL = 'Coming soon'

export function isNuclearPlant(plant: string | undefined | null): boolean {
  return plant === 'nuclear'
}

/** Catalog class plant for a cut, or undefined if the class is missing. */
export function plantOfCut(cut: Pick<CutSeed, 'classId'>): string | undefined {
  return catalog.classes.find((c) => c.id === cut.classId)?.plant
}

export function isNuclearCut(cut: Pick<CutSeed, 'classId'>): boolean {
  return isNuclearPlant(plantOfCut(cut))
}

export function isNuclearCutId(cutId: string): boolean {
  const cut = getCutSeed(cutId)
  return !!cut && isNuclearCut(cut)
}

/** Starter-pack cuts whose class plant is nuclear (data-derived). */
export function nuclearStarterCuts(): CutSeed[] {
  return listCutSeeds().filter(isNuclearCut)
}
