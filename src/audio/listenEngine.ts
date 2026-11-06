/**
 * Listen engine: LOFAR-row-shaped noise via AudioWorklet (OLA random-phase IFFT), FOCUS bandpass,
 * optional octave shift-up. AudioContext is created/resumed only on unmute (iOS gesture rule).
 * Mute and unmount tear every node down — long-session safe, no leaks.
 */
import { normalizePeak, rowToMagnitudes } from './shape'
import { bandpassQ, focusHalfWidthHz, type FocusHalfWidth } from './focus'
import { shiftFocusHz, type ShiftMode } from './shift'

export type ListenSpectrumMeta = { f0: number; fBin: number; bins: number; floorDb: number; ceilDb: number }

const FFT_HALF = 1024 // worklet fftSize/2

type Ctor = typeof AudioContext

function audioCtor(): Ctor | null {
  const g = globalThis as { AudioContext?: Ctor; webkitAudioContext?: Ctor }
  return g.AudioContext ?? g.webkitAudioContext ?? null
}

function workletCandidates(): string[] {
  const base = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/datum/'
  const out: string[] = [`${base}audio/listen-worklet.js`]
  try {
    if (typeof location !== 'undefined' && location.href) {
      out.push(new URL('audio/listen-worklet.js', location.href).href)
    }
  } catch { /* */ }
  return out
}

/**
 * Remap LOFAR-bin magnitudes onto FFT-bin magnitudes for the worklet.
 * `fftHalf` = fftSize/2; bin k ↔ k * sampleRate/fftSize Hz.
 */
export function remapToFftBins(
  src: Float32Array, bins: number, f0: number, fBin: number,
  sampleRate: number, fftHalf: number, dst: Float32Array,
): void {
  dst.fill(0)
  const fftSize = fftHalf * 2
  const binHz = sampleRate / fftSize
  if (!(binHz > 0) || !(fBin > 0)) return
  const n = Math.min(bins, src.length)
  for (let i = 0; i < n; i++) {
    const m = src[i]!
    if (!(m > 0)) continue
    const hz = f0 + i * fBin
    if (!(hz > 0)) continue
    const k = Math.round(hz / binHz)
    if (k <= 0 || k >= fftHalf) continue
    if (m > dst[k]!) dst[k] = m
  }
}

export class ListenEngine {
  private ctx: AudioContext | null = null
  private worklet: AudioWorkletNode | null = null
  private focus: BiquadFilterNode | null = null
  private master: GainNode | null = null
  private comp: DynamicsCompressorNode | null = null
  private loaded = false
  private fallback = false
  private noise: AudioBufferSourceNode | null = null
  private noiseGain: GainNode | null = null
  private peaks: OscillatorNode[] = []
  private peakGains: GainNode[] = []

  private rowMags = new Float32Array(4096)
  private fftMags = new Float32Array(FFT_HALF)
  private meta: ListenSpectrumMeta | null = null
  private focusHz: number | null = null
  private focusHalf: FocusHalfWidth = 10
  private viewSpan = 1000
  private fullSpan = 1000
  private shift: ShiftMode = 'off'
  private running = false

  get isRunning(): boolean { return this.running }
  get contextState(): string | null { return this.ctx?.state ?? null }
  get usingFallback(): boolean { return this.fallback }
  get audioContext(): AudioContext | null { return this.ctx }

  /** Create / resume context on a user gesture, build the graph, start the worklet. */
  async unmute(): Promise<void> {
    if (this.running) return
    const C = audioCtor()
    if (!C) throw new Error('Web Audio unavailable')
    if (!this.ctx) this.ctx = new C()
    if (this.ctx.state === 'suspended') await this.ctx.resume()
    await this.buildGraph()
    this.running = true
    this.pushCurrent()
    this.applyFocus()
  }

  /** Tear every node down and close the context. Safe to call repeatedly. */
  mute(): void {
    this.teardownNodes()
    const c = this.ctx
    this.ctx = null
    this.loaded = false
    this.fallback = false
    this.running = false
    if (c) {
      try { void c.close() } catch { /* already closed */ }
    }
  }

  dispose(): void { this.mute() }

  setShift(mode: ShiftMode): void {
    this.shift = mode
    this.pushCurrent()
    this.applyFocus()
  }

  setFocusHalf(half: FocusHalfWidth): void {
    this.focusHalf = half
    this.applyFocus()
  }

  setViewSpans(viewSpanHz: number, fullSpanHz: number): void {
    this.viewSpan = viewSpanHz
    this.fullSpan = fullSpanHz
    this.applyFocus()
  }

  /** Cursor Hz; null = bypass FOCUS (hear the full shaped band). */
  setFocusHz(hz: number | null): void {
    this.focusHz = hz !== null && Number.isFinite(hz) ? hz : null
    this.applyFocus()
  }

  /**
   * Ingest the latest LOFAR dB row for the selected stream. Copies into a private buffer
   * (the client's row buffer is released right after listeners return).
   */
  pushRow(data: Float32Array, offset: number, meta: ListenSpectrumMeta): void {
    if (meta.bins > this.rowMags.length) this.rowMags = new Float32Array(meta.bins)
    rowToMagnitudes(data, offset, meta.bins, meta.floorDb, meta.ceilDb, this.rowMags)
    normalizePeak(this.rowMags, meta.bins, 0.85)
    this.meta = meta
    this.pushCurrent()
  }

  /** Silence the stream without tearing the graph down (channel gate / cuts). */
  silence(): void {
    if (this.master) this.master.gain.value = 0
    try {
      this.worklet?.port.postMessage({
        type: 'spectrum', mags: new Float32Array(FFT_HALF), bins: FFT_HALF, f0: 0, fBin: 1,
      })
    } catch { /* */ }
  }

  /** Restore master gain after a temporary silence. */
  unsilence(): void {
    if (this.master) this.master.gain.value = 1
    this.pushCurrent()
  }

  private pushCurrent(): void {
    if (!this.running || !this.ctx || !this.meta) return
    const m = this.meta
    const octave = this.shift === 'octave'
    remapToFftBins(
      this.rowMags, m.bins,
      octave ? m.f0 * 2 : m.f0,
      octave ? m.fBin * 2 : m.fBin,
      this.ctx.sampleRate, FFT_HALF, this.fftMags,
    )
    if (this.worklet) {
      const copy = this.fftMags.slice()
      this.worklet.port.postMessage(
        { type: 'spectrum', mags: copy, bins: FFT_HALF, f0: 0, fBin: this.ctx.sampleRate / (FFT_HALF * 2) },
        [copy.buffer],
      )
    } else if (this.fallback) {
      this.updateFallbackPeaks()
    }
  }

  private applyFocus(): void {
    if (!this.focus || !this.ctx) return
    if (this.focusHz === null) {
      this.focus.type = 'allpass'
      this.focus.frequency.value = 1000
      this.focus.Q.value = 0.7
      return
    }
    this.focus.type = 'bandpass'
    const half = focusHalfWidthHz(this.focusHalf, this.viewSpan, this.fullSpan)
    const f = shiftFocusHz(this.focusHz, this.shift)
    const { Q } = bandpassQ(f, half)
    this.focus.frequency.value = Math.max(20, Math.min(this.ctx.sampleRate * 0.45, f))
    this.focus.Q.value = Q
  }

  private async buildGraph(): Promise<void> {
    const ctx = this.ctx!
    this.teardownNodesOnly()
    this.master = ctx.createGain()
    this.master.gain.value = 1
    this.comp = ctx.createDynamicsCompressor()
    this.comp.threshold.value = -18
    this.comp.knee.value = 12
    this.comp.ratio.value = 6
    this.comp.attack.value = 0.003
    this.comp.release.value = 0.12
    this.focus = ctx.createBiquadFilter()
    this.focus.type = 'allpass'
    this.focus.connect(this.comp)
    this.comp.connect(this.master)
    this.master.connect(ctx.destination)

    if (!this.loaded) {
      try {
        let ok = false
        let lastErr: unknown
        for (const url of workletCandidates()) {
          try { await ctx.audioWorklet.addModule(url); ok = true; break } catch (e) { lastErr = e }
        }
        if (!ok) throw lastErr ?? new Error('worklet load failed')
        this.loaded = true
      } catch {
        this.fallback = true
        this.buildFallback(ctx)
        return
      }
    }
    this.worklet = new AudioWorkletNode(ctx, 'datum-listen', {
      numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1],
    })
    this.worklet.connect(this.focus)
  }

  /** ScriptProcessor-free fallback: white noise through FOCUS + a few tracked tonal oscillators. */
  private buildFallback(ctx: AudioContext): void {
    const secs = 1
    const buf = ctx.createBuffer(1, ctx.sampleRate * secs, ctx.sampleRate)
    const ch = buf.getChannelData(0)
    for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * 0.15
    this.noise = ctx.createBufferSource()
    this.noise.buffer = buf
    this.noise.loop = true
    this.noiseGain = ctx.createGain()
    this.noiseGain.gain.value = 0.35
    this.noise.connect(this.noiseGain)
    this.noiseGain.connect(this.focus!)
    this.noise.start()
  }

  private updateFallbackPeaks(): void {
    if (!this.ctx || !this.focus || !this.meta) return
    const m = this.meta
    const idx: number[] = []
    for (let i = 1; i < m.bins - 1; i++) {
      const v = this.rowMags[i]!
      if (v > 0.25 && v >= this.rowMags[i - 1]! && v >= this.rowMags[i + 1]!) idx.push(i)
    }
    idx.sort((a, b) => this.rowMags[b]! - this.rowMags[a]!)
    const top = idx.slice(0, 6)
    while (this.peaks.length < top.length) {
      const o = this.ctx.createOscillator()
      const g = this.ctx.createGain()
      g.gain.value = 0
      o.type = 'sine'
      o.connect(g); g.connect(this.focus)
      o.start()
      this.peaks.push(o); this.peakGains.push(g)
    }
    for (let k = 0; k < this.peaks.length; k++) {
      const o = this.peaks[k]!, g = this.peakGains[k]!
      if (k < top.length) {
        const i = top[k]!
        const hz = shiftFocusHz(m.f0 + i * m.fBin, this.shift)
        o.frequency.setTargetAtTime(Math.max(20, hz), this.ctx.currentTime, 0.03)
        g.gain.setTargetAtTime(0.04 * this.rowMags[i]!, this.ctx.currentTime, 0.05)
      } else {
        g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05)
      }
    }
  }

  private teardownNodesOnly(): void {
    try { this.worklet?.port.postMessage({ type: 'kill' }) } catch { /* */ }
    try { this.worklet?.disconnect() } catch { /* */ }
    try { this.focus?.disconnect() } catch { /* */ }
    try { this.comp?.disconnect() } catch { /* */ }
    try { this.master?.disconnect() } catch { /* */ }
    try { this.noise?.stop(); this.noise?.disconnect() } catch { /* */ }
    try { this.noiseGain?.disconnect() } catch { /* */ }
    for (const o of this.peaks) { try { o.stop(); o.disconnect() } catch { /* */ } }
    for (const g of this.peakGains) { try { g.disconnect() } catch { /* */ } }
    this.worklet = null; this.focus = null; this.comp = null; this.master = null
    this.noise = null; this.noiseGain = null; this.peaks = []; this.peakGains = []
  }

  private teardownNodes(): void { this.teardownNodesOnly() }
}
