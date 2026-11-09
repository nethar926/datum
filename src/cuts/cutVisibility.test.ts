/**
 * CUTSDATA (Wilson 2026-11-08: "the cuts literally display no data").
 * Uses the shared acoustics cut-visibility window (CUT_VISIBILITY_WINDOW) so FE and
 * acoustics measure the same mid-cut mean row and local-median contrast.
 *
 * Physics fix (2026-11-08, Sonya f1a4d57): diesel/AIP cuts clear the 6 dB window.
 * Nuclear classes are "Coming soon" (Wilson) — visibility not required yet;
 * UI badge/disabled picker covered in comingSoon/CutPicker tests. Keep these
 * acoustics-visibility skips until nuclear grams ship.
 * Morrowcoil lesson is h2 clear / h1 masked.
 *
 * Lazy: no CutSession work at module import — under the full parallel suite that
 * contended with the warm-seek 150 ms budget and flaked. Memoize per cut on first use.
 */
import { describe, expect, it } from 'vitest'
import {
  CUT_VISIBILITY_WINDOW as W,
  bestLine,
  cutVisibilityIds,
  lessonLineContrasts,
  meanRawRow,
  type LessonContrast,
} from '@acoustics'

const ids = cutVisibilityIds()
const NUCLEAR = new Set(['cut-velvetshoal-nuc', 'cut-twilightweft-nuc'])
const dieselIds = ids.filter((id) => !NUCLEAR.has(id))
const nuclearIds = ids.filter((id) => NUCLEAR.has(id))

type Line = { hz: number; contrastDb: number }

const bestById = new Map<string, Line>()
const lessonsById = new Map<string, LessonContrast[]>()

function bestFor(id: string): Line {
  if (!bestById.has(id)) bestById.set(id, bestLine(meanRawRow(id)))
  return bestById.get(id)!
}

function lessonsFor(id: string): LessonContrast[] {
  if (!lessonsById.has(id)) lessonsById.set(id, lessonLineContrasts(id))
  return lessonsById.get(id)!
}

describe('starter cuts show readable lines in raw rows (shared window)', () => {
  it('ships exactly the 10 registry cuts', () => {
    expect(ids.length).toBe(10)
  })

  it('records current baseline (diesel/AIP focus)', () => {
    console.log(JSON.stringify(dieselIds.map((id) => {
      const r = bestFor(id)
      return [id, +r.hz.toFixed(1), +r.contrastDb.toFixed(2)]
    })))
  }, 30_000)

  it.each(dieselIds)(
    `%s has a line >= ${W.minContrastDb} dB at mid-cut`,
    (id) => {
      expect(bestFor(id).contrastDb).toBeGreaterThanOrEqual(W.minContrastDb)
    },
    15_000,
  )

  // Nuclear coming soon (Lead 2026-11-08) — skip until Lead removes from pack.
  it.skip.each(nuclearIds)(
    `%s (nuclear coming soon) visibility not required`,
    (id) => {
      expect(bestFor(id).contrastDb).toBeGreaterThanOrEqual(W.minContrastDb)
    },
  )
})

describe('starter cuts: lesson-line contrast (diesel/AIP)', () => {
  it('morrowcoil HYDP fundamental stays masked while h2 clears', () => {
    const rows = lessonsFor('cut-morrowcoil-hydp-masked')
    const h1 = rows.find((r) => r.line.lineFamily === 'HYDP' && r.line.n === 1)!
    const h2 = rows.find((r) => r.line.lineFamily === 'HYDP' && r.line.n === 2)!
    expect(h1.expectMasked).toBe(true)
    expect(h1.contrastDb!).toBeLessThan(W.minContrastDb)
    expect(h2.contrastDb!).toBeGreaterThanOrEqual(W.minContrastDb)
  }, 15_000)
})
