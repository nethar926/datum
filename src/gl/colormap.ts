type Stop = [t: number, r: number, g: number, b: number]

/**
 * Gram palettes. green/amber/gray: single-hue operator phosphors, black to near-white.
 * multi: perceptual multicolour (stops sampled from matplotlib's viridis, CC0), dark purple to yellow.
 */
export const PALETTES = {
  green: [[0, 0, 0, 0], [0.25, 0, 40, 8], [0.55, 20, 150, 45], [0.8, 92, 255, 122], [1, 225, 255, 230]],
  amber: [[0, 0, 0, 0], [0.25, 45, 18, 0], [0.55, 170, 90, 5], [0.8, 255, 176, 40], [1, 255, 238, 200]],
  gray: [[0, 0, 0, 0], [1, 245, 245, 245]],
  multi: [[0, 68, 1, 84], [0.125, 71, 39, 119], [0.25, 62, 73, 137], [0.375, 49, 103, 141], [0.5, 37, 131, 142],
    [0.625, 30, 157, 136], [0.75, 53, 183, 120], [0.875, 140, 209, 70], [1, 253, 231, 37]],
} satisfies Record<string, Stop[]>
export type PaletteId = keyof typeof PALETTES
export const PALETTE_IDS = Object.keys(PALETTES) as PaletteId[]
export const isPaletteId = (v: unknown): v is PaletteId => typeof v === 'string' && v in PALETTES

/** 256-entry RGBA lookup table for a palette (piecewise-linear between stops). */
export function paletteLut(id: PaletteId = 'green', size = 256): Uint8Array {
  const stops: Stop[] = PALETTES[id] ?? PALETTES.green
  const out = new Uint8Array(size * 4)
  for (let i = 0; i < size; i++) {
    const t = i / (size - 1)
    let k = 0
    while (k < stops.length - 2 && t > stops[k + 1][0]) k++
    const [t0, r0, g0, b0] = stops[k], [t1, r1, g1, b1] = stops[k + 1]
    const a = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)))
    out[i * 4] = Math.round(r0 + (r1 - r0) * a)
    out[i * 4 + 1] = Math.round(g0 + (g1 - g0) * a)
    out[i * 4 + 2] = Math.round(b0 + (b1 - b0) * a)
    out[i * 4 + 3] = 255
  }
  return out
}

/** Classic phosphor-green palette (kept for existing callers). */
export const phosphorLut = (size = 256) => paletteLut('green', size)

/** dB → 0..1 display intensity, NaN preserved (drawn as gap colour). */
export function normalizeDb(db: number, floor: number, ceil: number): number {
  if (Number.isNaN(db)) return NaN
  const span = Math.max(1e-6, ceil - floor)
  return Math.min(1, Math.max(0, (db - floor) / span))
}
