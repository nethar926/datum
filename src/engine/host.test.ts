import { describe, expect, it } from 'vitest'
import { SimHost, POOL_FRAMES, BANDS } from './host'
import type { FromWorker, GramRows, StreamSet, Tactical } from './contract'

function harness() {
  const out: FromWorker[] = []
  const host = new SimHost((m) => out.push(m))
  host.handle({ type: 'init', seed: 7, scenarioId: 'ridgeline-field', band: 'lofar1k', rowRateHz: 2 })
  return { host, out }
}
const rowsOf = (out: FromWorker[]) => out.filter((m): m is GramRows => m.type === 'gramRows')

describe('SimHost', () => {
  it('announces one LOFAR stream per buoy with contract fields', () => {
    const { out } = harness()
    const s = out.find((m): m is StreamSet => m.type === 'streams')!
    expect(s.configs).toHaveLength(6)
    const c = s.configs[0]
    expect(c).toMatchObject({ v: 1, kind: 'lofar', bins: 2048, f0: 0, rowRateHz: 2, dbFloor: 40, dbCeil: 110 })
    expect(c.fBin).toBeCloseTo(1000 / 2047, 6)
  })

  it('emits packed rows and applies backpressure until frames are released', () => {
    const { host, out } = harness()
    for (let i = 0; i < POOL_FRAMES + 2; i++) host.handle({ type: 'step' })
    const rows = rowsOf(out)
    expect(rows).toHaveLength(POOL_FRAMES)
    expect(rows[0].data.length).toBe(6 * 2048)
    expect(Array.from(rows[2].rowIndex)).toEqual([2, 2, 2, 2, 2, 2])
    expect(rows[2].simT).toBeCloseTo(1.5)
    const r = rows[0]
    host.handle({ type: 'release', buffers: [r.streamIds.buffer, r.rowIndex.buffer, r.data.buffer] as ArrayBuffer[] })
    host.handle({ type: 'step' })
    expect(rowsOf(out)).toHaveLength(POOL_FRAMES + 1)
  })

  it('rejects bad input without throwing', () => {
    const out: FromWorker[] = []
    const host = new SimHost((m) => out.push(m))
    host.handle({ type: 'step' })
    host.handle({ type: 'init', seed: 1, scenarioId: 'nope', band: 'lofar1k', rowRateHz: 2 })
    host.handle({ type: 'init', seed: 1, scenarioId: 'ridgeline-field', band: 'lofar1k', rowRateHz: 1000 })
    expect(out.map((m) => m.type)).toEqual(['error', 'error', 'error'])
  })

  it('marks a not-yet-deployed buoy as falling with NaN rows', () => {
    const { host, out } = harness()
    host.handle({ type: 'step' })
    const rows = rowsOf(out)[0]
    const idx = 5 // buoy-22 deploys at t=600 s
    expect(Number.isNaN(rows.data[idx * 2048 + 100])).toBe(true)
    const t = out.filter((m): m is Tactical => m.type === 'tactical').at(-1)!
    expect(t.buoys[idx].state).toBe('falling')
    expect(t.buoys[0].state).toBe('live')
  })

  it('is deterministic for a seed', () => {
    const a = harness(), b = harness()
    a.host.handle({ type: 'step' }); b.host.handle({ type: 'step' })
    expect(rowsOf(a.out)[0].data).toEqual(rowsOf(b.out)[0].data)
  })

  it('seeded tonals stand well above the local noise on the LOFAR', () => {
    const out: FromWorker[] = []
    const host = new SimHost((m) => out.push(m))
    host.handle({ type: 'init', seed: 7, scenarioId: 'ridgeline-field', band: 'lofar1k', rowRateHz: 2 })
    const { bins, fmax } = BANDS.lofar1k
    const fBin = fmax / (bins - 1)
    const acc = new Float64Array(bins)
    const N = 30
    for (let k = 0; k < N; k++) {
      host.handle({ type: 'step' })
      const r = rowsOf(out).at(-1)!
      for (let i = 0; i < bins; i++) acc[i] += r.data[i] / N // buoy-11
      host.handle({ type: 'release', buffers: [r.streamIds.buffer, r.rowIndex.buffer, r.data.buffer] as ArrayBuffer[] })
    }
    // SSK k1 tonal family at 72 Hz multiples (slightly Doppler shifted): buoy-11 sees 144 Hz clearly.
    const peakNear = (f: number) => { const c = Math.round(f / fBin); let m = -Infinity; for (let i = c - 6; i <= c + 6; i++) m = Math.max(m, acc[i]); return m }
    const floorNear = (f: number) => { const c = Math.round(f / fBin); const v: number[] = []; for (let i = c - 60; i <= c + 60; i++) if (Math.abs(i - c) > 10) v.push(acc[i]); v.sort((x, y) => x - y); return v[v.length >> 1] }
    expect(peakNear(144) - floorNear(144)).toBeGreaterThan(8)
  })
})
