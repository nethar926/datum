import { phosphorLut } from './colormap'

const VS = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main(){ vUv = vec2(aPos.x*0.5+0.5, 0.5-aPos.y*0.5); gl_Position = vec4(aPos,0.,1.); }`

// Ring-texture waterfall. Newest row at top. Max-pools the bins under each pixel so narrow tonals never alias away.
const FS = `#version 300 es
precision highp float; precision highp int;
uniform highp sampler2D uTex; uniform sampler2D uLut;
uniform int uHead, uRows, uFilled, uBins;
uniform float uB0, uB1, uFloor, uCeil, uPxW;
in vec2 vUv; out vec4 o;
void main(){
  int age = int(floor(vUv.y * float(uRows)));
  if (age >= uFilled) { o = vec4(0.,0.,0.,1.); return; }
  int row = ((uHead - age) % uRows + uRows) % uRows;
  float b = mix(uB0, uB1, vUv.x);
  float per = (uB1 - uB0) * uPxW;            // bins per pixel
  int i0 = int(floor(b - per*0.5)), n = int(clamp(ceil(per), 1., 8.));
  float v = -1e9; bool gap = false;
  for (int k = 0; k < 8; k++) {
    if (k >= n) break;
    int i = clamp(i0 + k, 0, uBins - 1);
    float s = texelFetch(uTex, ivec2(i, row), 0).r;
    if (isnan(s) || s != s) { gap = true; continue; }
    v = max(v, s);
  }
  if (v < -1e8) { o = gap ? vec4(0.06,0.06,0.07,1.) : vec4(0.,0.,0.,1.); return; }
  float t = clamp((v - uFloor) / max(1e-3, uCeil - uFloor), 0., 1.);
  o = vec4(texture(uLut, vec2(t, 0.5)).rgb, 1.);
}`

export interface WaterfallView { binLo: number; binHi: number; dbFloor: number; dbCeil: number }

/** WebGL2 waterfall host: one ring texture per stream on one context, so switching channels keeps history.
 * Uploads one row per call via texSubImage2D; no per-frame allocation. */
export class WaterfallRenderer {
  private gl: WebGL2RenderingContext
  private prog!: WebGLProgram
  private tex: WebGLTexture[] = []
  private lut!: WebGLTexture
  private vao!: WebGLVertexArrayObject
  private buf!: WebGLBuffer
  private u: Record<string, WebGLUniformLocation | null> = {}
  private head: Int32Array
  private filled: Int32Array
  private lost = false
  readonly bins: number
  readonly rows: number
  readonly streams: number

  constructor(private canvas: HTMLCanvasElement, bins: number, rows: number, streams: number) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: false })
    if (!gl) throw new Error('WebGL2 is not available in this browser.')
    const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
    if (bins > maxTex || rows > maxTex) throw new Error(`Gram size ${bins}×${rows} exceeds GPU texture limit ${maxTex}.`)
    this.gl = gl; this.bins = bins; this.rows = rows; this.streams = streams
    this.head = new Int32Array(streams).fill(-1); this.filled = new Int32Array(streams)
    canvas.addEventListener('webglcontextlost', this.onLost)
    canvas.addEventListener('webglcontextrestored', this.onRestored)
    this.setup()
  }

  private onLost = (e: Event) => { e.preventDefault(); this.lost = true }
  private onRestored = () => { this.lost = false; this.head.fill(-1); this.filled.fill(0); this.setup() }

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
    for (const n of ['uTex', 'uLut', 'uHead', 'uRows', 'uFilled', 'uBins', 'uB0', 'uB1', 'uFloor', 'uCeil', 'uPxW']) this.u[n] = gl.getUniformLocation(p, n)

    this.vao = gl.createVertexArray()!
    gl.bindVertexArray(this.vao)
    this.buf = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(p, 'aPos')
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null)

    // R16F halves GPU memory vs R32F; FLOAT uploads are allowed for R16F in WebGL2. texelFetch → no filtering needed.
    this.tex = []
    for (let i = 0; i < this.streams; i++) {
      const t = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, t)
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R16F, this.bins, this.rows)
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v)
      this.tex.push(t)
    }

    this.lut = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, this.lut)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, phosphorLut(256))
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v)
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

  rowsFilled(s: number): number { return this.filled[s] ?? 0 }

  draw(s: number, view: WaterfallView): void {
    if (s < 0 || s >= this.streams) return
    if (this.lost || this.gl.isContextLost()) return
    const gl = this.gl, c = this.canvas
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1)
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
      gl.deleteTexture(this.lut); gl.deleteBuffer(this.buf)
      gl.deleteVertexArray(this.vao); gl.deleteProgram(this.prog)
    }
  }
}
