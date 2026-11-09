import { describe, expect, it } from 'vitest'
import {
  DEMON_CARRIER_BAND, DEMON_DISPLAY_DB, DEMON_NORM, normalizeDemonRow, SplitWindowNormalizer,
} from '@acoustics'
import { DEMON_CASES, DEMON_BINS, type DisplayFn } from '../../acoustics/bench/demonContrast'
import { MAX_FIELD_BUOYS, SimHost } from '../engine/host'
import type { FromWorker, GramConfig, StreamSet, TacticalBuoy } from '../engine/contract'
import { fillLineBearings, isGramMode, GRAM_MODES } from './difarBearing'
import {
  DEMON_DISPLAY, DEMON_GRAM, DEMON_HISTORY_ROWS, DEMON_STREAM, isDemonView,
  LIVE_DEMON_HINT, liveDemonHint,
} from './demonConfig'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** FE shared pipeline: clamp → NORM whiten → clip to DEMON_DISPLAY_DB. */
function sharedDisplay(): DisplayFn {
  const nz = new SplitWindowNormalizer(DEMON_BINS, DEMON_DISPLAY.window, DEMON_DISPLAY.guard)
  return (s, d) => {
    normalizeDemonRow(s, 0, d, 0, DEMON_BINS, DEMON_NORM, true, nz)
    for (let i = 0; i < DEMON_BINS; i++) {
      const v = d[i]
      if (v === v) d[i] = Math.min(DEMON_DISPLAY.ceilDb, Math.max(DEMON_DISPLAY.floorDb, v))
    }
  }
}
const byId = (id: string) => DEMON_CASES.find((c) => c.id === id)!

describe('shared DEMON config (Cuts + live)', () => {
  it('imports carrier band + display LUT from acoustics (no FE hardcodes)', () => {
    expect([...DEMON_CARRIER_BAND]).toEqual([1000, 4000])
    expect(DEMON_DISPLAY_DB).toEqual({ floorDb: 0, ceilDb: 20 })
    expect(DEMON_DISPLAY.window).toBe(DEMON_NORM.window)
    expect(DEMON_DISPLAY.guard).toBe(DEMON_NORM.guard)
    expect(DEMON_DISPLAY.floorDb).toBe(DEMON_DISPLAY_DB.floorDb)
    expect(DEMON_DISPLAY.ceilDb).toBe(DEMON_DISPLAY_DB.ceilDb)
    expect(DEMON_GRAM.normalized).toBe(false)
    expect(DEMON_HISTORY_ROWS).toBe(500)
    expect(DEMON_STREAM.bins).toBe(512)
  })

  it('gram mode includes demon; isDemonView gates DIFAR paint', () => {
    expect(GRAM_MODES).toContain('demon')
    expect(isGramMode('demon')).toBe(true)
    expect(isDemonView('demon')).toBe(true)
    expect(isDemonView('difar')).toBe(false)
  })
})

describe('live DEMON hint (no answer leak)', () => {
  it('returns identical fixed copy whether contacts are cavitating or quiet', () => {
    const cav = [{ id: 'a', params: { cavitationPower: 0.4, shaftHz: 2 } }]
    const quiet = [{ id: 'b', params: { cavitationPower: 0, shaftHz: 2 } }]
    expect(liveDemonHint(cav)).toBe(LIVE_DEMON_HINT)
    expect(liveDemonHint(quiet)).toBe(LIVE_DEMON_HINT)
    expect(liveDemonHint(cav)).toBe(liveDemonHint(quiet))
    expect(liveDemonHint()).toBe('DEMON shows propulsion only from cavitating contacts.')
  })
})


describe('live DEMON path never touches reveal answer-key helpers', () => {
  it('demonConfig + DemonPane + cutNorm sources do not import demonExpectation / scenarioDemonAnswerKey', () => {
    const here = fileURLToPath(new URL('.', import.meta.url)) // .../src/gram/
    const srcRoot = fileURLToPath(new URL('..', import.meta.url)) // .../src/
    const files = [
      'gram/demonConfig.ts',
      'gram/DemonPane.tsx',
      'cuts/cutNorm.ts',
    ]
    void here
    for (const rel of files) {
      const src = readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8')
      const importLines = src.split('\n').filter((l) => /^\s*import\b/.test(l)).join('\n')
      expect(importLines).not.toMatch(/demonExpectation/)
      expect(importLines).not.toMatch(/scenarioDemonAnswerKey/)
      expect(importLines).not.toMatch(/cutDemonExpectation/)
    }
    void srcRoot
    const ui = readFileSync(fileURLToPath(new URL('../cuts/demonExpectationUi.ts', import.meta.url)), 'utf8')
    expect(ui).toMatch(/cutDemonExpectation/)
    expect(ui).toMatch(/scenarioDemonAnswerKey/)
  })
})

describe('live DEMON subscribe contract', () => {
  it('host stamps demodBandHz from DEMON_CARRIER_BAND on every DEMON config', () => {
    const msgs: FromWorker[] = []
    const h = new SimHost((m) => msgs.push(m))
    h.handle({ type: 'init', seed: 7, scenarioId: 'ridgeline-field', band: 'lofar1k', rowRateHz: 2 })
    const streams = msgs.find((m): m is StreamSet => m.type === 'streams')!
    const demon = streams.configs.filter((c) => c.kind === 'demon')
    expect(demon.length).toBeGreaterThan(0)
    for (const c of demon) {
      expect(c.demodBandHz).toEqual([DEMON_CARRIER_BAND[0], DEMON_CARRIER_BAND[1]])
      expect(c.bins).toBe(DEMON_STREAM.bins)
    }
    const n0 = h.liveStreamCount()
    for (let i = 0; i < 4; i++) h.handle({ type: 'step' })
    expect(h.liveStreamCount()).toBe(n0) // view toggle is FE-only; streams stay subscribed
  })

  it('DEMON kind never paints DIFAR bearings (omni demod)', () => {
    const cfg = {
      v: 1, type: 'gramConfig', streamId: 9, kind: 'demon', channel: 7,
      bins: 100, f0: 0, fBin: 0.2, rowRateHz: 4, dbFloor: 0, dbCeil: 30,
    } as GramConfig
    const difar = { id: 1, channel: 7, kind: 'difar' } as TacticalBuoy
    const out = new Float32Array(100)
    expect(fillLineBearings(out, cfg, difar, [{ buoyId: 7, freqHz: 2, brgDeg: 90, quality: 1 }])).toBe(false)
    expect(out.every(Number.isNaN)).toBe(true)
  })
})

describe('DEMON readability probe (db2de08 physics)', () => {
  const display = sharedDisplay()
  const FBIN = 100 / 511

  function localContrast(avg: Float32Array, k: number): number {
    const bg: number[] = []
    for (let i = Math.max(0, k - 25); i <= Math.min(DEMON_BINS - 1, k + 25); i++) {
      if (Math.abs(i - k) > 2 && avg[i] === avg[i]) bg.push(avg[i])
    }
    if (!bg.length) return NaN
    bg.sort((a, b) => a - b)
    let pk = -Infinity
    for (let i = Math.max(0, k - 1); i <= Math.min(DEMON_BINS - 1, k + 1); i++) {
      if (avg[i] === avg[i]) pk = Math.max(pk, avg[i])
    }
    return pk - bg[bg.length >> 1]
  }

  function contrastAt(avg: Float32Array, hz: number): number | null {
    if (!(hz > 0) || hz >= 100 - 2 * FBIN) return null
    const c = localContrast(avg, Math.round(hz / FBIN))
    return c === c ? c : null
  }

  function probe(id: string) {
    const spec = byId(id)
    const { pull, target } = spec.make()
    const raw = new Float32Array(DEMON_BINS), rows: Float32Array[] = []
    for (let r = 0; r < 120; r++) {
      if (!pull(raw)) break
      const d = new Float32Array(DEMON_BINS)
      display(raw, d)
      rows.push(d)
    }
    const avg = new Float32Array(DEMON_BINS)
    for (const row of rows) for (let i = 0; i < DEMON_BINS; i++) avg[i] += row[i] / rows.length
    const shaftHz = target.params.shaftHz
    const blades = target.params.blades
    const bladeHz = shaftHz * blades
    const fmt = (v: number | null) => (v == null ? null : +v.toFixed(2))
    return {
      id,
      note: spec.note,
      shaftHz: +shaftHz.toFixed(3),
      blades,
      cavitationPower: +(target.params.cavitationPower ?? 0).toFixed(4),
      shaft_dB: fmt(contrastAt(avg, shaftHz)),
      shaft_h2_dB: fmt(contrastAt(avg, shaftHz * 2)),
      shaft_h3_dB: fmt(contrastAt(avg, shaftHz * 3)),
      shaft_h4_dB: fmt(contrastAt(avg, shaftHz * 4)),
      BR_dB: fmt(contrastAt(avg, bladeHz)),
      BR2_dB: fmt(contrastAt(avg, bladeHz * 2)),
      BR3_dB: fmt(contrastAt(avg, bladeHz * 3)),
    }
  }

  it('reports shaft, BR, BR2 and shaft harmonics on cinderlilt + new cav cuts, live 17 kn, quiet seed', () => {
    const reports = ['cut-cinderlilt-cav', 'cut-brindleflux-cav', 'cut-gloamspiral-cav', 'live-fast-cav', 'live-slow-batt'].map(probe)
    console.log('DEMON_READABILITY_PROBE', JSON.stringify({
      window: DEMON_DISPLAY.window,
      guard: DEMON_DISPLAY.guard,
      displayDb: { floorDb: DEMON_DISPLAY_DB.floorDb, ceilDb: DEMON_DISPLAY_DB.ceilDb },
      band: [...DEMON_CARRIER_BAND],
      reports,
    }))
    const by = Object.fromEntries(reports.map((r) => [r.id, r]))
    const cav = by['cut-cinderlilt-cav']!, brin = by['cut-brindleflux-cav']!, gloam = by['cut-gloamspiral-cav']!
    const fast = by['live-fast-cav']!, quiet = by['live-slow-batt']!
    expect(cav.BR_dB).toBeTypeOf('number')
    expect(fast.BR_dB).toBeTypeOf('number')
    expect(quiet.BR_dB).toBeTypeOf('number')
    expect(quiet.BR_dB!).toBeLessThan(3.5)
    expect(cav.BR_dB!).toBeGreaterThan(8)
    // Lesson-pack practice cuts: approx shaft≈6.3/6.2, BR≈12.5/13.3, BR2≈5.0/7.3 (Sonya).
    expect(brin.shaft_dB!).toBeGreaterThan(4)
    expect(brin.BR_dB!).toBeGreaterThan(9)
    expect(brin.BR2_dB!).toBeGreaterThan(3)
    expect(gloam.shaft_dB!).toBeGreaterThan(4)
    expect(gloam.BR_dB!).toBeGreaterThan(9)
    expect(gloam.BR2_dB!).toBeGreaterThan(4)
    expect(cav.shaft_h2_dB).toBeTypeOf('number')
    expect(cav.shaft_h3_dB).toBeTypeOf('number')
    expect(cav.shaft_h4_dB).toBeTypeOf('number')
  }, 120_000)
})

describe('32-buoy DEMON step latency (report; do not hack if over 150 ms)', () => {
  it('logs median host step with DEMON on at the field buoy cap', () => {
    const out: FromWorker[] = []
    const queue: ArrayBuffer[][] = []
    const host = new SimHost((m) => {
      if (m.type === 'gramRows') {
        out.push(m)
        queue.push([m.streamIds.buffer, m.rowIndex.buffer, m.data.buffer, ...(m.bearingDeg ? [m.bearingDeg.buffer] : [])] as ArrayBuffer[])
      } else out.push(m)
    })
    host.handle({ type: 'init', seed: 7, scenarioId: 'ridgeline-field', band: 'lofar1k', rowRateHz: 2 })
    const release = () => { while (queue.length) host.handle({ type: 'release', buffers: queue.shift()! }) }
    const streamsOf = () => out.filter((m): m is StreamSet => m.type === 'streams').at(-1)
    const lofarN = () => streamsOf()?.configs.filter((c) => c.kind === 'lofar').length ?? 0
    const demonN = () => streamsOf()?.configs.filter((c) => c.kind === 'demon').length ?? 0
    expect(demonN()).toBeGreaterThan(0)
    let seq = 1, i = 0
    while (lofarN() < MAX_FIELD_BUOYS && i < MAX_FIELD_BUOYS + 4) {
      const remaining = MAX_FIELD_BUOYS - lofarN()
      const chunk: { kind: 'difar' | 'omni'; x: number; y: number; channel: number }[] = []
      for (let k = 0; k < Math.min(8, remaining); k++, i++) {
        chunk.push({
          kind: i % 2 === 0 ? 'difar' : 'omni',
          x: (i % 8) * 500 - 1750,
          y: Math.floor(i / 8) * 700 - 2450,
          channel: 400 + i,
        })
      }
      host.handle({ type: 'dropBuoys', seq: seq++, source: 'manual', buoys: chunk })
    }
    expect(lofarN()).toBe(MAX_FIELD_BUOYS)
    expect(demonN()).toBe(MAX_FIELD_BUOYS)
    for (let k = 0; k < 6; k++) { host.handle({ type: 'step' }); release() }
    const times: number[] = []
    for (let k = 0; k < 21; k++) {
      const t0 = performance.now()
      host.handle({ type: 'step' })
      times.push(performance.now() - t0)
      release()
    }
    times.sort((a, b) => a - b)
    const median = times[10]!
    console.log(JSON.stringify({
      demon32BuoyStepMedianMs: +median.toFixed(2),
      demon32BuoyStepTimesMs: times.map((x) => +x.toFixed(2)),
      lofar: lofarN(),
      demon: demonN(),
      budgetMs: 150,
      overBudget: median > 150,
    }))
    expect(demonN()).toBe(MAX_FIELD_BUOYS)
    expect(median).toBeGreaterThan(0)
  }, 120_000)
})
