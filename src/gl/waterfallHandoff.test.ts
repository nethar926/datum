import { describe, expect, it } from 'vitest'
import { WaterfallRenderer } from './waterfall'

/** Minimal WebGL2 stand-in: constants are stable numbers, calls are no-ops; counts texture create/delete. */
function fakeGl() {
  const n = { created: 0, deleted: 0, draws: 0, fbo: 0 }
  const consts = new Map<string, number>()
  const konst = (k: string) => { if (!consts.has(k)) consts.set(k, consts.size + 1); return consts.get(k)! }
  const over: Record<string, unknown> = {
    createTexture: () => { n.created++; return { t: n.created } }, deleteTexture: () => { n.deleted++ },
    getParameter: () => 4096, isContextLost: () => false, getShaderParameter: () => true, getProgramParameter: () => true,
    getExtension: () => ({}), checkFramebufferStatus: () => konst('FRAMEBUFFER_COMPLETE'),
    createFramebuffer: () => { n.fbo++; return {} }, drawArrays: () => { n.draws++ },
    getUniformLocation: (_p: unknown, name: string) => ({ name }), getAttribLocation: () => 0,
  }
  const gl = new Proxy({}, { get: (_t, k: string) => {
    if (k in over) return over[k]
    if (/^[A-Z0-9_]+$/.test(k)) return konst(k)
    return () => ({})
  } })
  const canvas = { getContext: () => gl, addEventListener() {}, removeEventListener() {}, clientWidth: 100, clientHeight: 100, width: 100, height: 100 }
  return { n, canvas: canvas as unknown as HTMLCanvasElement }
}
const map = { f0From: 0, fBinFrom: 0.5, f0To: 0, fBinTo: 0.0625, rowRateFrom: 0.5, rowRateTo: 0.25, dbFloorFrom: 0, dbCeilFrom: 30, dbFloorTo: 0, dbCeilTo: 30 }

describe('WaterfallRenderer handoff banks', () => {
  it('reuses one pending bank across many handoffs and deletes every texture on dispose', () => {
    const { n, canvas } = fakeGl()
    const r = new WaterfallRenderer(canvas, 1024, 600, 6, 6)
    const base = n.created
    const row = new Float32Array(1024)
    for (let i = 0; i < 20; i++) r.pushRow(i % 6, row, 0)
    for (let h = 0; h < 50; h++) {
      r.beginPending()
      for (let k = 0; k < 3; k++) { r.pushPendingRow(k, row, 0); r.pushPendingBearing(k, row, 0) }
      if (h % 3 === 0) r.dropPending()
      else {
        const rowsBefore = r.pendingFilled(0)
        expect(r.promotePending(Array.from({ length: 6 }, () => map))).toBe(true)
        // Baked: the new displayed ring = its own rows + the resampled old history (never empty).
        expect(r.rowsFilled(0)).toBeGreaterThan(rowsBefore)
        expect(r.hasPending()).toBe(false)
      }
    }
    expect(n.created - base).toBe(12) // one pending bank (6 power + 6 bearing), allocated once
    expect(r.textureCount).toBe(n.created)
    r.dispose()
    expect(n.deleted).toBe(n.created)
    expect(r.textureCount).toBe(0)
  })

  it('bake keeps the window full when the old ring was full (RES 5 → 2: 2 old rows per new row)', () => {
    const { canvas } = fakeGl()
    const r = new WaterfallRenderer(canvas, 1024, 600, 1, 1)
    const row = new Float32Array(1024)
    for (let i = 0; i < 600; i++) { r.pushRow(0, row, 0); r.pushBearing(0, row, 0) }
    r.beginPending(); r.pushPendingRow(0, row, 0); r.pushPendingBearing(0, row, 0)
    r.promotePending([map])
    expect(r.rowsFilled(0)).toBe(1 + 300)
    // A later handoff with no new rows yet still shows the whole (baked) history.
    r.beginPending(); r.promotePending([{ ...map, rowRateFrom: 0.25, rowRateTo: 0.25 }])
    expect(r.rowsFilled(0)).toBe(301)
  })

  it('promote without a pending bank is a no-op', () => {
    const { canvas } = fakeGl()
    const r = new WaterfallRenderer(canvas, 1024, 600, 1, 1)
    expect(r.promotePending([map])).toBe(false)
  })
})
