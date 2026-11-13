import { useEffect, useRef } from 'react'
import type { DepthUnit } from '../displayUnits'
import { btGlyphLabel, btMarkers, formatBtDepth, type BtDrop } from './btStyle'

/** SSP / temperature-vs-depth for a selected BT drop. Depth increases downward. */
export function BtProfileView({ drop, unit, onClose }: { drop: BtDrop; unit: DepthUnit; onClose?: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const dpr = Math.max(1, window.devicePixelRatio || 1)
    const w = 244, h = 180
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr)
    canvas.style.width = `${w}px`; canvas.style.height = `${h}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    const samples = drop.profile.profile
    if (!samples.length) return
    const padL = 36, padR = 8, padT = 14, padB = 8
    const plot = { x: padL, y: padT, w: w - padL - padR, h: h - padT - padB }
    const z0 = samples[0]!.depthM, z1 = Math.max(z0 + 1, samples[samples.length - 1]!.depthM)
    const tMin = Math.min(...samples.map((s) => s.tempC)), tMax = Math.max(...samples.map((s) => s.tempC))
    const cMin = Math.min(...samples.map((s) => s.cMps)), cMax = Math.max(...samples.map((s) => s.cMps))
    const y = (z: number) => plot.y + plot.h * (z - z0) / (z1 - z0)
    const xT = (t: number) => plot.x + plot.w * (t - tMin) / Math.max(1e-6, tMax - tMin)
    const xC = (c: number) => plot.x + plot.w * (c - cMin) / Math.max(1e-6, cMax - cMin)
    ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.strokeRect(plot.x, plot.y, plot.w, plot.h)
    ctx.font = '10px ui-sans-serif, system-ui'
    ctx.setLineDash([3, 3]); ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.textAlign = 'right'
    for (const m of btMarkers(drop.profile)) {
      const yy = y(m.depthM)
      ctx.beginPath(); ctx.moveTo(plot.x, yy); ctx.lineTo(plot.x + plot.w, yy); ctx.stroke()
      ctx.fillText(`${m.label} ${formatBtDepth(m.depthM, unit)}`, plot.x + plot.w - 2, yy - 2)
    }
    ctx.setLineDash([]); ctx.textAlign = 'left'
    ctx.beginPath()
    samples.forEach((s, i) => { i === 0 ? ctx.moveTo(xT(s.tempC), y(s.depthM)) : ctx.lineTo(xT(s.tempC), y(s.depthM)) })
    ctx.strokeStyle = 'rgb(255,178,89)'; ctx.lineWidth = 1.6; ctx.stroke()
    ctx.beginPath()
    samples.forEach((s, i) => { i === 0 ? ctx.moveTo(xC(s.cMps), y(s.depthM)) : ctx.lineTo(xC(s.cMps), y(s.depthM)) })
    ctx.strokeStyle = 'rgb(102,217,255)'; ctx.lineWidth = 1.6; ctx.stroke()
    ctx.fillStyle = 'rgb(255,178,89)'; ctx.fillText('T °C', plot.x, 10)
    ctx.fillStyle = 'rgb(102,217,255)'; ctx.textAlign = 'right'; ctx.fillText('c m/s', plot.x + plot.w, 10)
    ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(255,255,255,0.7)'
    ctx.fillText(formatBtDepth(z0, unit), 2, plot.y + 8)
    ctx.fillText(formatBtDepth(z1, unit), 2, plot.y + plot.h)
  }, [drop, unit])
  return (
    <div className="bt-profile" data-testid="bt-profile" style={{
      width: 260, padding: 8, borderRadius: 10, background: 'rgba(0,0,0,0.82)',
      border: '1px solid rgba(255,255,255,0.18)', color: '#fff',
    }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
        <strong style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 }}>{btGlyphLabel(drop.id)}</strong>
        <span style={{ fontSize: 12, fontWeight: 600 }}>BT / SSP</span>
        <button type="button" aria-label="Close BT profile" onClick={onClose} style={{ marginLeft: 'auto', background: 'none', color: 'inherit', border: 0 }}>×</button>
      </div>
      <canvas ref={ref} />
      {drop.profile.outOfRange ? <div style={{ fontSize: 10, color: 'orange' }}>Clamped (Mackenzie range)</div> : null}
    </div>
  )
}
