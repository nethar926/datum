import { describe, expect, it } from 'vitest'
import { SimHost, MAX_FIELD_BUOYS } from './host'
import type { BuoysDropped, FromWorker, GramRows, PendingStreamSet, StreamSet, Tactical, ToWorker } from './contract'

/** Host whose posted frames can be released straight back (like the client) or held to test in-flight buffers. */
function harness(init: Partial<Extract<ToWorker, { type: 'init' }>> = {}) {
  const out: FromWorker[] = [], queue: ArrayBuffer[][] = []
  const host = new SimHost((m) => {
    if (m.type === 'gramRows') {
      out.push({ ...m, streamIds: m.streamIds.slice(), rowIndex: m.rowIndex.slice(), data: m.data.slice() })
      queue.push([m.streamIds.buffer, m.rowIndex.buffer, m.data.buffer, ...(m.bearingDeg ? [m.bearingDeg.buffer] : [])] as ArrayBuffer[])
    } else out.push(m)
  })
  host.handle({ type: 'init', seed: 7, scenarioId: 'ridgeline-field', band: 'lofar1k', rowRateHz: 2, demon: false, ...init })
  const release = () => { while (queue.length) host.handle({ type: 'release', buffers: queue.shift()! }) }
  const step = (k = 1) => { for (let i = 0; i < k; i++) { host.handle({ type: 'step' }); release() } }
  return { host, out, step, queue, release }
}
const last = <T extends FromWorker['type']>(out: FromWorker[], t: T) => out.filter((m) => m.type === t).at(-1) as Extract<FromWorker, { type: T }>
const lofar = (s: StreamSet) => s.configs.filter((c) => c.kind === 'lofar')
const errors = (out: FromWorker[]) => out.filter((m) => m.type === 'error')
const drop = (seq: number, buoys: Extract<ToWorker, { type: 'dropBuoys' }>['buoys'], source: 'manual' | 'auto' = 'manual'): ToWorker => ({ type: 'dropBuoys', seq, source, buoys })

/** Runs the shared drop scenario on a fresh host and returns what it saw. */
function harnessDrop(init: Partial<Extract<ToWorker, { type: 'init' }>>) {
  const { host, out, step } = harness(init)
  step(4)
  const n0 = lofar(last(out, 'streams')).length
  const mark = out.length
  host.handle(drop(1, [{ kind: 'difar', x: 1000, y: 1000, channel: 11 }, { kind: 'omni', x: -1000, y: 500, channel: 300 }, { kind: 'difar', x: 0, y: -3000 }]))
  const after = out.slice(mark)
  return { host, out, step, n0, after }
}

describe('SimHost dropBuoys', () => {
  for (const [name, init] of [['RES', { gram: { res: 5, filter: 'NB' as const } }], ['band', { bandPreset: 'LF' as const }], ['legacy', {}]] as const) {
    it(`${name}: new buoys appear on the plot, get matching LOFAR streams, and stay empty until liveTime`, () => {
      const { out, step, n0, after } = harnessDrop(init)
      expect(after.map((m) => m.type)).toEqual(['streams', 'tactical', 'dropped'])
      const d = after[2] as BuoysDropped
      expect(d).toMatchObject({ seq: 1, source: 'manual' }); expect(d.error).toBeUndefined()
      expect(d.channels).toHaveLength(3)
      expect(d.channels[0]).not.toBe(11) // field buoy 11 owns that channel: bumped
      expect(d.channels[1]).toBe(300)
      const s = lofar(after[0] as StreamSet)
      expect(s).toHaveLength(n0 + 3)
      const fresh = s.slice(n0)
      expect(fresh.map((c) => c.channel)).toEqual(d.channels)
      // Same family/geometry as the displayed set.
      for (const c of fresh) expect({ bins: c.bins, res: c.res, filter: c.filter, bandPreset: c.bandPreset, f0: c.f0 }).toEqual({ bins: s[0].bins, res: s[0].res, filter: s[0].filter, bandPreset: s[0].bandPreset, f0: s[0].f0 })
      const t = after[1] as Tactical
      expect(t.buoys).toHaveLength(n0 + 3)
      expect(t.buoys.slice(n0).map((b) => [b.kind, b.x, b.y, b.state, b.hydrophoneDepthM])).toEqual([
        ['difar', 1000, 1000, 'live', 60], ['omni', -1000, 500, 'live', 150], ['difar', 0, -3000, 'live', 60]])
      // dropBuoy always walks the sequence: deployed (1 s) → descending (50.8 s) → integrating.
      // AcousticEngine.consumePreLiveRows (same as Swift SimEngine) skips rows until
      // firstEmitTime = max(liveTime, splash+P), so the first real gram row waits for the
      // full post-splash integration window. Until then writeRow / skipToLatest return -1
      // and the host reports streamId -1 (no new row). Legacy pull streams still occupy
      // a slot every step and are filled with NaN while the buoy is not feeding.
      expect(t.buoys.slice(n0).every((b) => b.status?.phase === 'deployed')).toBe(true)
      const mark = out.length
      step(12) // 6 s: still descending, well before liveTime (~58 s)
      const rows = out.slice(mark).filter((m): m is GramRows => m.type === 'gramRows')
      expect(rows.length).toBeGreaterThan(0)
      const width = n0 + 3
      for (const r of rows) expect(r.streamIds.length).toBe(width)
      const ids = new Set(fresh.map((c) => c.streamId))
      for (const r of rows) {
        const bins = r.data.length / width
        r.streamIds.forEach((id, k) => { if (ids.has(id)) { const row = r.data.subarray(k * bins, (k + 1) * bins); expect(row.some(Number.isFinite)).toBe(false) } })
      }
      expect(errors(out)).toHaveLength(0)
    })
  }

  it('in-flight frames from before the drop are released without breaking the pools', () => {
    const { host, out, queue, release, step } = harness({ gram: { res: 5, filter: 'NB' } })
    host.handle({ type: 'step' }); host.handle({ type: 'step' }); host.handle({ type: 'step' }); host.handle({ type: 'step' }) // hold frames
    expect(queue.length).toBeGreaterThan(0)
    host.handle(drop(2, [{ kind: 'difar', x: 0, y: 0 }]))
    release() // old-width frames (with bearing buffers) are dropped, not mis-paired
    expect(errors(out)).toHaveLength(0)
    const mark = out.length
    step(20)
    expect(out.slice(mark).filter((m) => m.type === 'gramRows').length).toBeGreaterThan(3)
    expect(errors(out)).toHaveLength(0)
  })

  it('during a gram handoff the pending set gets the new buoy too and re-announces (same gen); promote keeps it', () => {
    const { host, out, step } = harness({ gram: { res: 5, filter: 'NB' } })
    host.handle({ type: 'subscribeGram', gen: 3, res: 2, filter: 'NB' })
    const mark = out.length
    host.handle(drop(4, [{ kind: 'omni', x: 2500, y: 2500 }]))
    const p = out.slice(mark).find((m): m is PendingStreamSet => m.type === 'pendingStreams')!
    expect(p.gen).toBe(3); expect(p.configs).toHaveLength(7); expect(p.configs[6]).toMatchObject({ res: 2, filter: 'NB' })
    step(16)
    host.handle({ type: 'promoteGram', gen: 3 })
    const s = lofar(last(out, 'streams'))
    expect(s).toHaveLength(7); expect(s.every((c) => c.res === 2)).toBe(true)
    expect(host.liveStreamCount()).toBe(7)
    step(8)
    expect(errors(out)).toHaveLength(0)
  })

  it('RES/vernier changes after a drop apply to the dropped streams as well', () => {
    const { host, out, step } = harness({ gram: { res: 5, filter: 'NB' } })
    host.handle(drop(5, [{ kind: 'difar', x: 0, y: 0 }]))
    host.handle({ type: 'setGram', filter: 'BB' })
    host.handle(drop(6, [{ kind: 'difar', x: 500, y: 0 }]))
    const s = lofar(last(out, 'streams'))
    expect(s).toHaveLength(8); expect(s.every((c) => c.filter === 'BB')).toBe(true)
    step(4); expect(errors(out)).toHaveLength(0)
  })

  it('caps the field and reports (without stopping the sim) instead of throwing', () => {
    const { host, out } = harness({ gram: { res: 5, filter: 'NB' } })
    const many = Array.from({ length: MAX_FIELD_BUOYS }, (_, i) => ({ kind: 'omni' as const, x: i * 100, y: 0 }))
    host.handle(drop(7, many, 'auto'))
    const d = last(out, 'dropped')
    expect(d.channels).toHaveLength(MAX_FIELD_BUOYS - 6); expect(d.error).toMatch(/Field full/); expect(d.source).toBe('auto')
    host.handle(drop(8, [{ kind: 'difar', x: NaN, y: 0 }]))
    expect(last(out, 'dropped').channels).toHaveLength(0)
    expect(errors(out)).toHaveLength(0)
  })
})
