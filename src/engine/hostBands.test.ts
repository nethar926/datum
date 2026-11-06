import { describe, expect, it } from 'vitest'
import { AcousticEngine } from '@acoustics'
import { SimHost } from './host'
import type { FromWorker, GramRows, PendingStreamSet, StreamSet, ToWorker } from './contract'

function harness(init: Partial<Extract<ToWorker, { type: 'init' }>> = {}) {
  const out: FromWorker[] = [], queue: ArrayBuffer[][] = []
  const host = new SimHost((m) => {
    if (m.type === 'gramRows') {
      out.push({ ...m, streamIds: m.streamIds.slice(), rowIndex: m.rowIndex.slice(), data: m.data.slice() })
      queue.push([m.streamIds.buffer, m.rowIndex.buffer, m.data.buffer, ...(m.bearingDeg ? [m.bearingDeg.buffer] : [])] as ArrayBuffer[])
    } else out.push(m)
  })
  host.handle({ type: 'init', seed: 7, scenarioId: 'ridgeline-field', band: 'lofar1k', rowRateHz: 2, demon: false, ...init })
  const step = (k = 1) => { for (let i = 0; i < k; i++) { host.handle({ type: 'step' }); while (queue.length) host.handle({ type: 'release', buffers: queue.shift()! }) } }
  return { host, out, step }
}
const lofar = (s: StreamSet) => s.configs.filter((c) => c.kind === 'lofar')
const last = <T extends FromWorker['type']>(out: FromWorker[], t: T) => out.filter((m) => m.type === t).at(-1) as Extract<FromWorker, { type: T }>
const errors = (out: FromWorker[]) => out.filter((m) => m.type === 'error')
const rowsFor = (out: FromWorker[], ids: number[], from = 0) => out.slice(from).filter((m): m is GramRows => m.type === 'gramRows' && Array.from(m.streamIds).some((id) => ids.includes(id)))

describe('SimHost band presets (m3-bands)', () => {
  it('init with bandPreset subscribes one analytic band stream per buoy, stamped with the preset', () => {
    const { host, out, step } = harness({ bandPreset: 'VLF' })
    const c = lofar(last(out, 'streams'))
    expect(c).toHaveLength(6)
    expect(c[0]).toMatchObject({ bandPreset: 'VLF', f0: 0, bins: 2048, rowRateHz: 2 })
    expect(c[0].res).toBeUndefined()
    expect(c[0].f0 + c[0].fBin * (c[0].bins - 1)).toBeCloseTo(200)
    expect(host.lofarStreamIds().mode).toBe('band')
    const n0 = out.length; step(6)
    const rs = rowsFor(out, c.map((x) => x.streamId), n0)
    expect(rs.length).toBe(6) // one row per host step (4 Hz engine rows drained to the newest)
    expect(rs[0].data.length).toBe(6 * 2048)
    expect(Array.from(rs[5].rowIndex).every((i) => i >= 10)).toBe(true) // drained: ~2 engine rows per 0.5 s step
    expect(errors(out)).toHaveLength(0)
  })

  it('band presets go through the handoff: LF → MF → ELF, old streams stop, no leaks', () => {
    const { host, out, step } = harness({ bandPreset: 'LF' })
    const lf = lofar(last(out, 'streams')).map((c) => c.streamId)
    host.handle({ type: 'subscribeGram', gen: 1, bandPreset: 'MF' })
    const p = last(out, 'pendingStreams') as PendingStreamSet
    expect(p.configs[0]).toMatchObject({ bandPreset: 'MF', bins: 2048 }); expect(p.configs[0].fBin * 2047).toBeCloseTo(2000)
    expect(host.liveStreamCount()).toBe(12)
    step(3)
    host.handle({ type: 'promoteGram', gen: 1 })
    expect(host.liveStreamCount()).toBe(6)
    const n0 = out.length; step(4)
    expect(rowsFor(out, lf, n0)).toHaveLength(0)
    host.handle({ type: 'subscribeGram', gen: 2, bandPreset: 'ELF' }); host.handle({ type: 'promoteGram', gen: 2 })
    expect(lofar(last(out, 'streams'))[0].bandPreset).toBe('ELF')
    expect(host.liveStreamCount()).toBe(6)
    expect(errors(out)).toHaveLength(0)
  })

  it('RES ↔ band: frame pools follow the bin count (1024 ↔ 2048) and are trimmed after the swap', () => {
    const { host, out, step } = harness({ gram: { res: 5, filter: 'NB' } })
    expect(host.lofarStreamIds().pools).toEqual([1024])
    host.handle({ type: 'subscribeGram', gen: 1, bandPreset: 'MF' })
    expect(host.lofarStreamIds().pools.sort()).toEqual([1024, 2048])
    step(4) // both sizes in flight and released
    const band = (last(out, 'pendingStreams') as PendingStreamSet).configs.map((c) => c.streamId)
    expect(rowsFor(out, band).every((r) => r.data.length === 6 * 2048)).toBe(true)
    host.handle({ type: 'promoteGram', gen: 1 })
    expect(host.lofarStreamIds()).toMatchObject({ mode: 'band', pools: [2048] })
    step(4)
    host.handle({ type: 'subscribeGram', gen: 2, res: 3, filter: 'BB' })
    step(8)
    host.handle({ type: 'promoteGram', gen: 2 })
    expect(host.lofarStreamIds()).toMatchObject({ mode: 'res', pools: [1024] })
    expect(lofar(last(out, 'streams'))[0]).toMatchObject({ res: 3, filter: 'BB', bins: 1024 })
    expect(host.liveStreamCount()).toBe(6)
    step(8)
    expect(errors(out)).toHaveLength(0)
  })

  it('rapid band changes never hold more than one pending set', () => {
    const { host, out, step } = harness({ bandPreset: 'LF' })
    const ids = ['ELF', 'VLF', 'MF', 'LF'] as const
    for (let i = 0; i < 40; i++) { host.handle({ type: 'subscribeGram', gen: i + 1, bandPreset: ids[i % 4] }); step(1); expect(host.liveStreamCount()).toBe(12) }
    host.handle({ type: 'dropGram', gen: 40 })
    expect(host.liveStreamCount()).toBe(6)
    expect(errors(out)).toHaveLength(0)
  })

  it('late releases of retired RES frames (with bearing buffers) after the swap to a band are dropped cleanly', () => {
    const out: FromWorker[] = [], held: ArrayBuffer[][] = []
    const host = new SimHost((m) => { if (m.type === 'gramRows') held.push([m.streamIds.buffer, m.rowIndex.buffer, m.data.buffer, ...(m.bearingDeg ? [m.bearingDeg.buffer] : [])] as ArrayBuffer[]); else out.push(m) })
    host.handle({ type: 'init', seed: 7, scenarioId: 'ridgeline-field', band: 'lofar1k', rowRateHz: 2, demon: false, gram: { res: 5, filter: 'NB' } })
    for (let i = 0; i < 6; i++) host.handle({ type: 'step' }) // RES (and DEMON) frames held by the "main thread"
    host.handle({ type: 'subscribeGram', gen: 1, bandPreset: 'LF' })
    for (let i = 0; i < 3; i++) host.handle({ type: 'step' })
    host.handle({ type: 'promoteGram', gen: 1 })
    // Everything comes back in one release, old RES frames first, mixed with band and DEMON frames.
    const late = held.splice(0)
    host.handle({ type: 'release', buffers: late.splice(0, 2).flat() }) // a pair (a stale RES frame first)
    for (const f of late) host.handle({ type: 'release', buffers: f }) // and singly
    for (let i = 0; i < 20; i++) { host.handle({ type: 'step' }); host.handle({ type: 'release', buffers: held.splice(0).flat() }) }
    expect(out.filter((m) => m.type === 'error')).toEqual([])
    expect(host.lofarStreamIds()).toMatchObject({ mode: 'band', pools: [2048] })
  })

  it('band backlog of N ready rows yields exactly one newest row per host step (skipToLatest)', () => {
    const out: FromWorker[] = [], held: ArrayBuffer[][] = []
    const host = new SimHost((m) => {
      if (m.type === 'gramRows') {
        out.push({ ...m, streamIds: m.streamIds.slice(), rowIndex: m.rowIndex.slice(), data: m.data.slice(), ...(m.bearingDeg ? { bearingDeg: m.bearingDeg.slice() } : {}) })
        held.push([m.streamIds.buffer, m.rowIndex.buffer, m.data.buffer, ...(m.bearingDeg ? [m.bearingDeg.buffer] : [])] as ArrayBuffer[])
      } else out.push(m)
    })
    host.handle({ type: 'init', seed: 7, scenarioId: 'ridgeline-field', band: 'lofar1k', rowRateHz: 2, demon: false, gram: { res: 5, filter: 'NB' } })
    const releaseResOnly = () => {
      const resBytes = 6 * 1024 * 4
      const keep: ArrayBuffer[][] = []
      for (const f of held.splice(0)) {
        if (f[2].byteLength === resBytes) host.handle({ type: 'release', buffers: f })
        else keep.push(f)
      }
      held.push(...keep)
    }
    for (let i = 0; i < 3; i++) { host.handle({ type: 'step' }); releaseResOnly() }

    host.handle({ type: 'subscribeGram', gen: 1, bandPreset: 'MF' })
    const bandIds = (last(out, 'pendingStreams') as PendingStreamSet).configs.map((c) => c.streamId)
    // Exhaust the pending 2048 pool (POOL_FRAMES=3) while holding band frames, then build a backlog.
    for (let i = 0; i < 3; i++) { host.handle({ type: 'step' }); releaseResOnly() }
    const afterPool = rowsFor(out, bandIds).length
    expect(afterPool).toBe(3)
    const lastIdxBefore = Math.max(...Array.from(rowsFor(out, bandIds).at(-1)!.rowIndex))
    // 4 more host steps (2 s) at 4 Hz → 8 ready rows backlog with no free pending frame.
    for (let i = 0; i < 4; i++) { host.handle({ type: 'step' }); releaseResOnly() }
    expect(rowsFor(out, bandIds).length).toBe(afterPool) // no further band posts while pool empty

    const bandIdSet = new Set(bandIds)
    let bandWrites = 0
    const orig = AcousticEngine.prototype.writeRow
    AcousticEngine.prototype.writeRow = function (this: AcousticEngine, streamId: number, ...rest: [Float32Array, number?]) {
      if (bandIdSet.has(streamId)) bandWrites++
      return orig.call(this, streamId, ...rest)
    }
    try {
      // Return one band frame and step once: skipToLatest should write once per buoy (not N).
      const bandFrame = held.find((f) => f[2].byteLength === 6 * 2048 * 4)!
      held.splice(held.indexOf(bandFrame), 1)
      host.handle({ type: 'release', buffers: bandFrame })
      const n0 = out.length
      host.handle({ type: 'step' }) // +0.5 s → backlog 8 + 2 = 10 ready; skip emits newest
      releaseResOnly()
      const rs = rowsFor(out, bandIds, n0)
      expect(rs).toHaveLength(1)
      expect(bandWrites).toBe(6) // one writeRow per buoy via skipToLatest, not 10×6 drain writes
      const idx = Array.from(rs[0].rowIndex)
      expect(new Set(idx).size).toBe(1) // all buoys share the same newest row index
      expect(idx[0]).toBe(lastIdxBefore + 10) // 8 held + 2 from this step
      expect(errors(out)).toHaveLength(0)
    } finally {
      AcousticEngine.prototype.writeRow = orig
    }
  })
})
