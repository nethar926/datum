/** FE-only CUT scoring / UI types. CutSeed / classifying line schema live in `@acoustics`. */
export type {
  CutRichness,
  OperatingMode,
  CutClassifyingLine,
  CutSeed,
  CutLookalikePair,
  CutStarterPack,
  CutLineBehaviour,
  CutSession as AcousticsCutSession,
} from '@acoustics'

import type { CutClassifyingLine, CutLineBehaviour, CutSeed } from '@acoustics'
import type { FeCutSession } from './api'

/** Main-thread session handle (worker owns the real Acoustics CutSession). */
export type CutSession = FeCutSession

export type Confidence = 'low' | 'med' | 'high'

export interface OperatorMarks {
  /** HARM fundamental Hz, if set. */
  harmF0Hz: number | null
  /** PROBE frequency Hz, if set. */
  probeHz: number | null
  /** Extra marked frequencies (future: multi-probe). */
  extraHz?: readonly number[]
}

export interface CutGuess {
  classId: string
  confidence?: Confidence
}

export interface LineHit {
  line: CutClassifyingLine
  hit: boolean
  nearestMarkHz: number | null
  deltaHz: number | null
}

export interface IdentifyingLine {
  lineFamily: string
  label: string
  /** True when the giveaway was a harmonic (n of harmonicOf), not the fundamental. */
  wasHarmonic: boolean
  harmonicOf?: string
  n?: number
  behaviour?: CutLineBehaviour
  nominalHz?: number
}

export interface ScoreResult {
  correct: boolean
  truthClassId: string
  guessClassId: string
  confidence?: Confidence
  lines: LineHit[]
  giveawaysHit: number
  giveawaysTotal: number
  /** The classifying line that identified (or should have identified) the boat. */
  identifiedBy: IdentifyingLine | null
  lookalike?: { pairId: string; otherCutId: string; otherClassId: string; differOn: string }
}

/** @deprecated Prefer CutLineBehaviour from @acoustics; kept for catalog-card derived tags. */
export type LineBehaviour = CutLineBehaviour | 'stable-ac' | 'wander-dc' | 'tracks-engine' | 'on-with-engine' | 'ramp'

