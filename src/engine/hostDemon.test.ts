import { describe, expect, it } from 'vitest'
import { AcousticEngine } from '@acoustics'
import { SimHost, BANDS } from './host'
import type { FromWorker, GramRows, StreamSet } from './contract'

/** LOFAR vs DEMON gramRows by packed data width. */
const isLofar = (m: GramRows, nLofar: number) => m.data.length === nLofar * BANDS.lofar1k.bins
const isDemon = (m: GramRows, nDemon: number, bins: number) => m.data.length === nDemon * bins

describe('SimHost DEMON skipToLatest (HIG4)', () => {
  it('60 s gap yields at most one DEMON window (no backlog drain) aligned with LOFAR simT', () => {
    const out: FromWorker[] = []
    const heldL: ArrayBuffer[][] = []
    const heldD: ArrayBuffer[][] = []
    const host = new SimHost((m) => {
      if (m.type === 'gramRows') {
        out.push({ ...m, streamIds: m.streamIds.slice(), rowIndex: m.rowIndex.slice(), data: m.data.slice() })
        const bufs = [m.streamIds.buffer, m.rowIndex.buffer, m.data.buffer] as ArrayBuffer[]
        const streams = out.find((x): x is StreamSet => x.type === 'streams')
        const nD = streams?.configs.filter((c) => c.kind === 'demon').length ?? 0
        const dBins = streams?.configs.find((c) => c.kind === 'demon')?.bins ?? 512
        const nL = streams?.configs.filter((c) => c.kind === 'lofar').length ?? 0
        if (isDemon(m, nD, dBins)) heldD.push(bufs)
        else if (isLofar(m, nL)) heldL.push(bufs)
        else heldL.push(bufs)
      } else out.push(m)
    })
    host.handle({ type: 'init', seed: 7, scenarioId: 'ridgeline-field', band: 'lofar1k', rowRateHz: 2 })
    const streams = out.find((m): m is StreamSet => m.type === 'streams')!
    const demon = streams.configs.filter((c) => c.kind === 'demon')
    const lofar = streams.configs.filter((c) => c.kind === 'lofar')
    expect(demon.length).toBe(6)
    expect(demon[0].rowRateHz).toBe(2) // display axis locked to host / LOFAR
    const demonIds = new Set(demon.map((c) => c.streamId))
    const dBins = demon[0].bins

    // Warm-up with both pools recycling.
    for (let i = 0; i < 6; i++) {
      host.handle({ type: 'step' })
      while (heldL.length) host.handle({ type: 'release', buffers: heldL.shift()! })
      while (heldD.length) host.handle({ type: 'release', buffers: heldD.shift()! })
    }

    // 60 s gap: LOFAR keeps flowing; DEMON frames are held so rowsReady accumulates (~4 Hz × 60 s).
    for (let i = 0; i < 120; i++) {
      host.handle({ type: 'step' })
      while (heldL.length) host.handle({ type: 'release', buffers: heldL.shift()! })
    }
    expect(heldD.length).toBeGreaterThan(0)

    let demonWrites = 0
    const orig = AcousticEngine.prototype.writeRow
    AcousticEngine.prototype.writeRow = function (this: AcousticEngine, streamId: number, ...rest: [Float32Array, number?]) {
      if (demonIds.has(streamId)) demonWrites++
      return orig.call(this, streamId, ...rest)
    }
    try {
      host.handle({ type: 'release', buffers: heldD.shift()! })
      const n0 = out.length
      const t0 = performance.now()
      host.handle({ type: 'step' })
      const stepMs = performance.now() - t0
      while (heldL.length) host.handle({ type: 'release', buffers: heldL.shift()! })

      const slice = out.slice(n0)
      const demonRows = slice.filter((m): m is GramRows => m.type === 'gramRows' && isDemon(m, demon.length, dBins))
      const lofarRows = slice.filter((m): m is GramRows => m.type === 'gramRows' && isLofar(m, lofar.length))

      // At most one DEMON window (one row per stream), not a backlog replay.
      expect(demonRows).toHaveLength(1)
      expect(lofarRows).toHaveLength(1)
      expect(demonWrites).toBe(demon.length) // one writeRow per stream via skipToLatest (not ~240×N)
      expect(demonRows[0].simT).toBeCloseTo(lofarRows[0].simT, 6)
      expect(demonRows[0].simT).toBeCloseTo(63.5, 6)
      const idx = Array.from(demonRows[0].rowIndex)
      expect(new Set(idx).size).toBe(1)
      // Engine DEMON is 4 Hz from t=0: newest index after 63.5 s ≈ floor(63.5*4)-ish; all match.
      expect(idx[0]).toBeGreaterThan(200)
      expect(stepMs).toBeLessThan(50)
      expect(out.filter((m) => m.type === 'error')).toHaveLength(0)
    } finally {
      AcousticEngine.prototype.writeRow = orig
    }
  })
})
