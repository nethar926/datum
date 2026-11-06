import { getCutStarterPack, getCutSeed } from './api'
import type { CutGuess, CutSeed, IdentifyingLine, LineHit, OperatorMarks, ScoreResult } from './types'

/** Default mark-to-line tolerance (Hz). Callers may pass fBin-based. */
export const DEFAULT_MARK_TOL_HZ = 1.5

function marksList(m: OperatorMarks): number[] {
  const out: number[] = []
  if (m.harmF0Hz != null && m.harmF0Hz > 0) out.push(m.harmF0Hz)
  if (m.probeHz != null && m.probeHz > 0) out.push(m.probeHz)
  for (const x of m.extraHz ?? []) if (x > 0) out.push(x)
  return out
}

/** Candidate frequencies a classifying line can be hit at (fundamental and/or harmonic n). */
export function lineTargetHz(line: CutSeed['classifyingLines'][number]): { hz: number; wasHarmonic: boolean }[] {
  const out: { hz: number; wasHarmonic: boolean }[] = []
  if (line.nominalHz != null && line.nominalHz > 0) {
    const n = line.n != null && line.n > 1 ? line.n : 1
    if (n === 1) out.push({ hz: line.nominalHz, wasHarmonic: false })
    else out.push({ hz: line.nominalHz * n, wasHarmonic: true })
    // Also accept the fundamental when n>1 was declared (operator found fund after all).
    if (n > 1) out.push({ hz: line.nominalHz, wasHarmonic: false })
  }
  return out
}

/** Nearest operator mark to a nominal Hz, or null if none within tol. */
export function nearestMark(nominalHz: number, marks: readonly number[], tolHz: number): { hz: number; delta: number } | null {
  let best: { hz: number; delta: number } | null = null
  for (const hz of marks) {
    const delta = Math.abs(hz - nominalHz)
    if (delta <= tolHz && (!best || delta < best.delta)) best = { hz, delta }
  }
  return best
}

export function scoreLineHits(cut: CutSeed, marks: OperatorMarks, tolHz = DEFAULT_MARK_TOL_HZ): LineHit[] {
  const list = marksList(marks)
  return cut.classifyingLines.map((line) => {
    const targets = lineTargetHz(line)
    if (!targets.length) return { line, hit: false, nearestMarkHz: null, deltaHz: null }
    let best: { hz: number; delta: number } | null = null
    for (const t of targets) {
      const n = nearestMark(t.hz, list, tolHz)
      if (n && (!best || n.delta < best.delta)) best = n
    }
    return { line, hit: !!best, nearestMarkHz: best?.hz ?? null, deltaHz: best?.delta ?? null }
  })
}

function toIdentifying(line: CutSeed['classifyingLines'][number]): IdentifyingLine {
  const n = line.n != null && line.n > 1 ? line.n : undefined
  return {
    lineFamily: line.lineFamily,
    label: line.label,
    wasHarmonic: n != null,
    harmonicOf: line.harmonicOf,
    n,
    behaviour: line.behaviour,
    nominalHz: line.nominalHz,
  }
}

/** Prefer a giveaway; else the first classifying line. Names harmonics when declared. */
export function pickIdentifyingLine(cut: CutSeed): IdentifyingLine | null {
  const g = cut.classifyingLines.find((l) => l.giveaway) ?? cut.classifyingLines[0]
  return g ? toIdentifying(g) : null
}

/** Score a CUT guess against the seed. Pure; no allocations on the gram hot path. */
export function scoreCut(cut: CutSeed, guess: CutGuess, marks: OperatorMarks, tolHz = DEFAULT_MARK_TOL_HZ): ScoreResult {
  const lines = scoreLineHits(cut, marks, tolHz)
  const giveaways = lines.filter((l) => l.line.giveaway)
  const result: ScoreResult = {
    correct: guess.classId === cut.classId,
    truthClassId: cut.classId,
    guessClassId: guess.classId,
    confidence: guess.confidence,
    lines,
    giveawaysHit: giveaways.filter((l) => l.hit).length,
    giveawaysTotal: giveaways.length,
    identifiedBy: pickIdentifyingLine(cut),
  }
  if (cut.lookalikeGroupId) {
    const pack = getCutStarterPack()
    const pair = pack.lookalikePairs.find((p) => p.id === cut.lookalikeGroupId)
    if (pair) {
      const otherId = pair.cutIds[0] === cut.id ? pair.cutIds[1] : pair.cutIds[0]
      const other = getCutSeed(otherId)
      result.lookalike = {
        pairId: pair.id,
        otherCutId: otherId,
        otherClassId: other?.classId ?? '?',
        differOn: pair.differOn,
      }
    }
  }
  return result
}

export interface SessionScore {
  correct: number
  wrong: number
  total: number
  byCut: Record<string, ScoreResult>
}

export function emptySessionScore(): SessionScore {
  return { correct: 0, wrong: 0, total: 0, byCut: {} }
}

export function applyScore(prev: SessionScore, cutId: string, result: ScoreResult): SessionScore {
  const had = prev.byCut[cutId]
  let { correct, wrong, total } = prev
  if (!had) {
    total += 1
    if (result.correct) correct += 1
    else wrong += 1
  } else if (had.correct !== result.correct) {
    if (result.correct) { correct += 1; wrong -= 1 }
    else { wrong += 1; correct -= 1 }
  }
  return { correct, wrong, total, byCut: { ...prev.byCut, [cutId]: result } }
}
