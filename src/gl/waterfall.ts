import { capDpr } from '../touch/gestures'
import { DEFAULT_WHEEL, difarWheelLut, paletteLut, type DifarWheelSettings, type PaletteId } from './colormap'

const VS = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main(){ vUv = vec2(aPos.x*0.5+0.5, 0.5-aPos.y*0.5); gl_Position = vec4(aPos,0.,1.); }`

// Ring-texture waterfall. Newest row at top. Max-pools the bins under each pixel so narrow tonals never alias away.
const FS = `#version 300 es
precision highp float; precision highp int;
uniform highp sampler2D uTex; uniform sampler2D uLut; uniform highp sampler2D uBrg; uniform sampler2D uWheel;
uniform int uHead, uRows, uFilled, uBins, uDifar, uHeadB, uFilledB;
uniform float uB0, uB1, uFloor, uCeil, uPxW;
in vec2 vUv; out vec4 o;
void main(){
  int age = int(floor(vUv.y * float(uRows)));
  if (age >= uFilled) { o = vec4(0.,0.,0.,1.); return; }
  int row = ((uHead - age) % uRows + uRows) % uRows;
  float b = mix(uB0, uB1, vUv.x);
  float per = (uB1 - uB0) * uPxW;            // bins per pixel
  int i0 = int(floor(b - per*0.5)), n = int(clamp(ceil(per), 1., 8.));
  float v = -1e9; bool gap = false; int imax = i0;
  for (int k = 0; k < 8; k++) {
    if (k >= n) break;
    int i = clamp(i0 + k, 0, uBins - 1);
    float s = texelFetch(uTex, ivec2(i, row), 0).r;
    if (isnan(s) || s != s) { gap = true; continue; }
    if (s > v) { v = s; imax = i; }
  }
  if (v < -1e8) { o = gap ? vec4(0.06,0.06,0.07,1.) : vec4(0.,0.,0.,1.); return; }
  float t = clamp((v - uFloor) / max(1e-3, uCeil - uFloor), 0., 1.);
  if (uDifar == 0) { o = vec4(texture(uLut, vec2(t, 0.5)).rgb, 1.); return; }
  // DIFAR: hue from the bearing of the strongest bin under this pixel, brightness from intensity.
  float brg = age < uFilledB ? texelFetch(uBrg, ivec2(imax, ((uHeadB - age) % uRows + uRows) % uRows), 0).r : 0./0.;
  vec3 hue = (isnan(brg) || brg != brg) ? vec3(0.6) : texture(uWheel, vec2(brg / 360., 0.5)).rgb;
  o = vec4(hue * t, 1.);
}`

// Handoff bake: resample the displayed ring (old RES/filter/vernier grid) into the older slots of the pending ring,
// so the promoted gram is full on the first frame. Fragment = one texel (bin x, ring slot y) of the destination.
const BAKE_FS = `#version 300 es
precision highp float; precision highp int;
uniform highp sampler2D uSrc;
uniform int uRows, uBins, uDstHead, uNew, uCover, uSrcHead, uSrcFilled, uBearing;
uniform float uA, uB, uScale, uGain, uOff;
out vec4 o;
void main(){
  int x = int(gl_FragCoord.x), slot = int(gl_FragCoord.y);
  int age = ((uDstHead - slot) % uRows + uRows) % uRows;
  int tAge = age - uNew;
  if (tAge < 0 || tAge >= uCover) discard;           // keep the pending set's own (newest) rows
  int sAge = int(floor(float(tAge) * uScale));
  if (sAge >= uSrcFilled) discard;
  int srow = ((uSrcHead - sAge) % uRows + uRows) % uRows;
  float c = uA * float(x) + uB;                       // old-grid bin at this new bin's centre
  float nan = uintBitsToFloat(0x7fc00000u);
  if (c < -0.5 || c > float(uBins) - 0.5) { o = vec4(uBearing == 1 ? nan : -60000., 0., 0., 1.); return; }
  if (uBearing == 1) { o = vec4(texelFetch(uSrc, ivec2(clamp(int(floor(c + 0.5)), 0, uBins - 1), srow), 0).r, 0., 0., 1.); return; }
  // Power: max-pool the old bins under the new bin (coarser RES), level-mapped onto the new dB scale.
  int i0 = int(floor(c - uA * 0.5 + 0.5)), n = int(clamp(ceil(uA), 1., 8.));
  float v = -1e9; bool gap = false;
  for (int k = 0; k < 8; k++) {
    if (k >= n) break;
    float s = texelFetch(uSrc, ivec2(clamp(i0 + k, 0, uBins - 1), srow), 0).r;
    if (isnan(s) || s != s) { gap = true; continue; }
    v = max(v, s);
  }
  o = vec4(v < -1e8 ? (gap ? nan : -60000.) : v * uGain + uOff, 0., 0., 1.);
}`

/** Old → new grid for one stream at the handoff swap (bins and rows from the two gramConfigs). */
export interface BakeMap { f0From: number; fBinFrom: number; f0To: number; fBinTo: number; rowRateFrom: number; rowRateTo: number
  dbFloorFrom: number; dbCeilFrom: number; dbFloorTo: number; dbCeilTo: number }

export interface WaterfallView { binLo: number; binHi: number; dbFloor: number; dbCeil: number }

/** WebGL2 waterfall host: one ring texture per stream on one context, so switching channels keeps history.
 * Uploads one row per call via texSubImage2D; no per-frame allocation. */
export class WaterfallRenderer {
  private gl: WebGL2RenderingContext
  private prog!: WebGLProgram
  private tex: WebGLTexture[] = []
  private lut!: WebGLTexture
  private wheel!: WebGLTexture
  private brg: WebGLTexture[] = []
  private headB: Int32Array
  private filledB: Int32Array
  readonly bearingStreams: number
  private vao!: WebGLVertexArrayObject
  private buf!: WebGLBuffer
  private u: Record<string, WebGLUniformLocation | null> = {}
  private head: Int32Array
  private filled: Int32Array
  private lost = false
  private palette: PaletteId = 'green'
  private wheelSettings: DifarWheelSettings = DEFAULT_WHEEL
  readonly bins: number
  readonly rows: number
  readonly streams: number
  /** Pending (handoff) bank: same sizes as the displayed bank, allocated on first use and then reused. */
  private ptex: WebGLTexture[] = []
  private pbrg: WebGLTexture[] = []
  private phead: Int32Array
  private pfilled: Int32Array
  private pheadB: Int32Array
  private pfilledB: Int32Array
  private pendingOn = false
  private bakeProg: WebGLProgram | null = null
  private fbo: WebGLFramebuffer | null = null
  private bu: Record<string, WebGLUniformLocation | null> = {}
  /** Live GPU textures created by this renderer (leak checks in tests and the smoke). */
  textureCount = 0

  /** bearingStreams: extra ring textures holding a per-bin bearing (deg, NaN = none) for DIFAR colouring. */
  constructor(private canvas: HTMLCanvasElement, bins: number, rows: number, streams: number, bearingStreams = 0) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: false })
    if (!gl) throw new Error('WebGL2 is not available in this browser.')
    const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
    if (bins > maxTex || rows > maxTex) throw new Error(`Gram size ${bins}×${rows} exceeds GPU texture limit ${maxTex}.`)
    this.gl = gl; this.bins = bins; this.rows = rows; this.streams = streams
    this.head = new Int32Array(streams).fill(-1); this.filled = new Int32Array(streams)
    this.bearingStreams = bearingStreams
    this.headB = new Int32Array(bearingStreams).fill(-1); this.filledB = new Int32Array(bearingStreams)
    this.phead = new Int32Array(streams).fill(-1); this.pfilled = new Int32Array(streams)
    this.pheadB = new Int32Array(bearingStreams).fill(-1); this.pfilledB = new Int32Array(bearingStreams)
    canvas.addEventListener('webglcontextlost', this.onLost)
    canvas.addEventListener('webglcontextrestored', this.onRestored)
    this.setup()
  }

  private onLost = (e: Event) => { e.preventDefault(); this.lost = true }
  private onRestored = () => {
    this.lost = false; this.head.fill(-1); this.filled.fill(0); this.headB.fill(-1); this.filledB.fill(0)
    // The old context's objects are gone; the pending bank and bake program are rebuilt lazily.
    this.ptex = []; this.pbrg = []; this.pendingOn = false; this.bakeProg = null; this.fbo = null; this.textureCount = 0
    this.setup()
  }

  private setup(): void {
    const gl = this.gl
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(gl.getShaderInfoLog(s) ?? 'shader')
      return s
    }
    const p = gl.createProgram()!
    const vs = sh(gl.VERTEX_SHADER, VS), fs = sh(gl.FRAGMENT_SHADER, FS)
    gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p)
    gl.deleteShader(vs); gl.deleteShader(fs)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(gl.getProgramInfoLog(p) ?? 'link')
    this.prog = p
    for (const n of ['uTex', 'uLut', 'uHead', 'uRows', 'uFilled', 'uBins', 'uB0', 'uB1', 'uFloor', 'uCeil', 'uPxW', 'uBrg', 'uWheel', 'uDifar', 'uHeadB', 'uFilledB']) this.u[n] = gl.getUniformLocation(p, n)

    this.vao = gl.createVertexArray()!
    gl.bindVertexArray(this.vao)
    this.buf = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(p, 'aPos')
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null)

    // R16F halves GPU memory vs R32F; FLOAT uploads are allowed for R16F in WebGL2. texelFetch → no filtering needed.
    const ring = () => {
      const t = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, t)
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R16F, this.bins, this.rows)
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v)
      return t
    }
    this.tex = Array.from({ length: this.streams }, ring)
    this.textureCount += this.streams + this.bearingStreams + 2
    // Half-float bearings: 0.25° steps near 360°, well under any DIFAR bearing error.
    this.brg = Array.from({ length: this.bearingStreams }, ring)
    this.wheel = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, this.wheel)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 360, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, difarWheelLut(360, this.wheelSettings))
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.REPEAT], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v)

    this.lut = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, this.lut)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, paletteLut(this.palette, 256))
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v)
  }

  private ring(): WebGLTexture {
    const gl = this.gl, t = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R16F, this.bins, this.rows)
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v)
    this.textureCount++
    return t
  }

  /** Start (or restart) filling the pending bank. Allocates its textures once; later handoffs reuse them. */
  beginPending(): void {
    if (this.lost) return
    if (!this.ptex.length) { this.ptex = Array.from({ length: this.streams }, () => this.ring()); this.pbrg = Array.from({ length: this.bearingStreams }, () => this.ring()) }
    this.phead.fill(-1); this.pfilled.fill(0); this.pheadB.fill(-1); this.pfilledB.fill(0); this.pendingOn = true
  }
  /** Superseded or abandoned handoff: forget the pending rows (textures stay for the next one). */
  dropPending(): void { this.pendingOn = false; this.phead.fill(-1); this.pfilled.fill(0); this.pheadB.fill(-1); this.pfilledB.fill(0) }
  hasPending(): boolean { return this.pendingOn }
  pendingFilled(s: number): number { return this.pfilled[s] ?? 0 }

  pushPendingRow(s: number, data: Float32Array, offset: number): void {
    if (!this.pendingOn || this.lost || s < 0 || s >= this.streams) return
    this.upload(this.ptex[s], this.phead, this.pfilled, s, data, offset)
  }
  pushPendingBearing(b: number, data: Float32Array, offset: number): void {
    if (!this.pendingOn || this.lost || b < 0 || b >= this.bearingStreams) return
    this.upload(this.pbrg[b], this.pheadB, this.pfilledB, b, data, offset)
  }

  private upload(t: WebGLTexture, head: Int32Array, filled: Int32Array, s: number, data: Float32Array, offset: number): void {
    const gl = this.gl
    head[s] = (head[s] + 1) % this.rows
    filled[s] = Math.min(this.rows, filled[s] + 1)
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, head[s], this.bins, 1, gl.RED, gl.FLOAT, data, offset)
  }

  /**
   * Atomic swap: the pending bank becomes the displayed bank. When `maps` is given (one per stream) and float
   * render targets are available, the old displayed history is first resampled into the pending ring's older
   * slots, so the window stays full. The old bank becomes the next pending bank (no GPU allocation).
   * Returns whether the bake ran.
   */
  promotePending(maps?: BakeMap[]): boolean {
    if (!this.pendingOn) return false
    let baked = false
    if (maps && !this.lost && !this.gl.isContextLost()) baked = this.bake(maps)
    let t = this.tex; this.tex = this.ptex; this.ptex = t
    t = this.brg; this.brg = this.pbrg; this.pbrg = t
    let a = this.head; this.head = this.phead; this.phead = a
    a = this.filled; this.filled = this.pfilled; this.pfilled = a
    a = this.headB; this.headB = this.pheadB; this.pheadB = a
    a = this.filledB; this.filledB = this.pfilledB; this.pfilledB = a
    this.dropPending()
    return baked
  }

  private bake(maps: BakeMap[]): boolean {
    const gl = this.gl
    if (!this.bakeProg) {
      if (!gl.getExtension('EXT_color_buffer_float')) return false
      const sh = (type: number, src: string) => { const x = gl.createShader(type)!; gl.shaderSource(x, src); gl.compileShader(x); return x }
      const p = gl.createProgram()!, vs = sh(gl.VERTEX_SHADER, VS), fs = sh(gl.FRAGMENT_SHADER, BAKE_FS)
      gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p); gl.deleteShader(vs); gl.deleteShader(fs)
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { gl.deleteProgram(p); return false }
      this.bakeProg = p; this.fbo = gl.createFramebuffer()
      for (const n of ['uSrc', 'uRows', 'uBins', 'uDstHead', 'uNew', 'uCover', 'uSrcHead', 'uSrcFilled', 'uBearing', 'uA', 'uB', 'uScale', 'uGain', 'uOff']) this.bu[n] = gl.getUniformLocation(p, n)
    }
    const u = this.bu
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo)
    gl.viewport(0, 0, this.bins, this.rows)
    gl.useProgram(this.bakeProg)
    gl.bindVertexArray(this.vao)
    gl.uniform1i(u.uRows, this.rows); gl.uniform1i(u.uBins, this.bins); gl.uniform1i(u.uSrc, 0)
    let ok = true
    const pass = (src: WebGLTexture, dst: WebGLTexture, srcHead: number, srcFilled: number, dstHead: number, dstFilled: number, m: BakeMap, bearing: boolean): number => {
      const scale = m.rowRateFrom / Math.max(1e-9, m.rowRateTo) // old rows per new row
      const cover = Math.min(this.rows - dstFilled, Math.ceil(srcFilled / Math.max(1e-9, scale)))
      if (cover <= 0) return dstFilled
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, dst, 0)
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { ok = false; return dstFilled }
      const spanFrom = m.dbCeilFrom - m.dbFloorFrom, gain = spanFrom > 0 ? (m.dbCeilTo - m.dbFloorTo) / spanFrom : 1
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src)
      gl.uniform1i(u.uDstHead, dstHead < 0 ? this.rows - 1 : dstHead); gl.uniform1i(u.uNew, dstFilled); gl.uniform1i(u.uCover, cover)
      gl.uniform1i(u.uSrcHead, Math.max(0, srcHead)); gl.uniform1i(u.uSrcFilled, srcFilled); gl.uniform1i(u.uBearing, bearing ? 1 : 0)
      gl.uniform1f(u.uA, m.fBinTo / m.fBinFrom); gl.uniform1f(u.uB, (m.f0To - m.f0From) / m.fBinFrom); gl.uniform1f(u.uScale, scale)
      gl.uniform1f(u.uGain, gain); gl.uniform1f(u.uOff, m.dbFloorTo - m.dbFloorFrom * gain)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      return dstFilled + cover
    }
    for (let s = 0; s < this.streams && s < maps.length && ok; s++) {
      // Empty pending ring (head -1): park head on the last slot so the next live row lands on slot 0, just ahead of the baked rows.
      if (this.phead[s] < 0) { this.phead[s] = this.rows - 1 }
      this.pfilled[s] = pass(this.tex[s], this.ptex[s], this.head[s], this.filled[s], this.phead[s], this.pfilled[s], maps[s], false)
    }
    for (let b = 0; b < this.bearingStreams && b < maps.length && ok; b++) {
      if (this.pheadB[b] < 0) { this.pheadB[b] = this.rows - 1 }
      this.pfilledB[b] = pass(this.brg[b], this.pbrg[b], this.headB[b], this.filledB[b], this.pheadB[b], this.pfilledB[b], maps[b], true)
    }
    gl.bindVertexArray(null)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return ok
  }

  /** Re-bake the DIFAR wheel LUT from the operator's settings (one 1.4 KB upload); survives context restore. */
  setWheel(w: DifarWheelSettings): void {
    this.wheelSettings = w
    if (this.lost) return
    const gl = this.gl
    gl.bindTexture(gl.TEXTURE_2D, this.wheel)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 360, 1, gl.RGBA, gl.UNSIGNED_BYTE, difarWheelLut(360, w))
  }

  /** Swap the colour palette (one 1 KB texture upload); survives context restore. */
  setPalette(id: PaletteId): void {
    this.palette = id
    if (this.lost) return
    const gl = this.gl
    gl.bindTexture(gl.TEXTURE_2D, this.lut)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, paletteLut(id, 256))
  }

  /** Upload one row for stream index s (bins floats starting at offset). */
  pushRow(s: number, data: Float32Array, offset: number): void {
    if (this.lost || s < 0 || s >= this.streams) return
    this.upload(this.tex[s], this.head, this.filled, s, data, offset)
  }

  /** Upload one per-bin bearing row (deg, NaN = no bearing) for bearing stream b. Push it on the same tick as the power row. */
  pushBearing(b: number, data: Float32Array, offset: number): void {
    if (this.lost || b < 0 || b >= this.bearingStreams) return
    this.upload(this.brg[b], this.headB, this.filledB, b, data, offset)
  }

  isLost(): boolean { return this.lost || this.gl.isContextLost() }

  rowsFilled(s: number): number { return this.filled[s] ?? 0 }

  /** difar: bearing stream index to colour by, or undefined for the palette (LOFAR) look. */
  draw(s: number, view: WaterfallView, difar?: number): void {
    if (s < 0 || s >= this.streams) return
    if (this.lost || this.gl.isContextLost()) return
    const gl = this.gl, c = this.canvas
    const dpr = capDpr(globalThis.devicePixelRatio)
    const w = Math.max(1, Math.round(c.clientWidth * dpr)), h = Math.max(1, Math.round(c.clientHeight * dpr))
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h }
    gl.viewport(0, 0, w, h)
    gl.useProgram(this.prog)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex[s]); gl.uniform1i(this.u.uTex, 0)
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.lut); gl.uniform1i(this.u.uLut, 1)
    gl.uniform1i(this.u.uHead, Math.max(0, this.head[s])); gl.uniform1i(this.u.uRows, this.rows)
    gl.uniform1i(this.u.uFilled, this.filled[s]); gl.uniform1i(this.u.uBins, this.bins)
    gl.uniform1f(this.u.uB0, view.binLo); gl.uniform1f(this.u.uB1, view.binHi)
    gl.uniform1f(this.u.uFloor, view.dbFloor); gl.uniform1f(this.u.uCeil, view.dbCeil)
    gl.uniform1f(this.u.uPxW, 1 / w)
    const d = difar !== undefined && difar >= 0 && difar < this.bearingStreams ? difar : -1
    gl.uniform1i(this.u.uDifar, d >= 0 ? 1 : 0)
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, d >= 0 ? this.brg[d] : this.tex[s]); gl.uniform1i(this.u.uBrg, 2)
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.wheel); gl.uniform1i(this.u.uWheel, 3)
    gl.uniform1i(this.u.uHeadB, d >= 0 ? Math.max(0, this.headB[d]) : 0); gl.uniform1i(this.u.uFilledB, d >= 0 ? this.filledB[d] : 0)
    gl.bindVertexArray(this.vao)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.bindVertexArray(null)
  }

  dispose(): void {
    const gl = this.gl
    this.canvas.removeEventListener('webglcontextlost', this.onLost)
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored)
    if (!gl.isContextLost()) {
      for (const t of this.tex) gl.deleteTexture(t)
      for (const t of this.brg) gl.deleteTexture(t)
      for (const t of this.ptex) gl.deleteTexture(t)
      for (const t of this.pbrg) gl.deleteTexture(t)
      gl.deleteTexture(this.wheel)
      gl.deleteTexture(this.lut); gl.deleteBuffer(this.buf)
      gl.deleteVertexArray(this.vao); gl.deleteProgram(this.prog)
      this.textureCount = 0
      if (this.bakeProg) gl.deleteProgram(this.bakeProg)
      if (this.fbo) gl.deleteFramebuffer(this.fbo)
    }
  }
}
