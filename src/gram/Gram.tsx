import { useEffect, useMemo, useRef, useState } from 'react'
import type { GramConfig, Tactical } from '../engine/contract'
import { fillLineBearings, type GramMode } from './difarBearing'
import type { SimClient } from '../engine/client'
import { WaterfallRenderer } from '../gl/waterfall'
import type { PaletteId } from '../gl/colormap'
import { AutoLevel } from './autoLevel'
import { SplitWindowNormalizer } from './whiten'
import { LevelHistory } from './levelHistory'
import { clampView, freqToX, niceTicks, xToFreq, zoomView, type FreqView } from './axis'
import { bandLimitHz, fullView, geometryKey, minSpanOf } from './res'
import { DOUBLE_TAP_MS, LONG_PRESS_MS, exceedsSlop, pinchView } from '../touch/gestures'


export interface OverlayCtx { view: FreqView; width: number; cfg: GramConfig; historyS: number }
interface Props {
  /** Streams of one kind (all with equal bins), in display order; streamIndex selects among them. */
  client: SimClient; configs: GramConfig[]; streamIndex: number; view: FreqView; onView: (v: FreqView) => void
  label?: string; testId?: string; historyRows?: number; unit?: string
  /** Drawn above the waterfall (cursors, markers); gets the live view and pixel width. */
  overlay?: (o: OverlayCtx) => React.ReactNode
  /** When set, clicks call this with (Hz, seconds before the newest row) instead of onSelectHz. */
  onPickPoint?: (hz: number, agoS: number) => void
  /** When set, pointer drags on the waterfall call this (overlay dragging); clicks are suppressed. */
  onDragPoint?: (phase: 'start' | 'move' | 'end', hz: number, agoS: number, shift: boolean) => void
  /** Full-width time / full-height frequency crosshair with time, frequency and level readout. */
  crosshair?: boolean; nowS?: number
  auto?: boolean; normalized?: boolean; palette?: PaletteId; selectedHz?: number | null; onSelectHz?: (hz: number) => void
  /** 'difar' colours each bin by bearing (hue) with intensity as brightness; 'lofar' uses the palette. */
  mode?: GramMode
  /** Latest tactical frame, used for per-bin bearings until the engine streams them. */
  tactical?: Tactical
}
// Auto range: noise floor sits just above black, tonals reach the bright end of the phosphor palette.
const AUTO_BELOW_DB = 4, AUTO_SPAN_DB = 32
// Normalized view: background sits at ~0 dB, so a fixed range from just below it shows weak tonals.
const NORM_FLOOR_DB = 1, NORM_CEIL_DB = 22

/**
 * Gram waterfall (LOFAR, DEMON): WebGL2 ring textures, frequency axis below, time axis right, cursor readout.
 * Accepts gramRows for its own streams only (matched by streamId), so several panes can share one client.
 */
export function Gram({ client, configs, streamIndex, view, onView, auto = true, normalized = true, palette = 'green', selectedHz = null, onSelectHz, mode = 'lofar', tactical,
  label = 'LOFAR waterfall', testId = 'lofar', historyRows = 600, unit = 'Hz', overlay, onPickPoint, onDragPoint, crosshair = false, nowS = 0 }: Props) {
  const HISTORY_ROWS = historyRows
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<WaterfallRenderer | null>(null)
  const [glError, setGlError] = useState<string | null>(null)
  // Bumped when a lost WebGL context is not restored (iOS backgrounding): remounts the canvas with a fresh context.
  const [glGen, setGlGen] = useState(0)
  const [pressHint, setPressHint] = useState(false)
  const [cursor, setCursor] = useState<number | null>(null)
  const [cross, setCross] = useState<{ hz: number; agoS: number; x: number } | null>(null)
  const histRef = useRef<LevelHistory | null>(null)
  const [width, setWidth] = useState(800)
  const cfg = configs[streamIndex] ?? configs[0]
  const bins = cfg?.bins ?? 0, fBin = cfg?.fBin ?? 1, rowRate = cfg?.rowRateHz ?? 2
  const fMax = cfg ? cfg.f0 + (cfg.bins - 1) * cfg.fBin : 1000
  const fMin = cfg?.f0 ?? 0, minSpan = minSpanOf(cfg)
  const full = (): FreqView => (cfg ? fullView(cfg) : { lo: 0, hi: fMax })
  const geo = geometryKey(configs)
  const limitHz = bandLimitHz(cfg)
  const viewRef = useRef({ view, streamIndex, cfg, auto, normalized, palette, mode })
  viewRef.current = { view, streamIndex, cfg, auto, normalized, palette, mode }
  const tacRef = useRef(tactical); tacRef.current = tactical

  // (Re)create the renderer when the stream geometry changes.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !bins || !configs.length) return
    let r: WaterfallRenderer
    // Textures 0..N-1 hold raw rows, N..2N-1 the normalized rows, so toggling keeps full history.
    const N = configs.length
    const local = new Map<number, number>()
    configs.forEach((c, i) => local.set(c.streamId, i))
    try { r = new WaterfallRenderer(canvas, bins, HISTORY_ROWS, N * 2, N) } catch (e) { setGlError(e instanceof Error ? e.message : String(e)); return }
    setGlError(null)
    rendererRef.current = r
    const level = new AutoLevel(N)
    const engineFiltered = configs[0]?.res !== undefined
    const norm = new SplitWindowNormalizer(bins), scratch = new Float32Array(bins), brgRow = new Float32Array(bins)
    const hist = new LevelHistory(HISTORY_ROWS, bins); histRef.current = hist
    let histStream = viewRef.current.streamIndex
    let dirty = true, raf = 0
    const off = client.onRows((rows) => {
      if (viewRef.current.streamIndex !== histStream) { hist.clear(); histStream = viewRef.current.streamIndex }
      const n = rows.streamIds.length
      if (!n || rows.data.length !== n * bins) return // another pane's streams (different bin count)
      for (let k = 0; k < n; k++) {
        const s = local.get(rows.streamIds[k])
        if (s === undefined) continue
        r.pushRow(s, rows.data, k * bins); level.update(s, rows.data, k * bins, bins)
        if (s === histStream) hist.push(rows.data, k * bins)
        // RES grams arrive engine-filtered (NB = TPSW), so the display normalizer only runs on legacy grams.
        if (!engineFiltered) { norm.apply(rows.data, k * bins, scratch, 0); r.pushRow(N + s, scratch, 0) }
        // Bearing ring stays row-aligned with the power ring (NaN rows for omni buoys).
        // Engine per-bin bearings when streamed; else interim colouring from the tracked line bearings.
        const bd = (rows as { bearingDeg?: Float32Array }).bearingDeg
        if (bd && bd.length === rows.data.length) r.pushBearing(s, bd, k * bins)
        else {
          const tac = tacRef.current, c = configs[s]
          fillLineBearings(brgRow, c, tac?.buoys.find((b) => b.channel === c.channel), tac?.bearings)
          r.pushBearing(s, brgRow, 0)
        }
      }
      dirty = true
    })
    const ro = new ResizeObserver(() => { dirty = true; setWidth(canvas.clientWidth) })
    ro.observe(canvas)
    let lastKey = ''
    const frame = () => {
      const { view: v, streamIndex: s, cfg: c, auto: a, normalized: nz, palette: pal, mode: md } = viewRef.current
      const key = `${v.lo},${v.hi},${s},${a},${nz},${pal},${md},${c?.dbFloor},${c?.dbCeil}`
      if ((dirty || key !== lastKey) && c) {
        const fl = level.get(s), useAuto = a && Number.isFinite(fl)
        const dbFloor = useAuto ? fl - AUTO_BELOW_DB : c.dbFloor, dbCeil = useAuto ? fl - AUTO_BELOW_DB + AUTO_SPAN_DB : c.dbCeil
        const range = { binLo: (v.lo - c.f0) / c.fBin, binHi: (v.hi - c.f0) / c.fBin }
        const difar = md === 'difar' ? s : undefined
        // RES grams: the colour scale comes only from gramConfig (NB 0–30 dB, BB 40–110 dB).
        if (c.res !== undefined) r.draw(s, { ...range, dbFloor: c.dbFloor, dbCeil: c.dbCeil }, difar)
        else if (nz) r.draw(N + s, { ...range, dbFloor: NORM_FLOOR_DB, dbCeil: NORM_CEIL_DB }, difar)
        else r.draw(s, { ...range, dbFloor, dbCeil }, difar)
        dirty = false; lastKey = key
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    // iOS may drop the context while backgrounded and never fire 'restored'; rebuild on return if still lost.
    let lostTimer = 0
    const checkLost = () => {
      if (document.visibilityState !== 'visible' || !r.isLost()) return
      clearTimeout(lostTimer)
      lostTimer = window.setTimeout(() => { if (r.isLost()) setGlGen((g) => g + 1) }, 1000)
    }
    const onLost = () => { if (document.visibilityState === 'visible') checkLost() }
    document.addEventListener('visibilitychange', checkLost); canvas.addEventListener('webglcontextlost', onLost)
    const onShow = () => { dirty = true }
    window.addEventListener('pageshow', onShow)
    return () => {
      cancelAnimationFrame(raf); clearTimeout(lostTimer); off(); ro.disconnect()
      document.removeEventListener('visibilitychange', checkLost); canvas.removeEventListener('webglcontextlost', onLost); window.removeEventListener('pageshow', onShow)
      r.dispose(); rendererRef.current = null; histRef.current = null
    }
  }, [client, bins, configs.length, geo, HISTORY_ROWS, glGen])

  // Palette swap: one LUT upload on the live renderer (runs after a renderer is (re)created); the frame loop redraws on key change.
  useEffect(() => { rendererRef.current?.setPalette(palette) }, [palette, bins, configs.length, client, glGen])

  const ticks = useMemo(() => niceTicks(view.lo, view.hi, Math.max(3, Math.floor(width / 90))), [view, width])
  const historyS = HISTORY_ROWS / rowRate
  const timeTicks = useMemo(() => niceTicks(0, historyS, 6), [historyS])

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const anchor = xToFreq(e.clientX - rect.left, view, rect.width)
    onView(zoomView(view, anchor, e.deltaY < 0 ? 1.25 : 0.8, fMax, minSpan, fMin))
  }
  // Pointer gestures (mouse, pen, touch). One finger: tap = pick/select, drag = tool drag or scrub cursor,
  // long-press = crosshair details at that point, double-tap = full band. Two fingers: pinch zoom + pan.
  type P = { id: number; x: number; y: number; x0: number; y0: number; t0: number; type: string }
  const ptr = useRef(new Map<number, P>())
  const g = useRef({ pinch: null as null | { v: FreqView; a0: number; b0: number }, dragging: false, moved: false, longFired: false, longTimer: 0, lastTap: { t: 0, x: 0, y: 0 } })
  const local = (e: React.PointerEvent<HTMLCanvasElement>) => { const r = e.currentTarget.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height } }
  const ago = (y: number, h: number) => Math.max(0, (y / Math.max(1, h)) * historyS)
  const showAt = (x: number, y: number, w: number, h: number, withCross: boolean) => {
    const hz = xToFreq(x, view, w); setCursor(hz)
    if (withCross) setCross({ hz, agoS: ago(y, h), x })
  }
  const onPDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* synthetic or already-released pointer */ }
    const { x, y, w, h } = local(e), G = g.current
    ptr.current.set(e.pointerId, { id: e.pointerId, x, y, x0: x, y0: y, t0: e.timeStamp, type: e.pointerType })
    clearTimeout(G.longTimer)
    if (ptr.current.size === 2) {
      // Second finger: end any one-finger drag and start a pinch from the current view.
      if (G.dragging) { G.dragging = false; const p0 = [...ptr.current.values()][0]; onDragPoint?.('end', xToFreq(p0.x, view, w), ago(p0.y, h), false) }
      const [a, b] = [...ptr.current.values()]
      G.pinch = { v: view, a0: a.x, b0: b.x }; G.moved = true; setPressHint(false); return
    }
    if (ptr.current.size > 2) return
    G.moved = false; G.longFired = false; G.pinch = null
    if (!crosshair) setCross(null)
    if (onDragPoint) { G.dragging = true; onDragPoint('start', xToFreq(x, view, w), ago(y, h), e.shiftKey) }
    if (e.pointerType !== 'mouse') {
      showAt(x, y, w, h, false); setPressHint(true)
      G.longTimer = window.setTimeout(() => {
        const p = ptr.current.get(e.pointerId); if (!p || G.moved || ptr.current.size !== 1) return
        G.longFired = true; setPressHint(false); showAt(p.x, p.y, w, h, true)
      }, LONG_PRESS_MS)
    }
  }
  const onPMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y, w, h } = local(e), G = g.current, p = ptr.current.get(e.pointerId)
    if (!p) { if (e.pointerType === 'mouse') showAt(x, y, w, h, crosshair); return }
    p.x = x; p.y = y
    if (G.pinch && ptr.current.size >= 2) {
      const [a, b] = [...ptr.current.values()]
      onView(pinchView(G.pinch.v, G.pinch.a0, G.pinch.b0, a.x, b.x, w, fMax, minSpan, fMin)); return
    }
    if (!G.moved && exceedsSlop(p.x0, p.y0, x, y)) { G.moved = true; clearTimeout(G.longTimer); setPressHint(false) }
    if (G.dragging) { if (G.moved) onDragPoint?.('move', xToFreq(x, view, w), ago(y, h), e.shiftKey) }
    showAt(x, y, w, h, crosshair || G.longFired)
  }
  const onPUp = (e: React.PointerEvent<HTMLCanvasElement>, cancel = false) => {
    const { x, y, w, h } = local(e), G = g.current, p = ptr.current.get(e.pointerId)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    ptr.current.delete(e.pointerId); clearTimeout(G.longTimer); setPressHint(false)
    if (!p) return
    if (G.pinch) { if (ptr.current.size < 2) G.pinch = null; return }
    if (G.dragging) { G.dragging = false; onDragPoint?.('end', xToFreq(x, view, w), ago(y, h), e.shiftKey); return }
    if (cancel || G.moved || G.longFired) return
    // Tap.
    const hz = xToFreq(x, view, w), lt = G.lastTap
    if (p.type !== 'mouse' && e.timeStamp - lt.t < DOUBLE_TAP_MS && !exceedsSlop(lt.x, lt.y, x, y, 24)) {
      G.lastTap = { t: 0, x: 0, y: 0 }; onView(full()); return
    }
    G.lastTap = { t: e.timeStamp, x, y }
    if (onPickPoint) onPickPoint(hz, ago(y, h))
    else onSelectHz?.(hz)
  }
  const crossText = (() => {
    if (!cross || !cfg) return ''
    const t = nowS - cross.agoS, h = histRef.current
    const db = h ? h.at(cross.agoS * rowRate, (cross.hz - cfg.f0) / fBin) : NaN
    const mm = Math.floor(Math.max(0, t) / 60), ss = Math.floor(Math.max(0, t) % 60)
    return `T+${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')} (-${cross.agoS.toFixed(0)}s)  ${cross.hz.toFixed(fBin < 0.1 ? 2 : 1)} ${unit}  ${Number.isFinite(db) ? `${db.toFixed(1)} dB` : '-- dB'}`
  })()

  return (
    <div className="gram">
      {glError ? <div className="gl-error">{glError}</div> : (
        <canvas key={glGen} ref={canvasRef} data-testid={testId} onWheel={onWheel}
          onPointerDown={onPDown} onPointerMove={onPMove} onPointerUp={(e) => onPUp(e)} onPointerCancel={(e) => onPUp(e, true)}
          onPointerLeave={(e) => { if (e.pointerType === 'mouse' && !ptr.current.size) { setCursor(null); setCross(null) } }}
          onContextMenu={(e) => e.preventDefault()}
          className={pressHint ? 'pressing' : undefined}
          style={{ touchAction: 'none', cursor: onPickPoint ? 'crosshair' : onDragPoint ? 'ew-resize' : undefined }}
          onDoubleClick={() => onView(full())} aria-label={label} />
      )}
      {cfg && <div key={geo} className="gram-veil" aria-hidden />}
      {limitHz !== null && freqToX(limitHz, view, width) < width && (
        <div className="band-limit" data-testid={`${testId}-band-limit`} style={{ left: Math.max(0, freqToX(limitHz, view, width)), width: width - Math.max(0, freqToX(limitHz, view, width)) }}
          title={`Above ${limitHz.toFixed(0)} Hz is past the simulated band`}><span>BAND LIMIT</span></div>
      )}
      <div className="axis axis-y" aria-hidden>
        {timeTicks.map((t) => <span key={t} style={{ top: `${(t / historyS) * 100}%` }}>{t === 0 ? 'now' : `-${t}s`}</span>)}
      </div>
      <div className="axis axis-x" aria-hidden>
        {ticks.map((f) => { const x = freqToX(f, view, width); return (
          <span key={f} style={{ left: x }}><i className="tick-x" style={{ left: '50%', top: -6 }} />{f}</span>) })}
      </div>
      <div />
      {selectedHz !== null && selectedHz >= view.lo && selectedHz <= view.hi && (
        <div className="sel-marker" style={{ left: freqToX(selectedHz, view, width) }} aria-hidden><span>{selectedHz.toFixed(fBin < 0.1 ? 2 : 1)}</span></div>
      )}
      {cfg && overlay && <div className="gram-layer" style={{ width }}>{overlay({ view, width, cfg, historyS })}</div>}
      {cross && (
        <div className="gram-layer cross-layer" style={{ width }} aria-hidden>
          <div className="cross-h" style={{ top: `${(cross.agoS / historyS) * 100}%` }} />
          <div className="cross-v" style={{ left: cross.x }} />
        </div>
      )}
      {cross ? <div className="cursor-readout cross-readout" data-testid={`${testId}-cross`}>{crossText}</div> : cursor !== null && <div className="cursor-readout">{cursor.toFixed(fBin < 0.1 ? 2 : 1)} {unit} · bin {Math.round((cursor - (cfg?.f0 ?? 0)) / fBin)}</div>}
    </div>
  )
}
