import { describe, expect, it } from 'vitest'
import { BAKE_FS, FS, RING_GLSL } from './waterfall'

// The MF-band seam (m3-fe-mf-line): GLSL ES 3.00 leaves % undefined for negative operands, and WebKit's WebGL
// returned garbage for ((head - age) % rows + rows) % rows once head - age < 0. The bake then skipped ~100 slots
// behind the pending rows and the display read wrong slots: a full-width line ~250 s back after LF → MF.
describe('ring index in the waterfall shaders', () => {
  it('no shader takes % of anything but ringIdx operands (never a negative left side)', () => {
    for (const src of [FS, BAKE_FS]) {
      expect(src).toContain(RING_GLSL)
      expect(src.replace(RING_GLSL, '')).not.toMatch(/%/)
    }
  })

  it('ringIdx (the GLSL text, run as JS with a % that rejects negative operands) wraps like a true modulo', () => {
    const body = /return (.*); \}$/.exec(RING_GLSL)![1]
    const js = body.replace(/(\(-a - 1\)|\ba) % n/g, 'mod($1, n)')
    expect(js).not.toMatch(/%/)
    const mod = (x: number, n: number) => { if (x < 0 || n <= 0) throw new Error(`negative % operand ${x} % ${n}`); return x % n }
    const ringIdx = new Function('a', 'n', 'mod', `return ${js}`) as (a: number, n: number, m: typeof mod) => number
    for (const n of [600, 1, 7]) for (let a = -2 * n - 3; a <= 2 * n + 3; a++) expect(ringIdx(a, n, mod)).toBe(((a % n) + n) % n)
    // The cases from the bug: head 7, slots 496..599 → ages 8..111; display head 11, age 150 → slot 461.
    expect(ringIdx(7 - 599, 600, mod)).toBe(8)
    expect(ringIdx(11 - 150, 600, mod)).toBe(461)
  })
})
