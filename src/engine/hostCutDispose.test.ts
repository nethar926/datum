import { describe, expect, it } from 'vitest'
import { listCutSeeds } from '../cuts/api'
import type { FromWorker, GramRows } from './contract'
import { SimHost } from './host'

function cutHost(syncBackfill = true) {
  const msgs: FromWorker[] = []
  const schedule = syncBackfill
    ? (fn: () => void) => { fn(); return 0 }
    : (fn: () => void, ms?: number) => setTimeout(fn, ms ?? 0)
  const cancel = syncBackfill ? () => {} : (id: number) => clearTimeout(id)
  const host = new SimHost((m) => { msgs.push(m) }, schedule, cancel)
  const cut = listCutSeeds()[0]!
  host.handle({ type: 'init', seed: cut.seed, scenarioId: `cut:${cut.id}`, band: 'lofar1k', rowRateHz: 2, demon: false })
  msgs.length = 0
  return { host, msgs, cut }
}

/** Reach the private cutSession for assertions (test-only). */
function liveSession(host: SimHost) {
  return (host as unknown as { cutSession: { isDisposed: boolean; done: boolean; dispose: () => void; writeLofarRow: (o: Float32Array) => number; cut: { id: string; durationS: number }; lofar: { bins: number }; simT: number } | null }).cutSession
}

function asAb(buf: ArrayBufferLike): ArrayBuffer {
  return buf as ArrayBuffer
}

function releaseRows(host: SimHost, msgs: FromWorker[]): void {
  for (const m of msgs) {
    if (m.type !== 'gramRows') continue
    const r = m as GramRows
    const bufs: ArrayBuffer[] = [asAb(r.streamIds.buffer), asAb(r.rowIndex.buffer), asAb(r.data.buffer)]
    if (r.bearingDeg) bufs.push(asAb(r.bearingDeg.buffer))
    host.handle({ type: 'release', buffers: bufs })
  }
}

describe('SimHost CutSession.dispose', () => {
  it('disposes the live session when the cut finishes', () => {
    const { host, msgs, cut } = cutHost(true)
    // Seek near the end so we only need a few released steps to hit done.
    const target = Math.max(0, cut.durationS - 3)
    host.handle({ type: 'seekCut', simT: target })
    const session = liveSession(host)!
    expect(session.isDisposed).toBe(false)
    let guard = 0
    while (!session.isDisposed && guard++ < 20_000) {
      msgs.length = 0
      host.handle({ type: 'step' })
      releaseRows(host, msgs)
      if (session.done && session.isDisposed) break
      // If writers already ended but dispose hasn't run (no free frame), keep releasing.
      if (session.done && !session.isDisposed) {
        msgs.length = 0
        host.handle({ type: 'step' })
        releaseRows(host, msgs)
      }
    }
    expect(session.isDisposed).toBe(true)
    const row = new Float32Array(session.lofar.bins)
    expect(session.writeLofarRow(row)).toBe(-1)
    host.handle({ type: 'step' }) // no crash after dispose
  }, 30_000)

  it('disposes on abandon (disposeCut) and on leave-CUT init', () => {
    const { host } = cutHost(true)
    const a = liveSession(host)!
    expect(a.isDisposed).toBe(false)
    host.handle({ type: 'disposeCut' })
    expect(a.isDisposed).toBe(true)
    expect(liveSession(host)).toBeNull()

    // Re-open then leave CUT for a live field scenario.
    const cut = listCutSeeds()[0]!
    host.handle({ type: 'init', seed: cut.seed, scenarioId: `cut:${cut.id}`, band: 'lofar1k', rowRateHz: 2, demon: false })
    const b = liveSession(host)!
    host.handle({ type: 'init', seed: 7, scenarioId: 'ridgeline-field', band: 'lofar1k', rowRateHz: 2 })
    expect(b.isDisposed).toBe(true)
    expect(liveSession(host)).toBeNull()
  })

  it('disposes the previous session when seek replaces it', () => {
    const { host, cut } = cutHost(true)
    const before = liveSession(host)!
    const target = Math.floor(cut.durationS * 0.5)
    host.handle({ type: 'seekCut', simT: target })
    expect(before.isDisposed).toBe(true)
    const after = liveSession(host)!
    expect(after).not.toBe(before)
    expect(after.isDisposed).toBe(false)

    // Second seek replaces the first-paint/backfill session too.
    const mid = after
    host.handle({ type: 'seekCut', simT: target + 20 })
    expect(mid.isDisposed).toBe(true)
    expect(liveSession(host)!.isDisposed).toBe(false)
  })

  it('disposes abandoned backfill when a newer scrub cancels it', () => {
    const msgs: FromWorker[] = []
    let queued: Array<() => void> = []
    const schedule = (fn: () => void) => { queued.push(fn); return queued.length }
    const cancel = () => { queued = [] }
    const host = new SimHost((m) => { msgs.push(m) }, schedule, cancel)
    const cut = listCutSeeds()[0]!
    host.handle({ type: 'init', seed: cut.seed, scenarioId: `cut:${cut.id}`, band: 'lofar1k', rowRateHz: 2, demon: false })

    host.handle({ type: 'seekCut', simT: 200 })
    const backfill = (host as unknown as { cutBackfill: { session: { isDisposed: boolean } } | null }).cutBackfill
    expect(backfill).not.toBeNull()
    const orphan = backfill!.session
    expect(orphan.isDisposed).toBe(false)

    host.handle({ type: 'seekCut', simT: 250 })
    expect(orphan.isDisposed).toBe(true)
  })
})
