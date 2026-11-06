/**
 * Phone-portrait plot grabber: a split-handle lookalike that slides the full-size plot up over the gram
 * with gram / half / plot detents, flick or tap, ~180 ms spring.
 */
import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import {
  DETENT_SPRING_MS, detentProgress, nextDetent, progressFromDrag, snapDetent, type PlotDetent,
} from './layoutMath'

export function PlotGrabber({
  detent, progress, onLive, onCommit,
}: {
  detent: PlotDetent
  /** Live progress while dragging (falls back to the detent's progress). */
  progress: number
  onLive: (p: number) => void
  onCommit: (d: PlotDetent) => void
}) {
  const drag = useRef<{ id: number; y0: number; p0: number; t0: number; lastY: number; lastT: number } | null>(null)
  const lastTap = useRef(0)

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.preventDefault()
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* synthetic */ }
    const now = e.timeStamp
    drag.current = { id: e.pointerId, y0: e.clientY, p0: progress, t0: now, lastY: e.clientY, lastT: now }
  }
  const travel = () => {
    // Full sheet travel ≈ the workspace height (parent .workspace).
    const ws = (document.querySelector('.workspace') as HTMLElement | null)
    return Math.max(1, ws?.getBoundingClientRect().height ?? window.innerHeight * 0.6)
  }
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current; if (!d || d.id !== e.pointerId) return
    const p = progressFromDrag(d.p0, e.clientY - d.y0, travel())
    d.lastY = e.clientY; d.lastT = e.timeStamp
    onLive(p)
  }
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current; if (!d || d.id !== e.pointerId) return
    drag.current = null
    const dy = e.clientY - d.y0
    const dt = Math.max(1, e.timeStamp - d.t0)
    if (Math.abs(dy) < 4) {
      // Tap (or double-tap): cycle detents. Double-tap jumps to the opposite end.
      if (e.timeStamp - lastTap.current < 320) {
        onCommit(detent === 'gram' ? 'plot' : 'gram')
        lastTap.current = 0
        return
      }
      lastTap.current = e.timeStamp
      onCommit(nextDetent(detent))
      return
    }
    const live = progressFromDrag(d.p0, dy, travel())
    const v = (live - d.p0) / dt
    onCommit(snapDetent(live, v))
  }
  const onCancel = () => { drag.current = null; onCommit(detent) }

  return (
    <div
      className="plot-grabber split-handle split-y"
      role="slider"
      aria-label="Slide plot"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      aria-valuetext={detent}
      tabIndex={0}
      data-testid="plot-grabber"
      data-detent={detent}
      style={{ transitionDuration: `${DETENT_SPRING_MS}ms` }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onCancel}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); onCommit(nextDetent(detent)) }
        else if (e.key === 'ArrowDown' || e.key === 'PageDown') { e.preventDefault(); onCommit(snapDetent(detentProgress(detent) - 0.5)) }
        else if (e.key === 'Home') { e.preventDefault(); onCommit('gram') }
        else if (e.key === 'End') { e.preventDefault(); onCommit('plot') }
        else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCommit(nextDetent(detent)) }
      }}
    >
      <i />
    </div>
  )
}
