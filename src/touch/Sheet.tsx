import { useEffect, useRef, useState } from 'react'

/**
 * Bottom sheet (phones): slides up over a scrim, grab handle on top. Tap the scrim, press Escape or swipe the
 * handle down to close. Transform/opacity only, so it animates on the compositor at 60 fps.
 */
export function Sheet({ open, onClose, title, children, testId }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; testId?: string }) {
  const [shown, setShown] = useState(open)
  const [dy, setDy] = useState(0)
  const drag = useRef<{ y: number } | null>(null)
  // Stay mounted for the slide-down, then unmount (timer, not transitionend: that never fires if reduced motion is on).
  useEffect(() => {
    if (open) { setShown(true); return }
    const t = window.setTimeout(() => setShown(false), 240)
    return () => clearTimeout(t)
  }, [open])
  // Mount closed, then open on the next frame so the slide-up transition runs.
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
  return (
    <div className={`sheet-root${open && entered ? ' open' : ''}`}>
      <div className="sheet-scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-label={title} data-testid={testId}
        style={dy ? { transform: `translateY(${dy}px)`, transition: 'none' } : undefined}>
        <div className="sheet-grab" aria-hidden
          onPointerDown={(e) => { drag.current = { y: e.clientY }; e.currentTarget.setPointerCapture(e.pointerId) }}
          onPointerMove={(e) => { if (drag.current) setDy(Math.max(0, e.clientY - drag.current.y)) }}
          onPointerUp={() => { const close = dy > 80; drag.current = null; setDy(0); if (close) onClose() }}
          onPointerCancel={() => { drag.current = null; setDy(0) }}><i /></div>
        <div className="sheet-head"><h2>{title}</h2><button className="btn icon" onClick={onClose} aria-label={`Close ${title}`}>✕</button></div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  )
}
