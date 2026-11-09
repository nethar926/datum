import { Worker } from 'node:worker_threads'
import { describe, expect, it } from 'vitest'
import { listCutSeeds } from '../cuts/api'
import { CUT_SEEK_FIRST_ROWS, CUT_SEEK_FULL_ROWS } from '../cuts/seek'
import type { FromWorker, ToWorker } from './contract'
import { MAX_FIELD_BUOYS, SimHost } from './host'

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

/** Live field at the 32-buoy cap; step() writes one LOFAR row period across every buoy. */
function liveField32() {
  const out: FromWorker[] = []
  const queue: ArrayBuffer[][] = []
  const host = new SimHost((m) => {
    if (m.type === 'gramRows') {
      out.push(m)
      queue.push([m.streamIds.buffer, m.rowIndex.buffer, m.data.buffer, ...(m.bearingDeg ? [m.bearingDeg.buffer] : [])] as ArrayBuffer[])
    } else out.push(m)
  })
  host.handle({ type: 'init', seed: 7, scenarioId: 'ridgeline-field', band: 'lofar1k', rowRateHz: 2, demon: false })
  const release = () => { while (queue.length) host.handle({ type: 'release', buffers: queue.shift()! }) }
  const step = (k = 1) => { for (let i = 0; i < k; i++) { host.handle({ type: 'step' }); release() } }
  step(2)
  const lofarCount = () => {
    const s = out.filter((m) => m.type === 'streams').at(-1)
    return s && s.type === 'streams' ? s.configs.filter((c) => c.kind === 'lofar').length : 0
  }
  let seq = 1
  let i = 0
  while (lofarCount() < MAX_FIELD_BUOYS && i < MAX_FIELD_BUOYS + 4) {
    const remaining = MAX_FIELD_BUOYS - lofarCount()
    const chunk: Extract<ToWorker, { type: 'dropBuoys' }>['buoys'] = []
    for (let k = 0; k < Math.min(8, remaining); k++, i++) {
      chunk.push({
        kind: i % 2 === 0 ? 'difar' : 'omni',
        x: (i % 8) * 500 - 1750,
        y: Math.floor(i / 8) * 700 - 2450,
        channel: 400 + i,
      })
    }
    host.handle({ type: 'dropBuoys', seq: seq++, source: 'manual', buoys: chunk })
    const last = out.filter((m) => m.type === 'dropped').at(-1)
    if (last && last.type === 'dropped' && last.error && last.channels.length === 0) {
      throw new Error(`dropBuoys failed: ${last.error}`)
    }
  }
  expect(lofarCount()).toBe(MAX_FIELD_BUOYS)
  const tactical = out.filter((m) => m.type === 'tactical').at(-1)
  expect(tactical?.type).toBe('tactical')
  if (tactical?.type === 'tactical') {
    expect(tactical.buoys.length).toBe(MAX_FIELD_BUOYS)
  }
  step(4) // warm every stream once
  return { host, step, liveCount: MAX_FIELD_BUOYS }
}

/**
 * Sibling worker burns CPU like a second core running a full 32-buoy gram step
 * (32 × 2048 float ops per pulse) so warm cut-seek sees real cross-core contention.
 */
function startBuoyContentionWorker(): Worker {
  const source = `
    const { parentPort } = require('node:worker_threads');
    const N = 32, BINS = 2048;
    const bufs = Array.from({ length: N }, () => new Float64Array(BINS));
    let on = true;
    parentPort.on('message', (m) => { if (m === 'stop') on = false; });
    const pulse = () => {
      if (!on) return;
      for (let s = 0; s < N; s++) {
        const b = bufs[s];
        for (let i = 0; i < BINS; i++) b[i] = Math.sin(i * 0.001 + s) * (i & 1 ? 1.01 : 0.99);
      }
      setImmediate(pulse);
    };
    pulse();
  `
  return new Worker(source, { eval: true })
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
    console.log(JSON.stringify({ hostWarmSeekMedianMs: warmTimes[2], hostWarmSeekTimesMs: warmTimes }))
    expect(warmTimes[2]!).toBeLessThan(150)
    if (done?.type === 'cutSeeked') {
      expect(done.rowCount).toBeGreaterThan(400)
      expect(done.rowCount).toBeLessThanOrEqual(CUT_SEEK_FULL_ROWS)
      expect(done.gen).toBe(first && first.type === 'cutSeeked' ? first.gen : done.gen)
    }
  }, 60_000)

  it('warm first-paint stays under 150 ms with 32 live buoys contending', () => {
    const field = liveField32()
    const stress = startBuoyContentionWorker()
    try {
      const { host, msgs, cut } = runHost(true)
      const target = Math.floor(cut.durationS * 0.7)
      // Cold construct excluded; field stays at 32 live streams and is stepped between samples.
      host.handle({ type: 'seekCut', simT: target })
      const warmTimes: number[] = []
      for (let i = 0; i < 5; i++) {
        field.step(1) // real 32-wide gram step on the live field host
        msgs.length = 0
        host.handle({ type: 'seekCut', simT: target })
        const f = msgs.find((m) => m.type === 'cutSeeked' && m.phase === 'first')
        if (f && f.type === 'cutSeeked') warmTimes.push(f.elapsedMs)
      }
      warmTimes.sort((a, b) => a - b)
      console.log(JSON.stringify({
        hostWarmSeek32BuoyMedianMs: warmTimes[2],
        hostWarmSeek32BuoyTimesMs: warmTimes,
        liveBuoyCount: field.liveCount,
      }))
      expect(field.liveCount).toBe(MAX_FIELD_BUOYS)
      expect(warmTimes[2]!).toBeLessThan(150)
    } finally {
      stress.postMessage('stop')
      void stress.terminate()
    }
  }, 90_000)

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
