import { describe, expect, it } from 'vitest'
import { renderCut } from '@acoustics'
import { listCutSeeds } from './api'
import {
  CUT_SEEK_FIRST_ROWS,
  CUT_SEEK_FULL_ROWS,
  CutSeekPlayback,
  fillCutSeekFast,
  type CutSeekBuffers,
} from './seek'

function bufs(): CutSeekBuffers {
  return { data: new Float32Array(0), rowIndex: new Uint32Array(0) }
}

/** Normal playback: CutSession.writeLofarRow ring, same as host stepCut. */
function playbackRing(cutId: string, targetS: number, keep: number): { data: Float32Array; rowIndex: Uint32Array; rowCount: number; simT: number; bins: number } {
  const session = renderCut(cutId)
  const bins = session.lofar.bins
  const data = new Float32Array(keep * bins)
  const rowIndex = new Uint32Array(keep)
  let head = 0
  let written = 0
  while (session.simT + 1e-9 < targetS && !session.done) {
    const slot = head % keep
    const idx = session.writeLofarRow(data, slot * bins)
    if (idx < 0) break
    rowIndex[slot] = idx
    head++
    written++
  }
  const rowCount = Math.min(keep, written)
  if (written <= keep) return { data, rowIndex, rowCount, simT: session.simT, bins }
  const linear = new Float32Array(rowCount * bins)
  const linearIdx = new Uint32Array(rowCount)
  const start = head - rowCount
  for (let i = 0; i < rowCount; i++) {
    const slot = (start + i) % keep
    linear.set(data.subarray(slot * bins, (slot + 1) * bins), i * bins)
    linearIdx[i] = rowIndex[slot]!
  }
  return { data: linear, rowIndex: linearIdx, rowCount, simT: session.simT, bins }
}

describe('CUT seek fills', () => {
  const cut = listCutSeeds()[0]
  const cutId = cut.id

  it('first paint (fast) lands near target under ~150 ms warm', () => {
    const target = Math.floor(cut.durationS * 0.7)
    const out = bufs()
    fillCutSeekFast(cutId, target, out) // warm
    const times: number[] = []
    for (let i = 0; i < 5; i++) times.push(fillCutSeekFast(cutId, target, out).elapsedMs)
    times.sort((a, b) => a - b)
    expect(times[2]!).toBeLessThan(150)
    const r = fillCutSeekFast(cutId, target, out)
    expect(r.simT).toBeGreaterThanOrEqual(target - 0.3)
    expect(r.rowCount).toBeGreaterThan(40)
    expect(r.rowCount).toBeLessThanOrEqual(CUT_SEEK_FIRST_ROWS)
  })

  it('seeked rows are byte-identical to normal playback (determinism)', () => {
    const target = Math.floor(cut.durationS * 0.55)
    const keep = 180
    const seekOut = bufs()
    const a = new CutSeekPlayback(cutId, target, seekOut, keep).finish()
    const b = playbackRing(cutId, target, keep)
    expect(a.rowCount).toBe(b.rowCount)
    expect(a.rowCount).toBeGreaterThan(40)
    expect(a.simT).toBeCloseTo(b.simT, 1)
    const n = a.rowCount * a.bins
    for (let i = 0; i < n; i++) expect(seekOut.data[i]).toBe(b.data[i])
    for (let i = 0; i < a.rowCount; i++) expect(seekOut.rowIndex[i]).toBe(b.rowIndex[i])
  })

  it('chunked CutSeekPlayback matches one-shot finish', () => {
    const target = 120
    const keep = 200
    const one = bufs()
    const a = new CutSeekPlayback(cutId, target, one, keep).finish()
    const many = bufs()
    const fill = new CutSeekPlayback(cutId, target, many, keep)
    while (!fill.done) fill.writeMore(40)
    fill.compact()
    expect(fill.rowCount).toBe(a.rowCount)
    const n = a.rowCount * a.bins
    for (let i = 0; i < n; i += 7) expect(many.data[i]).toBe(one.data[i])
  })

  it('full-window deterministic fill completes under ~800 ms warm', () => {
    const target = Math.floor(cut.durationS * 0.7)
    const out = bufs()
    new CutSeekPlayback(cutId, target, out, CUT_SEEK_FULL_ROWS).finish() // warm
    const times: number[] = []
    for (let i = 0; i < 3; i++) {
      times.push(new CutSeekPlayback(cutId, target, out, CUT_SEEK_FULL_ROWS).finish().elapsedMs)
    }
    times.sort((a, b) => a - b)
    expect(times[1]!).toBeLessThan(800)
  })

  it('200 fast first-paints reuse buffers', () => {
    const out = bufs()
    fillCutSeekFast(cutId, 90, out)
    const data0 = out.data, idx0 = out.rowIndex, len = data0.length
    let maxMs = 0
    for (let i = 0; i < 200; i++) {
      const r = fillCutSeekFast(cutId, 30 + (i % 50) * 5, out)
      maxMs = Math.max(maxMs, r.elapsedMs)
      expect(out.data).toBe(data0)
      expect(out.rowIndex).toBe(idx0)
      expect(out.data.length).toBe(len)
    }
    expect(maxMs).toBeLessThan(500)
  }, 120_000)
})
