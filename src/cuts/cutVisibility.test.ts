/**
 * CUTSDATA (Wilson 2026-11-08: "the cuts literally display no data").
 * Starter cuts must be prime examples: mid-cut, averaged over 120 rows, at least one line
 * above 12 Hz must stand ≥ 6 dB over its local (±24-bin) median in the raw renderCut LOFAR rows.
 * This checks the source rows before any FE normalization or colour mapping.
 */
import { describe, expect, it } from 'vitest'
import { listCutSeeds, renderCut } from '@acoustics'

function bestLineDb(cutId: string, durationS: number): { hz: number; db: number } {
  const s = renderCut(cutId)
  const lc = s.lofar
  const row = new Float32Array(lc.bins)
  while (s.simT < durationS * 0.5) if (s.writeLofarRow(row) < 0) break
  const mean = new Float64Array(lc.bins)
  let n = 0
  for (let r = 0; r < 120; r++) {
    if (s.writeLofarRow(row) < 0) break
    for (let i = 0; i < lc.bins; i++) mean[i] += row[i]
    n++
  }
  s.dispose()
  let best = { hz: 0, db: -Infinity }
  for (let i = 0; i < lc.bins; i++) {
    const hz = lc.f0 + i * lc.fBin
    if (hz <= 12) continue
    const lo = Math.max(0, i - 24), hi = Math.min(lc.bins, i + 25)
    const w = Array.from(mean.slice(lo, hi)).sort((a, b) => a - b)
    const db = (mean[i] - w[w.length >> 1]) / n
    if (db > best.db) best = { hz, db }
  }
  return best
}

describe('starter cuts show readable lines in raw rows', () => {
  for (const c of listCutSeeds()) {
    it(c.id, () => {
      const b = bestLineDb(c.id, c.durationS)
      expect(b.db, `${c.id}: strongest line ${b.hz.toFixed(1)} Hz only +${b.db.toFixed(1)} dB`).toBeGreaterThanOrEqual(6)
    }, 120000)
  }
})
