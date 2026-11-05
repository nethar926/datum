import { useEffect, useMemo, useRef, useState } from 'react'
import type { GramConfig } from '../engine/contract'
import type { SimClient } from '../engine/client'
import { WaterfallRenderer } from '../gl/waterfall'
import type { PaletteId } from '../gl/colormap'
import { AutoLevel } from './autoLevel'
import { SplitWindowNormalizer } from './whiten'
import { clampView, freqToX, niceTicks, xToFreq, zoomView, type FreqView } from './axis'


export interface OverlayCtx { view: FreqView; width: number; cfg: GramConfig }
interface Props {
  /** Streams of one kind (all with equal bins), in display order; streamIndex selects among them. */
  client: SimClient; configs: GramConfig[]; streamIndex: number; view: FreqView; onView: (v: FreqView) => void
  label?: string; testId?: string; historyRows?: number; unit?: string
  /** Drawn above the waterfall (cursors, markers); gets the live view and pixel width. */
  overlay?: (o: OverlayCtx) => React.ReactNode
  auto?: boolean; normalized?: boolean; palette?: PaletteId; selectedHz?: number | null; onSelectHz?: (hz: number) => void
}
// Auto range: noise floor sits just above black, tonals reach the bright end of the phosphor palette.
const AUTO_BELOW_DB = 4, AUTO_SPAN_DB = 32
// Normalized view: background sits at ~0 dB, so a fixed range from just below it shows weak tonals.
const NORM_FLOOR_DB = 1, NORM_CEIL_DB = 22

/**
 * Gram waterfall (LOFAR, DEMON): WebGL2 ring textures, frequency axis below, time axis right, cursor readout.
 * Accepts gramRows for its own streams only (matched by streamId), so several panes can share one client.
 */
export function Gram({ client, configs, streamIndex, view, onView, auto = true, normalized = true, palette = 'green', selectedHz = null, onSelectHz,
  label = 'LOFAR waterfall', testId = 'lofar', historyRows = 600, unit = 'Hz', overlay }: Props) {
  const HISTORY_ROWS = historyRows
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<WaterfallRenderer | null>(null)
  const [glError, setGlError] = useState<string | null>(null)
  const [cursor, setCursor] = useState<number | null>(null)
  const [width, setWidth] = useState(800)
  const cfg = configs[streamIndex] ?? configs[0]
  const bins = cfg?.bins ?? 0, fBin = cfg?.fBin ?? 1, rowRate = cfg?.rowRateHz ?? 2
  const fMax = cfg ? cfg.f0 + (cfg.bins - 1) * cfg.fBin : 1000
  const viewRef = useRef({ view, streamIndex, cfg, auto, normalized, palette })
  viewRef.current = { view, streamIndex, cfg, auto, normalized, palette }

  // (Re)create the renderer when the stream geometry changes.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !bins || !configs.length) return
    let r: WaterfallRenderer
    // Textures 0..N-1 hold raw rows, N..2N-1 the normalized rows, so toggling keeps full history.
    const N = configs.length
    const local = new Map<number, number>()
    configs.forEach((c, i) => local.set(c.streamId, i))
    try { r = new WaterfallRenderer(canvas, bins, HISTORY_ROWS, N * 2) } catch (e) { setGlError(e instanceof Error ? e.message : String(e)); return }
    setGlError(null)
    rendererRef.current = r
    const level = new AutoLevel(N)
    const norm = new SplitWindowNormalizer(bins), scratch = new Float32Array(bins)
    let dirty = true, raf = 0
    const off = client.onRows((rows) => {
      const n = rows.streamIds.length
      if (!n || rows.data.length !== n * bins) return // another pane's streams (different bin count)
      for (let k = 0; k < n; k++) {
        const s = local.get(rows.streamIds[k])
        if (s === undefined) continue
        r.pushRow(s, rows.data, k * bins); level.update(s, rows.data, k * bins, bins)
        norm.apply(rows.data, k * bins, scratch, 0); r.pushRow(N + s, scratch, 0)
      }
      dirty = true
    })
    const ro = new ResizeObserver(() => { dirty = true; setWidth(canvas.clientWidth) })
    ro.observe(canvas)
    let lastKey = ''
    const frame = () => {
      const { view: v, streamIndex: s, cfg: c, auto: a, normalized: nz, palette: pal } = viewRef.current
      const key = `${v.lo},${v.hi},${s},${a},${nz},${pal}`
      if ((dirty || key !== lastKey) && c) {
        const fl = level.get(s), useAuto = a && Number.isFinite(fl)
        const dbFloor = useAuto ? fl - AUTO_BELOW_DB : c.dbFloor, dbCeil = useAuto ? fl - AUTO_BELOW_DB + AUTO_SPAN_DB : c.dbCeil
        const range = { binLo: (v.lo - c.f0) / c.fBin, binHi: (v.hi - c.f0) / c.fBin }
        if (nz) r.draw(N + s, { ...range, dbFloor: NORM_FLOOR_DB, dbCeil: NORM_CEIL_DB })
        else r.draw(s, { ...range, dbFloor, dbCeil })
        dirty = false; lastKey = key
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(raf); off(); ro.disconnect(); r.dispose(); rendererRef.current = null }
  }, [client, bins, configs.length, configs.map((c) => c.streamId).join(','), HISTORY_ROWS])

  // Palette swap: one LUT upload on the live renderer (runs after a renderer is (re)created); the frame loop redraws on key change.
  useEffect(() => { rendererRef.current?.setPalette(palette) }, [palette, bins, configs.length, client])

  const ticks = useMemo(() => niceTicks(view.lo, view.hi, Math.max(3, Math.floor(width / 90))), [view, width])
  const historyS = HISTORY_ROWS / rowRate
  const timeTicks = useMemo(() => niceTicks(0, historyS, 6), [historyS])

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const anchor = xToFreq(e.clientX - rect.left, view, rect.width)
    onView(zoomView(view, anchor, e.deltaY < 0 ? 1.25 : 0.8, fMax))
  }
  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setCursor(xToFreq(e.clientX - rect.left, view, rect.width))
  }

  return (
    <div className="gram">
      {glError ? <div className="gl-error">{glError}</div> : (
        <canvas ref={canvasRef} data-testid={testId} onWheel={onWheel} onMouseMove={onMove} onMouseLeave={() => setCursor(null)}
          onClick={(e) => { const rect = e.currentTarget.getBoundingClientRect(); onSelectHz?.(xToFreq(e.clientX - rect.left, view, rect.width)) }}
          onDoubleClick={() => onView(clampView({ lo: 0, hi: fMax }, fMax))} aria-label={label} />
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
        <div className="sel-marker" style={{ left: freqToX(selectedHz, view, width) }} aria-hidden><span>{selectedHz.toFixed(1)}</span></div>
      )}
      {cfg && overlay?.({ view, width, cfg })}
      {cursor !== null && <div className="cursor-readout">{cursor.toFixed(fBin < 0.1 ? 2 : 1)} {unit} · bin {Math.round((cursor - (cfg?.f0 ?? 0)) / fBin)}</div>}
    </div>
  )
}
