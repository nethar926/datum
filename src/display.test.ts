import { describe, expect, it } from 'vitest'
import { normalizeDb, phosphorLut } from './gl/colormap'
import { clampView, freqToX, niceTicks, ringRow, xToFreq, zoomView } from './gram/axis'
import { crossFixes } from './tactical/fix'
import { fitView, toScreenX, toScreenY, toWorld } from './tactical/transform'
import { TrackRing } from './engine/client'
import type { TacticalBuoy } from './engine/contract'

describe('colormap', () => {
  it('runs black to bright, monotonic in luminance', () => {
    const l = phosphorLut(256)
    expect(Array.from(l.slice(0, 4))).toEqual([0, 0, 0, 255])
    let prev = -1
    for (let i = 0; i < 256; i++) { const y = 0.2 * l[i * 4] + 0.7 * l[i * 4 + 1] + 0.1 * l[i * 4 + 2]; expect(y).toBeGreaterThanOrEqual(prev - 1e-9); prev = y }
  })
  it('normalizes dB with clamping and keeps NaN', () => {
    expect(normalizeDb(75, 40, 110)).toBeCloseTo(0.5)
    expect(normalizeDb(0, 40, 110)).toBe(0)
    expect(normalizeDb(500, 40, 110)).toBe(1)
    expect(normalizeDb(NaN, 40, 110)).toBeNaN()
    expect(Number.isFinite(normalizeDb(50, 60, 60))).toBe(true)
  })
})

describe('frequency axis', () => {
  it('maps frequency to pixels and back', () => {
    const v = { lo: 100, hi: 300 }
    expect(freqToX(200, v, 800)).toBe(400)
    expect(xToFreq(400, v, 800)).toBe(200)
  })
  it('zooms about the anchor and clamps to the band', () => {
    const z = zoomView({ lo: 0, hi: 1000 }, 200, 2, 1000)
    expect(z.lo).toBeCloseTo(100); expect(z.hi).toBeCloseTo(600)
    const out = zoomView({ lo: 0, hi: 1000 }, 500, 0.1, 1000)
    expect(out).toEqual({ lo: 0, hi: 1000 })
    expect(clampView({ lo: 990, hi: 991 }, 1000)).toEqual({ lo: 990, hi: 1000 })
    expect(clampView({ lo: NaN, hi: NaN }, 1000).hi).toBeLessThanOrEqual(1000)
  })
  it('produces nice ticks', () => {
    expect(niceTicks(0, 1000, 5)).toEqual([0, 200, 400, 600, 800, 1000])
    expect(niceTicks(10, 10)).toEqual([])
  })
  it('wraps ring rows', () => {
    expect(ringRow(5, 0, 600)).toBe(5)
    expect(ringRow(5, 6, 600)).toBe(599)
    expect(ringRow(0, 600, 600)).toBe(0)
  })
})

describe('tactical', () => {
  it('round-trips world and screen coordinates, north up', () => {
    const v = fitView(800, 600, 12000)
    expect(toScreenX(v, 0)).toBe(400); expect(toScreenY(v, 0)).toBe(300)
    expect(toScreenY(v, 1000)).toBeLessThan(300)
    const w = toWorld(v, toScreenX(v, 1234), toScreenY(v, -567))
    expect(w.x).toBeCloseTo(1234); expect(w.y).toBeCloseTo(-567)
  })
  const buoy = (id: number, x: number, y: number, state: TacticalBuoy['state'] = 'live'): TacticalBuoy =>
    ({ id, channel: id, kind: 'difar', x, y, hydrophoneDepthM: 60, batteryFrac: 1, lifeRemainingS: 100, state })
  const brg = (fx: number, fy: number, b: TacticalBuoy) => ((Math.atan2(fx - b.x, fy - b.y) * 180) / Math.PI + 360) % 360
  it('cross-fixes a contact from two or more DIFAR bearings', () => {
    const bs = [buoy(1, -2000, 0), buoy(2, 2000, 0), buoy(3, 0, -3000)]
    const target = { x: 500, y: 2500 }
    const lines = bs.map((b) => ({ buoyId: b.id, freqHz: 144 + b.id * 0.2, brgDeg: brg(target.x, target.y, b), quality: 15 }))
    const fixes = crossFixes(lines, bs)
    expect(fixes).toHaveLength(1)
    expect(fixes[0].x).toBeCloseTo(500, 0); expect(fixes[0].y).toBeCloseTo(2500, 0); expect(fixes[0].buoys).toBe(3)
  })
  it('ignores weak lines, dead buoys, parallel and behind-buoy intersections', () => {
    const a = buoy(1, -2000, 0), b = buoy(2, 2000, 0), dead = buoy(3, 0, -3000, 'dead')
    expect(crossFixes([{ buoyId: 1, freqHz: 50, brgDeg: 0, quality: 20 }, { buoyId: 2, freqHz: 50, brgDeg: 0, quality: 20 }], [a, b])).toHaveLength(0)
    expect(crossFixes([{ buoyId: 1, freqHz: 50, brgDeg: 45, quality: 2 }, { buoyId: 2, freqHz: 50, brgDeg: 315, quality: 2 }], [a, b])).toHaveLength(0)
    expect(crossFixes([{ buoyId: 1, freqHz: 50, brgDeg: 225, quality: 20 }, { buoyId: 2, freqHz: 50, brgDeg: 135, quality: 20 }], [a, b])).toHaveLength(0)
    expect(crossFixes([{ buoyId: 1, freqHz: 50, brgDeg: 45, quality: 20 }, { buoyId: 3, freqHz: 50, brgDeg: 0, quality: 20 }], [a, dead])).toHaveLength(0)
  })
  it('keeps a bounded track ring in order', () => {
    const r = new TrackRing(3), p = { x: 0, y: 0 }
    for (let i = 1; i <= 5; i++) r.push(i, -i)
    expect(r.count).toBe(3)
    r.at(0, p); expect(p).toEqual({ x: 3, y: -3 })
    r.at(2, p); expect(p).toEqual({ x: 5, y: -5 })
  })
})

import { AutoLevel } from './gram/autoLevel'
describe('auto level', () => {
  it('tracks a low percentile of rows, ignores NaN, starts unset', () => {
    const a = new AutoLevel(2)
    expect(a.get(0)).toBeNaN()
    const row = new Float32Array(2048).fill(60); for (let i = 0; i < 2048; i += 97) row[i] = 120
    a.update(0, row, 0, 2048)
    expect(a.get(0)).toBeCloseTo(60)
    const dead = new Float32Array(2048).fill(NaN)
    a.update(1, dead, 0, 2048)
    expect(a.get(1)).toBeNaN()
  })
})

import { SplitWindowNormalizer } from './gram/whiten'
import { selectBearings } from './tactical/TacticalPlot'
describe('split-window normalization', () => {
  it('flattens a sloped background, keeps tonals, keeps NaN', () => {
    const n = 512, src = new Float32Array(n), dst = new Float32Array(n)
    for (let i = 0; i < n; i++) src[i] = 100 - i * 0.05
    src[200] += 12
    const nz = new SplitWindowNormalizer(n)
    nz.apply(src, 0, dst, 0)
    for (let i = 40; i < n - 40; i++) if (Math.abs(i - 200) > 30) expect(Math.abs(dst[i])).toBeLessThan(0.01)
    expect(dst[200]).toBeCloseTo(12, 1)
    src.fill(NaN); nz.apply(src, 0, dst, 0)
    expect(dst.every((v) => Number.isNaN(v))).toBe(true)
  })
})
describe('bearing selection', () => {
  const buoys = [1, 2].map((id) => ({ id, channel: 10 + id, kind: 'difar' as const, x: 0, y: 0, hydrophoneDepthM: 60, batteryFrac: 1, lifeRemainingS: 1, state: 'live' as const }))
  const br = [
    { buoyId: 1, freqHz: 72, brgDeg: 10, quality: 20 }, { buoyId: 1, freqHz: 144, brgDeg: 50, quality: 12 },
    { buoyId: 2, freqHz: 72.5, brgDeg: 300, quality: 15 }, { buoyId: 2, freqHz: 300, brgDeg: 90, quality: 4 },
  ]
  it('defaults to the strongest line on the selected buoy', () => {
    expect(selectBearings(br, buoys, 11, null, false).map((b) => b.freqHz)).toEqual([72, 72.5])
  })
  it('follows a picked frequency, and shows all confident lines as a toggle', () => {
    expect(selectBearings(br, buoys, 11, 144.4, false)).toHaveLength(1)
    expect(selectBearings(br, buoys, 11, null, true)).toHaveLength(3)
  })
})

import { PALETTE_IDS, isPaletteId, paletteLut } from './gl/colormap'
describe('palettes', () => {
  it('every palette is 256 opaque entries, dark at the floor and bright at the top', () => {
    const lum = (l: Uint8Array, i: number) => 0.2126 * l[i * 4] + 0.7152 * l[i * 4 + 1] + 0.0722 * l[i * 4 + 2]
    for (const id of PALETTE_IDS) {
      const l = paletteLut(id)
      expect(l.length).toBe(1024)
      for (let i = 0; i < 256; i++) expect(l[i * 4 + 3]).toBe(255)
      expect(lum(l, 255) - lum(l, 0)).toBeGreaterThan(150)
      // Luminance never steps down by more than a rounding error: weak lines never read brighter than strong ones.
      for (let i = 1; i < 256; i++) expect(lum(l, i)).toBeGreaterThanOrEqual(lum(l, i - 1) - 0.5)
    }
  })
  it('validates ids and falls back to green', () => {
    expect(isPaletteId('amber')).toBe(true); expect(isPaletteId('neon')).toBe(false); expect(isPaletteId(null)).toBe(false)
    expect(Array.from(paletteLut('neon' as never).slice(1020))).toEqual(Array.from(paletteLut('green').slice(1020)))
  })
})

import { bearingTo, distToRay, fixInputs, MANUAL_QUALITY } from './tactical/manual'
import { OperatorLog } from './log/operatorLog'
describe('manual bearings', () => {
  const B = (id: number, x: number, y: number, kind: 'difar' | 'omni' = 'difar', state: 'live' | 'dead' = 'live') =>
    ({ id, channel: 10 + id, kind, x, y, hydrophoneDepthM: 60, batteryFrac: 1, lifeRemainingS: 1, state })
  it('computes true bearings and ray distances', () => {
    expect(bearingTo({ x: 0, y: 0 }, 0, 100)).toBeCloseTo(0)
    expect(bearingTo({ x: 0, y: 0 }, 100, 0)).toBeCloseTo(90)
    expect(bearingTo({ x: 0, y: 0 }, -100, 0)).toBeCloseTo(270)
    expect(bearingTo({ x: 5, y: 5 }, 5, 5)).toBeNull()
    expect(distToRay({ x: 0, y: 0 }, 90, 1000, 500, 30)).toBeCloseTo(30)
    expect(distToRay({ x: 0, y: 0 }, 90, 1000, -500, 0)).toBe(Infinity)
    expect(distToRay({ x: 0, y: 0 }, 90, 1000, 1500, 0)).toBe(Infinity)
  })
  it('feeds auto, manual or both into the fix solver', () => {
    const buoys = [B(1, -2000, 0), B(2, 2000, 0), B(3, 0, 0, 'omni'), B(4, 0, -3000, 'difar', 'dead')]
    const auto = [{ buoyId: 1, freqHz: 72, brgDeg: 45, quality: 20 }]
    const man = { 2: 315, 3: 10, 4: 0 }
    expect(fixInputs(auto, man, buoys, 'auto', null)).toEqual(auto)
    expect(fixInputs(auto, man, buoys, 'manual', null)).toEqual([{ buoyId: 2, freqHz: 72, brgDeg: 315, quality: MANUAL_QUALITY }])
    const both = fixInputs(auto, man, buoys, 'both', null)
    expect(both).toHaveLength(2)
    const f = crossFixes(both, buoys, 1.5, 10)
    expect(f).toHaveLength(1); expect(f[0].x).toBeCloseTo(0, 0); expect(f[0].y).toBeCloseTo(2000, 0)
    // No frequency known: manual lines form their own group and still fix.
    const mf = crossFixes(fixInputs([], { 1: 45, 2: 315 }, buoys, 'manual', null), buoys, 1.5, 10)
    expect(mf).toHaveLength(1); expect(mf[0].freqHz).toBe(-1)
  })
  it('logs v1.1 events, bounded, exportable', () => {
    const log = new OperatorLog(3); let n = 0; log.subscribe(() => n++)
    for (let i = 0; i < 5; i++) log.add({ simT: i, kind: 'bearing', buoyId: 1, data: { source: 'manual', brgDeg: i } })
    expect(log.size()).toBe(3); expect(n).toBe(5)
    expect(log.all()[0]).toMatchObject({ v: 1.1, type: 'log', simT: 2, kind: 'bearing' })
    expect(log.toJsonl().split('\n')).toHaveLength(3)
  })
})

describe('harmonic cursor', () => {
  it('lists harmonics up to fMax', async () => {
    const { harmonicSeries } = await import('./gram/harmonics')
    expect(harmonicSeries(2.5, 10)).toEqual([2.5, 5, 7.5, 10])
    expect(harmonicSeries(0, 10)).toEqual([])
    expect(harmonicSeries(1, 1000).length).toBe(24)
  })
  it('reads RPM and blade count, rejects non-harmonic blade lines', async () => {
    const { bladeReadout } = await import('./gram/harmonics')
    const r = bladeReadout(2.4, 16.85)
    expect(r.rpm).toBeCloseTo(144)
    expect(r.blades).toBe(7)
    expect(bladeReadout(2.4, 2.4 * 6.5).blades).toBeNull()
    expect(bladeReadout(2.4, 2.4).blades).toBeNull() // 1 blade is not a propeller reading
    expect(bladeReadout(2.4, null).blades).toBeNull()
  })
})

describe('CPA cursor', () => {
  it('model curve is an S: high before CPA, f0 at CPA, low after', async () => {
    const { cpaModelHz } = await import('./gram/cpa')
    const fit = { f0: 100, speedMps: 5, tCpaS: 600, rCpaM: 1500 }
    expect(cpaModelHz(fit, 600)).toBeCloseTo(100, 6)
    expect(cpaModelHz(fit, 0)).toBeGreaterThan(100.25)
    expect(cpaModelHz(fit, 1200)).toBeLessThan(99.75)
    expect(cpaModelHz(fit, 0) - 100).toBeCloseTo(100 - cpaModelHz(fit, 1200), 2)
  })
  it('keeps marks time-ordered and replaces near-duplicates', async () => {
    const { addSample } = await import('./gram/cpa')
    let l = addSample([], { tS: 10, fHz: 1 })
    l = addSample(l, { tS: 5, fHz: 2 })
    l = addSample(l, { tS: 10.4, fHz: 3 })
    expect(l).toEqual([{ tS: 5, fHz: 2 }, { tS: 10.4, fHz: 3 }])
  })
})

describe("Lloyd's mirror overlay", () => {
  it('K from geometry matches the striation formula and round-trips to zs', async () => {
    const L = await import('./gram/lloyds')
    const R = 2000, zs = 60, zr = 30, c = 1500
    const k = L.kFromGeometry(R, zs, zr)
    expect(k).toBeCloseTo((c * R) / (2 * zs * zr), 6)
    const rd = L.lloydReadout('cpaFit', k, zr, R)
    expect(rd.zsM).toBeCloseTo(zs, 6)
    expect(rd.depthRatio).toBeCloseTo(R / zs, 9)
  })
  it('basis none never reports a depth', async () => {
    const L = await import('./gram/lloyds')
    const rd = L.lloydReadout('none', 800, 30, 2000)
    expect(Number.isNaN(rd.zsM)).toBe(true)
    expect(rd.depthRatio).toBeGreaterThan(0)
  })
  it('drag re-scale puts the picked null through the pointer', async () => {
    const L = await import('./gram/lloyds')
    const s = { k: 100, tCpaS: 500, tauS: 300 }
    const n = L.nearestNull(s, 800, 290)
    expect(n).toBe(2)
    const k = L.kThrough(s, n, 800, 290)
    expect(L.striationHz({ ...s, k }, n, 800)).toBeCloseTo(290, 9)
  })
})

describe('surface traffic', () => {
  it('labels the stops', async () => {
    const { trafficLabel } = await import('./scenarios/acousticsApi')
    expect(trafficLabel(0)).toBe('None'); expect(trafficLabel(0.25)).toBe('Light')
    expect(trafficLabel(0.5)).toBe('Moderate'); expect(trafficLabel(1)).toBe('Heavy')
    expect(trafficLabel(0.35)).toBe('Light~')
  })
  it('host accepts setSurfaceTraffic and rejects NaN', async () => {
    const { SimHost } = await import('./engine/host')
    const msgs: { type: string; message?: string }[] = []
    const h = new SimHost((m) => msgs.push(m as never))
    h.handle({ type: 'init', seed: 1, scenarioId: 'ridgeline-field', band: 'lofar1k', rowRateHz: 2, surfaceTraffic: 0.25 })
    h.handle({ type: 'setSurfaceTraffic', value: 1 })
    expect(msgs.some((m) => m.type === 'error')).toBe(false)
    h.handle({ type: 'setSurfaceTraffic', value: NaN })
    expect(msgs.at(-1)?.type).toBe('error')
  })
})

describe('host DEMON streams (v1.1 engines)', () => {
  it('posts DEMON rows in their own gramRows message and recycles both pools', async () => {
    const { SimHost } = await import('./engine/host')
    type M = { type: string; configs?: { kind: string; bins: number; streamId: number }[]; streamIds?: Int32Array; rowIndex?: Uint32Array; data?: Float32Array; message?: string }
    const msgs: M[] = []
    const h = new SimHost((m) => msgs.push(m as M))
    h.handle({ type: 'init', seed: 3, scenarioId: 'ridgeline-field', band: 'lofar1k', rowRateHz: 2 })
    const cfgs = msgs.find((m) => m.type === 'streams')!.configs!
    const demon = cfgs.filter((c) => c.kind === 'demon')
    if (!demon.length) return // v1 engine: no DEMON, nothing to check
    for (let k = 0; k < 8; k++) {
      msgs.length = 0
      h.handle({ type: 'step' })
      const rows = msgs.filter((m) => m.type === 'gramRows')
      expect(msgs.some((m) => m.type === 'error')).toBe(false)
      for (const r of rows) h.handle({ type: 'release', buffers: [r.streamIds!.buffer, r.rowIndex!.buffer, r.data!.buffer] as ArrayBuffer[] })
      if (k > 2) {
        const d = rows.find((r) => r.data!.length === demon.length * demon[0].bins)
        expect(d, 'demon rows').toBeTruthy()
        expect(Array.from(d!.streamIds!)).toEqual(demon.map((c) => c.streamId))
      }
    }
    expect(msgs.some((m) => m.type === 'error')).toBe(false)
  })
})

describe('host with changing contact count', () => {
  it('survives surface traffic changes across steps', async () => {
    const { SimHost } = await import('./engine/host')
    const msgs: { type: string; message?: string }[] = []
    const h = new SimHost((m) => msgs.push(m as never))
    h.handle({ type: 'init', seed: 5, scenarioId: 'ridgeline-field', band: 'lofar1k', rowRateHz: 2, surfaceTraffic: 1 })
    for (let k = 0; k < 3; k++) h.handle({ type: 'step' })
    h.handle({ type: 'setSurfaceTraffic', value: 0 })
    h.handle({ type: 'step' })
    expect(msgs.filter((m) => m.type === 'error').map((m) => m.message)).toEqual([])
  })
})

describe('Lloyd fit uses spacings and R/zs', () => {
  it('overlay samples are null spacing, not null frequency, and fitLloydsMirror recovers zs', async () => {
    const L = await import('./gram/lloyds')
    const O = await import('./gram/LloydsOverlay')
    const R = 2000, zs = 60, zr = 30, v = 7, tc = 500
    const k = L.kFromGeometry(R, zs, zr), s = { k, tCpaS: tc, tauS: R / v }
    const sm = L.overlaySpacingSamples(s, 200, 800, 12)
    for (const p of sm) {
      expect(p.spacingHz).toBeCloseTo(L.striationHz(s, 1, p.simT), 6)
      expect(p.spacingHz).not.toBeCloseTo(L.striationHz(s, 3, p.simT), 1)
    }
    const st = { basis: 'cpaFit' as const, k, tCpaS: tc, tauS: R / v, manRangeM: R, manSpeedMps: v }
    const f = O.fitOverlay(st, { tCpaS: tc, rCpaM: R, speedMps: v }, zr, { t0: 200, t1: 800 })
    expect(f).not.toBeNull()
    expect(f!.zs).toBeCloseTo(zs, 0)
    expect(f!.depthRatio).toBeCloseTo(R / zs, 1)
    expect(O.lloydText({ ...st, basis: 'none' }, null, zr, { t0: 200, t1: 800 })).toMatch(/R\/zs [\d.]+ \(RELATIVE\)/)
  })
})

describe('scenario list', () => {
  it('m2-lloyds-cpa runs in SimHost on the selected band', async () => {
    const { SimHost } = await import('./engine/host')
    const msgs: { type: string; message?: string; configs?: { bins: number }[] }[] = []
    const h = new SimHost((m) => msgs.push(m as never))
    h.handle({ type: 'init', seed: 3, scenarioId: 'm2-lloyds-cpa', band: 'lofar1k', rowRateHz: 2 })
    for (let k = 0; k < 4; k++) h.handle({ type: 'step' })
    expect(msgs.filter((m) => m.type === 'error').map((m) => m.message)).toEqual([])
    expect(msgs.some((m) => m.type === 'gramRows')).toBe(true)
  })
})

describe('LOFAR cursors', () => {
  it('level history returns the right row and bin, NaN outside', async () => {
    const { LevelHistory } = await import('./gram/levelHistory')
    const h = new LevelHistory(3, 4)
    const row = (v: number) => new Float32Array([v, v + 1, v + 2, v + 3])
    expect(Number.isNaN(h.at(0, 0))).toBe(true)
    h.push(row(10), 0); h.push(row(20), 0); h.push(row(30), 0); h.push(row(40), 0) // wraps, 10 dropped
    expect(h.at(0, 0)).toBe(40); expect(h.at(1, 2)).toBe(32); expect(h.at(2, 3)).toBe(23)
    expect(Number.isNaN(h.at(3, 0))).toBe(true); expect(Number.isNaN(h.at(0, 4))).toBe(true)
    h.clear(); expect(h.size).toBe(0)
  })
  it('harmonic drag: grabbing marker k and moving to hz sets f0 = hz/k', async () => {
    const H = await import('./gram/harmonics')
    expect(H.nearestHarmonic(50, 148)).toBe(3)
    expect(H.nearestHarmonic(50, 10)).toBe(1)
    const k = H.nearestHarmonic(50, 151), f0 = 156 / k
    expect(f0).toBeCloseTo(52, 9)
    expect(H.harmonicSeries(f0, 1000).length).toBe(19)
    expect(H.harmText(f0, k, 1000)).toBe('HARM F0 52.00 HZ  19 MARKERS  H3 156.00 HZ')
    expect(H.harmText(null, null, 1000)).toMatch(/CLICK A LINE/)
  })
})

import { Receiver, DEFAULT_RECEIVER } from './engine/receiver'
describe('receiver front end', () => {
  const B = 256, dt = 0.5
  const row = (weak: number, loud: number) => { const r = new Float32Array(B).fill(60); r[40] = weak; r[200] = loud; return r }
  it('passes the settled scene through unchanged', () => {
    const rx = new Receiver(); const r = row(70, 80); const ref = r.slice()
    rx.process(r, 0, B, dt); expect(Array.from(r)).toEqual(Array.from(ref)); expect(rx.overload).toBe(false)
  })
  it('clips a sudden loud source, then the AGC pulls gain down and the weak line drowns', () => {
    const rx = new Receiver()
    for (let i = 0; i < 20; i++) rx.process(row(70, 60), 0, B, dt)
    const hit = row(70, 150); rx.process(hit, 0, B, dt)
    expect(rx.overload).toBe(true)
    let r = hit
    for (let i = 0; i < 40; i++) { r = row(70, 150); rx.process(r, 0, B, dt) }
    expect(rx.gainDb).toBeLessThan(-30)
    const floor = Math.max(...Array.from(r).filter((_, i) => i !== 40 && i !== 200))
    expect(r[40] - floor).toBeLessThan(1) // weak line is gone into the floor
  })
  it('releases slowly after the loud source stops (pumping)', () => {
    const rx = new Receiver()
    for (let i = 0; i < 20; i++) rx.process(row(70, 60), 0, B, dt)
    for (let i = 0; i < 40; i++) rx.process(row(70, 120), 0, B, dt)
    const g0 = rx.gainDb
    rx.process(row(70, 60), 0, B, dt)
    expect(rx.gainDb).toBeGreaterThan(g0)
    expect(rx.gainDb - g0).toBeLessThan((0 - g0) * (dt / DEFAULT_RECEIVER.releaseS) * 1.5)
  })
})

import { familyFundamentals, familyLabel, snapToFamily, psrCoupled, truthRows, type TruthContactLite } from './gram/truthFamilies'
describe('engine line families (truth)', () => {
  const dd = (running: boolean): TruthContactLite => ({ id: 1, label: 'FX-RQ-09-1', spdMps: 4, crsDeg: 90, depthM: 12, spdKts: 7.8,
    propulsion: { kind: 'dieselDirect', ratio: 1, ratioLabel: '1.00:1', shafts: [{ rpm: 180, hz: 3 }],
      engines: [{ id: 'e1', stroke: 2, cylinders: 6, erpm: running ? 180 : 0, running, csrHz: running ? 3 : 0, cfrHz: running ? 3 : 0, efrHz: running ? 18 : 0 }] },
    lines: [{ lineFamily: 'EDA', fundamentalHz: 7.5 }] })
  it('lists CSR/CFR/EFR from running engines plus EDA from lines', () => {
    expect(familyFundamentals([dd(true)]).map((f) => `${f.family}:${f.hz}`)).toEqual(['CSR:3', 'CFR:3', 'EFR:18', 'EDA:7.5'])
    expect(familyFundamentals([dd(false)]).map((f) => f.family)).toEqual(['EDA'])
    expect(familyFundamentals([{ ...dd(true), active: false }])).toEqual([])
  })
  it('snaps a click near a harmonic to that family fundamental', () => {
    const s = snapToFamily(36.3, familyFundamentals([dd(true)]), 1)
    expect(s?.fund.family).toBe('EFR'); expect(s?.k).toBe(2)
    expect(familyLabel(s!.fund)).toBe('EFR E1 ERPM 180')
    expect(snapToFamily(50, familyFundamentals([dd(true)]), 0.2)).toBeNull()
  })
  it('battery mode: engine families drop, PSR stays; shaft coupled flag wins', () => {
    const c = dd(false); c.mode = 'battery'; c.propulsion!.shafts[0].coupled = false
    c.lines = [{ lineFamily: 'PSR', fundamentalHz: 3 }]
    expect(familyFundamentals([c]).map((f) => f.family)).toEqual(['PSR'])
    expect(psrCoupled(c.propulsion)).toBe(false)
    const rows = truthRows(c).join('\n')
    expect(rows).toMatch(/MODE BATTERY/); expect(rows).toMatch(/PSR 3.00 HZ  180 RPM  DECOUPLED/)
    const on = dd(true); on.propulsion!.shafts[0].coupled = true
    expect(psrCoupled(on.propulsion)).toBe(true)
    expect(snapToFamily(9.1, familyFundamentals([c]), 0.5)?.k).toBe(3)
  })
  it('Diesel Direct PSR = CSR only when the engines are coupled', () => {
    expect(psrCoupled(dd(true).propulsion)).toBe(true)
    expect(psrCoupled(dd(false).propulsion)).toBe(false)
    expect(truthRows(dd(true)).join('\n')).toMatch(/ERPM 180  CSR 3.00  CFR 3.00  EFR 18.00 HZ[\s\S]*PSR = CSR/)
    expect(truthRows(dd(false)).join('\n')).toMatch(/STOPPED[\s\S]*DECOUPLED/)
  })
})

import { ratioText } from './gram/harmonics'
describe('HARM ratio probe', () => {
  it('reads a fractional EDA multiple', () => {
    expect(ratioText(10, 277.5)).toBe('R 277.50 HZ = F0 ×27.75 (H27+75%)')
    expect(ratioText(10, 280.1)).toContain('ON H28')
    expect(ratioText(0, 5)).toBe('')
  })
})

import { truthEdaName } from './gram/truthFamilies'
describe('truth EDA naming', () => {
  const contacts = [{ id: 1, spdMps: 3, crsDeg: 0, lines: [{ lineFamily: 'EDA' as const, hz: 277.5, eda: { name: 'LOP', cfrMultiple: 27.75 } }] }]
  it('names the EDA under the probe only within tolerance', () => {
    expect(truthEdaName(contacts, 277.8, 0.5)).toBe('LOP = CFR ×27.75')
    expect(truthEdaName(contacts, 280, 0.5)).toBeNull()
    expect(truthEdaName(undefined, 277.5, 0.5)).toBeNull()
  })
})

describe('truth speed-gated rows', () => {
  const base = { id: 1, spdMps: 8, crsDeg: 90, propulsion: { kind: 'dieselGR', ratio: 3, ratioLabel: '3:1', engines: [], shafts: [] } }
  it('lists only active swaths/SRCs', () => {
    const r = truthRows({ ...base, speedGated: [{ name: 'A', kind: 'SRC', hz: 512, active: true, gain: 0.5 }, { name: 'B', kind: 'SWATH', loHz: 180, hiHz: 240, active: false }] })
    expect(r.at(-1)).toBe('ACTIVE SRC A 512.0 HZ (FADING)')
    expect(truthRows({ ...base, speedGated: [{ name: 'B', kind: 'SWATH', loHz: 1, hiHz: 2, active: false }] }).at(-1)).toBe('SWATH/SRC NONE AT THIS SPEED')
  })
})

import { truthRowDim } from './gram/truthFamilies'
describe('truth panel propulsion rows (m3-lines)', () => {
  const base = (tpkValid: boolean): TruthContactLite => ({ id: 1, label: 'FX-1', spdMps: 2, crsDeg: 10, spdKts: 3.9,
    propulsion: { kind: 'dieselElectric', ratio: 1, ratioLabel: '1.00:1', shafts: [{ rpm: 60, hz: 1 }], engines: [],
      mode: 'BATT', drivetrainLabel: 'Diesel Electric', tpk: 11.5, tpkValid, tpkMinKts: 4,
      propulsor: { shafts: 1, blades: 7, bladeType: 'cpp', brHz: 7 }, motor: { rpm: 60, slots: 48, msrHz: 48 },
      aip: { kind: 'stirling', active: false } },
    speedGated: [{ name: 'A', kind: 'SRC', hz: 512, active: false, gain: 0 }] })
  it('shows mode, propulsor, TPK, MSR and speed-gated state', () => {
    const r = truthRows(base(true)).join('\n')
    expect(r).toMatch(/MODE BATT/)
    expect(r).toMatch(/PLANT DIESEL ELECTRIC  AIP STIRLING OFF/)
    expect(r).toMatch(/PROP 1 SHAFT  7-BLADE VARIABLE PITCH  BR 7.00 HZ = PSR × 7/)
    expect(r).toMatch(/TPK 11.50 RPM\/KT  SPD = PSRPM ÷ TPK/); expect(truthRowDim(r.split('\n').find((x) => x.startsWith('TPK'))!)).toBe(false)
    expect(r).toMatch(/MSR 48.0 HZ \(48 SLOTS\)/)
    expect(r).toMatch(/SWATH\/SRC NONE AT THIS SPEED/)
  })
  it('flags TPK as not valid inside the pitch-control range and hides it when zero', () => {
    const bad = truthRows(base(false)).find((r) => r.startsWith('TPK'))!
    expect(bad).toBe('TPK 11.50 RPM/KT  VALID ABOVE 4 KT'); expect(truthRowDim(bad)).toBe(true)
    const c = base(true); c.propulsion!.tpk = 0
    expect(truthRows(c).join('\n')).not.toMatch(/TPK/)
  })
})
