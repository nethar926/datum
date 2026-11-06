import { useEffect, useRef, useState } from 'react'
import { IcClose } from '../ui/icons'

export type Detent = 'medium' | 'large'
/** Fraction of the viewport height each detent shows. */
const DETENT_FRAC: Record<Detent, number> = { medium: 0.52, large: 0.92 }

/**
 * iOS-style sheet: medium / large detents, a grabber, swipe down to dismiss (or tap the scrim / Escape / the close
 * button). The sheet is laid out at its large height and translated for the medium detent, so moving between
 * detents and the drag itself are transform-only (compositor, 60 fps). Glass chrome: translucent fill + specular
 * rim, but no backdrop-filter over this large area (perf).
 */
export function Sheet({ open, onClose, title, children, testId, detents = ['medium', 'large'], initial }: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode; testId?: string; detents?: Detent[]; initial?: Detent
}) {
  const [shown, setShown] = useState(open)
  const [detent, setDetent] = useState<Detent>(initial ?? detents[0])
  const [dy, setDy] = useState(0)
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ y: number; t: number; lastY: number; lastT: number; id: number } | null>(null)
  const moved = useRef(false)
  useEffect(() => {
    if (open) { setShown(true); setDetent(initial ?? detents[0]); return }
    const t = window.setTimeout(() => setShown(false), 240)
    return () => clearTimeout(t)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    if (!shown || !open) { setEntered(false); return }
    const r = requestAnimationFrame(() => setEntered(true)); return () => cancelAnimationFrame(r)
  }, [shown, open])
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [open, onClose])
  if (!shown) return null
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const largeH = Math.round(vh * DETENT_FRAC.large)
  const offsetFor = (d: Detent) => Math.round(largeH - vh * DETENT_FRAC[d])
  const base = offsetFor(detent)
  const onDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if ((e.target as HTMLElement).closest('.sheet-close')) return
    moved.current = false
    drag.current = { y: e.clientY, t: e.timeStamp, lastY: e.clientY, lastT: e.timeStamp, id: e.pointerId }
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch { /* synthetic */ }
    setDragging(true)
  }
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d || d.id !== e.pointerId) return
    const raw = e.clientY - d.y
    if (Math.abs(raw) > 4) moved.current = true
    // Above the large detent: rubber-band.
    const off = base + raw
    setDy(off < 0 ? raw - off + off * 0.2 : raw)
    d.lastY = e.clientY; d.lastT = e.timeStamp
  }
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current; if (!d || d.id !== e.pointerId) return
    drag.current = null; setDragging(false)
    if (!moved.current) { setDy(0); return }
    const raw = e.clientY - d.y, dt = Math.max(1, e.timeStamp - d.t), v = raw / dt // px/ms, + = down
    const pos = base + raw
    // Project a little along the fling, then pick the nearest detent (or dismiss below the smallest).
    const proj = pos + v * 120
    const minOff = Math.max(...detents.map(offsetFor))
    setDy(0)
    if (proj > minOff + Math.min(160, (vh * DETENT_FRAC[detents[0]]) * 0.35) || (v > 0.9 && raw > 30)) { onClose(); return }
    let best = detents[0], bd = Infinity
    for (const k of detents) { const dd = Math.abs(offsetFor(k) - proj); if (dd < bd) { bd = dd; best = k } }
    setDetent(best)
  }
  const ty = open && entered ? base + dy : largeH + 40
  return (
    <div className={`sheet-root${open && entered ? ' open' : ''}`}>
      <div className="sheet-scrim" onClick={onClose} style={detent === 'medium' && !dragging ? { opacity: 0.35 } : undefined} />
      <div className={`sheet glass-sheet${dragging ? ' dragging' : ''}`} role="dialog" aria-label={title} data-testid={testId} data-detent={detent}
        style={{ height: largeH, transform: `translateY(${ty}px)` }}>
        <div className="sheet-top" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <button type="button" className="sheet-grab" aria-label={detent === 'large' ? `Collapse ${title}` : `Expand ${title}`}
            onClick={() => { if (moved.current) { moved.current = false; return } if (detents.length > 1) setDetent(detent === 'large' ? 'medium' : 'large') }}><i /></button>
          <div className="sheet-head"><h2>{title}</h2><button type="button" className="sheet-close" onClick={onClose} aria-label={`Close ${title}`}><IcClose size={18} /></button></div>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  )
}
