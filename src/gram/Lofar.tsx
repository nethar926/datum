import { useEffect, useMemo, useRef, useState } from 'react'
import type { GramConfig } from '../engine/contract'
import type { SimClient } from '../engine/client'
import { WaterfallRenderer } from '../gl/waterfall'
import { clampView, freqToX, niceTicks, xToFreq, zoomView, type FreqView } from './axis'

const HISTORY_ROWS = 600

interface Props { client: SimClient; configs: GramConfig[]; streamIndex: number; view: FreqView; onView: (v: FreqView) => void }

/** LOFAR waterfall: WebGL2 ring textures, frequency axis below, time axis right, cursor readout. */
export function Lofar({ client, configs, streamIndex, view, onView }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<WaterfallRenderer | null>(null)
  const [glError, setGlError] = useState<string | null>(null)
  const [cursor, setCursor] = useState<number | null>(null)
  const [width, setWidth] = useState(800)
  const cfg = configs[streamIndex] ?? configs[0]
  const bins = cfg?.bins ?? 0, fBin = cfg?.fBin ?? 1, rowRate = cfg?.rowRateHz ?? 2
  const fMax = cfg ? cfg.f0 + (cfg.bins - 1) * cfg.fBin : 1000
  const viewRef = useRef({ view, streamIndex, cfg })
  viewRef.current = { view, streamIndex, cfg }

  // (Re)create the renderer when the stream geometry changes.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !bins || !configs.length) return
    let r: WaterfallRenderer
    try { r = new WaterfallRenderer(canvas, bins, HISTORY_ROWS, configs.length) } catch (e) { setGlError(e instanceof Error ? e.message : String(e)); return }
    setGlError(null)
    rendererRef.current = r
    let dirty = true, raf = 0
    const off = client.onRows((rows) => {
      const n = rows.streamIds.length
      for (let k = 0; k < n; k++) r.pushRow(rows.streamIds[k] - 1, rows.data, k * bins)
      dirty = true
    })
    const ro = new ResizeObserver(() => { dirty = true; setWidth(canvas.clientWidth) })
    ro.observe(canvas)
    let lastKey = ''
    const frame = () => {
      const { view: v, streamIndex: s, cfg: c } = viewRef.current
      const key = `${v.lo},${v.hi},${s}`
      if ((dirty || key !== lastKey) && c) {
        r.draw(s, { binLo: (v.lo - c.f0) / c.fBin, binHi: (v.hi - c.f0) / c.fBin, dbFloor: c.dbFloor, dbCeil: c.dbCeil })
        dirty = false; lastKey = key
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(raf); off(); ro.disconnect(); r.dispose(); rendererRef.current = null }
  }, [client, bins, configs.length])

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
        <canvas ref={canvasRef} data-testid="lofar" onWheel={onWheel} onMouseMove={onMove} onMouseLeave={() => setCursor(null)}
          onDoubleClick={() => onView(clampView({ lo: 0, hi: fMax }, fMax))} aria-label="LOFAR waterfall" />
      )}
      <div className="axis axis-y" aria-hidden>
        {timeTicks.map((t) => <span key={t} style={{ top: `${(t / historyS) * 100}%` }}>{t === 0 ? 'now' : `-${t}s`}</span>)}
      </div>
      <div className="axis axis-x" aria-hidden>
        {ticks.map((f) => { const x = freqToX(f, view, width); return (
          <span key={f} style={{ left: x }}><i className="tick-x" style={{ left: '50%', top: -6 }} />{f}</span>) })}
      </div>
      <div />
      {cursor !== null && <div className="cursor-readout">{cursor.toFixed(1)} Hz · bin {Math.round(cursor / fBin)}</div>}
    </div>
  )
}
