import { describe, expect, it } from 'vitest'
import { SimHost } from './host'
import type { FromWorker, GramRows, PendingStreamSet, StreamSet } from './contract'

/** RES-mode host whose posted frames are released straight back (like the client does). */
function harness() {
  const out: FromWorker[] = []
  let host!: SimHost
  host = new SimHost((m) => {
    if (m.type === 'gramRows') {
      out.push({ ...m, streamIds: m.streamIds.slice(), rowIndex: m.rowIndex.slice() })
      queue.push([m.streamIds.buffer, m.rowIndex.buffer, m.data.buffer, ...(m.bearingDeg ? [m.bearingDeg.buffer] : [])] as ArrayBuffer[])
    } else out.push(m)
  })
  const queue: ArrayBuffer[][] = []
  host.handle({ type: 'init', seed: 7, scenarioId: 'ridgeline-field', band: 'lofar1k', rowRateHz: 2, demon: false, gram: { res: 5, filter: 'NB' } })
  const step = (k = 1) => { for (let i = 0; i < k; i++) { host.handle({ type: 'step' }); while (queue.length) host.handle({ type: 'release', buffers: queue.shift()! }) } }
  return { host, out, step }
}
const pending = (out: FromWorker[]) => out.filter((m): m is PendingStreamSet => m.type === 'pendingStreams')
const streams = (out: FromWorker[]) => out.filter((m): m is StreamSet => m.type === 'streams')
const idsWithRows = (out: FromWorker[], from = 0) => { const s = new Set<number>(); for (const m of out.slice(from)) if (m.type === 'gramRows') (m as GramRows).streamIds.forEach((id) => { if (id > 0) s.add(id) }); return s }
const errors = (out: FromWorker[]) => out.filter((m) => m.type === 'error')

describe('SimHost gram handoff (dual subscribe)', () => {
  it('subscribes a pending set alongside the displayed one; both stream rows', () => {
    const { host, out, step } = harness()
    expect(host.liveStreamCount()).toBe(6)
    host.handle({ type: 'subscribeGram', gen: 1, res: 2, filter: 'NB' })
    const p = pending(out).at(-1)!
    expect(p.gen).toBe(1); expect(p.configs).toHaveLength(6)
    expect(p.configs[0]).toMatchObject({ res: 2, bins: 1024, filter: 'NB' }); expect(p.configs[0].rowRateHz).toBeCloseTo(0.25)
    const pids = p.configs.map((c) => c.streamId)
    expect(pids.some((id) => id <= 6)).toBe(false)
    expect(host.liveStreamCount()).toBe(12)
    const n0 = out.length
    step(24) // 12 s sim: RES 5 rows every 2 s, RES 2 every 4 s
    const seen = idsWithRows(out, n0)
    for (let id = 1; id <= 6; id++) expect(seen.has(id)).toBe(true)
    for (const id of pids) expect(seen.has(id)).toBe(true)
    expect(errors(out)).toHaveLength(0)
  })

  it('promote swaps the sets and really stops the old streams', () => {
    const { host, out, step } = harness()
    host.handle({ type: 'subscribeGram', gen: 1, res: 3, filter: 'BB', vernierHz: 120 })
    const pids = pending(out).at(-1)!.configs.map((c) => c.streamId)
    step(8)
    host.handle({ type: 'promoteGram', gen: 1 })
    expect(host.liveStreamCount()).toBe(6)
    expect(host.lofarStreamIds()).toMatchObject({ active: pids, pending: [], pendingGen: 0, mode: 'res', pools: [1024] })
    const s = streams(out).at(-1)!
    expect(s.configs.filter((c) => c.kind === 'lofar').map((c) => c.streamId)).toEqual(pids)
    expect(s.configs[0]).toMatchObject({ res: 3, filter: 'BB' }); expect(s.configs[0].fcHz).toBeCloseTo(120)
    const n0 = out.length
    step(24)
    const seen = idsWithRows(out, n0)
    for (let id = 1; id <= 6; id++) expect(seen.has(id)).toBe(false)
    for (const id of pids) expect(seen.has(id)).toBe(true)
    expect(errors(out)).toHaveLength(0)
  })

  it('a newer subscribe drops the older pending set; stale promote and drop are ignored', () => {
    const { host, out, step } = harness()
    host.handle({ type: 'subscribeGram', gen: 1, res: 2, filter: 'NB' })
    const a = pending(out).at(-1)!.configs.map((c) => c.streamId)
    host.handle({ type: 'subscribeGram', gen: 2, res: 1, filter: 'NB' })
    const b = pending(out).at(-1)!.configs.map((c) => c.streamId)
    expect(host.liveStreamCount()).toBe(12)
    expect(host.lofarStreamIds().pending).toEqual(b)
    host.handle({ type: 'promoteGram', gen: 1 }) // stale
    host.handle({ type: 'dropGram', gen: 1 })    // stale
    expect(host.lofarStreamIds().active).toEqual([1, 2, 3, 4, 5, 6])
    const n0 = out.length; step(40)
    const seen = idsWithRows(out, n0)
    for (const id of a) expect(seen.has(id)).toBe(false)
    host.handle({ type: 'dropGram', gen: 2 })
    expect(host.liveStreamCount()).toBe(6)
    expect(errors(out)).toHaveLength(0)
  })

  it('does not leak engine streams over a long session of rapid changes', () => {
    const { host, out, step } = harness()
    let gen = 0
    for (let i = 0; i < 60; i++) {
      host.handle({ type: 'subscribeGram', gen: ++gen, res: 1 + (i % 9), filter: i % 2 ? 'BB' : 'NB' })
      step(1 + (i % 3))
      if (i % 4 === 3) host.handle({ type: 'promoteGram', gen })
      else if (i % 4 === 1) host.handle({ type: 'dropGram', gen })
      expect(host.liveStreamCount()).toBeLessThanOrEqual(12)
    }
    if (host.lofarStreamIds().pendingGen) host.handle({ type: 'dropGram', gen })
    expect(host.liveStreamCount()).toBe(6)
    expect(errors(out)).toHaveLength(0)
  })

  it('legacy setGram mid-handoff drops the pending set', () => {
    const { host, out } = harness()
    host.handle({ type: 'subscribeGram', gen: 1, res: 2, filter: 'NB' })
    host.handle({ type: 'setGram', res: 4 })
    expect(host.liveStreamCount()).toBe(6)
    expect(errors(out)).toHaveLength(0)
  })
})
