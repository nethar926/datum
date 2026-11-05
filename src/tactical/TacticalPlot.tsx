import { useEffect, useRef } from 'react'
import type { SimClient } from '../engine/client'
import type { Bearing, TacticalBuoy } from '../engine/contract'
import { crossFixes } from './fix'
import { LONG_PRESS_MS, capDpr, exceedsSlop } from '../touch/gestures'
import { fitView, toScreenX, toScreenY, toWorld, type PlotView } from './transform'
import { bearingTo, distToRay, fixInputs, type FixSource, type ManualBearings } from './manual'

// Only confident DIFAR lines are drawn, to keep the plot readable (lines arrive strongest-first, up to 8 per buoy).
const MIN_DRAW_Q = 10
// Bearing lines are drawn to a finite length and fade out toward the end.
const BEARING_LEN_M = 7000
const SEL_TOL_HZ = 1.5

interface Props {
  client: SimClient; showTruth: boolean; spanM?: number; selectedChannel?: number; selectedHz?: number | null; allBearings?: boolean
  showAuto?: boolean; showManual?: boolean; manual?: ManualBearings; fixSource?: FixSource
  /** Manual cursor moved (final=false while dragging, true on release); deg null clears it. */
  onManual?: (buoyId: number, deg: number | null, final: boolean) => void
}
const HIT_PX = 14
// Fingers need a 44 pt target: 22 px radius on coarse pointers.
const hitPx = () => (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? 22 : HIT_PX)

/** Tactical plot: aircraft track, buoys (omni / DIFAR), DIFAR bearing lines, cross-fixes, optional truth. Canvas 2D. */
export function TacticalPlot({ client, showTruth, spanM = 18000, selectedChannel, selectedHz = null, allBearings = false, showAuto = true, showManual = true, manual = {}, fixSource = 'both', onManual }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const props = useRef({ showTruth, spanM, selectedChannel, selectedHz, allBearings, showAuto, showManual, manual, fixSource })
  props.current = { showTruth, spanM, selectedChannel, selectedHz, allBearings, showAuto, showManual, manual, fixSource }
  const viewRef = useRef<PlotView | null>(null)
  const dragRef = useRef<number | null>(null)
  // Long-press a DIFAR buoy (touch stand-in for double-click) clears its manual bearing.
  const press = useRef<{ x: number; y: number; moved: boolean; timer: number } | null>(null)

  useEffect(() => {
    const canvas = ref.current!
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const css = getComputedStyle(document.documentElement)
    const col = (n: string) => css.getPropertyValue(n).trim() || '#888'
    const C = { bg: col('--plot-bg'), grid: col('--plot-grid'), ac: col('--plot-aircraft'), buoy: col('--plot-buoy'), dead: col('--plot-buoy-dead'), brg: col('--plot-bearing'), fix: col('--plot-fix'), truth: col('--plot-truth'), man: col('--plot-manual'), text: col('--phosphor-dim') }
    const p = { x: 0, y: 0 }
    let raf = 0, lastT = -1, lastKey = ''
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const st = client.status, t = st.tactical
      const { showTruth: truth, spanM: span, selectedChannel: sel, selectedHz: selHz, allBearings: all, showAuto: sa, showManual: sm, manual: man, fixSource: fs } = props.current
      const dpr = capDpr(devicePixelRatio)
      const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr)
      const key = `${w}x${h}:${truth}:${span}:${sel}:${selHz}:${all}:${sa}:${sm}:${fs}:${JSON.stringify(man)}`
      if (t?.simT === lastT && key === lastKey) return
      lastT = t?.simT ?? -1; lastKey = key
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
      const v = fitView(w, h, span)
      viewRef.current = v
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, w, h)
      // Range rings every 2 km + grid.
      ctx.strokeStyle = C.grid; ctx.lineWidth = 1 * dpr
      for (let r = 2000; r <= span; r += 2000) { ctx.beginPath(); ctx.arc(toScreenX(v, 0), toScreenY(v, 0), r / v.mPerPx, 0, Math.PI * 2); ctx.stroke() }
      ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke()
      ctx.font = `${10 * dpr}px ui-monospace, Menlo, monospace`; ctx.fillStyle = C.text
      ctx.fillText('N', w / 2 + 4 * dpr, 12 * dpr); ctx.fillText('2 km rings', 8 * dpr, h - 8 * dpr)
      if (!t) return

      // Bearing lines: by default only those for the selected tonal (picked on the LOFAR, or the
      // selected buoy's strongest line), all of them as a toggle. Finite length, fading.
      const shown = selectBearings(t.bearings, t.buoys, sel, selHz, all)
      ctx.lineWidth = 1 * dpr
      for (const b of sa ? shown : []) {
        const buoy = t.buoys.find((x) => x.id === b.buoyId)!
        const th = (b.brgDeg * Math.PI) / 180
        const x0 = toScreenX(v, buoy.x), y0 = toScreenY(v, buoy.y)
        const x1 = toScreenX(v, buoy.x + Math.sin(th) * BEARING_LEN_M), y1 = toScreenY(v, buoy.y + Math.cos(th) * BEARING_LEN_M)
        const g = ctx.createLinearGradient(x0, y0, x1, y1)
        g.addColorStop(0, C.brg); g.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.strokeStyle = g; ctx.globalAlpha = Math.min(1, 0.35 + b.quality / 30)
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke()
      }
      ctx.globalAlpha = 1

      // Manual bearing cursors: dashed, operator colour, diamond mark and bearing readout at the end.
      if (sm) {
        ctx.strokeStyle = C.man; ctx.fillStyle = C.man; ctx.lineWidth = 1.5 * dpr; ctx.setLineDash([6 * dpr, 4 * dpr])
        for (const b of t.buoys) {
          const deg = man[b.id]; if (deg === undefined || b.kind !== 'difar') continue
          const th = (deg * Math.PI) / 180
          const x0 = toScreenX(v, b.x), y0 = toScreenY(v, b.y)
          const x1 = toScreenX(v, b.x + Math.sin(th) * BEARING_LEN_M), y1 = toScreenY(v, b.y + Math.cos(th) * BEARING_LEN_M)
          ctx.globalAlpha = b.state === 'live' ? 0.95 : 0.35
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke()
          ctx.setLineDash([]); const r = 4 * dpr
          ctx.beginPath(); ctx.moveTo(x1, y1 - r); ctx.lineTo(x1 + r, y1); ctx.lineTo(x1, y1 + r); ctx.lineTo(x1 - r, y1); ctx.closePath(); ctx.fill()
          ctx.fillText(`M${String(Math.round(deg) % 360).padStart(3, '0')}`, x1 + 6 * dpr, y1 - 6 * dpr)
          ctx.setLineDash([6 * dpr, 4 * dpr])
        }
        ctx.setLineDash([]); ctx.globalAlpha = 1
      }

      // Aircraft track + symbol.
      const tr = client.track
      if (tr.count > 1) {
        ctx.strokeStyle = C.ac; ctx.globalAlpha = 0.5; ctx.lineWidth = 1.5 * dpr; ctx.beginPath()
        for (let i = 0; i < tr.count; i++) { tr.at(i, p); const sx = toScreenX(v, p.x), sy = toScreenY(v, p.y); if (i) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy) }
        ctx.stroke(); ctx.globalAlpha = 1
      }
      const ax = toScreenX(v, t.aircraft.x), ay = toScreenY(v, t.aircraft.y), hd = (t.aircraft.hdgDeg * Math.PI) / 180
      ctx.save(); ctx.translate(ax, ay); ctx.rotate(hd); ctx.fillStyle = C.ac
      ctx.beginPath(); ctx.moveTo(0, -8 * dpr); ctx.lineTo(6 * dpr, 6 * dpr); ctx.lineTo(0, 3 * dpr); ctx.lineTo(-6 * dpr, 6 * dpr); ctx.closePath(); ctx.fill(); ctx.restore()

      // Buoys.
      for (const b of t.buoys) {
        const sx = toScreenX(v, b.x), sy = toScreenY(v, b.y), r = 5 * dpr
        ctx.strokeStyle = b.state === 'live' ? C.buoy : C.dead; ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = (b.channel === sel ? 2.5 : 1.5) * dpr
        ctx.beginPath()
        if (b.kind === 'difar') { ctx.moveTo(sx, sy - r); ctx.lineTo(sx + r, sy + r); ctx.lineTo(sx - r, sy + r); ctx.closePath() } else ctx.arc(sx, sy, r, 0, Math.PI * 2)
        if (b.state === 'falling') ctx.setLineDash([2 * dpr, 2 * dpr])
        ctx.stroke(); ctx.setLineDash([])
        ctx.fillText(String(b.channel), sx + 8 * dpr, sy + 4 * dpr)
      }

      // Cross-fixes from DIFAR lines.
      ctx.strokeStyle = C.fix; ctx.lineWidth = 1.5 * dpr
      for (const f of crossFixes(fixInputs(shown, sm ? man : {}, t.buoys, fs, selHz), t.buoys, SEL_TOL_HZ, MIN_DRAW_Q)) {
        const sx = toScreenX(v, f.x), sy = toScreenY(v, f.y), r = 6 * dpr
        ctx.beginPath(); ctx.moveTo(sx - r, sy - r); ctx.lineTo(sx + r, sy + r); ctx.moveTo(sx + r, sy - r); ctx.lineTo(sx - r, sy + r); ctx.stroke()
        ctx.fillStyle = C.fix; ctx.fillText(f.freqHz < 0 ? 'MAN' : `${f.freqHz.toFixed(0)}Hz`, sx + 8 * dpr, sy - 6 * dpr)
      }

      // Truth (instructor view).
      if (truth && t.truth) {
        ctx.strokeStyle = C.truth; ctx.fillStyle = C.truth; ctx.lineWidth = 1 * dpr
        for (const c of t.truth.contacts) {
          const sx = toScreenX(v, c.x), sy = toScreenY(v, c.y), th = (c.crsDeg * Math.PI) / 180
          ctx.beginPath(); ctx.rect(sx - 4 * dpr, sy - 4 * dpr, 8 * dpr, 8 * dpr); ctx.moveTo(sx, sy)
          ctx.lineTo(sx + Math.sin(th) * 18 * dpr, sy - Math.cos(th) * 18 * dpr); ctx.stroke()
          ctx.fillText(`T${c.id}`, sx + 8 * dpr, sy + 12 * dpr)
        }
      }
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [client])

  // Manual cursors: press on a DIFAR buoy or its manual line and drag to set its bearing; double-click a buoy to clear.
  const world = (e: React.PointerEvent | React.MouseEvent) => {
    const v = viewRef.current, c = ref.current; if (!v || !c) return null
    const rect = c.getBoundingClientRect(), dpr = c.width / Math.max(1, rect.width)
    return { ...toWorld(v, (e.clientX - rect.left) * dpr, (e.clientY - rect.top) * dpr), mPerPx: v.mPerPx * dpr }
  }
  const hitBuoy = (e: React.PointerEvent | React.MouseEvent) => {
    const w = world(e), t = client.status.tactical; if (!w || !t) return null
    let best: { id: number; d: number } | null = null
    for (const b of t.buoys) {
      if (b.kind !== 'difar' || b.state !== 'live') continue
      const dBuoy = Math.hypot(w.x - b.x, w.y - b.y) / w.mPerPx
      const deg = props.current.manual[b.id]
      const dLine = deg === undefined ? Infinity : distToRay(b, deg, BEARING_LEN_M, w.x, w.y) / w.mPerPx
      const d = Math.min(dBuoy, dLine)
      if (d <= hitPx() && (!best || d < best.d)) best = { id: b.id, d }
    }
    return best && { id: best.id, w }
  }
  const setFrom = (id: number, wx: number, wy: number, final: boolean) => {
    const b = client.status.tactical?.buoys.find((x) => x.id === id); if (!b) return
    const deg = bearingTo(b, wx, wy); if (deg !== null) onManual?.(id, deg, final)
  }
  return (
    <canvas ref={ref} data-testid="tactical" aria-label="Tactical plot"
      style={{ cursor: onManual ? 'crosshair' : undefined, touchAction: 'none' }}
      onPointerDown={(e) => {
        const h = hitBuoy(e); if (!h || !onManual) return
        dragRef.current = h.id; try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* synthetic pointer */ }
        const id = h.id, pr = { x: e.clientX, y: e.clientY, moved: false, timer: 0 }
        pr.timer = window.setTimeout(() => { if (!pr.moved && dragRef.current === id) { dragRef.current = null; onManual(id, null, true) } }, LONG_PRESS_MS)
        press.current = pr
      }}
      onPointerMove={(e) => {
        const id = dragRef.current; if (id === null) return
        const pr = press.current
        if (pr && !pr.moved) { if (!exceedsSlop(pr.x, pr.y, e.clientX, e.clientY)) return; pr.moved = true; clearTimeout(pr.timer) }
        const w = world(e); if (w) setFrom(id, w.x, w.y, false)
      }}
      onPointerUp={(e) => { const id = dragRef.current; dragRef.current = null; const pr = press.current; press.current = null; if (pr) clearTimeout(pr.timer); if (id === null || !pr?.moved) return; const w = world(e); if (w) setFrom(id, w.x, w.y, true) }}
      onPointerCancel={() => { dragRef.current = null; if (press.current) clearTimeout(press.current.timer); press.current = null }}
      onContextMenu={(e) => e.preventDefault()}
      onDoubleClick={(e) => { const h = hitBuoy(e); if (h) onManual?.(h.id, null, true) }} />
  )
}

/**
 * Which DIFAR lines to draw. all: every confident line. Otherwise lines within SEL_TOL_HZ of the selected
 * frequency; with no frequency picked, the strongest line on the selected buoy sets it.
 */
export function selectBearings(bearings: Bearing[], buoys: TacticalBuoy[], selChannel: number | undefined, selHz: number | null, all: boolean): Bearing[] {
  const live = bearings.filter((b) => b.quality >= MIN_DRAW_Q && buoys.some((x) => x.id === b.buoyId && x.state !== 'dead'))
  if (all) return live
  let hz = selHz
  if (hz === null) {
    const buoy = buoys.find((x) => x.channel === selChannel)
    let best: Bearing | undefined
    for (const b of live) if (b.buoyId === buoy?.id && (!best || b.quality > best.quality)) best = b
    if (!best) return []
    hz = best.freqHz
  }
  return live.filter((b) => Math.abs(b.freqHz - hz) <= SEL_TOL_HZ)
}
