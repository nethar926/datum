import { describe, expect, it } from 'vitest'
import { listCutSeeds } from '../cuts/api'
import { CUT_SEEK_FIRST_ROWS, CUT_SEEK_FULL_ROWS } from '../cuts/seek'
import type { FromWorker } from './contract'
import { SimHost } from './host'

function runHost(syncBackfill = true) {
  const msgs: FromWorker[] = []
  // Sync schedule drains backfill immediately (tests); production uses setTimeout.
  const schedule = syncBackfill
    ? (fn: () => void) => { fn(); return 0 }
    : (fn: () => void, ms?: number) => setTimeout(fn, ms ?? 0)
  const cancel = syncBackfill ? () => {} : (id: number) => clearTimeout(id)
  const host = new SimHost((m) => { msgs.push(m) }, schedule, cancel)
  const cut = listCutSeeds()[0]
  host.handle({ type: 'init', seed: cut.seed, scenarioId: `cut:${cut.id}`, band: 'lofar1k', rowRateHz: 2, demon: false })
  msgs.length = 0
  return { host, msgs, cut }
}

describe('SimHost seekCut', () => {
  it('first-paints then backfills to FULL without gramRows fast-forward', () => {
    const { host, msgs, cut } = runHost(true)
    const target = Math.floor(cut.durationS * 0.7)
    host.handle({ type: 'seekCut', simT: target })
    const seeked = msgs.filter((m) => m.type === 'cutSeeked')
    const rows = msgs.filter((m) => m.type === 'gramRows')
    expect(rows).toHaveLength(0)
    expect(seeked.length).toBeGreaterThanOrEqual(2) // first + done
    const first = seeked.find((m) => m.type === 'cutSeeked' && m.phase === 'first')
    const done = seeked.filter((m) => m.type === 'cutSeeked' && m.phase === 'done').at(-1)
    expect(first?.type).toBe('cutSeeked')
    expect(done?.type).toBe('cutSeeked')
    if (first?.type === 'cutSeeked') {
      expect(first.rowCount).toBeGreaterThan(40)
      expect(first.rowCount).toBeLessThanOrEqual(CUT_SEEK_FIRST_ROWS)
    }
    // Warm first-paint latency (cold construct is excluded).
    const warmTimes: number[] = []
    for (let i = 0; i < 5; i++) {
      msgs.length = 0
      host.handle({ type: 'seekCut', simT: target })
      const f = msgs.find((m) => m.type === 'cutSeeked' && m.phase === 'first')
      if (f && f.type === 'cutSeeked') warmTimes.push(f.elapsedMs)
    }
    warmTimes.sort((a, b) => a - b)
    expect(warmTimes[2]!).toBeLessThan(150)
    if (done?.type === 'cutSeeked') {
      expect(done.rowCount).toBeGreaterThan(400)
      expect(done.rowCount).toBeLessThanOrEqual(CUT_SEEK_FULL_ROWS)
      expect(done.gen).toBe(first && first.type === 'cutSeeked' ? first.gen : done.gen)
    }
  }, 60_000)

  it('a newer scrub cancels the previous backfill generation', () => {
    const msgs: FromWorker[] = []
    let queued: Array<() => void> = []
    const schedule = (fn: () => void) => { queued.push(fn); return queued.length }
    const cancel = () => { queued = [] }
    const host = new SimHost((m) => { msgs.push(m) }, schedule, cancel)
    const cut = listCutSeeds()[0]
    host.handle({ type: 'init', seed: cut.seed, scenarioId: `cut:${cut.id}`, band: 'lofar1k', rowRateHz: 2, demon: false })
    msgs.length = 0
    host.handle({ type: 'seekCut', simT: 200 })
    const firstGen = (msgs.find((m) => m.type === 'cutSeeked' && m.phase === 'first') as { gen: number } | undefined)?.gen
    expect(firstGen).toBeTypeOf('number')
    expect(queued.length).toBeGreaterThan(0)
    // New scrub before draining the queue — stale callbacks must no-op.
    const pending = queued.slice()
    queued = []
    msgs.length = 0
    host.handle({ type: 'seekCut', simT: 250 })
    const secondFirst = msgs.find((m) => m.type === 'cutSeeked' && m.phase === 'first') as { gen: number } | undefined
    expect(secondFirst?.gen).toBeGreaterThan(firstGen!)
    const genAfter = secondFirst!.gen
    msgs.length = 0
    for (const fn of pending) fn() // stale backfill
    const stale = msgs.filter((m) => m.type === 'cutSeeked' && (m as { gen: number }).gen === firstGen)
    expect(stale).toHaveLength(0)
    // Drain the new seek's queue to completion.
    let guard = 0
    while (queued.length && guard++ < 200) {
      const batch = queued.slice(); queued = []
      for (const fn of batch) fn()
    }
    const done = msgs.filter((m) => m.type === 'cutSeeked' && (m as { phase: string }).phase === 'done')
    expect(done.length).toBeGreaterThanOrEqual(1)
    expect((done.at(-1) as { gen: number }).gen).toBe(genAfter)
  })

  it('200 seeks stay under latency budget with buffer reuse', () => {
    const { host, msgs, cut } = runHost(true)
    let maxFirst = 0
    for (let i = 0; i < 200; i++) {
      msgs.length = 0
      const t = 40 + (i % 40) * 4
      host.handle({ type: 'seekCut', simT: Math.min(t, cut.durationS - 1) })
      const first = msgs.find((m) => m.type === 'cutSeeked' && m.phase === 'first')
      expect(first?.type).toBe('cutSeeked')
      if (first && first.type === 'cutSeeked') maxFirst = Math.max(maxFirst, first.elapsedMs)
    }
    expect(maxFirst).toBeLessThan(500)
  }, 180_000)
})
