import { LOFAR_BAND_PRESETS } from '@acoustics'
import type { GramConfig, LofarBandPresetId } from '../engine/contract'
import type { BakeMap } from '../gl/waterfall'

/**
 * m3-bands LOFAR band picker (ELF / VLF / LF / MF). The engine keeps two gram families exclusive per stream:
 * RES (zoom-FFT, res/filter/vernierHz) and the analytic band gram (bandPreset). In the display a picked band
 * therefore means "RES off": the gram becomes the analytic band gram; RES −/+ goes back to RES.
 */
export const BAND_IDS = LOFAR_BAND_PRESETS.map((p) => p.id) as readonly LofarBandPresetId[]
export const BAND_DEFAULT: LofarBandPresetId = 'LF'
export const BAND_KEY = 'datum.band'
export const isBandId = (v: unknown): v is LofarBandPresetId => typeof v === 'string' && (BAND_IDS as readonly string[]).includes(v)
/** [f0, fMax] Hz of a preset, straight from the engine's frozen table. */
export const bandEdges = (id: LofarBandPresetId): readonly [number, number] => LOFAR_BAND_PRESETS.find((p) => p.id === id)!.band

/** Saved picker state: the last preset (default LF) and whether the band gram is on (RES off). */
export interface BandChoice { preset: LofarBandPresetId; on: boolean }
export function parseBandChoice(raw: string | null): BandChoice {
  try {
    const v = JSON.parse(raw ?? 'null')
    if (isBandId(v)) return { preset: v, on: true } // bare id = picked band
    if (v && isBandId(v.preset)) return { preset: v.preset, on: v.on === true }
  } catch { /* corrupt */ }
  return { preset: BAND_DEFAULT, on: false }
}

/** Header readout for a band gram. */
export const bandReadout = (c: GramConfig | undefined): string | null =>
  c?.bandPreset ? `RES OFF · ${c.bandPreset} 0–${Math.round(c.f0 + (c.bins - 1) * c.fBin)} Hz` : null

// Legacy/band grams draw the split-window normalized copy (textures N..2N−1) over this range (see Gram.tsx).
export const NORM_FLOOR_DB = 1, NORM_CEIL_DB = 22

/**
 * Bake maps for a handoff swap, one per destination texture. RES sets have N textures; band/legacy sets 2N
 * (raw, then display-normalized). Frequency and time are exact; levels are mapped linearly between the two
 * colour scales (NB ↔ normalized copy, BB ↔ raw), so tails across families are approximate.
 */
export function bakeMaps(from: GramConfig[], to: GramConfig[], fromTextures: number, toTextures: number): BakeMap[] {
  const N = to.length, fromRes = from[0]?.res !== undefined, toRes = to[0]?.res !== undefined
  const out: BakeMap[] = []
  for (let d = 0; d < toTextures; d++) {
    const s = d % N, t = to[s], f = from[s] ?? t
    const dstNorm = !toRes && d >= N
    // Source texture: the normalized copy feeds normalized/NB destinations when the old set has one.
    const wantNorm = dstNorm || (toRes && t.filter === 'NB')
    const src = !fromRes && fromTextures >= 2 * N && wantNorm ? N + s : s
    const srcNorm = !fromRes && src >= N
    const [fl0, fc0] = srcNorm ? [NORM_FLOOR_DB, NORM_CEIL_DB] : [f.dbFloor, f.dbCeil]
    const [fl1, fc1] = dstNorm ? [NORM_FLOOR_DB, NORM_CEIL_DB] : [t.dbFloor, t.dbCeil]
    out.push({ src, f0From: f.f0, fBinFrom: f.fBin, f0To: t.f0, fBinTo: t.fBin, rowRateFrom: f.rowRateHz, rowRateTo: t.rowRateHz,
      dbFloorFrom: fl0, dbCeilFrom: fc0, dbFloorTo: fl1, dbCeilTo: fc1 })
  }
  return out
}

/** Ring textures a set needs: RES grams arrive engine-filtered (N), band/legacy keep a normalized copy (2N). */
export const texturesFor = (cs: GramConfig[]): number => (cs[0]?.res !== undefined ? cs.length : cs.length * 2)
