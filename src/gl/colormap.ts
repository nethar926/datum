type Stop = [t: number, r: number, g: number, b: number]

/**
 * LOFAR palettes: single-hue operator phosphors, black to near-white. Amplitude only, no hue coding
 * (DIFAR ignores these and uses the bearing wheel).
 */
export const PALETTES = {
  green: [[0, 0, 0, 0], [0.25, 0, 40, 8], [0.55, 20, 150, 45], [0.8, 92, 255, 122], [1, 225, 255, 230]],
  amber: [[0, 0, 0, 0], [0.25, 45, 18, 0], [0.55, 170, 90, 5], [0.8, 255, 176, 40], [1, 255, 238, 200]],
  red: [[0, 0, 0, 0], [0.25, 48, 0, 2], [0.55, 165, 12, 12], [0.8, 255, 72, 56], [1, 255, 222, 210]],
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

/**
 * DIFAR bearing → hue on a full, continuous 360° HSV wheel (S = V = 1; brightness comes from intensity in the shader).
 * Cardinals land on Wilson's colours: 000 N red, 090 E yellow, 180 S blue, 270 W violet. Between them the hue sweeps
 * every value in order (N→E orange, E→S green and cyan, S→W indigo, W→N magenta), piecewise-linear in hue.
 */
export const DIFAR_HUE_ANCHORS: readonly (readonly [bearingDeg: number, hueDeg: number])[] = [
  [0, 0], [90, 60], [180, 240], [270, 280], [360, 360],
]
/** Bearing (deg, any value) → hue (deg 0..360). */
export function difarHue(deg: number): number {
  const d = ((deg % 360) + 360) % 360
  let k = 0
  while (k < DIFAR_HUE_ANCHORS.length - 2 && d >= DIFAR_HUE_ANCHORS[k + 1][0]) k++
  const [b0, h0] = DIFAR_HUE_ANCHORS[k], [b1, h1] = DIFAR_HUE_ANCHORS[k + 1]
  return (h0 + ((d - b0) / (b1 - b0)) * (h1 - h0)) % 360
}
/** Fully saturated HSV (V = 1) to RGB 0..255. */
export function hueRgb(h: number): [number, number, number] {
  const x = (((h % 360) + 360) % 360) / 60, i = Math.floor(x) % 6, f = x - Math.floor(x)
  const up = Math.round(255 * f), dn = Math.round(255 * (1 - f))
  switch (i) {
    case 0: return [255, up, 0]
    case 1: return [dn, 255, 0]
    case 2: return [0, 255, up]
    case 3: return [0, dn, 255]
    case 4: return [up, 0, 255]
    default: return [255, 0, dn]
  }
}
/** Bearing (deg, any value) to RGB 0..255 on the continuous wheel. */
export const difarRgb = (deg: number): [number, number, number] => hueRgb(difarHue(deg))
/** 360-entry RGBA wheel (one texel per degree) for the GPU; sampled with linear filtering and REPEAT wrap. */
export function difarWheelLut(size = 360): Uint8Array {
  const out = new Uint8Array(size * 4)
  for (let i = 0; i < size; i++) { const [r, g, b] = difarRgb((i * 360) / size); out.set([r, g, b, 255], i * 4) }
  return out
}
