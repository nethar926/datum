import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { GramConfig } from '../engine/contract'
import type { SimClient } from '../engine/client'
import type { PaletteId } from '../gl/colormap'
import { agoFromY, timeTickAges, yFromAgo, type GramDir, DEFAULT_GRAM_DIR } from './timeAxis'
import { formatZuluHms } from '../touch/scrollBack'
import {
  BT_BINS, BT_EMPTY_LABEL, BT_MAX_ROWS, BT_WINDOW_S, BT_ZOOM_WINDOWS_S, BtRing,
  applyBtSeekClear, axisFracToBearing, bearingRateDegPerS, bearingToAxisFrac,
  appendBtEntries, btAxisTicks, btOverlayBars, btRowFromEngine, btTimeAxisMinWidthPx, drawBtOverlays,
  fillBtRingFromHistory, formatBtCursor, lutForPalette, paintBtRgba, wrapBearingDeg,
  type BtLineOverlay, type BtMark, type BtZoomS,
} from './bt'

interface Props {
  client: SimClient
  configs: GramConfig[]
  streamIndex: number
  palette?: PaletteId
  dir?: GramDir
  zuluOriginMs?: number
  nowS?: number
  available?: boolean
  /** Tactical / engine buoy id for this stream (rf channel). */
  buoyId?: number
}

type RingState = {
  ring: BtRing
  out: Uint8Array
  lastT: number
  entries: BtLineOverlay[]
}

/**
 * Main-display bearing-time mode: true bearing against time, gram colormap, DIFAR only.
 * Fills from engine `bearingEnergy` / `bearingEnergyHistory` rows (360 uint8, degrees true)
 * and overlays `bearingTime` entries as σ bars. Empty when the engine has posted no rows.
 */
export function BtPlot({
  client, configs, streamIndex, palette = 'green', dir = DEFAULT_GRAM_DIR,
  zuluOriginMs, nowS = 0, available = true, buoyId,
}: Props) {
  const cfg = configs[streamIndex] ?? configs[0]
  const id = buoyId ?? cfg?.channel ?? 0
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const histRef = useRef<RingState | null>(null)
  const rafRef = useRef(0)
  const imageRef = useRef<{ data: ImageData; rgba: Uint8ClampedArray; lut: Uint8Array; pal: PaletteId; w: number; h: number } | null>(null)
  const [width, setWidth] = useState(800)
  const [height, setHeight] = useState(400)
  const [zoomS, setZoomS] = useState<BtZoomS>(BT_WINDOW_S)
  const [centreOn, setCentreOn] = useState(false)
  const [hasData, setHasData] = useState(false)
  const [newestT, setNewestT] = useState(nowS)
  const [srcId, setSrcId] = useState(id)
  if (srcId !== id) { setSrcId(id); setHasData(false) }
  const [cursor, setCursor] = useState<{ bearingDeg: number; simS: number; x: number; y: number } | null>(null)
  const [anchor, setAnchor] = useState<BtMark | null>(null)
  const [mark, setMark] = useState<BtMark | null>(null)
  const dragRef = useRef<{ start: BtMark; x: number; y: number; moved: boolean } | null>(null)

  const period = 1 // engine energy cadence
  const rows = Math.min(BT_MAX_ROWS, Math.max(16, Math.ceil(BT_WINDOW_S / period) + 2))
  const centreDeg = 0
  const centre = centreOn ? centreDeg : null
  const origin = zuluOriginMs ?? 0
  const ch = cfg?.channel ?? 0

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const measure = () => {
      const yAxis = el.querySelector('.axis-y') as HTMLElement | null
      const xAxis = el.querySelector('.axis-x') as HTMLElement | null
      const gutter = yAxis?.offsetWidth || btTimeAxisMinWidthPx()
      setWidth(Math.max(1, el.clientWidth - gutter))
      setHeight(Math.max(1, el.clientHeight - (xAxis?.offsetHeight || 44)))
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    measure()
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    histRef.current = { ring: new BtRing(rows), out: new Uint8Array(BT_BINS), lastT: -Infinity, entries: [] }
    const off = client.onBearingBt((msg) => {
      const st = histRef.current
      if (!st) return
      const mineE = msg.energy.filter((r) => r.buoyId === id)
      const mineT = msg.entries.filter((e) => e.buoyId === id)
      if (msg.replace) {
        applyBtSeekClear(st.ring, msg)
        fillBtRingFromHistory(st.ring, mineE, st.out)
        st.entries = mineT.slice()
        st.lastT = mineE.length ? mineE[mineE.length - 1]!.t : -Infinity
        setHasData(st.ring.size > 0)
        if (st.ring.size) setNewestT(st.ring.timeAt(0))
        return
      }
      for (const row of mineE) {
        if (row.t <= st.lastT + 1e-9) continue
        btRowFromEngine(row, st.out)
        st.ring.push(st.out, row.t)
        st.lastT = row.t
      }
      const newest = mineE.length ? st.lastT : (mineT.length ? mineT[mineT.length - 1]!.t : st.lastT)
      appendBtEntries(st.entries, mineT, Number.isFinite(newest) ? newest : 0, BT_WINDOW_S)
      if (st.ring.size > 0) { setHasData(true); setNewestT(st.ring.timeAt(0)) }
    })
    return () => { off(); histRef.current = null }
  }, [client, rows, id])

  useEffect(() => {
    const c = canvasRef.current
    if (!c || !cfg) return
    const lut = lutForPalette(palette)
    const draw = () => {
      rafRef.current = requestAnimationFrame(draw)
      const ctx = c.getContext('2d')
      const st = histRef.current
      if (!ctx || !st) return
      const dpr = Math.max(1, window.devicePixelRatio || 1)
      const w = Math.max(1, Math.round((c.clientWidth || 1) * dpr))
      const h = Math.max(1, Math.round((c.clientHeight || 1) * dpr))
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h }
      let img = imageRef.current
      if (!img || img.w !== w || img.h !== h || img.pal !== palette) {
        const data = ctx.createImageData(w, h)
        img = { data, rgba: data.data, lut, pal: palette, w, h }
        imageRef.current = img
      }
      paintBtRgba(img.rgba, w, h, st.ring, {
        centreDeg: centre, lut: img.lut, dir, windowS: zoomS, rowPeriodS: period,
      })
      ctx.putImageData(img.data, 0, 0)
      const newest = st.ring.size ? st.ring.timeAt(0) : nowS
      const bars = btOverlayBars(st.entries, { buoyId: id, newest, windowS: zoomS })
      if (bars.length) {
        ctx.save()
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        drawBtOverlays(ctx, bars, {
          width: w / dpr, height: h / dpr, windowS: zoomS, dir, centreDeg: centre, dpr,
        })
        ctx.restore()
      }
    }
    rafRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafRef.current)
  }, [cfg, palette, centre, dir, zoomS, period, id, nowS])

  const brgTicks = useMemo(() => btAxisTicks(centre, width), [centre, width])
  const newest = hasData ? newestT : nowS
  const timeTicks = useMemo(() => timeTickAges(zoomS, height), [zoomS, height])

  const pointFromEvent = (e: ReactPointerEvent<HTMLCanvasElement>): { bearingDeg: number; simS: number; x: number; y: number } | null => {
    const c = canvasRef.current
    if (!c) return null
    const r = c.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    if (x < 0 || y < 0 || x > r.width || y > r.height) return null
    const bearingDeg = axisFracToBearing(x / Math.max(1, r.width), centre)
    const agoS = agoFromY(y, r.height, zoomS, dir)
    const tNewest = histRef.current?.ring.size ? histRef.current.ring.timeAt(0) : nowS
    return { bearingDeg, simS: tNewest - agoS, x, y }
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const p = pointFromEvent(e)
    setCursor(p)
    const drag = dragRef.current
    if (drag && p && Math.hypot(p.x - drag.x, p.y - drag.y) > 6) drag.moved = true
  }
  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const p = pointFromEvent(e)
    if (!p) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { start: { bearingDeg: p.bearingDeg, simS: p.simS }, x: p.x, y: p.y, moved: false }
    setCursor(p)
  }
  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const p = pointFromEvent(e)
    const drag = dragRef.current
    dragRef.current = null
    if (!p || !drag) return
    if (drag.moved) {
      setAnchor(drag.start)
      setMark({ bearingDeg: p.bearingDeg, simS: p.simS })
      return
    }
    if (!anchor) { setAnchor({ bearingDeg: p.bearingDeg, simS: p.simS }); setMark(null); return }
    if (!mark) { setMark({ bearingDeg: p.bearingDeg, simS: p.simS }); return }
    setAnchor(null)
    setMark(null)
  }

  const brgRate = anchor && (mark || cursor)
    ? bearingRateDegPerS(anchor, mark ?? { bearingDeg: cursor!.bearingDeg, simS: cursor!.simS })
    : null
  const showRate = brgRate != null && !!(anchor && (mark || cursor))
  const readout = cursor
    ? formatBtCursor(cursor.bearingDeg, cursor.simS, origin, showRate ? brgRate : null)
    : (anchor && mark && brgRate != null ? formatBtCursor(mark.bearingDeg, mark.simS, origin, brgRate) : null)
  const ctrLabel = centreOn ? ` · ctr ${String(Math.round(wrapBearingDeg(centreDeg)) % 360).padStart(3, '0')}°` : ''
  const label = `BT · 0–360° true · ${zoomS / 60} min${ctrLabel} · B${ch}`

  return (
    <div className="gram bt-plot" ref={boxRef} data-testid="bt-frame" role="img" aria-label={label} data-dir={dir} data-available={available ? '1' : '0'} data-empty={hasData ? '0' : '1'}>
      <canvas
        ref={canvasRef}
        data-testid="bt-canvas"
        onPointerMove={onPointerMove}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerLeave={() => { if (!dragRef.current) setCursor(null) }}
      />
      <div className="axis axis-y" data-testid="bt-time-axis" aria-hidden>
        {timeTicks.map((ago) => {
          const top = (yFromAgo(ago, height, zoomS, dir) / Math.max(1, height)) * 100
          const sim = newest - ago
          return (
            <span key={ago} style={{ top: `clamp(9px, ${top}%, calc(100% - 9px))` }}>
              {formatZuluHms(sim, origin)}
            </span>
          )
        })}
      </div>
      <div className="axis axis-x" data-testid="bt-brg-axis" aria-hidden>
        {brgTicks.map((t) => (
          <span key={`${t.frac}-${t.deg}-${t.label}`} data-align={t.align} style={{ left: t.left }}>
            <i className="tick-x" style={{ top: -6 }} />{t.label}
          </span>
        ))}
      </div>
      <div className="bt-label" data-testid="bt-label">{label}</div>
      <div className="bt-controls">
        <div className="seg ios-seg" role="group" aria-label="BT history zoom" data-testid="bt-zoom">
          {BT_ZOOM_WINDOWS_S.map((s) => (
            <button key={s} type="button" aria-pressed={zoomS === s} data-testid={`bt-zoom-${s}`}
              disabled={!available} onClick={() => setZoomS(s)}>{s / 60} min</button>
          ))}
        </div>
        <div className="seg ios-seg" role="group" aria-label="BT axis centre" data-testid="bt-centre">
          <button type="button" aria-pressed={centreOn} data-testid="bt-centre-000"
            disabled={!available} onClick={() => setCentreOn((v) => !v)}
            title="Centre the axis on 000° so a track near north does not wrap">Centre 000</button>
        </div>
      </div>
      {readout && <div className="bt-readout" data-testid="bt-readout">{readout}</div>}
      {!hasData && <div className="bt-empty" data-testid="bt-empty">{BT_EMPTY_LABEL}</div>}
    </div>
  )
}
