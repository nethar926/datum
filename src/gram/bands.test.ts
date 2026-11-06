import { describe, expect, it } from 'vitest'
import { BAND_IDS, bakeMaps, bandEdges, bandReadout, parseBandChoice, texturesFor } from './bands'
import { handoffLabel, HandoffMachine, sameTarget } from './handoff'
import type { GramConfig } from '../engine/contract'

const res = (streamId: number, filter: 'NB' | 'BB' = 'NB'): GramConfig => ({ v: 1, type: 'gramConfig', streamId, kind: 'lofar', channel: streamId, bins: 1024, f0: 0, fBin: 0.5, rowRateHz: 0.5, dbFloor: filter === 'NB' ? 0 : 40, dbCeil: filter === 'NB' ? 30 : 110, res: 5, filter })
const band = (streamId: number, fMax: number, id: GramConfig['bandPreset']): GramConfig => ({ v: 1, type: 'gramConfig', streamId, kind: 'lofar', channel: streamId, bins: 2048, f0: 0, fBin: fMax / 2047, rowRateHz: 2, dbFloor: 40, dbCeil: 110, bandPreset: id })

describe('band presets (m3-bands)', () => {
  it('uses the engine table: ELF 50, VLF 200, LF 500, MF 2000 Hz', () => {
    expect(BAND_IDS).toEqual(['ELF', 'VLF', 'LF', 'MF'])
    expect(BAND_IDS.map((id) => bandEdges(id)[1])).toEqual([50, 200, 500, 2000])
    expect(BAND_IDS.every((id) => bandEdges(id)[0] === 0)).toBe(true)
  })

  it('parses the saved choice (default LF, RES on) and tolerates junk', () => {
    expect(parseBandChoice(null)).toEqual({ preset: 'LF', on: false })
    expect(parseBandChoice('{"preset":"MF","on":true}')).toEqual({ preset: 'MF', on: true })
    expect(parseBandChoice('{"preset":"VLF"}')).toEqual({ preset: 'VLF', on: false })
    expect(parseBandChoice('"ELF"')).toEqual({ preset: 'ELF', on: true })
    expect(parseBandChoice('{"preset":"XX","on":true}')).toEqual({ preset: 'LF', on: false })
    expect(parseBandChoice('not json')).toEqual({ preset: 'LF', on: false })
  })

  it('reads out the band gram, nothing for RES', () => {
    expect(bandReadout(band(1, 200, 'VLF'))).toBe('RES OFF · VLF 0–200 Hz')
    expect(bandReadout(res(1))).toBeNull()
  })

  it('band targets compare by preset only (NB/BB is a display choice there)', () => {
    expect(sameTarget({ res: 5, filter: 'NB', band: 'LF' }, { res: 3, filter: 'BB', band: 'LF' })).toBe(true)
    expect(sameTarget({ res: 5, filter: 'NB', band: 'LF' }, { res: 5, filter: 'NB', band: 'MF' })).toBe(false)
    expect(sameTarget({ res: 5, filter: 'NB' }, { res: 5, filter: 'NB', band: 'LF' })).toBe(false)
    const m = new HandoffMachine()
    expect(m.begin({ res: 5, filter: 'NB', band: 'LF' }, { res: 5, filter: 'BB', band: 'LF' }, 0)).toEqual([])
    expect(m.begin({ res: 5, filter: 'NB', band: 'LF' }, { res: 5, filter: 'NB', band: 'MF' }, 0).map((e) => e.type)).toEqual(['subscribe'])
    // NB/BB while MF fills: keep filling, no resubscribe.
    expect(m.begin({ res: 5, filter: 'NB', band: 'LF' }, { res: 5, filter: 'BB', band: 'MF' }, 10)).toEqual([])
    expect(m.to).toMatchObject({ band: 'MF', filter: 'BB' })
    expect(handoffLabel({ res: 5, filter: 'NB' }, { res: 5, filter: 'NB', band: 'MF' }, 0.5)).toBe('RES 5 → MF  FILLING 50%')
    expect(handoffLabel({ res: 5, filter: 'NB', band: 'LF' }, { res: 5, filter: 'NB', band: 'ELF' }, 1)).toBe('LF → ELF  FILLING 100%')
    expect(handoffLabel({ res: 5, filter: 'NB', band: 'LF' }, { res: 3, filter: 'NB' }, 0)).toBe('LF → RES 3  FILLING 0%')
  })

  it('bake maps: band ↔ band keeps raw/normalized copies apart and scales the grid', () => {
    const from = [band(1, 500, 'LF'), band(2, 500, 'LF')], to = [band(3, 2000, 'MF'), band(4, 2000, 'MF')]
    const m = bakeMaps(from, to, texturesFor(from), texturesFor(to))
    expect(m).toHaveLength(4)
    expect(m.map((x) => x.src)).toEqual([0, 1, 2, 3])
    expect(m[0].fBinTo / m[0].fBinFrom).toBeCloseTo(4) // MF bins are 4× wider: old LF fills the bottom quarter
    expect(m[2]).toMatchObject({ dbFloorFrom: 1, dbCeilFrom: 22, dbFloorTo: 1, dbCeilTo: 22 })
    expect(m[0]).toMatchObject({ dbFloorFrom: 40, dbCeilFrom: 110, rowRateFrom: 2, rowRateTo: 2 })
  })

  it('bake maps across families: RES NB ← normalized copy, band normalized ← RES NB', () => {
    const b = [band(1, 500, 'LF'), band(2, 500, 'LF')], r = [res(3), res(4)]
    const toRes = bakeMaps(b, r, 4, 2)
    expect(toRes.map((x) => x.src)).toEqual([2, 3])
    expect(toRes[0]).toMatchObject({ dbFloorFrom: 1, dbCeilFrom: 22, dbFloorTo: 0, dbCeilTo: 30, rowRateFrom: 2, rowRateTo: 0.5 })
    const toResBB = bakeMaps(b, [res(3, 'BB'), res(4, 'BB')], 4, 2)
    expect(toResBB.map((x) => x.src)).toEqual([0, 1])
    const toBand = bakeMaps(r, b, 2, 4)
    expect(toBand.map((x) => x.src)).toEqual([0, 1, 0, 1])
    expect(toBand[2]).toMatchObject({ dbFloorFrom: 0, dbCeilFrom: 30, dbFloorTo: 1, dbCeilTo: 22 })
    expect(texturesFor(r)).toBe(2); expect(texturesFor(b)).toBe(4)
  })
})
