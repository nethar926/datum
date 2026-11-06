import { describe, expect, it } from 'vitest'
import { DEFAULT_WHEEL, WHEEL_MUTED_RGB, WHEEL_NULL_RGB, difarRgb, difarWheelLut, quantizeBearing, sectorOf, wheelRgb } from '../gl/colormap'
import { summary } from './DifarApplet'
import { sectorDivisionStrokeCount, showsSectorDivisions } from './wheelSettings'
import { wheelConic } from './DifarLegend'
import { isDefaultWheel, sanitizeWheel, toggleSector } from './wheelSettings'

const W = (p: Partial<typeof DEFAULT_WHEEL>) => ({ ...DEFAULT_WHEEL, ...p })

describe('DIFAR operator wheel', () => {
  it('default settings are exactly the continuous wheel', () => {
    for (let d = 0; d < 360; d += 5) expect(wheelRgb(d)).toEqual(difarRgb(d))
    expect(isDefaultWheel(DEFAULT_WHEEL)).toBe(true)
  })
  it('rotation moves the colours: rot 90 puts red at east', () => {
    const w = W({ rotDeg: 90 })
    expect(wheelRgb(90, w)).toEqual([255, 0, 0]); expect(wheelRgb(180, w)).toEqual([255, 255, 0]); expect(wheelRgb(0, w)).toEqual(difarRgb(270))
  })
  it('steps quantize to bins centred on north', () => {
    expect(quantizeBearing(44, 4)).toBe(0); expect(quantizeBearing(46, 4)).toBe(90); expect(quantizeBearing(350, 8)).toBe(0)
    expect(quantizeBearing(30, 16)).toBe(22.5); expect(quantizeBearing(123.4, 360)).toBeCloseTo(123.4)
    const w = W({ steps: 4 }), seen = new Set<string>()
    for (let d = 0; d < 360; d++) seen.add(wheelRgb(d, w).join())
    expect(seen.size).toBe(4)
    expect(wheelRgb(30, w)).toEqual([255, 0, 0]); expect(wheelRgb(100, w)).toEqual([255, 255, 0])
  })
  it('sectors are 22.5° on true bearing centred on N', () => {
    expect(sectorOf(0)).toBe(0); expect(sectorOf(350)).toBe(0); expect(sectorOf(11.3)).toBe(1); expect(sectorOf(90)).toBe(4); expect(sectorOf(-90)).toBe(12)
  })
  it('null greys a sector; isolate mutes everything else; rotation never moves sectors', () => {
    const n = W({ nulled: 1 << 4, rotDeg: 45 })
    expect(wheelRgb(90, n)).toEqual(WHEEL_NULL_RGB); expect(wheelRgb(0, n)).not.toEqual(WHEEL_NULL_RGB)
    const i = W({ isolated: (1 << 0) | (1 << 8) })
    expect(wheelRgb(0, i)).toEqual([255, 0, 0]); expect(wheelRgb(180, i)).toEqual([0, 0, 255]); expect(wheelRgb(90, i)).toEqual(WHEEL_MUTED_RGB)
  })
  it('looks: pastel lightens, B&W and green are monochrome and keep the wheel order', () => {
    const p = wheelRgb(180, W({ look: 'pastel' })); expect(Math.min(...p)).toBeGreaterThan(100)
    const bw = wheelRgb(90, W({ look: 'bw' })); expect(bw[0]).toBe(bw[1]); expect(bw[1]).toBe(bw[2])
    expect(wheelRgb(90, W({ look: 'bw' }))[0]).toBeGreaterThan(wheelRgb(180, W({ look: 'bw' }))[0]) // yellow brighter than blue
    const g = wheelRgb(0, W({ look: 'green' })); expect(g[1]).toBeGreaterThan(g[0]); expect(g[1]).toBeGreaterThan(g[2])
  })
  it('LUT and legend follow the settings', () => {
    const w = W({ rotDeg: 180, steps: 8 }), lut = difarWheelLut(360, w)
    for (const d of [0, 45, 200]) expect([...lut.slice(d * 4, d * 4 + 3)]).toEqual(wheelRgb(d, w))
    expect(wheelConic(W({ rotDeg: 180 }))).toContain('rgb(0 0 255) 0deg')
  })
  it('toggleSector: null and isolate are exclusive, tap again clears', () => {
    let w = toggleSector(DEFAULT_WHEEL, 3, 'null'); expect(w.nulled).toBe(8)
    w = toggleSector(w, 3, 'isolate'); expect(w.nulled).toBe(0); expect(w.isolated).toBe(8)
    w = toggleSector(w, 3, 'isolate'); expect(w.isolated).toBe(0)
  })
  it('sanitize rejects junk and persists round-trip', () => {
    expect(sanitizeWheel(null)).toEqual(DEFAULT_WHEEL)
    expect(sanitizeWheel({ rotDeg: -30, steps: 7, look: 'neon', nulled: 0x1ffff, isolated: 1 })).toEqual({ rotDeg: 330, steps: 360, look: 'full', nulled: 0xffff, isolated: 0 })
    const w = W({ rotDeg: 15, steps: 16, look: 'pastel', nulled: 2, isolated: 4 })
    expect(sanitizeWheel(JSON.parse(JSON.stringify(w)))).toEqual(w)
  })
  it('summary names the state', () => {
    expect(summary(DEFAULT_WHEEL)).toBe('CONT · FULL')
    expect(summary(W({ steps: 8, look: 'bw', rotDeg: 90, isolated: 1, nulled: 1 << 4 }))).toBe('8 STEP · B&W · RED 090° · ISO N · NULL E')
  })
  it('360° continuous mode draws no sector division strokes; stepped modes keep all 16', () => {
    expect(showsSectorDivisions(360)).toBe(false)
    expect(showsSectorDivisions(16)).toBe(true)
    expect(showsSectorDivisions(8)).toBe(true)
    expect(sectorDivisionStrokeCount(360)).toBe(0)
    expect(sectorDivisionStrokeCount(16)).toBe(16)
    expect(sectorDivisionStrokeCount(8)).toBe(16)
    // Marked null/isolate sectors still stroke in continuous mode so the operator can see them.
    expect(sectorDivisionStrokeCount(360, 1 << 4, 0)).toBe(1)
    expect(sectorDivisionStrokeCount(360, 1 << 0, 1 << 8)).toBe(2)
  })
})
