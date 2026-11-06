import { useEffect, useRef, useState } from 'react'
import { DEFAULT_WHEEL, WHEEL_LOOKS, WHEEL_SECTORS, WHEEL_STEPS, sectorOf, type DifarWheelSettings, type WheelLook } from '../gl/colormap'
import { wheelConic } from './DifarLegend'
import { normRot, showsSectorDivisions, toggleSector } from './wheelSettings'

const LOOK_LABEL: Record<WheelLook, string> = { full: 'Full', pastel: 'Pastel', bw: 'B&W', green: 'Green' }
const STEP_LABEL = (s: number) => (s === 360 ? '360°' : `${s}`)
const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
const R = 110, RI = 46 // wheel radius / inner hole (px, SVG units)

function wedge(i: number): string {
  const a0 = ((i * 22.5 - 11.25 - 90) * Math.PI) / 180, a1 = ((i * 22.5 + 11.25 - 90) * Math.PI) / 180
  const p = (r: number, a: number) => `${(R + r * Math.cos(a)).toFixed(2)} ${(R + r * Math.sin(a)).toFixed(2)}`
  return `M ${p(RI, a0)} L ${p(R, a0)} A ${R} ${R} 0 0 1 ${p(R, a1)} L ${p(RI, a1)} A ${RI} ${RI} 0 0 0 ${p(RI, a0)} Z`
}

interface Props { wheel: DifarWheelSettings; onChange: (w: DifarWheelSettings) => void; onClose: () => void }

/** DIFAR wheel applet: drag to rotate the colours, tap sectors to null or isolate, pick bearing steps and look. */
export function DifarApplet({ wheel, onChange, onClose }: Props) {
  const [tool, setTool] = useState<'null' | 'isolate'>('null')
  const [closing, setClosing] = useState(false)
  const drag = useRef<{ id: number; a0: number; rot0: number; moved: boolean; x: number; y: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const closingRef = useRef(false)
  const requestClose = () => {
    if (closingRef.current) return
    closingRef.current = true
    setClosing(true)
    window.setTimeout(onClose, 180)
  }
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || closingRef.current) return
      closingRef.current = true
      setClosing(true)
      window.setTimeout(onClose, 180)
    }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [onClose])

  const angleAt = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect(), x = e.clientX - r.left - r.width / 2, y = e.clientY - r.top - r.height / 2
    return { deg: (Math.atan2(x, -y) * 180) / Math.PI, rad: Math.hypot(x, y) / (r.width / 2) }
  }
  const onDown = (e: React.PointerEvent) => {
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* synthetic or already-released pointer */ }
    drag.current = { id: e.pointerId, a0: angleAt(e).deg, rot0: wheel.rotDeg, moved: false, x: e.clientX, y: e.clientY }
  }
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d || d.id !== e.pointerId) return
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return
    d.moved = true
    // Dragging clockwise carries the colours clockwise: red follows the finger.
    onChange({ ...wheel, rotDeg: normRot(d.rot0 + (angleAt(e).deg - d.a0)) })
  }
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current; drag.current = null
    if (!d || d.moved) return
    const { deg, rad } = angleAt(e)
    if (rad >= RI / R && rad <= 1.02) onChange(toggleSector(wheel, sectorOf(deg), tool))
  }
  const rot = (delta: number) => onChange({ ...wheel, rotDeg: normRot(wheel.rotDeg + delta) })
  const nN = popcount(wheel.nulled), nI = popcount(wheel.isolated)

  const divisions = showsSectorDivisions(wheel.steps)
  return (
    <div className={`difar-applet-scrim${closing ? ' closing' : ''}`} onPointerDown={(e) => { if (e.target === e.currentTarget) requestClose() }}>
      <div className={`difar-applet${closing ? ' closing' : ''}`} role="dialog" aria-label="DIFAR bearing wheel" data-testid="difar-applet">
        <div className="da-head">
          <span>DIFAR WHEEL</span>
          <button className="btn icon" onClick={requestClose} aria-label="Close" data-testid="difar-applet-close">✕</button>
        </div>
        <div className="da-wheel" ref={ref} data-testid="difar-applet-wheel" data-steps={wheel.steps}
          data-divisions={divisions ? '1' : '0'}
          style={{ background: wheelConic(wheel) }}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { drag.current = null }}>
          <svg viewBox={`0 0 ${2 * R} ${2 * R}`} aria-hidden="true">
            {Array.from({ length: WHEEL_SECTORS }, (_, i) => {
              const b = 1 << i, cls = wheel.nulled & b ? 'nulled' : wheel.isolated & b ? 'isolated' : ''
              const nodiv = !divisions && !cls ? ' nodiv' : ''
              return <path key={i} d={wedge(i)} className={`${cls}${nodiv}`.trim()} data-sector={i} data-div={nodiv ? '0' : '1'} />
            })}
          </svg>
          <div className="da-hub">
            <b>RED</b><span data-testid="difar-applet-rot">{String(wheel.rotDeg).padStart(3, '0')}°</span>
          </div>
          {['N', 'E', 'S', 'W'].map((c) => <em key={c} className={`da-c ${c.toLowerCase()}`}>{c}</em>)}
        </div>
        <div className="da-hint">Drag to rotate · tap a sector to {tool === 'null' ? 'null it' : 'isolate it'}</div>

        <div className="da-row">
          <span className="seg-label">TAP</span>
          <div className="seg" role="group" aria-label="Sector tool">
            <button aria-pressed={tool === 'null'} onClick={() => setTool('null')} data-testid="da-tool-null">Null{nN ? ` ${nN}` : ''}</button>
            <button aria-pressed={tool === 'isolate'} onClick={() => setTool('isolate')} data-testid="da-tool-isolate">Isolate{nI ? ` ${nI}` : ''}</button>
          </div>
          <button className="btn" disabled={!nN && !nI} onClick={() => onChange({ ...wheel, nulled: 0, isolated: 0 })}>Clear</button>
        </div>
        <div className="da-row">
          <span className="seg-label">ROTATE</span>
          <div className="seg" role="group" aria-label="Rotate wheel">
            <button onClick={() => rot(-15)} aria-label="Rotate −15°">−15</button>
            <button onClick={() => onChange({ ...wheel, rotDeg: 0 })} aria-pressed={wheel.rotDeg === 0} title="North red">N red</button>
            <button onClick={() => rot(15)} aria-label="Rotate +15°">+15</button>
          </div>
        </div>
        <div className="da-row">
          <span className="seg-label">STEPS</span>
          <div className="seg" role="group" aria-label="Bearing steps" data-testid="da-steps">
            {WHEEL_STEPS.map((s) => <button key={s} aria-pressed={wheel.steps === s} onClick={() => onChange({ ...wheel, steps: s })}>{STEP_LABEL(s)}</button>)}
          </div>
        </div>
        <div className="da-row">
          <span className="seg-label">LOOK</span>
          <div className="seg" role="group" aria-label="Wheel look" data-testid="da-look">
            {WHEEL_LOOKS.map((l) => <button key={l} aria-pressed={wheel.look === l} onClick={() => onChange({ ...wheel, look: l })}>{LOOK_LABEL[l]}</button>)}
          </div>
        </div>
        <div className="da-foot">
          <span className="da-sum">{summary(wheel)}</span>
          <button className="btn" onClick={() => onChange(DEFAULT_WHEEL)} data-testid="da-reset">Reset</button>
        </div>
      </div>
    </div>
  )
}

function popcount(m: number) { let n = 0; for (let x = m; x; x &= x - 1) n++; return n }
function names(m: number) { return POINTS.filter((_, i) => m & (1 << i)).join(' ') }
export function summary(w: DifarWheelSettings): string {
  const parts = [`${w.steps === 360 ? 'CONT' : `${w.steps} STEP`}`, LOOK_LABEL[w.look].toUpperCase()]
  if (w.rotDeg) parts.push(`RED ${String(w.rotDeg).padStart(3, '0')}°`)
  if (w.isolated) parts.push(`ISO ${names(w.isolated)}`)
  if (w.nulled) parts.push(`NULL ${names(w.nulled)}`)
  return parts.join(' · ')
}
