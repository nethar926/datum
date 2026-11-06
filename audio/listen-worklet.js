/**
 * DATUM listen worklet: overlap-add of random-phase IFFT grains shaped by the latest
 * LOFAR magnitude row. Crossfades spectra so row swaps don't click. Self-contained (no imports).
 */
class DatumListenProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.fftSize = 2048
    this.hop = 512
    this.bins = 0
    this.f0 = 0
    this.fBin = 1
    this.magsA = new Float32Array(this.fftSize / 2)
    this.magsB = new Float32Array(this.fftSize / 2)
    this.xfade = 1 // 1 = fully on B
    this.xfadeStep = 1 / (sampleRate * 0.08) // ~80 ms crossfade
    this.ola = new Float32Array(this.fftSize * 2)
    this.olaPos = 0
    this.hopAcc = 0
    this.re = new Float32Array(this.fftSize)
    this.im = new Float32Array(this.fftSize)
    this.win = new Float32Array(this.fftSize)
    for (let i = 0; i < this.fftSize; i++) this.win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / this.fftSize)
    this.gain = 0.22
    this.alive = true
    this.port.onmessage = (e) => this.onMsg(e.data)
  }

  onMsg(m) {
    if (!m || typeof m !== 'object') return
    if (m.type === 'spectrum') {
      const bins = m.bins | 0
      const src = m.mags
      if (!src || !bins) return
      // Swap: current B becomes A, new row fills B, restart crossfade.
      const tmp = this.magsA; this.magsA = this.magsB; this.magsB = tmp
      this.magsB.fill(0)
      const n = Math.min(bins, this.magsB.length, src.length)
      for (let i = 0; i < n; i++) this.magsB[i] = src[i]
      this.bins = n
      this.f0 = +m.f0 || 0
      this.fBin = +m.fBin || 1
      this.xfade = 0
    } else if (m.type === 'gain') {
      this.gain = Math.max(0, Math.min(1, +m.gain || 0))
    } else if (m.type === 'kill') {
      this.alive = false
      this.magsA.fill(0); this.magsB.fill(0); this.ola.fill(0)
    }
  }

  /** In-place radix-2 inverse FFT (re/im length = fftSize). */
  ifft() {
    const n = this.fftSize, re = this.re, im = this.im
    // bit reverse
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1
      for (; j & bit; bit >>= 1) j ^= bit
      j ^= bit
      if (i < j) {
        let t = re[i]; re[i] = re[j]; re[j] = t
        t = im[i]; im[i] = im[j]; im[j] = t
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (2 * Math.PI) / len // inverse: positive angle
      const wlenRe = Math.cos(ang), wlenIm = Math.sin(ang)
      for (let i = 0; i < n; i += len) {
        let wr = 1, wi = 0
        for (let j = 0; j < len / 2; j++) {
          const uRe = re[i + j], uIm = im[i + j]
          const vRe = re[i + j + len / 2] * wr - im[i + j + len / 2] * wi
          const vIm = re[i + j + len / 2] * wi + im[i + j + len / 2] * wr
          re[i + j] = uRe + vRe; im[i + j] = uIm + vIm
          re[i + j + len / 2] = uRe - vRe; im[i + j + len / 2] = uIm - vIm
          const nwr = wr * wlenRe - wi * wlenIm
          wi = wr * wlenIm + wi * wlenRe
          wr = nwr
        }
      }
    }
    const inv = 1 / n
    for (let i = 0; i < n; i++) { re[i] *= inv; im[i] *= inv }
  }

  synthGrain() {
    const half = this.fftSize / 2
    const re = this.re, im = this.im
    re.fill(0); im.fill(0)
    const x = this.xfade
    const a = this.magsA, b = this.magsB
    // DC + Nyquist stay 0; bins 1..half-1 shaped.
    for (let k = 1; k < half; k++) {
      const mag = (1 - x) * (a[k] || 0) + x * (b[k] || 0)
      if (!(mag > 0)) continue
      const ph = Math.random() * 2 * Math.PI
      re[k] = mag * Math.cos(ph)
      im[k] = mag * Math.sin(ph)
      re[this.fftSize - k] = re[k]
      im[this.fftSize - k] = -im[k]
    }
    this.ifft()
    // Overlap-add Hann-windowed grain.
    const pos = this.olaPos
    const win = this.win, ola = this.ola, n = this.fftSize, g = this.gain
    for (let i = 0; i < n; i++) {
      const idx = (pos + i) % ola.length
      ola[idx] += re[i] * win[i] * g
    }
  }

  process(_inputs, outputs) {
    if (!this.alive) return false
    const out = outputs[0] && outputs[0][0]
    if (!out) return true
    const ola = this.ola
    for (let i = 0; i < out.length; i++) {
      if (this.xfade < 1) this.xfade = Math.min(1, this.xfade + this.xfadeStep)
      if (this.hopAcc <= 0) {
        this.synthGrain()
        this.hopAcc = this.hop
      }
      this.hopAcc--
      const s = ola[this.olaPos] || 0
      ola[this.olaPos] = 0
      this.olaPos = (this.olaPos + 1) % ola.length
      // Soft limit inline.
      const a = Math.abs(s)
      out[i] = a <= 0.7 ? s : Math.sign(s) * (0.7 + 0.3 * Math.tanh((a - 0.7) / 0.3))
    }
    return true
  }
}

registerProcessor('datum-listen', DatumListenProcessor)
