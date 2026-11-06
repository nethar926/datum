import { describe, expect, it } from 'vitest'
import { FixStore } from './fixStore'

const buoys = [
  { id: 1, x: 0, y: 0, kind: 'difar', state: 'live' },
  { id: 2, x: 4000, y: 0, kind: 'difar', state: 'live' },
]

describe('FixStore', () => {
  it('lays fixes, fits a leg, DYN EVENT opens a new leg, undo works', () => {
    const s = new FixStore()
    s.newTrack()
    const cse = 45, spdKts = 8
    const spdMps = spdKts * 1852 / 3600
    const vx = Math.sin(cse * Math.PI / 180) * spdMps
    const vy = Math.cos(cse * Math.PI / 180) * spdMps
    const brg = (b: typeof buoys[0], x: number, y: number) =>
      ((Math.atan2(x - b.x, y - b.y) * 180) / Math.PI + 360) % 360

    const origin = { x: 1200, y: 800 }
    for (let i = 0; i < 3; i++) {
      const tS = 60 + i * 60
      const x = origin.x + vx * (i * 60), y = origin.y + vy * (i * 60)
      const manual = { 1: brg(buoys[0], x, y), 2: brg(buoys[1], x, y) }
      const ages = { 1: tS, 2: tS }
      const r = s.layFix(manual, ages, buoys, tS)
      expect(r.ok).toBe(true)
    }
    const fit = s.activeFit()
    expect(fit).not.toBeNull()
    expect(Math.abs(fit!.cseDeg - cse)).toBeLessThan(2)
    expect(Math.abs(fit!.spdKts - spdKts)).toBeLessThan(0.2)

    s.dynEvent()
    expect(s.legs.filter((l) => l.closed)).toHaveLength(1)
    expect(s.legs.filter((l) => !l.closed)).toHaveLength(1)

    const tS = 60 + 3 * 60
    const x = origin.x + vx * (3 * 60), y = origin.y + vy * (3 * 60)
    const r4 = s.layFix({ 1: brg(buoys[0], x, y), 2: brg(buoys[1], x, y) }, { 1: tS, 2: tS }, buoys, tS)
    expect(r4.ok).toBe(true)
    expect(s.fixes).toHaveLength(4)
    expect(s.legs.find((l) => !l.closed)!.fixIds).toHaveLength(1)

    s.undo()
    expect(s.fixes).toHaveLength(3)
    s.clear()
    expect(s.fixes).toHaveLength(0)
    expect(s.tracks).toHaveLength(0)
  })

  it('rejects a shallow cut with a clear flash', () => {
    const s = new FixStore()
    const r = s.layFix({ 1: 40, 2: 45 }, { 1: 10, 2: 10 }, buoys, 10)
    expect(r.ok).toBe(false)
    expect(s.flash).toMatch(/too shallow/i)
  })
})
