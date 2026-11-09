/**
 * Cuts / reveal DEMON answer-key UI. Imports acoustics cutDemonExpectation /
 * scenarioDemonAnswerKey — reveal and cut-metadata only.
 *
 * Live DemonPane and src/gram/demonConfig must NOT import this module (that would
 * risk leaking the answer into the live hint path).
 */
import {
  cutDemonExpectation,
  scenarioDemonAnswerKey,
  type CutSeed,
  type Scenario,
  type CutDemonExpectation,
  type ContactDemonExpectation,
} from '@acoustics'
import { CUT_DEMON_NO_CAV_HINT } from '../gram/demonConfig'

export type { CutDemonExpectation, ContactDemonExpectation }

/** Sonya\'s Cuts wording when the model says no DEMON propulsion lines. */
export { CUT_DEMON_NO_CAV_HINT }

/** Map a cut/contact expectation to the on-screen Cuts/reveal note (or null). */
export function cutsDemonHintFromExpectation(
  exp: Pick<{ demonExpected: boolean; demonReason: string }, 'demonExpected' | 'demonReason'> | null | undefined,
): string | null {
  if (!exp) return null
  if (!exp.demonExpected || exp.demonReason === 'not-cavitating') return CUT_DEMON_NO_CAV_HINT
  return null
}

/** Per-cut metadata for Cuts DEMON chrome. Safe during Cuts play (cut seed is already chosen). */
export function expectationForCut(cut: CutSeed): CutDemonExpectation {
  return cutDemonExpectation(cut)
}

export function cutsDemonHintForCut(cut: CutSeed | null | undefined): string | null {
  if (!cut) return null
  return cutsDemonHintFromExpectation(cutDemonExpectation(cut))
}

/**
 * Live reveal ONLY. Fresh answer key — never attach to streams, rows, subscriptions,
 * live contacts, or worker messages.
 */
export function liveRevealDemonAnswerKey(
  scenario: Pick<Scenario, 'contacts'>,
  horizonS = 900,
): readonly ContactDemonExpectation[] {
  return scenarioDemonAnswerKey(scenario, horizonS)
}

export function cutsDemonHintForContact(
  contact: ContactDemonExpectation | null | undefined,
): string | null {
  return cutsDemonHintFromExpectation(contact)
}
