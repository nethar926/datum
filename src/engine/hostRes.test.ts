import { describe, expect, it } from 'vitest'
import { SimHost } from './host'
import type { FromWorker, GramRows, StreamSet } from './contract'

function harness(filter: 'NB' | 'BB' = 'NB', res = 5) {
  const out: FromWorker[] = []
  const host = new SimHost((m) => out.push(m))
  host.handle({ type: 'init', seed: 7, scenarioId: 'ridgeline-field', band: 'lofar1k', rowRateHz: 2, demon: false, gram: { res, filter } })
  const release = (r: GramRows) => host.handle({ type: 'release', buffers: [r.streamIds.buffer, r.rowIndex.buffer, r.data.buffer, r.bearingDeg!.buffer] as ArrayBuffer[] })
  return { host, out, release }
}
const streams = (out: FromWorker[]) => out.filter((m): m is StreamSet => m.type === 'streams')
const rows = (out: FromWorker[]) => out.filter((m): m is GramRows => m.type === 'gramRows')
const errors = (out: FromWorker[]) => out.filter((m) => m.type === 'error')

describe('SimHost RES mode', () => {
  it('announces 1024-bin RES 5 NB streams with the engine numbers', () => {
    const { out } = harness()
    const c = streams(out)[0].configs.filter((c) => c.kind === 'lofar')
    expect(c).toHaveLength(6)
    expect(c[0]).toMatchObject({ bins: 1024, res: 5, filter: 'NB', f0: 0, fBin: 0.5, bandHz: 512, dbFloor: 0, dbCeil: 30, rowRateHz: 0.5, bandLimited: false })
    expect(c[0].liveBins).toBe(1024)
    expect(c[0]).not.toHaveProperty('simT')
    expect(errors(out)).toHaveLength(0)
  })

  it('posts rows only every P seconds while the host steps at 0.5 s', () => {
    const { host, out, release } = harness()
    for (let i = 0; i < 16; i++) { host.handle({ type: 'step' }); const r = rows(out).at(-1); if (r && !(r as { _r?: 1 })._r) { (r as { _r?: 1 })._r = 1; release(r) } }
    const rs = rows(out)
    expect(rs.map((r) => r.simT)).toEqual([2, 4, 6, 8]) // 8 s of sim at P = 2 s
    expect(Array.from(rs[3].rowIndex)).toEqual([3, 3, 3, 3, 3, 3])
    expect(rs[0].data.length).toBe(6 * 1024)
    expect(out.filter((m) => m.type === 'tactical').length).toBeGreaterThanOrEqual(16) // tactical still every step
  })

  it('flags BAND LIMIT when the RES band passes the simulated top (1 kHz band, RES 7 = 2048 Hz)', () => {
    const { out } = harness('NB', 7)
    const c = streams(out)[0].configs[0]
    expect(c).toMatchObject({ res: 7, fBin: 2, bandLimited: true })
    expect(c.liveBins).toBe(Math.floor(1000 / 2) + 1)
  })

  it('switches filter and RES with setGram, keeping stream ids and frame size', () => {
    const { host, out } = harness()
    host.handle({ type: 'setGram', filter: 'BB' })
    let c = streams(out).at(-1)!.configs[0]
    expect(c).toMatchObject({ streamId: 1, filter: 'BB', dbFloor: 40, dbCeil: 110, res: 5, bins: 1024 })
    host.handle({ type: 'setGram', res: 2, vernierHz: 50 })
    c = streams(out).at(-1)!.configs[0]
    expect(c.res).toBe(2); expect(c.fBin).toBeCloseTo(0.0625); expect(c.fcHz).toBeCloseTo(50); expect(c.f0).toBeCloseTo(50 - 512 * 0.0625)
    expect(c.rowRateHz).toBeCloseTo(1 / 4)
    host.handle({ type: 'setGram', vernierHz: null })
    c = streams(out).at(-1)!.configs[0]
    expect(c.fcHz).toBeUndefined(); expect(c.f0).toBe(0)
    expect(errors(out)).toHaveLength(0)
  })

  it('rejects setGram on a legacy init without throwing', () => {
    const out: FromWorker[] = []
    const host = new SimHost((m) => out.push(m))
    host.handle({ type: 'init', seed: 7, scenarioId: 'ridgeline-field', band: 'lofar1k', rowRateHz: 2 })
    host.handle({ type: 'setGram', res: 3 })
    expect(errors(out)).toHaveLength(1)
  })
})
