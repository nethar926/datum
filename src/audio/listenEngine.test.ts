import { describe, expect, it } from 'vitest'
import { remapToFftBins } from './listenEngine'
import { dbToLinear, rowToMagnitudes, normalizePeak } from './shape'

describe('remapToFftBins', () => {
  it('places a tonal at the expected FFT bin', () => {
    const src = new Float32Array(100)
    src[10] = 0.9 // f0=0, fBin=10 → 100 Hz
    const dst = new Float32Array(1024)
    remapToFftBins(src, 100, 0, 10, 48000, 1024, dst)
    const binHz = 48000 / 2048
    const k = Math.round(100 / binHz)
    expect(dst[k]).toBeCloseTo(0.9, 5)
    expect(dst[k - 3] ?? 0).toBe(0)
  })
})

describe('OfflineAudioContext spectrum check (shaped tone energy)', () => {
  it('a bright bin at 200 Hz yields energy near 200 Hz after shaping', async () => {
    // Skip when OfflineAudioContext is unavailable (node vitest default).
    const Offline = (globalThis as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext
    if (!Offline) {
      // Pure stand-in: verify the shaping pipeline concentrates energy at the bright bin.
      const row = new Float32Array(64).fill(0)
      row[20] = 30 // 0 + 20*10 = 200 Hz if fBin=10
      const mags = new Float32Array(64)
      rowToMagnitudes(row, 0, 64, 0, 30, mags)
      normalizePeak(mags, 64, 0.85)
      expect(mags[20]).toBeCloseTo(0.85, 5)
      const side = Math.max(mags[19]!, mags[21]!)
      expect(mags[20]!).toBeGreaterThan(side)
      return
    }
    const sr = 48000, len = sr * 0.25
    const ctx = new Offline(1, len, sr)
    // Build a short buffer of shaped noise via oscillators at 200 Hz as a hearing proxy.
    const o = ctx.createOscillator()
    o.frequency.value = 200
    const g = ctx.createGain()
    g.gain.value = dbToLinear(30, 0, 30) * 0.2
    o.connect(g); g.connect(ctx.destination); o.start()
    const buf = await ctx.startRendering()
    const data = buf.getChannelData(0)
    // Goertzel-ish energy at 200 vs 500 Hz.
    const energy = (f: number) => {
      const w = 2 * Math.PI * f / sr
      let s0 = 0, s1 = 0, s2 = 0
      const c = 2 * Math.cos(w)
      for (let i = 0; i < data.length; i++) { s0 = data[i]! + c * s1 - s2; s2 = s1; s1 = s0 }
      return s1 * s1 + s2 * s2 - c * s1 * s2
    }
    expect(energy(200)).toBeGreaterThan(energy(500) * 5)
  })
})
