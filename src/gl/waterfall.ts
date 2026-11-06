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
    canvas.addEventListener('webglcontextlost', this.onLost)
    canvas.addEventListener('webglcontextrestored', this.onRestored)
    this.setup()
  }

  private onLost = (e: Event) => { e.preventDefault(); this.lost = true }
  private onRestored = () => { this.lost = false; this.head.fill(-1); this.filled.fill(0); this.headB.fill(-1); this.filledB.fill(0); this.setup() }

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
    const gl = this.gl
    this.head[s] = (this.head[s] + 1) % this.rows
    this.filled[s] = Math.min(this.rows, this.filled[s] + 1)
    gl.bindTexture(gl.TEXTURE_2D, this.tex[s])
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, this.head[s], this.bins, 1, gl.RED, gl.FLOAT, data, offset)
  }

  /** Upload one per-bin bearing row (deg, NaN = no bearing) for bearing stream b. Push it on the same tick as the power row. */
  pushBearing(b: number, data: Float32Array, offset: number): void {
    if (this.lost || b < 0 || b >= this.bearingStreams) return
    const gl = this.gl
    this.headB[b] = (this.headB[b] + 1) % this.rows
    this.filledB[b] = Math.min(this.rows, this.filledB[b] + 1)
    gl.bindTexture(gl.TEXTURE_2D, this.brg[b])
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, this.headB[b], this.bins, 1, gl.RED, gl.FLOAT, data, offset)
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
      gl.deleteTexture(this.wheel)
      gl.deleteTexture(this.lut); gl.deleteBuffer(this.buf)
      gl.deleteVertexArray(this.vao); gl.deleteProgram(this.prog)
    }
  }
}
