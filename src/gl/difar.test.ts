import { describe, expect, it } from 'vitest'
import { difarRgb, difarWheelLut } from './colormap'
import { fillLineBearings, isGramMode } from '../gram/difarBearing'
import { DIFAR_CONIC } from '../gram/DifarLegend'
import { SimHost } from '../engine/host'
import type { GramConfig, TacticalBuoy } from '../engine/contract'

describe('DIFAR bearing colour wheel', () => {
  it('hits the four anchors', () => {
    expect(difarRgb(0)).toEqual([255, 0, 0])       // N red
    expect(difarRgb(90)).toEqual([255, 255, 0])    // E yellow
    expect(difarRgb(180)).toEqual([0, 0, 255])     // S blue
    expect(difarRgb(270)).toEqual([148, 0, 211])   // W violet
  })
  it('blends smoothly: 045 is orange, 315 is between violet and red', () => {
    expect(difarRgb(45)).toEqual([255, 128, 0])
    expect(difarRgb(315)).toEqual([202, 0, 106])
    expect(difarRgb(135)).toEqual([128, 128, 128])
  })
  it('wraps through north and normalises any bearing', () => {
    expect(difarRgb(360)).toEqual(difarRgb(0))
    expect(difarRgb(-90)).toEqual(difarRgb(270))
    expect(difarRgb(725)).toEqual(difarRgb(5))
    const a = difarRgb(359.9), b = difarRgb(0)
    expect(Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])).toBeLessThan(3)
  })
  it('changes by small steps every degree (no hue jumps)', () => {
    for (let d = 0; d < 360; d++) {
      const a = difarRgb(d), b = difarRgb(d + 1)
      expect(Math.max(...a.map((v, i) => Math.abs(v - b[i])))).toBeLessThanOrEqual(3)
    }
  })
  it('wheel LUT and legend use the same anchors', () => {
    const lut = difarWheelLut(360)
    expect([...lut.slice(45 * 4, 45 * 4 + 4)]).toEqual([255, 128, 0, 255])
    expect(DIFAR_CONIC).toContain('rgb(255 255 0) 90deg')
    expect(DIFAR_CONIC).toContain('rgb(148 0 211) 270deg')
    expect(DIFAR_CONIC).toContain('rgb(255 0 0) 360deg')
  })
})

describe('interim per-bin bearings', () => {
  const cfg = { v: 1, type: 'gramConfig', streamId: 1, kind: 'lofar', channel: 7, bins: 100, f0: 0, fBin: 0.5, rowRateHz: 2, dbFloor: 40, dbCeil: 110 } as GramConfig
  const difar = { id: 1, channel: 7, kind: 'difar' } as TacticalBuoy
  it('paints bins around each tracked line with its bearing, NaN elsewhere', () => {
    const out = new Float32Array(100)
    expect(fillLineBearings(out, cfg, difar, [{ buoyId: 7, freqHz: 20, brgDeg: 400, quality: 1 }, { buoyId: 9, freqHz: 30, brgDeg: 10, quality: 1 }])).toBe(true)
    expect(out[40]).toBe(40); expect(out[37]).toBe(40); expect(out[43]).toBe(40)
    expect(Number.isNaN(out[36])).toBe(true); expect(Number.isNaN(out[60])).toBe(true)
  })
  it('gives omni buoys no bearing', () => {
    const out = new Float32Array(100)
    expect(fillLineBearings(out, cfg, { ...difar, kind: 'omni' } as TacticalBuoy, [{ buoyId: 7, freqHz: 20, brgDeg: 5, quality: 1 }])).toBe(false)
    expect(out.every(Number.isNaN)).toBe(true)
  })
  it('validates the stored gram mode', () => {
    expect(isGramMode('difar')).toBe(true); expect(isGramMode('demon')).toBe(false)
  })
})

describe('DEMON off the display', () => {
  it('host skips DEMON streams when init says demon:false', () => {
    const msgs: { type: string; configs?: { kind: string }[] }[] = []
    const h = new SimHost((m) => msgs.push(m as never))
    h.handle({ type: 'init', seed: 3, scenarioId: 'ridgeline-field', band: 'lofar1k', rowRateHz: 2, demon: false })
    const kinds = (msgs.find((m) => m.type === 'streams')?.configs ?? []).map((c) => c.kind)
    expect(kinds.length).toBeGreaterThan(0)
    expect(kinds.every((k) => k === 'lofar')).toBe(true)
  })
})

describe('engine per-bin bearings through the host', () => {
  it('carries bearingDeg with each LOFAR row (NaN on omni) and pools its buffer on release', () => {
    type Rows = { type: string; streamIds: Int32Array; rowIndex: Uint32Array; data: Float32Array; bearingDeg?: Float32Array }
    const msgs: { type: string }[] = []
    const h = new SimHost((m) => msgs.push(m as never))
    h.handle({ type: 'init', seed: 3, scenarioId: 'ridgeline-field', band: 'lofar1k', rowRateHz: 2, demon: false })
    const tac = msgs.find((m) => m.type === 'tactical') as unknown as { buoys: TacticalBuoy[] }
    const bins = 2048
    for (let step = 0; step < 40; step++) {
      h.handle({ type: 'step' })
      const rows = msgs.filter((m) => m.type === 'gramRows').pop() as unknown as Rows
      expect(rows.bearingDeg?.length).toBe(rows.data.length)
      h.handle({ type: 'release', buffers: [rows.streamIds.buffer, rows.rowIndex.buffer, rows.data.buffer, rows.bearingDeg!.buffer] as ArrayBuffer[] })
    }
    const rows = msgs.filter((m) => m.type === 'gramRows').pop() as unknown as Rows
    let difarFinite = 0
    tac.buoys.forEach((b, i) => {
      const seg = rows.bearingDeg!.subarray(i * bins, (i + 1) * bins)
      if (b.kind === 'difar') { for (const v of seg) if (Number.isFinite(v)) { difarFinite++; expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(360.0001) } }
      else expect(seg.every(Number.isNaN)).toBe(true)
    })
    expect(difarFinite).toBeGreaterThan(0)
    expect(msgs.some((m) => m.type === 'error')).toBe(false)
  })
})
