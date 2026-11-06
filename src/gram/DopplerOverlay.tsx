import { useEffect, useRef, useSyncExternalStore } from 'react'
import { freqToX, xToFreq } from './axis'
import type { OverlayCtx } from './Gram'
import { capDpr, exceedsSlop } from '../touch/gestures'
import { rulerHz, rulerText, type Handle, type RulerStore } from './dopplerRuler'

const gramCanvas = (el: HTMLElement): HTMLCanvasElement | null => el.closest('.gram')?.querySelector<HTMLCanvasElement>(':scope > canvas') ?? null
/** Curve samples per redraw (preallocated; the frame loop never allocates arrays). */
const N = 192
const xs = new Float32Array(N), ys = new Float32Array(N)
const DASH: number[] = [4, 4], SOLID: number[] = []
const HANDLES: readonly Handle[] = ['f0', 'f1', 'f2']
const LABEL: Record<Handle, string> = { f0: 'f0', f1: 'f1', f2: 'f2' }

/**
 * Doppler ruler overlay on the LOFAR gram: one continuous S-curve through f1–f0–f2 on a 2D canvas, plus three 44 px
 * touch handles. f1/f2 drag freely in both axes (X = Δf, Y = Δt); each is the point-mirror of the other about f0/CPA.
 * Everything that moves is written imperatively from a rAF loop (no React render per drag frame). Handles take their
 * own pointers (captured, touch-action: none), so gram pan / pinch / other cursors never see a handle drag.
 */
export function DopplerOverlay({ ctx, store, nowS, active }: { ctx: OverlayCtx; store: RulerStore; nowS: number; active: boolean }) {
  const layer = useRef<HTMLDivElement>(null), cv = useRef<HTMLCanvasElement>(null)
  const hEls = useRef<Record<Handle, HTMLDivElement | null>>({ f0: null, f1: null, f2: null })
  const live = useRef({ ctx, nowS }); live.current = { ctx, nowS }
  const grab = useRef<{ h: Handle; id: number; x0: number; y0: number; dx: number; dy: number; moved: boolean } | null>(null)

  useEffect(() => {
    const el = layer.current, c = cv.current
    if (!el || !c) return
    const g = c.getContext('2d')
    let m0 = 0, raf = 0, w = 0, h = 0, gh = 0, dpr = 1, lastV = -1, dirty = true
    const last = new Float64Array(6)
    // Time maps over the waterfall canvas height (as the gram's own taps do), which can exceed this layer's.
    const gcv = gramCanvas(el)
    const ro = new ResizeObserver(() => { dirty = true })
    ro.observe(el)
    const frame = () => {
      raf = requestAnimationFrame(frame)
      const { ctx: o, nowS: now } = live.current
      const cw = el.clientWidth, ch = el.clientHeight
      gh = gcv?.clientHeight || ch
      if (cw !== w || ch !== h) { w = cw; h = ch; dpr = capDpr(window.devicePixelRatio); c.width = Math.max(1, Math.round(w * dpr)); c.height = Math.max(1, Math.round(h * dpr)); dirty = true }
      if (!dirty && store.version === lastV && last[0] === o.view.lo && last[1] === o.view.hi && last[2] === now && last[3] === o.historyS && last[4] === w && last[5] === o.cfg.fBin && m0 === gh) return
      m0 = gh
      dirty = false; lastV = store.version; last[0] = o.view.lo; last[1] = o.view.hi; last[2] = now; last[3] = o.historyS; last[4] = w; last[5] = o.cfg.fBin
      const m = store.m; m.heightPx = gh; m.historyS = o.historyS; m.hzPerPx = (o.view.hi - o.view.lo) / Math.max(1, w); m.fBin = o.cfg.fBin
      const s = store.s, yOf = (t: number) => ((now - t) / o.historyS) * gh
      if (!g) return
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h)
      for (const k of HANDLES) { const e = hEls.current[k]; if (e) e.style.display = store.placed ? '' : 'none' }
      if (!store.placed) return
      // Curve over the visible time window (now at the top, history below).
      const t0 = now - o.historyS
      for (let k = 0; k < N; k++) { const t = t0 + (o.historyS * k) / (N - 1); xs[k] = freqToX(rulerHz(s, t), o.view, w); ys[k] = yOf(t) }
      const geo = store.geom
      // Asymptotes f0 ± Δf (dashed, faint) and the CPA time tick.
      g.lineWidth = 1; g.strokeStyle = 'rgba(255, 204, 85, 0.35)'; g.setLineDash(DASH)
      g.beginPath()
      const xa = freqToX(geo.f0 + geo.dfAsymHz, o.view, w), xb = freqToX(geo.f0 - geo.dfAsymHz, o.view, w)
      g.moveTo(xa, 0); g.lineTo(xa, h); g.moveTo(xb, 0); g.lineTo(xb, h)
      const yc = yOf(s.tCpaS), xc = freqToX(s.f0Hz, o.view, w)
      g.moveTo(xc - 40, yc); g.lineTo(xc + 40, yc)
      g.stroke()
      g.setLineDash(SOLID); g.lineWidth = active ? 2 : 1.5; g.strokeStyle = active ? '#ffcc55' : 'rgba(255, 204, 85, 0.7)'
      g.beginPath(); g.moveTo(xs[0], ys[0]); for (let k = 1; k < N; k++) g.lineTo(xs[k], ys[k]); g.stroke()
      // Handles: positioned by transform (centre at the point); hidden when outside the window.
      for (const k of HANDLES) {
        const e = hEls.current[k]; if (!e) continue
        const f = k === 'f0' ? s.f0Hz : k === 'f1' ? s.f1Hz : s.f2Hz, t = k === 'f0' ? s.tCpaS : k === 'f1' ? s.t1S : s.t2S
        const x = freqToX(f, o.view, w), y = yOf(t)
        const vis = x > -22 && x < w + 22 && y > -22 && y < h + 22
        e.style.display = vis ? '' : 'none'
        if (vis) e.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`
        const sel = store.sel === k ? '1' : '0'; if (e.dataset.sel !== sel) e.dataset.sel = sel
        // Selected (and the handle being dragged) stays above the others so a tiny-Δf grab isn't stolen by f0/f2.
        e.style.zIndex = store.sel === k ? '3' : '2'
        const ul = k === 'f2' && !s.linked ? '1' : '0'; if (e.dataset.unlinked !== ul) e.dataset.unlinked = ul
        e.dataset.x = x.toFixed(1); e.dataset.y = y.toFixed(1)
      }
    }
    raf = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [store, active])

  // Desktop / iPad keyboard: arrows nudge the selected handle (Shift ×10), Esc clears.
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return // Esc already used (bearing arm, drop)
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.key === 'Escape') { if (store.placed) { store.clear(); e.preventDefault() } return }
      const k = e.shiftKey ? 10 : 1
      const d = e.key === 'ArrowLeft' ? [-k, 0] : e.key === 'ArrowRight' ? [k, 0] : e.key === 'ArrowUp' ? [0, k] : e.key === 'ArrowDown' ? [0, -k] : null
      if (d && store.nudge(d[0], d[1])) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, store])

  const pointAt = (e: React.PointerEvent, dx: number, dy: number) => {
    const el = layer.current!, r = (gramCanvas(el) ?? el).getBoundingClientRect(), { ctx: o, nowS: now } = live.current
    return { hz: xToFreq(e.clientX - r.left - dx, o.view, r.width), t: now - ((e.clientY - r.top - dy) / Math.max(1, r.height)) * o.historyS }
  }
  const down = (h: Handle) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (!active || (e.pointerType === 'mouse' && e.button !== 0)) return
    e.stopPropagation(); e.preventDefault()
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* synthetic pointer */ }
    const r = e.currentTarget.getBoundingClientRect()
    // Keep the grab offset so the point doesn't jump under the finger.
    grab.current = { h, id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: e.clientX - (r.left + r.width / 2), dy: e.clientY - (r.top + r.height / 2), moved: false }
    store.select(h)
  }
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const G = grab.current; if (!G || G.id !== e.pointerId) return
    e.stopPropagation()
    if (!G.moved && !exceedsSlop(G.x0, G.y0, e.clientX, e.clientY, 4)) return
    G.moved = true
    const p = pointAt(e, G.dx, G.dy); store.drag(G.h, p.hz, p.t)
  }
  const up = (e: React.PointerEvent<HTMLDivElement>) => {
    const G = grab.current; if (!G || G.id !== e.pointerId) return
    e.stopPropagation(); grab.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    // Tap on an unlinked f2 (legacy) re-links it to the f1 mirror; normal f2 drags stay linked and mirror f1.
    if (!G.moved && G.h === 'f2' && !store.s.linked) { store.relink(); return }
    store.changed(true)
  }
  return (
    <div ref={layer} className={`dop-layer${active ? ' active' : ''}`} data-testid="dop-layer">
      <canvas ref={cv} className="dop-curve" data-testid="dop-curve" aria-hidden />
      {HANDLES.map((k) => (
        <div key={k} ref={(e) => { hEls.current[k] = e }} className={`dop-handle h-${k}`} data-testid={`dop-${k}`} role="button" tabIndex={active ? 0 : -1}
          aria-label={k === 'f0' ? 'Doppler f0 (CPA) handle' : k === 'f1' ? 'Doppler f1 (approach) handle' : 'Doppler f2 (receding) handle, tap to re-link'}
          onFocus={() => store.select(k)} onPointerDown={down(k)} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
          onContextMenu={(e) => e.preventDefault()} style={{ display: 'none', touchAction: 'none' }}>
          <i /><span>{LABEL[k]}</span>
        </div>
      ))}
    </div>
  )
}

/** Live readout under the gram (re-renders only on ruler changes). */
export function DopplerReadout({ store, fBin }: { store: RulerStore; fBin: number }) {
  useSyncExternalStore(store.subscribe, store.getVersion)
  const close = store.placed && (store.s.f1Hz - store.s.f0Hz) / Math.max(1e-9, store.m.hzPerPx) < 8
  return <div className="gram-note readout dop-note" data-testid="dop-readout">
    {rulerText(store.placed, store.geom, store.s.linked, fBin, store.fit?.ok ? store.fit : null)}
    {store.placed && <span className="dop-hint">{close ? '  ZOOM IN TO SEE ΔF' : store.sel ? `  SEL ${store.sel.toUpperCase()}` : ''}</span>}
  </div>
}
