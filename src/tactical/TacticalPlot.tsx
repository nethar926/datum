import { useEffect, useRef } from 'react'
import type { SimClient } from '../engine/client'
import { crossFixes } from './fix'
import { fitView, toScreenX, toScreenY } from './transform'

// Only confident DIFAR lines are drawn, to keep the plot readable (lines arrive strongest-first, up to 8 per buoy).
const MIN_DRAW_Q = 10

interface Props { client: SimClient; showTruth: boolean; spanM?: number; selectedChannel?: number }

/** Tactical plot: aircraft track, buoys (omni / DIFAR), DIFAR bearing lines, cross-fixes, optional truth. Canvas 2D. */
export function TacticalPlot({ client, showTruth, spanM = 18000, selectedChannel }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const props = useRef({ showTruth, spanM, selectedChannel })
  props.current = { showTruth, spanM, selectedChannel }

  useEffect(() => {
    const canvas = ref.current!
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const css = getComputedStyle(document.documentElement)
    const col = (n: string) => css.getPropertyValue(n).trim() || '#888'
    const C = { bg: col('--plot-bg'), grid: col('--plot-grid'), ac: col('--plot-aircraft'), buoy: col('--plot-buoy'), dead: col('--plot-buoy-dead'), brg: col('--plot-bearing'), fix: col('--plot-fix'), truth: col('--plot-truth'), text: col('--phosphor-dim') }
    const p = { x: 0, y: 0 }
    let raf = 0, lastT = -1, lastKey = ''
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const st = client.status, t = st.tactical
      const { showTruth: truth, spanM: span, selectedChannel: sel } = props.current
      const dpr = Math.min(2, devicePixelRatio || 1)
      const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr)
      const key = `${w}x${h}:${truth}:${span}:${sel}`
      if (t?.simT === lastT && key === lastKey) return
      lastT = t?.simT ?? -1; lastKey = key
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
      const v = fitView(w, h, span)
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, w, h)
      // Range rings every 2 km + grid.
      ctx.strokeStyle = C.grid; ctx.lineWidth = 1 * dpr
      for (let r = 2000; r <= span; r += 2000) { ctx.beginPath(); ctx.arc(toScreenX(v, 0), toScreenY(v, 0), r / v.mPerPx, 0, Math.PI * 2); ctx.stroke() }
      ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke()
      ctx.font = `${10 * dpr}px ui-monospace, Menlo, monospace`; ctx.fillStyle = C.text
      ctx.fillText('N', w / 2 + 4 * dpr, 12 * dpr); ctx.fillText('2 km rings', 8 * dpr, h - 8 * dpr)
      if (!t) return

      // Bearing lines.
      const reach = span * 1.5
      ctx.strokeStyle = C.brg; ctx.lineWidth = 1 * dpr
      for (const b of t.bearings) {
        const buoy = t.buoys.find((x) => x.id === b.buoyId); if (!buoy || b.quality < MIN_DRAW_Q) continue
        const th = (b.brgDeg * Math.PI) / 180
        ctx.globalAlpha = Math.min(1, 0.25 + b.quality / 30)
        ctx.beginPath(); ctx.moveTo(toScreenX(v, buoy.x), toScreenY(v, buoy.y))
        ctx.lineTo(toScreenX(v, buoy.x + Math.sin(th) * reach), toScreenY(v, buoy.y + Math.cos(th) * reach)); ctx.stroke()
      }
      ctx.globalAlpha = 1

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
      for (const f of crossFixes(t.bearings, t.buoys, 1.5, MIN_DRAW_Q)) {
        const sx = toScreenX(v, f.x), sy = toScreenY(v, f.y), r = 6 * dpr
        ctx.beginPath(); ctx.moveTo(sx - r, sy - r); ctx.lineTo(sx + r, sy + r); ctx.moveTo(sx + r, sy - r); ctx.lineTo(sx - r, sy + r); ctx.stroke()
        ctx.fillStyle = C.fix; ctx.fillText(`${f.freqHz.toFixed(0)}Hz`, sx + 8 * dpr, sy - 6 * dpr)
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

  return <canvas ref={ref} data-testid="tactical" aria-label="Tactical plot" />
}
