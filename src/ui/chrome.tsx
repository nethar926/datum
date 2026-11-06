/**
 * iOS-style app chrome: appearance + glass hooks, glass tab bar (with iOS 26-style minimize), navigation bar
 * (large title collapsing to inline), the gram/plot split grabber and the Cuts placeholder screen.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { IcChevron, IcCuts, IcGear, IcLive, IcPlot } from './icons'
import {
  TABS, TAB_LABEL, clampSplit, loadGlass, loadScheme, resolveGlass, resolveScheme, saveGlass, saveScheme, saveSplit,
  type GlassPref, type SchemePref, type Tab,
} from './prefs'

const mq = (q: string) => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(q) : null)
function useMedia(q: string): boolean {
  const [v, setV] = useState(() => !!mq(q)?.matches)
  useEffect(() => {
    const m = mq(q); if (!m) return
    const on = () => setV(m.matches); on()
    m.addEventListener?.('change', on); return () => m.removeEventListener?.('change', on)
  }, [q])
  return v
}

/** Appearance (System / Light / Dark) → data-scheme on <html> + theme-color. Grams stay dark regardless. */
export function useAppearance() {
  const [pref, setPref] = useState<SchemePref>(loadScheme)
  const sysDark = useMedia('(prefers-color-scheme: dark)')
  const scheme = resolveScheme(pref, sysDark)
  useLayoutEffect(() => {
    const r = document.documentElement
    r.dataset.scheme = scheme; r.style.colorScheme = scheme
    const dark = scheme === 'dark'
    const color = dark ? '#000000' : '#f2f2f7'
    for (const m of document.querySelectorAll('meta[name=theme-color]')) {
      const media = m.getAttribute('media')
      if (!media) { m.setAttribute('content', color); continue }
      if (media.includes('dark') && dark) m.setAttribute('content', color)
      if (media.includes('light') && !dark) m.setAttribute('content', color)
    }
  }, [scheme])
  useEffect(() => saveScheme(pref), [pref])
  return { pref, setPref, scheme }
}

/** Glass strength: full Liquid Glass, or a more opaque fallback (prefers-reduced-transparency or the Settings switch). */
export function useGlass() {
  const [pref, setPref] = useState<GlassPref>(loadGlass)
  const reduced = useMedia('(prefers-reduced-transparency: reduce)')
  const glass = resolveGlass(pref, reduced)
  useLayoutEffect(() => {
    const r = document.documentElement
    r.dataset.glass = glass
    // Real SVG refraction only where backdrop-filter accepts url() (Chromium); WebKit keeps the gradient lens.
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
    const chromium = /Chrome\//.test(ua) && !/Version\//.test(ua)
    if (chromium && glass === 'full') r.dataset.refract = 'svg'; else delete r.dataset.refract
  }, [glass])
  useEffect(() => saveGlass(pref), [pref])
  return { pref, setPref, glass }
}

/**
 * One shared SVG filter for the refraction rim on browsers that accept url() in backdrop-filter (Chromium).
 * WebKit ignores it and uses the CSS gradient lens + edge backdrop (see .glass in index.css).
 */
export function GlassDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden focusable="false">
      <filter id="lg-refract" x="-10%" y="-10%" width="120%" height="120%" colorInterpolationFilters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.012 0.018" numOctaves="1" seed="7" result="n" />
        <feGaussianBlur in="n" stdDeviation="2" result="nb" />
        <feDisplacementMap in="SourceGraphic" in2="nb" scale="18" xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </svg>
  )
}

const TAB_ICON: Record<Tab, (p: { size?: number }) => ReactNode> = { live: IcLive, cuts: IcCuts, plot: IcPlot, settings: IcGear }

/**
 * Floating glass tab bar capsule. `minimized` (compact widths, while the user works the gram) collapses it to the
 * active tab only, iOS 26 style; tapping the mini capsule expands it again.
 */
export function TabBar({ tab, onTab, minimized, onExpand }: { tab: Tab; onTab: (t: Tab) => void; minimized: boolean; onExpand: () => void }) {
  return (
    <nav className={`tabbar glass${minimized ? ' min' : ''}`} role="tablist" aria-label="DATUM" data-testid="tabbar" data-min={minimized ? '1' : '0'}>
      {TABS.map((t) => {
        const I = TAB_ICON[t], on = t === tab
        return (
          <button key={t} role="tab" aria-selected={on} aria-label={TAB_LABEL[t]} data-testid={`tab-${t}`} className={on ? 'on' : undefined}
            tabIndex={minimized && !on ? -1 : 0} aria-hidden={minimized && !on ? true : undefined}
            onClick={() => { if (minimized) { onExpand(); return } onTab(t) }}>
            <I size={24} /><span>{TAB_LABEL[t]}</span>
          </button>
        )
      })}
    </nav>
  )
}

/** Inline glass navigation bar (Live / Plot). */
export function NavBar({ title, sub, leading, trailing, inlineShown = true, testId = 'navbar' }: { title: string; sub?: ReactNode; leading?: ReactNode; trailing?: ReactNode; inlineShown?: boolean; testId?: string }) {
  return (
    <header className={`navbar glass${inlineShown ? '' : ' title-hidden'}`} data-testid={testId}>
      <div className="nav-lead">{leading}</div>
      <div className="nav-title" aria-hidden={!inlineShown}><b>{title}</b>{sub && <small>{sub}</small>}</div>
      <div className="nav-trail">{trailing}</div>
    </header>
  )
}

/**
 * Scrolling screen with an iOS large title that collapses into the inline nav bar title once scrolled past
 * (Settings, Cuts). The nav bar is glass and content scrolls underneath it.
 */
export function LargeTitleScreen({ title, children, testId, trailing }: { title: string; children: ReactNode; testId: string; trailing?: ReactNode }) {
  const sc = useRef<HTMLDivElement>(null)
  const [collapsed, setCollapsed] = useState(false)
  useEffect(() => {
    const el = sc.current; if (!el) return
    const on = () => setCollapsed(el.scrollTop > 30)
    on(); el.addEventListener('scroll', on, { passive: true }); return () => el.removeEventListener('scroll', on)
  }, [])
  return (
    <section className="screen" data-testid={testId} data-collapsed={collapsed ? '1' : '0'}>
      <NavBar title={title} inlineShown={collapsed} trailing={trailing} testId={`${testId}-nav`} />
      <div className="screen-scroll" ref={sc}>
        <h1 className="large-title" data-testid={`${testId}-title`}>{title}</h1>
        {children}
      </div>
    </section>
  )
}

/**
 * Grabber between the gram and the tactical plot. Axis 'y' (stacked, gram on top) or 'x' (side by side, gram
 * left). The drag writes a CSS variable on the workspace directly (no React render per move); on release the
 * fraction is clamped to the pane minimums and settles with a short spring-ish transition, then persists.
 */
export function SplitHandle({ axis, frac, onFrac, storeKey, targetRef, defaultFrac }: {
  axis: 'x' | 'y'; frac: number; onFrac: (f: number) => void; storeKey: string; targetRef: React.RefObject<HTMLElement | null>; defaultFrac: number
}) {
  const drag = useRef<{ id: number; start: number; f0: number; total: number; lastTap: number } | null>(null)
  const lastTap = useRef(0)
  const total = () => {
    const el = targetRef.current; if (!el) return 0
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el)
    const gap = parseFloat(axis === 'y' ? cs.rowGap : cs.columnGap) || 0
    return (axis === 'y' ? r.height : r.width) - 2 * gap - (axis === 'y' ? 0 : 0) - handleSize(el, axis)
  }
  const apply = (f: number, settle: boolean) => {
    const el = targetRef.current; if (!el) return
    el.classList.toggle('settling', settle)
    el.style.setProperty('--split-a', `${f}fr`); el.style.setProperty('--split-b', `${1 - f}fr`)
  }
  const commit = (f: number) => { const c = clampSplit(f, total()); apply(c, true); onFrac(c); saveSplit(storeKey, c); window.setTimeout(() => targetRef.current?.classList.remove('settling'), 220) }
  const vert = axis === 'y'
  return (
    <div className={`split-handle ${vert ? 'split-y' : 'split-x'}`} role="separator" aria-orientation={vert ? 'horizontal' : 'vertical'}
      aria-label="Resize gram and plot" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(frac * 100)} tabIndex={0} data-testid="split-handle"
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return
        e.preventDefault(); try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* synthetic */ }
        drag.current = { id: e.pointerId, start: vert ? e.clientY : e.clientX, f0: frac, total: Math.max(1, total()), lastTap: lastTap.current }
        targetRef.current?.classList.add('dragging')
      }}
      onPointerMove={(e) => {
        const d = drag.current; if (!d || d.id !== e.pointerId) return
        const delta = (vert ? e.clientY : e.clientX) - d.start
        // Rubber-band past the minimums (iOS feel); clamp on release.
        const raw = d.f0 + delta / d.total, c = clampSplit(raw, d.total)
        apply(c + (raw - c) * 0.25, false)
      }}
      onPointerUp={(e) => {
        const d = drag.current; if (!d || d.id !== e.pointerId) return
        drag.current = null; targetRef.current?.classList.remove('dragging')
        const delta = (vert ? e.clientY : e.clientX) - d.start
        if (Math.abs(delta) < 4) {
          // Double-tap the grabber resets to the default split.
          if (e.timeStamp - lastTap.current < 320) { commit(defaultFrac); lastTap.current = 0; return }
          lastTap.current = e.timeStamp; apply(frac, true); return
        }
        commit(d.f0 + delta / d.total)
      }}
      onPointerCancel={() => { drag.current = null; targetRef.current?.classList.remove('dragging'); apply(frac, true) }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 0.1 : 0.02
        const k = e.key
        if ((vert && k === 'ArrowUp') || (!vert && k === 'ArrowLeft')) { e.preventDefault(); commit(frac - step) }
        else if ((vert && k === 'ArrowDown') || (!vert && k === 'ArrowRight')) { e.preventDefault(); commit(frac + step) }
        else if (k === 'Home' || k === 'Enter') { e.preventDefault(); commit(defaultFrac) }
      }}>
      <i />
    </div>
  )
}
function handleSize(ws: HTMLElement, axis: 'x' | 'y'): number {
  const h = ws.querySelector<HTMLElement>(':scope > .split-handle'); if (!h) return 0
  const r = h.getBoundingClientRect(); return axis === 'y' ? r.height : r.width
}

/**
 * Horizontally scrolling tool strip with an honest overflow affordance: the edge that has more content fades
 * (mask) and a 44 pt chevron pages it, so a tool is never just sliced mid-glyph at the toolbar edge. Tools
 * scroll-snap to their start edge so the strip rests on whole buttons.
 */
export function ToolScroll({ children, testId }: { children: ReactNode; testId?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [edge, setEdge] = useState({ l: false, r: false })
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return
    const upd = () => {
      const l = el.scrollLeft > 2, r = el.scrollLeft + el.clientWidth < el.scrollWidth - 2
      setEdge((e) => (e.l === l && e.r === r ? e : { l, r }))
    }
    upd()
    el.addEventListener('scroll', upd, { passive: true })
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(upd) : null
    ro?.observe(el); for (const c of Array.from(el.children)) ro?.observe(c)
    const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(upd) : null
    mo?.observe(el, { childList: true, subtree: true, characterData: true })
    return () => { el.removeEventListener('scroll', upd); ro?.disconnect(); mo?.disconnect() }
  }, [])
  const page = (dir: 1 | -1) => { const el = ref.current; if (el) el.scrollBy({ left: dir * el.clientWidth * 0.7, behavior: 'smooth' }) }
  return (
    <div className="tool-scroll-wrap" data-more-l={edge.l ? '1' : '0'} data-more-r={edge.r ? '1' : '0'}>
      <div ref={ref} className="tool-scroll" data-testid={testId}>{children}</div>
      {edge.l && <button type="button" className="tool-more tool-more-l" aria-label="Scroll tools left" tabIndex={-1} onClick={() => page(-1)}><IcChevron /></button>}
      {edge.r && <button type="button" className="tool-more tool-more-r" aria-label="More tools" data-testid={testId ? `${testId}-more` : undefined} tabIndex={-1} onClick={() => page(1)}><IcChevron /></button>}
    </div>
  )
}
