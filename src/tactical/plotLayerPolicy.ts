/**
 * Which truth contacts the plot draws, given AIS, Reveal, and difficulty.
 *
 * Matches native `PlotLayerPolicy` (DatumAppCore). Wilson (12 Nov 2026): AIS
 * shows surface ships; Reveal only uncovers subs; on the hardest difficulty
 * AIS is unavailable and ships stay hidden. Sonya: filter Reveal on
 * `category == "subsurface"`. Hardest preset is `"difficult"` (label
 * "Difficult") — there is no "extra hard" constant.
 */

import type { Difficulty } from '../scenarios/acousticsApi'

export type PlotDifficulty = Difficulty

/** Hardest generated preset (`presetToParams('difficult', …)`). */
export const PLOT_DIFFICULTY_HARDEST: PlotDifficulty = 'difficult'

export type PlotLayerContact = {
  category?: string | null
  active?: boolean
}

/** AIS may be turned on on easy and regular only. Greyed out on `'difficult'`. */
export function aisAvailable(difficulty: PlotDifficulty): boolean {
  return difficulty !== PLOT_DIFFICULTY_HARDEST
}

/** Effective AIS state: always off when the toggle is disabled, even if a leftover `aisOn` is still true. */
export function aisEffective(on: boolean, difficulty: PlotDifficulty): boolean {
  return on && aisAvailable(difficulty)
}

/** Draw this contact? Inactive and unknown categories are skipped. */
export function isVisible(
  category: string | null | undefined,
  active: boolean | undefined,
  aisOn: boolean,
  revealOn: boolean,
  difficulty: PlotDifficulty,
): boolean {
  if (active === false) return false
  if (category === 'subsurface') return revealOn
  if (category === 'surface') return aisEffective(aisOn, difficulty)
  return false
}

export function visible<T extends PlotLayerContact>(
  contacts: readonly T[],
  aisOn: boolean,
  revealOn: boolean,
  difficulty: PlotDifficulty,
): T[] {
  return contacts.filter((c) => isVisible(c.category, c.active, aisOn, revealOn, difficulty))
}

/** Reveal layer: subsurface only (even if a surface contact slipped through). */
export function revealContacts<T extends PlotLayerContact>(contacts: readonly T[], revealOn: boolean): T[] {
  if (!revealOn) return []
  return contacts.filter((c) => c.active !== false && c.category === 'subsurface')
}

/** AIS layer: surface only, and only when AIS is effective. */
export function aisContacts<T extends PlotLayerContact>(
  contacts: readonly T[],
  aisOn: boolean,
  difficulty: PlotDifficulty,
): T[] {
  if (!aisEffective(aisOn, difficulty)) return []
  return contacts.filter((c) => c.active !== false && c.category === 'surface')
}
