import { describe, expect, it } from 'vitest'
import { bandLimitHz, clampRes, fmtHz, fullView, geometryKey, minSpanOf, resReadout, vernierLabel } from './res'
import { clampView } from './axis'
import type { GramConfig } from '../engine/contract'

const cfg = (p: Partial<GramConfig>): GramConfig => ({ v: 1, type: 'gramConfig', streamId: 1, kind: 'lofar', channel: 11, bins: 1024, f0: 0, fBin: 0.5, rowRateHz: 0.5, dbFloor: 0, dbCeil: 30, res: 5, filter: 'NB', bandHz: 512, bandLimited: false, liveBins: 1024, ...p })

describe('RES readout helpers', () => {
  it('formats the ladder the way the header mock reads', () => {
    expect([0.03125, 0.0625, 0.125, 0.25, 0.5, 1, 2, 4, 8].map(fmtHz)).toEqual(['0.031', '0.063', '0.13', '0.25', '0.5', '1', '2', '4', '8'])
    expect(resReadout(cfg({}))).toBe('RES 5 · 0.5 Hz · 512 Hz band')
    expect(resReadout(cfg({ res: 1, fBin: 0.03125, bandHz: 32 }))).toBe('RES 1 · 0.031 Hz · 32 Hz band')
    expect(resReadout(cfg({}), true)).toBe('RES 5 · 0.5 Hz')
    expect(resReadout(undefined)).toBe('RES —')
  })
  it('labels the vernier only when the engine reports a centre', () => {
    expect(vernierLabel(cfg({}))).toBeNull()
    expect(vernierLabel(cfg({ fcHz: 50 }))).toBe('VERNIER 50.00 Hz')
    expect(vernierLabel(cfg({ fcHz: 50, fBin: 0.0625 }))).toBe('VERNIER 50.000 Hz')
  })
  it('finds the BAND LIMIT edge from liveBins', () => {
    expect(bandLimitHz(cfg({}))).toBeNull()
    expect(bandLimitHz(cfg({ res: 7, fBin: 2, bandLimited: true, liveBins: 501 }))).toBe(1002)
  })
  it('clamps views inside a vernier band and keeps a sub-Hz minimum span at fine RES', () => {
    const c = cfg({ res: 2, fBin: 0.0625, f0: 18, fcHz: 50 })
    const full = fullView(c)
    expect(full.lo).toBe(18); expect(full.hi).toBeCloseTo(18 + 1023 * 0.0625)
    const v = clampView({ lo: 0, hi: 1 }, full.hi, minSpanOf(c), c.f0)
    expect(v.lo).toBe(18); expect(v.hi - v.lo).toBeCloseTo(2)
    expect(minSpanOf(undefined)).toBe(10)
  })
  it('changes the geometry key on RES, filter or vernier changes, not on unrelated fields', () => {
    const a = geometryKey([cfg({})])
    expect(geometryKey([cfg({ dbCeil: 30 })])).toBe(a)
    expect(geometryKey([cfg({ filter: 'BB' })])).not.toBe(a)
    expect(geometryKey([cfg({ f0: 10 })])).not.toBe(a)
    expect(clampRes(0)).toBe(1); expect(clampRes(12)).toBe(9); expect(clampRes(4.6)).toBe(5)
  })
})
