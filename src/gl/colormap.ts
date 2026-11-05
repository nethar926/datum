/** Phosphor-green operator palette: black → deep green → green → pale green-white. 256 RGBA entries. */
export function phosphorLut(size = 256): Uint8Array {
  const stops: [number, number, number, number][] = [
    [0.0, 0, 0, 0], [0.25, 0, 40, 8], [0.55, 20, 150, 45], [0.8, 92, 255, 122], [1.0, 225, 255, 230],
  ]
  const out = new Uint8Array(size * 4)
  for (let i = 0; i < size; i++) {
    const t = i / (size - 1)
    let k = 0
    while (k < stops.length - 2 && t > stops[k + 1][0]) k++
    const [t0, r0, g0, b0] = stops[k], [t1, r1, g1, b1] = stops[k + 1]
    const a = (t - t0) / (t1 - t0)
    out[i * 4] = Math.round(r0 + (r1 - r0) * a)
    out[i * 4 + 1] = Math.round(g0 + (g1 - g0) * a)
    out[i * 4 + 2] = Math.round(b0 + (b1 - b0) * a)
    out[i * 4 + 3] = 255
  }
  return out
}

/** dB → 0..1 display intensity, NaN preserved (drawn as gap colour). */
export function normalizeDb(db: number, floor: number, ceil: number): number {
  if (Number.isNaN(db)) return NaN
  const span = Math.max(1e-6, ceil - floor)
  return Math.min(1, Math.max(0, (db - floor) / span))
}
