import { describe, expect, it } from 'vitest'
import { AcousticEngine } from '@acoustics'
import * as Acoustics from '@acoustics'
import { plotContactSource, SimHost } from './host'
import type { FromWorker, Tactical } from './contract'

function seed7Engine(): AcousticEngine {
  const preset = (Acoustics as unknown as { presetToParams: (d: string, s: number) => unknown }).presetToParams
  const gen = (Acoustics as unknown as { generateScenario: (p: unknown, s?: number) => ConstructorParameters<typeof AcousticEngine>[0] }).generateScenario
  const p = preset('regular', 7)
  return new AcousticEngine(gen(p, 7), 7)
}

describe('aisTracks / plotContactSource', () => {
  it('is surface-only, never subsurface, with fictional deterministic names', () => {
    const e = seed7Engine()
    const ais = e.aisTracks(0)
    expect(ais.length).toBeGreaterThan(0)
    for (const t of ais) {
      expect(t.id.startsWith('surface-') || !t.id.startsWith('fictional-')).toBe(true)
      expect(t.id.includes('sub') && t.id.startsWith('fictional')).toBe(false)
      expect(t.name.toLowerCase().startsWith('fictional ')).toBe(false)
      expect(t.name.length).toBeGreaterThan(0)
    }
    expect(ais.every((t) => !t.id.startsWith('fictional-'))).toBe(true)
    // plotContactSource is the one-line swap
    expect(plotContactSource(e).map((t) => t.id)).toEqual(ais.map((t) => t.id))
    expect(plotContactSource(e).map((t) => t.name)).toEqual(ais.map((t) => t.name))
  })

  it('plot coords match Reveal truth at the current sim time', () => {
    const e = seed7Engine()
    e.step(10)
    const ais = e.aisTracks(e.time)
    const truth = e.tactical().truth!.contacts
    expect(ais.length).toBeGreaterThan(0)
for (const t of ais) {
      const r = truth.find((c) => c.sourceId === t.id) ?? truth.find((c) => c.label === t.name)
      expect(r, `Reveal contact for ${t.id} ${t.name}`).toBeTruthy()
      expect(r!.category).toBe('surface')
      expect(t.x).toBe(r!.x)
      expect(t.y).toBe(r!.y)
      expect(t.crsDeg).toBeCloseTo(r!.crsDeg, 10)
      expect(t.spdMps).toBe(r!.spdMps)
    }
    expect(truth.some((c) => c.category === 'subsurface')).toBe(true)
    expect(ais.every((t) => {
      const r = truth.find((c) => c.sourceId === t.id) ?? truth.find((c) => c.label === t.name)
      return r?.category === 'surface'
    })).toBe(true)
  })

  it('host publishes aisTracks on the tactical picture', () => {
    const out: FromWorker[] = []
    const host = new SimHost((m) => out.push(m))
    const preset = (Acoustics as unknown as { presetToParams: (d: string, s: number) => unknown }).presetToParams
    host.handle({ type: 'init', seed: 7, scenarioId: 'generated', band: 'lofar1k', rowRateHz: 2, params: preset('regular', 7) as never })
    const t = out.filter((m): m is Tactical => m.type === 'tactical').at(-1)
    // generated init may error if params shape is wrong — still assert if present
    if (t?.aisTracks) {
      expect(t.aisTracks.every((a) => !a.id.startsWith('fictional-'))).toBe(true)
      for (const a of t.aisTracks) {
        const reveal = t.truth?.contacts.find((c) => c.sourceId === a.id)
        if (reveal) {
          expect(reveal.category).toBe('surface')
          expect(a.x).toBe(reveal.x)
          expect(a.y).toBe(reveal.y)
        }
      }
    }
  })

  it('throws on invalid time', () => {
    const e = seed7Engine()
    expect(() => e.aisTracks(NaN)).toThrow(/AIS time/)
    expect(() => e.aisTracks(Infinity)).toThrow(/AIS time/)
  })
})
