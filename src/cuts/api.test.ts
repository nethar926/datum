import { describe, expect, it } from 'vitest'
import { catalog } from '@acoustics'
import {
  CUT_MODEL_VERSION,
  behaviourWording,
  cutScenarioId,
  getCutSeed,
  getCutStarterPack,
  identifyingLineText,
  listCutSeeds,
  openCutHandle,
  parseCutScenarioId,
  renderCut,
} from './api'
import { catalogIdCard } from './catalogCards'

const EXPECTED_IDS = [
  'cut-brindleflux-snork',
  'cut-cinderlilt-cav',
  'cut-pebblewisp-demon',
  'cut-mistacorn-batt',
  'cut-orbelune-msr',
  'cut-emberbraid-ssma',
  'cut-velvetshoal-nuc',
  'cut-twilightweft-nuc',
  'cut-gloamspiral-aip',
  'cut-vellumwake-nuc',
] as const

describe('CUT acoustics API (m3-cuts)', () => {
  const pack = getCutStarterPack()

  it('starter pack has the 10 curated ids + 2 HYDP lookalike pairs', () => {
    expect(pack.packVersion).toBe(1)
    expect(pack.modelVersion).toBe(CUT_MODEL_VERSION)
    expect(pack.cuts.map((c) => c.id)).toEqual([...EXPECTED_IDS])
    expect(listCutSeeds().map((c) => c.id)).toEqual([...EXPECTED_IDS])
    expect(pack.lookalikePairs.length).toBe(2)
    expect(pack.lookalikePairs.every((p) => p.differOn === 'HYDP')).toBe(true)
    const plants = new Set(pack.cuts.map((c) => catalog.classes.find((x) => x.id === c.classId)?.plant))
    expect(plants.has('diesel')).toBe(true)
    expect(plants.has('nuclear')).toBe(true)
    expect(pack.cuts.some((c) => c.mode === 'AIP')).toBe(true)
  })

  it('every cut has v:1, 1–3 classifying lines with behaviour tags, real classId', () => {
    for (const c of listCutSeeds()) {
      expect(c.v).toBe(1)
      expect(c.modelVersion).toBe(CUT_MODEL_VERSION)
      expect(c.classifyingLines.length).toBeGreaterThanOrEqual(1)
      expect(c.classifyingLines.length).toBeLessThanOrEqual(3)
      expect(catalog.classes.some((x) => x.id === c.classId)).toBe(true)
      expect(getCutSeed(c.id)?.id).toBe(c.id)
      for (const line of c.classifyingLines) {
        if (line.behaviour) {
          expect(['stable', 'unstable', 'skipped', 'harmonics-only', 'ramping', 'broadband', 'kneeing']).toContain(line.behaviour)
        }
        if (line.n != null) expect(line.n).toBeGreaterThanOrEqual(1)
      }
    }
  })

  it('lookalike pairs point at cuts sharing lookalikeGroupId', () => {
    for (const p of pack.lookalikePairs) {
      const [a, b] = p.cutIds.map((id) => getCutSeed(id)!)
      expect(a.lookalikeGroupId).toBe(p.id)
      expect(b.lookalikeGroupId).toBe(p.id)
      expect(a.classId).not.toBe(b.classId)
    }
  })

  it('parseCutScenarioId / cutScenarioId', () => {
    expect(parseCutScenarioId(cutScenarioId('cut-brindleflux-snork'))).toBe('cut-brindleflux-snork')
    expect(parseCutScenarioId('ridgeline-field')).toBeNull()
  })

  it('openCutHandle is disposable and spoiler-free (no class in scenarioId)', () => {
    const h = openCutHandle('cut-brindleflux-snork')
    expect(h.scenarioId).toBe('cut:cut-brindleflux-snork')
    expect(h.scenarioId.includes('brindleflux') && !h.scenarioId.includes('blue-')).toBe(true)
    expect(h.disposed).toBe(false)
    h.dispose()
    expect(h.disposed).toBe(true)
  })
})

describe('renderCut drives every pack cut', () => {
  it('every pack cut renders and exposes LOFAR rows', () => {
    for (const c of listCutSeeds()) {
      const s = renderCut(c.id)
      expect(s.cut.id).toBe(c.id)
      expect(s.lofar.bins).toBe(2048)
      const row = new Float32Array(s.lofar.bins)
      expect(s.writeLofarRow(row)).toBeGreaterThanOrEqual(0)
      expect([...row].some(Number.isFinite)).toBe(true)
    }
  })

  it('throws on unknown id', () => {
    expect(() => renderCut('nope')).toThrow(/Unknown cut/)
  })
})

describe('classifyingLines ↔ catalog ID cards', () => {
  it('each cut classifying line family appears on that class catalog card', () => {
    for (const cut of listCutSeeds()) {
      const card = catalogIdCard(catalog.classes.find((x) => x.id === cut.classId)!)
      for (const line of cut.classifyingLines) {
        const fam = line.lineFamily
        const hit =
          card.lines.some((l) => l.family === fam) ||
          // SSMA teaching tone is AUX on the seed, SSMA on the card
          (fam === 'AUX' && line.behaviour === 'harmonics-only' && card.lines.some((l) => l.family === 'SSMA')) ||
          // AIP-quiet AUX: card may only show plant/AIP tag — accept drivetrain/aip presence
          (fam === 'AUX' && !!card.aip)
        expect(hit, `${cut.id} missing card line for ${fam} (${line.label})`).toBe(true)
      }
    }
  })
})

describe('behaviour / identify wording', () => {
  it('maps stable/unstable/ramping; leaves skipped/harmonics-only/broadband as-is', () => {
    expect(behaviourWording('stable')).toBe('AC, steady')
    expect(behaviourWording('unstable')).toBe('DC, wanders')
    expect(behaviourWording('ramping')).toBe('ramps')
    expect(behaviourWording('skipped')).toBe('skipped')
    expect(behaviourWording('harmonics-only')).toBe('harmonics-only')
    expect(behaviourWording('broadband')).toBe('broadband')
  })

  it('accepts the diesel knee without changing its acoustic behavior tag', () => {
    const cut = getCutSeed('cut-brindleflux-snork')!
    const knee = cut.classifyingLines.find((line) => line.behaviour === 'kneeing')
    expect(knee).toBeDefined()
    expect(knee!.lineFamily).toBe('CFR')
    expect(behaviourWording(knee!.behaviour!)).toBe('engine family slows together')
    expect(behaviourWording('future-tag')).toBe('future-tag')
  })

  it('names harmonic giveaways as FAMILY ×n', () => {
    expect(identifyingLineText({
      lineFamily: 'BR', label: '8-blade rate h2 reinforced', wasHarmonic: true, harmonicOf: 'BR', n: 2,
    })).toBe('BR ×2')
    expect(identifyingLineText({
      lineFamily: 'CFR', label: 'CFR 2nd', wasHarmonic: true, harmonicOf: 'CFR', n: 3,
    })).toBe('CFR ×3')
  })
})
