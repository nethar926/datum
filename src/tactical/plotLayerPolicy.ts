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
  /** Sonya's upcoming `kind: 'submarine'` field; optional until the engine lands it. */
  kind?: string | null
  id?: string | number
  sourceId?: string
  x?: number
  y?: number
}

/**
 * Is this a submarine for the Reveal layer?
 * Isolated so we can switch to Sonya's `kind: 'submarine'` when that field
 * is on every contact. Today: honour `kind` when present, otherwise the
 * engine's `category === "subsurface"`.
 */
export function isSubmarineContact(c: { kind?: string | null; category?: string | null }): boolean {
  if (c.kind != null && c.kind !== '') return c.kind === 'submarine'
  return c.category === 'subsurface'
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
  if (isSubmarineContact({ category })) return revealOn
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

/** Reveal layer: submarines only (never surface / merchant contacts).
 * `null`/`undefined` contacts (crew mode, allowRevealLocation false) draw nothing. */
export function revealContacts<T extends PlotLayerContact>(
  contacts: readonly T[] | null | undefined,
  revealOn: boolean,
): T[] {
  if (!revealOn || contacts == null) return []
  return contacts.filter((c) => c.active !== false && isSubmarineContact(c))
}

/**
 * AIS layer for drawing: the engine's AIS list as given. No frontend remix
 * from truth / gram contacts — Sonya owns that mapping.
 */
export function aisDisplayTracks<T>(
  aisTracks: readonly T[],
  aisOn: boolean,
  difficulty: PlotDifficulty,
): T[] {
  if (!aisEffective(aisOn, difficulty)) return []
  return aisTracks.slice()
}

/** Filter a mixed truth list down to surface contacts (tests / legacy). Drawing uses `aisDisplayTracks`. */
export function aisContacts<T extends PlotLayerContact>(
  contacts: readonly T[],
  aisOn: boolean,
  difficulty: PlotDifficulty,
): T[] {
  if (!aisEffective(aisOn, difficulty)) return []
  return contacts.filter((c) => c.active !== false && c.category === 'surface' && !isSubmarineContact(c))
}
