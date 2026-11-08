import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { SimClient } from '../engine/client'
import type { Bearing, TacticalBuoy } from '../engine/contract'
import { crossFixes } from './fix'
import { LONG_PRESS_MS, capDpr, exceedsSlop } from '../touch/gestures'
import { fitView, toScreenX, toScreenY, toWorld, type PlotView } from './transform'
import { bearingTo, distToRay, fixInputs, type FixSource, type ManualBearings } from './manual'
import type { DropController } from './dropController'
import { dropCapturesPlot } from './fieldMode'
import { planReadout, type DropPlan } from './drop'
import { canAim, isArmed, type BearingArm } from './bearingArm'
import { placeRevealTagsInPlace, revealRangeBrg, revealShapeForCategory } from './reveal'
import type { TruthContact } from '../engine/contract'
import { BUOY_STATUS_COLOR, paintHealth, type DetuneStore } from './detune'
import type { FixStore } from './fixStore'

// Only confident DIFAR lines are drawn, to keep the plot readable (lines arrive strongest-first, up to 8 per buoy).
const MIN_DRAW_Q = 10
// Bearing lines are drawn to a finite length and fade out toward the end.
const BEARING_LEN_M = 7000
const SEL_TOL_HZ = 1.5

interface Props {
  client: SimClient; showReveal: boolean; spanM?: number; selectedChannel?: number; selectedHz?: number | null; allBearings?: boolean
  showAuto?: boolean; showManual?: boolean; manual?: ManualBearings; fixSource?: FixSource
  /** Manual cursor moved (final=false while dragging, true on release); deg null clears it. */
  onManual?: (buoyId: number, deg: number | null, final: boolean) => void
  /** m3-fe-drop: while a pattern is armed, presses place it (ghost preview) instead of moving bearing cursors. */
  drop?: DropController
  /** Armed two-tap bearing mode (B / BRG). Tap buoy → tap plot. Drag still works alongside. Inactive while drop captures the plot. */
  arm?: BearingArm
  onArmPick?: (buoyId: number) => void
  onArmAim?: (buoyId: number, wx: number, wy: number) => void
  /** FE-local buoy status (detune colours, integrating ring). */
  detune?: DetuneStore
  /** Operator FIX tracks / legs / ellipses. */
  fix?: FixStore
}
const noSub = () => () => {}
/** New-buoy splash: an expanding ring for this long after a buoy appears on the plot. */
const SPLASH_MS = 700
const MAX_SPLASH = 128
const HIT_PX = 14
// Fingers need a 44 pt target: 22 px radius on coarse pointers.
const hitPx = () => (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? 22 : HIT_PX)

/** Tactical plot: aircraft track, buoys (omni / DIFAR), DIFAR bearing lines, cross-fixes, optional Reveal positions. Canvas 2D. */
export function TacticalPlot({ client, showReveal, spanM = 18000, selectedChannel, selectedHz = null, allBearings = false, showAuto = true, showManual = true, manual = {}, fixSource = 'both', onManual, drop, arm, onArmPick, onArmAim, detune, fix }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  /** m3-fe-drop: ghost + splash layer, so a drag repaints only this (the plot itself redraws on new data). */
  const oref = useRef<HTMLCanvasElement>(null)
  const props = useRef({ showReveal, spanM, selectedChannel, selectedHz, allBearings, showAuto, showManual, manual, fixSource, arm, detune, fix })
  props.current = { showReveal, spanM, selectedChannel, selectedHz, allBearings, showAuto, showManual, manual, fixSource, arm, detune, fix }
  const viewRef = useRef<PlotView | null>(null)
  const dragRef = useRef<number | null>(null)
  /** When set, the current pointer is an armed aim-tap (plot placement), not a buoy drag. */
  const aimTap = useRef(false)
  // Long-press a DIFAR buoy (touch stand-in for double-click) clears its manual bearing.
  const press = useRef<{ x: number; y: number; moved: boolean; timer: number } | null>(null)
  const [picked, setPicked] = useState<TruthContact | null>(null)
  const revealHits = useRef<{ id: number; x: number; y: number; r: number }[]>([])

  useEffect(() => {
    const canvas = ref.current!, over = oref.current
    const ctx = canvas.getContext('2d'), octx = over?.getContext('2d') ?? null
    if (!ctx) return
    const css = getComputedStyle(document.documentElement)
    const col = (n: string) => css.getPropertyValue(n).trim() || '#888'
    const C = { bg: col('--plot-bg'), grid: col('--plot-grid'), ac: col('--plot-aircraft'), buoy: col('--plot-buoy'), dead: col('--plot-buoy-dead'), brg: col('--plot-bearing'), fix: col('--plot-fix'), reveal: col('--plot-reveal') || col('--plot-truth'), man: col('--plot-manual'), text: col('--phosphor-dim'), stWork: col('--plot-buoy-working') || BUOY_STATUS_COLOR.working, stDet: col('--plot-buoy-detuned') || BUOY_STATUS_COLOR.detuned, stDead: col('--plot-buoy-dead-hi') || BUOY_STATUS_COLOR.dead, stErr: col('--plot-buoy-error') || BUOY_STATUS_COLOR.error }
    const p = { x: 0, y: 0 }
    let raf = 0, lastT = -1, lastKey = '', lastGhost = -1
    // Splash start times per buoy index (typed, preallocated); known = buoys already on the plot.
    const splash = new Float64Array(MAX_SPLASH), known = { n: -1 }
    let splashing = false
    let bag = makeBag(MAX_REVEAL)
    const hitPool: { id: number; x: number; y: number; r: number }[] = Array.from({ length: MAX_REVEAL }, () => ({ id: 0, x: 0, y: 0, r: 0 }))
    revealHits.current = hitPool
    const hitCount = { n: 0 }
    // Overlay: new-buoy splash rings (each frame only while one runs) and the drop ghost.
    const drawOverlay = (v: PlotView, w: number, h: number, dpr: number, t: typeof client.status.tactical, now: number) => {
      if (!octx || !over) return
      if (over.width !== w || over.height !== h) { over.width = w; over.height = h } else octx.clearRect(0, 0, w, h)
      splashing = false
      if (t) for (let i = 0; i < t.buoys.length && i < MAX_SPLASH; i++) {
        const age = now - splash[i]
        if (!splash[i] || age >= SPLASH_MS) continue
        splashing = true
        const b = t.buoys[i], k = age / SPLASH_MS
        octx.strokeStyle = C.man; octx.globalAlpha = 1 - k; octx.lineWidth = 1.5 * dpr
        octx.beginPath(); octx.arc(toScreenX(v, b.x), toScreenY(v, b.y), (6 + 22 * k) * dpr, 0, Math.PI * 2); octx.stroke()
      }
      octx.globalAlpha = 1
      // Integrating progress rings (FE detune store) — keep animating on the overlay.
      const dt = props.current.detune
      if (t && dt) {
        let integrating = false
        for (const b of t.buoys) {
          const prog = dt.progress(b.id, now)
          if (prog == null) continue
          integrating = true
          const sx = toScreenX(v, b.x), sy = toScreenY(v, b.y), rr = 10 * dpr
          octx.strokeStyle = C.stDet; octx.globalAlpha = 0.25; octx.lineWidth = 2 * dpr
          octx.beginPath(); octx.arc(sx, sy, rr, 0, Math.PI * 2); octx.stroke()
          octx.globalAlpha = 1; octx.beginPath()
          octx.arc(sx, sy, rr, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2); octx.stroke()
        }
        if (integrating) { splashing = true; dt.tick(now) }
      }
      const gh = drop?.ghost
      if (gh) drawGhost(octx, v, gh, dpr, C.man)
    }
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const st = client.status, t = st.tactical, now = performance.now()
      const gv = drop ? drop.version : 0
      if (t && t.buoys.length !== known.n) {
        // First picture (or a restart): no splash. Growth: splash the newcomers.
        if (known.n >= 0 && t.buoys.length > known.n) { for (let i = known.n; i < t.buoys.length && i < MAX_SPLASH; i++) splash[i] = now; splashing = true }
        known.n = t.buoys.length
      }
      const { showReveal: reveal, spanM: span, selectedChannel: sel, selectedHz: selHz, allBearings: all, showAuto: sa, showManual: sm, manual: man, fixSource: fs, arm: armSt } = props.current
      const dpr = capDpr(devicePixelRatio)
      const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr)
      const armKey = armSt?.phase === 'aim' ? `aim${armSt.buoyId}` : armSt?.phase ?? 'idle'
      const dtSnap = props.current.detune?.getSnapshot() ?? 0
      const fixSnap = props.current.fix?.getSnapshot() ?? 0
      const key = `${w}x${h}:${reveal}:${span}:${sel}:${selHz}:${all}:${sa}:${sm}:${fs}:${armKey}:${dtSnap}:${fixSnap}:${JSON.stringify(man)}`
      const base = !(t?.simT === lastT && key === lastKey)
      if (!base && gv === lastGhost && !splashing) return
      const v = fitView(w, h, span)
      viewRef.current = v
      if (gv !== lastGhost || splashing || base) { lastGhost = gv; drawOverlay(v, w, h, dpr, t, now) }
      if (!base) return
      lastT = t?.simT ?? -1; lastKey = key
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, w, h)
      // Range rings every 2 km + grid.
      ctx.strokeStyle = C.grid; ctx.lineWidth = 1 * dpr
      for (let r = 2000; r <= span; r += 2000) { ctx.beginPath(); ctx.arc(toScreenX(v, 0), toScreenY(v, 0), r / v.mPerPx, 0, Math.PI * 2); ctx.stroke() }
      ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke()
      ctx.font = `${10 * dpr}px ui-monospace, Menlo, monospace`; ctx.fillStyle = C.text
      ctx.fillText('N', w / 2 + 4 * dpr, 12 * dpr)
      // Ring-scale label is a DOM node (data-testid=ring-scale) so chrome hit-tests stay off canvas.
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

      // Buoys (status colours: white working, green detuned/integrating, red dead, yellow error).
      const dt = props.current.detune
      for (const b of t.buoys) {
        const sx = toScreenX(v, b.x), sy = toScreenY(v, b.y), r = 5 * dpr
        const fe = dt?.get(b.id)
        const health = paintHealth(fe, b.state)
        const colS = health === 'working' ? C.stWork : health === 'dead' ? C.stDead : health === 'error' ? C.stErr : C.stDet
        const feCh = fe?.channel
        const label = health === 'detuned' ? 'DT' : feCh != null ? String(feCh) : String(b.channel)
        const selected = b.channel === sel || feCh === sel
        if (selected) {
          ctx.save(); ctx.strokeStyle = '#0a84ff'; ctx.fillStyle = 'rgba(10,132,255,0.2)'; ctx.lineWidth = 3 * dpr
          ctx.beginPath(); ctx.arc(sx, sy, 11 * dpr, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore()
        }
        ctx.strokeStyle = colS; ctx.fillStyle = colS; ctx.lineWidth = (selected ? 2.5 : 1.5) * dpr
        ctx.beginPath()
        if (b.kind === 'difar') { ctx.moveTo(sx, sy - r); ctx.lineTo(sx + r, sy + r); ctx.lineTo(sx - r, sy + r); ctx.closePath() } else ctx.arc(sx, sy, r, 0, Math.PI * 2)
        if (b.state === 'falling' || health === 'integrating') ctx.setLineDash([2 * dpr, 2 * dpr])
        ctx.stroke(); ctx.setLineDash([])
        ctx.fillText(label, sx + 8 * dpr, sy + 4 * dpr)
        // Armed aim: ring the chosen DIFAR buoy.
        if (armSt?.phase === 'aim' && armSt.buoyId === b.id) {
          ctx.strokeStyle = C.man; ctx.lineWidth = 2 * dpr; ctx.setLineDash([3 * dpr, 3 * dpr])
          ctx.beginPath(); ctx.arc(sx, sy, 12 * dpr, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([])
        }
      }
      // Armed badge on the plot (bearing arm; drop has its own hint bar).
      if (armSt && armSt.phase !== 'idle') {
        ctx.fillStyle = C.man; ctx.font = `600 ${11 * dpr}px ui-monospace, Menlo, monospace`
        ctx.fillText(armSt.phase === 'pick-buoy' ? 'BRG · tap DIFAR buoy' : 'BRG · tap to aim', 8 * dpr, 16 * dpr)
      }

      // Cross-fixes from DIFAR lines (auto teaching aid).
      ctx.strokeStyle = C.fix; ctx.lineWidth = 1.5 * dpr
      for (const f of crossFixes(fixInputs(shown, sm ? man : {}, t.buoys, fs, selHz), t.buoys, SEL_TOL_HZ, MIN_DRAW_Q)) {
        const sx = toScreenX(v, f.x), sy = toScreenY(v, f.y), r = 6 * dpr
        ctx.beginPath(); ctx.moveTo(sx - r, sy - r); ctx.lineTo(sx + r, sy + r); ctx.moveTo(sx + r, sy - r); ctx.lineTo(sx - r, sy + r); ctx.stroke()
        ctx.fillStyle = C.fix; ctx.fillText(f.freqHz < 0 ? 'MAN' : `${f.freqHz.toFixed(0)}Hz`, sx + 8 * dpr, sy - 6 * dpr)
      }

      // Operator FIX tracks: ellipses, marks, legs (dim closed legs), short tags; track name on the leg.
      const fx = props.current.fix
      if (fx && fx.fixes.length) {
        ctx.font = `600 ${10 * dpr}px ui-monospace, Menlo, monospace`
        for (const leg of fx.legs) {
          const pts = leg.fixIds.map((id) => fx.fixes.find((f) => f.id === id)).filter(Boolean) as typeof fx.fixes
          if (pts.length < 2) continue
          const track = fx.tracks.find((tr) => tr.id === leg.trackId)
          ctx.globalAlpha = leg.closed ? 0.4 : 1
          ctx.strokeStyle = C.fix; ctx.lineWidth = (leg.closed ? 1.25 : 2) * dpr
          ctx.setLineDash(leg.closed ? [5 * dpr, 4 * dpr] : [])
          ctx.beginPath()
          for (let i = 0; i < pts.length; i++) {
            const sx = toScreenX(v, pts[i]!.x), sy = toScreenY(v, pts[i]!.y)
            if (i) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy)
          }
          if (leg.fit) {
            const last = pts[pts.length - 1]!
            const th = (leg.fit.cseDeg * Math.PI) / 180
            // ~3 minutes of steam at fitted speed, capped for the plot.
            const len = Math.min(3500, Math.max(900, leg.fit.spdKts * 1852 / 3600 * 180))
            ctx.lineTo(toScreenX(v, last.x + Math.sin(th) * len), toScreenY(v, last.y + Math.cos(th) * len))
          }
          ctx.stroke(); ctx.setLineDash([])
          // Track name at the mid-leg (not on every mark).
          if (track) {
            const mid = pts[Math.floor(pts.length / 2)]!
            const mx = toScreenX(v, mid.x), my = toScreenY(v, mid.y)
            ctx.fillStyle = C.fix
            ctx.font = `700 ${11 * dpr}px ui-monospace, Menlo, monospace`
            ctx.fillText(track.tag, mx + 10 * dpr, my - 10 * dpr)
            ctx.font = `600 ${10 * dpr}px ui-monospace, Menlo, monospace`
          }
        }
        ctx.globalAlpha = 1
        const nF = fx.fixes.length
        if (nF > bag.cap) bag = makeBag(nF)
        const { ax, ay, tw, th, outX, outY, obs } = bag
        let n = 0
        for (const f of fx.fixes) {
          const sx = toScreenX(v, f.x), sy = toScreenY(v, f.y)
          const leg = fx.legs.find((l) => l.id === f.legId)
          ctx.globalAlpha = leg?.closed ? 0.45 : 1
          const el = f.ellipse
          // Visible floor so a tight cut still reads as an ellipse on an 18 km plot.
          const majPx = Math.max(20 * dpr, el.semiMajorM / v.mPerPx)
          const minPx = Math.max(12 * dpr, el.semiMinorM / v.mPerPx)
          ctx.save()
          ctx.translate(sx, sy)
          // orientDeg is °T (0 = north); canvas +X is east → rotate (θ − 90°).
          ctx.rotate(((el.orientDeg - 90) * Math.PI) / 180)
          ctx.strokeStyle = C.fix; ctx.lineWidth = 1.5 * dpr; ctx.globalAlpha *= 0.75
          ctx.beginPath(); ctx.ellipse(0, 0, majPx, minPx, 0, 0, Math.PI * 2); ctx.stroke()
          ctx.restore()
          ctx.globalAlpha = leg?.closed ? 0.45 : 1
          const r = 5 * dpr
          ctx.strokeStyle = C.fix; ctx.lineWidth = 1.75 * dpr
          ctx.beginPath(); ctx.moveTo(sx - r, sy - r); ctx.lineTo(sx + r, sy + r); ctx.moveTo(sx + r, sy - r); ctx.lineTo(sx - r, sy + r); ctx.stroke()
          ax[n] = sx; ay[n] = sy
          tw[n] = ctx.measureText(f.tag).width + 4 * dpr; th[n] = 12 * dpr
          n++
        }
        let mObs = 0
        const pushObs = (x: number, y: number, ow: number, oh: number) => {
          obs[mObs * 4] = x; obs[mObs * 4 + 1] = y; obs[mObs * 4 + 2] = ow; obs[mObs * 4 + 3] = oh; mObs++
        }
        pushObs(0, 0, w, 80 * dpr) // layers float + ring-scale
        pushObs(0, h - 56 * dpr, w, 56 * dpr)
        pushObs(w - 200 * dpr, 0, 200 * dpr, 48 * dpr) // A/C readout
        for (const b of t.buoys) {
          const bx = toScreenX(v, b.x), by = toScreenY(v, b.y)
          pushObs(bx - 8 * dpr, by - 8 * dpr, 16 * dpr, 16 * dpr)
        }
        placeRevealTagsInPlace(n, ax, ay, tw, th, outX, outY, obs, mObs, w, h, 4 * dpr)
        ctx.fillStyle = C.fix; ctx.globalAlpha = 1
        for (let i = 0; i < n; i++) ctx.fillText(fx.fixes[i]!.tag, outX[i] + 2 * dpr, outY[i] + 10 * dpr)
      }

      // Reveal positions (instructor marks only — no text dump). Zero heap traffic on the hot path.
      for (let i = 0; i < hitPool.length; i++) hitPool[i].r = 0
      hitCount.n = 0
      if (reveal && t.truth) {
        const contacts = t.truth.contacts
        if (contacts.length > bag.cap) bag = makeBag(contacts.length)
        const { ax, ay, tw, th, outX, outY, obs, hit, tagCh, tagN } = bag
        let n = 0, sN = 0, mN = 0
        ctx.strokeStyle = C.reveal; ctx.fillStyle = C.reveal; ctx.lineWidth = 1.25 * dpr
        ctx.font = `600 ${10 * dpr}px ui-monospace, Menlo, monospace`
        for (let i = 0; i < contacts.length; i++) {
          const c = contacts[i]
          if (c.active === false) continue
          const shape = revealShapeForCategory(c.category)
          if (!shape) continue
          const prefix = c.category === 'subsurface' ? 0 : 1 // 0=S, 1=M
          const num = prefix === 0 ? ++sN : ++mN
          const sx = toScreenX(v, c.x), sy = toScreenY(v, c.y), heading = (c.crsDeg * Math.PI) / 180
          const hx = Math.sin(heading), hy = -Math.cos(heading)
          ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + hx * 20 * dpr, sy + hy * 20 * dpr); ctx.stroke()
          ctx.beginPath()
          if (shape === 'triangle') {
            const r = 7 * dpr
            ctx.moveTo(sx + hx * r, sy + hy * r)
            ctx.lineTo(sx - hx * r * 0.7 + hy * r * 0.7, sy - hy * r * 0.7 - hx * r * 0.7)
            ctx.lineTo(sx - hx * r * 0.7 - hy * r * 0.7, sy - hy * r * 0.7 + hx * r * 0.7)
            ctx.closePath(); ctx.stroke()
          } else {
            // circle (surface); square/warship reserved in REVEAL_SHAPE_BY_KIND
            ctx.arc(sx, sy, 5 * dpr, 0, Math.PI * 2); ctx.stroke()
          }
          // Measure without building a string when possible: "S12" / "M12" via scratch.
          const tag = (prefix === 0 ? TAG_S : TAG_M)[num - 1] ?? ((prefix === 0 ? 'S' : 'M') + num)
          ax[n] = sx; ay[n] = sy
          tw[n] = ctx.measureText(tag).width + 4 * dpr; th[n] = 12 * dpr
          hit[n] = i; tagCh[n] = prefix; tagN[n] = num
          if (hitCount.n < hitPool.length) {
            const h = hitPool[hitCount.n++]
            h.id = c.id; h.x = sx; h.y = sy; h.r = 14 * dpr
          }
          n++
        }
        let mObs = 0
        const pushObs = (x: number, y: number, ow: number, oh: number) => {
          obs[mObs * 4] = x; obs[mObs * 4 + 1] = y; obs[mObs * 4 + 2] = ow; obs[mObs * 4 + 3] = oh; mObs++
        }
        pushObs(0, 0, w, 36 * dpr)
        pushObs(0, h - 52 * dpr, w, 52 * dpr)
        pushObs(w - 160 * dpr, 0, 160 * dpr, 40 * dpr)
        for (const b of t.buoys) {
          const bx = toScreenX(v, b.x), by = toScreenY(v, b.y)
          pushObs(bx - 8 * dpr, by - 8 * dpr, 16 * dpr, 16 * dpr)
          pushObs(bx + 6 * dpr, by - 4 * dpr, 18 * dpr, 12 * dpr)
        }
        placeRevealTagsInPlace(n, ax, ay, tw, th, outX, outY, obs, mObs, w, h, 4 * dpr)
        ctx.fillStyle = C.reveal
        for (let i = 0; i < n; i++) {
          ctx.fillText((tagCh[i] === 0 ? TAG_S : TAG_M)[tagN[i] - 1]!, outX[i] + 2 * dpr, outY[i] + 10 * dpr)
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
  const hitReveal = (e: React.PointerEvent | React.MouseEvent) => {
    if (!props.current.showReveal) return null
    const c = ref.current; if (!c) return null
    const rect = c.getBoundingClientRect(), dpr = c.width / Math.max(1, rect.width)
    const px = (e.clientX - rect.left) * dpr, py = (e.clientY - rect.top) * dpr
    let best: { id: number; d: number } | null = null
    for (let i = 0; i < revealHits.current.length; i++) {
      // hitCount lives inside the effect; use r>0 as live flag — kept in sync each draw
      const h = revealHits.current[i]
      if (!h.r) continue
      const d = Math.hypot(px - h.x, py - h.y)
      if (d <= h.r && (!best || d < best.d)) best = { id: h.id, d }
    }
    return best?.id ?? null
  }
  useEffect(() => { if (!showReveal) setPicked(null) }, [showReveal])
  const setFrom = (id: number, wx: number, wy: number, final: boolean) => {
    const b = client.status.tactical?.buoys.find((x) => x.id === id); if (!b) return
    const deg = bearingTo(b, wx, wy); if (deg !== null) onManual?.(id, deg, final)
  }
  const dropPress = useRef<{ x: number; y: number; moved: boolean; id: number } | null>(null)
  const dropping = () => !!drop && dropCapturesPlot(drop.state)
  // Re-render (cursor/class only) when the drop tool arms or disarms.
  useSyncExternalStore(drop?.subscribe ?? noSub, () => (drop ? dropCapturesPlot(drop.state) : false))
  useSyncExternalStore(fix?.subscribe ?? noSub, () => (fix ? fix.getSnapshot() : 0))
  const brgArmed = !!(arm && isArmed(arm) && !dropping())
  return (<>
    <canvas ref={ref} data-testid="tactical" aria-label="Tactical plot" data-arm={dropping() ? 'drop' : (arm?.phase ?? 'idle')}
      className={drop && dropping() ? 'dropping' : undefined}
      style={{ cursor: onManual || dropping() || brgArmed ? 'crosshair' : undefined, touchAction: 'none' }}
      onPointerDown={(e) => {
        // Drop pattern arm owns the plot while active (bearing arm is forced idle in App).
        if (drop && dropping()) {
          if (dropPress.current) return // second finger: ignore
          const w = world(e); if (!w) return
          try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* synthetic pointer */ }
          dropPress.current = { x: e.clientX, y: e.clientY, moved: false, id: e.pointerId }
          drop.dispatch({ type: 'press', at: { x: w.x, y: w.y } }); return
        }
        const h = hitBuoy(e)
        // Armed aim on empty plot: capture so pointerup can place the bearing.
        if (!h && brgArmed && canAim(arm!) && onArmAim) {
          aimTap.current = true; dragRef.current = arm!.buoyId
          try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* synthetic */ }
          press.current = { x: e.clientX, y: e.clientY, moved: false, timer: 0 }
          return
        }
        aimTap.current = false
        if (!h) {
          // Empty plot tap: track for reveal pick / dismiss.
          if (props.current.showReveal) {
            try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* synthetic */ }
            press.current = { x: e.clientX, y: e.clientY, moved: false, timer: 0 }
            dragRef.current = -1 // sentinel: reveal tap
          }
          return
        }
        if (!onManual) return
        dragRef.current = h.id; try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* synthetic pointer */ }
        const id = h.id, pr = { x: e.clientX, y: e.clientY, moved: false, timer: 0 }
        // Long-press clear only when not in the two-tap arm path (arm uses tap-to-pick).
        if (!brgArmed) {
          pr.timer = window.setTimeout(() => { if (!pr.moved && dragRef.current === id) { dragRef.current = null; onManual(id, null, true) } }, LONG_PRESS_MS)
        }
        press.current = pr
      }}
      onPointerMove={(e) => {
        const dp = dropPress.current
        if (dp && drop) {
          if (e.pointerId !== dp.id) return
          if (!dp.moved) { if (!exceedsSlop(dp.x, dp.y, e.clientX, e.clientY)) return; dp.moved = true }
          const w = world(e); if (w) drop.dispatch({ type: 'drag', at: { x: w.x, y: w.y } }); return
        }
        const id = dragRef.current; if (id === null) return
        const pr = press.current
        if (pr && !pr.moved) { if (!exceedsSlop(pr.x, pr.y, e.clientX, e.clientY)) return; pr.moved = true; clearTimeout(pr.timer) }
        if (aimTap.current || id === -1) return // aim/reveal tap: placement/pick on up
        const w = world(e); if (w) setFrom(id, w.x, w.y, false)
      }}
      onPointerUp={(e) => {
        const dp = dropPress.current
        if (dp && drop) { if (e.pointerId !== dp.id) return; dropPress.current = null; drop.dispatch({ type: 'release' }); return }
        const id = dragRef.current; const aiming = aimTap.current
        dragRef.current = null; aimTap.current = false
        const pr = press.current; press.current = null; if (pr) clearTimeout(pr.timer)
        if (id === null) return
        const w = world(e)
        // Reveal tap (sentinel -1): pick a mark or dismiss the card.
        if (id === -1) {
          if (pr && !pr.moved) {
            const rid = hitReveal(e)
            if (rid !== null) {
              const c = client.status.tactical?.truth?.contacts.find((x) => x.id === rid) ?? null
              setPicked(c)
            } else setPicked(null)
          }
          return
        }
        // Armed aim tap on the plot (no drag).
        if (aiming) {
          if (pr && !pr.moved && w && arm && canAim(arm)) onArmAim?.(arm.buoyId, w.x, w.y)
          return
        }
        // Armed: tap (no move) on a buoy picks it for aim; drag still sets a bearing.
        if (brgArmed && pr && !pr.moved) { onArmPick?.(id); return }
        if (!pr?.moved) return
        if (w) setFrom(id, w.x, w.y, true)
      }}
      onPointerCancel={() => {
        if (dropPress.current && drop) { dropPress.current = null; drop.dispatch({ type: 'cancel' }); return }
        dragRef.current = null; aimTap.current = false; if (press.current) clearTimeout(press.current.timer); press.current = null
      }}
      onContextMenu={(e) => e.preventDefault()}
      onDoubleClick={(e) => { if (dropping() || brgArmed) return; const h = hitBuoy(e); if (h) onManual?.(h.id, null, true) }} />
    <canvas ref={oref} className="tac-overlay" data-testid="tactical-overlay" aria-hidden />
    <div className="ring-scale" data-testid="ring-scale" aria-hidden>2 km rings</div>
    {picked && showReveal && (() => {
      const buoy = client.status.tactical?.buoys.find((b) => b.channel === selectedChannel)
      const rb = revealRangeBrg(buoy, picked)
      const kts = picked.spdKts ?? picked.spdMps * 1.943844
      const cls = (picked.label || picked.sourceId || `C${picked.id}`).toUpperCase()
      return (
        <div className="reveal-card readout" data-testid="reveal-card" role="dialog" aria-label="Reveal contact">
          <div className="reveal-card-head">{cls}</div>
          <div>CSE {String(Math.round(picked.crsDeg) % 360).padStart(3, '0')}° · {kts.toFixed(1)} KT{picked.depthM !== undefined ? ` · ${picked.depthM.toFixed(0)} M` : ''}</div>
          {rb && <div>RNG {(rb.rngM / 1852).toFixed(2)} NM · BRG {String(Math.round(rb.brgDeg) % 360).padStart(3, '0')}°</div>}
          {!rb && buoy && <div className="dim">On selected buoy</div>}
          {!buoy && <div className="dim">Select a buoy for RNG/BRG</div>}
        </div>
      )
    })()}
  </>)
}

/**
 * Which DIFAR lines to draw. all: every confident line. Otherwise lines within SEL_TOL_HZ of the selected
 * frequency; with no frequency picked, the strongest line on the selected buoy sets it.
 */

const MAX_REVEAL = 64
const TAG_S = Array.from({ length: MAX_REVEAL }, (_, i) => 'S' + (i + 1))
const TAG_M = Array.from({ length: MAX_REVEAL }, (_, i) => 'M' + (i + 1))
function makeBag(cap: number) {
  const c = Math.max(cap, MAX_REVEAL)
  return {
    cap: c,
    ax: new Float64Array(c), ay: new Float64Array(c),
    tw: new Float64Array(c), th: new Float64Array(c),
    outX: new Float64Array(c), outY: new Float64Array(c),
    obs: new Float64Array((c + 128) * 4),
    hit: new Int32Array(c),
    tagCh: new Int32Array(c),
    tagN: new Int32Array(c),
  }
}

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

/**
 * Ghost of a pattern about to be laid: the drag guide (anchor → finger, with bearing and extent), the pattern
 * outline, hollow dashed buoy symbols (DIFAR triangle, omni circle) and the plan readout. Reads the plan's typed
 * xy array; runs only when the ghost changes.
 */
function drawGhost(ctx: CanvasRenderingContext2D, v: PlotView, g: DropPlan, dpr: number, col: string): void {
  const n = g.n, xy = g.xy, pl = g.placement
  const sx = (i: number) => toScreenX(v, xy[2 * i]), sy = (i: number) => toScreenY(v, xy[2 * i + 1])
  ctx.save()
  ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1.25 * dpr
  // Drag guide.
  if (pl.dragged && pl.from && pl.to) {
    const x0 = toScreenX(v, pl.from.x), y0 = toScreenY(v, pl.from.y), x1 = toScreenX(v, pl.to.x), y1 = toScreenY(v, pl.to.y)
    ctx.globalAlpha = 0.55; ctx.setLineDash([2 * dpr, 3 * dpr])
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke()
    ctx.setLineDash([]); ctx.globalAlpha = 0.9
    ctx.beginPath(); ctx.arc(x0, y0, 3 * dpr, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(x1, y1, 7 * dpr, 0, Math.PI * 2); ctx.stroke()
  }
  // Outline.
  ctx.globalAlpha = 0.7; ctx.setLineDash([6 * dpr, 4 * dpr]); ctx.beginPath()
  if (g.pattern === 'line' && n > 1) { ctx.moveTo(sx(0), sy(0)); for (let i = 1; i < n; i++) ctx.lineTo(sx(i), sy(i)) }
  else if (g.pattern === 'circle') ctx.arc(toScreenX(v, g.center.x), toScreenY(v, g.center.y), g.extentM / v.mPerPx, 0, Math.PI * 2)
  else if (g.pattern === 'wedge' && n > 1) {
    // Legs alternate (odd = one side, even = the other), outward from the apex at index 0.
    ctx.moveTo(sx(0), sy(0)); for (let i = 1; i < n; i += 2) ctx.lineTo(sx(i), sy(i))
    ctx.moveTo(sx(0), sy(0)); for (let i = 2; i < n; i += 2) ctx.lineTo(sx(i), sy(i))
  }
  ctx.stroke(); ctx.setLineDash([])
  // Buoys.
  const r = 6 * dpr
  for (let i = 0; i < n; i++) {
    const x = sx(i), y = sy(i)
    ctx.beginPath()
    if (g.kinds[i] === 'difar') { ctx.moveTo(x, y - r); ctx.lineTo(x + r, y + r); ctx.lineTo(x - r, y + r); ctx.closePath() } else ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.globalAlpha = 0.18; ctx.fill()
    ctx.globalAlpha = 0.95; ctx.setLineDash([3 * dpr, 2 * dpr]); ctx.stroke(); ctx.setLineDash([])
  }
  // Readout above the pattern (phones show it in the confirm bar instead, which rides at the top of the plot).
  if (typeof document !== 'undefined' && (document.querySelector('.app') as HTMLElement | null)?.dataset.layout !== 'wide') { ctx.restore(); return }
  let top = Infinity, left = Infinity, right = -Infinity
  for (let i = 0; i < n; i++) { top = Math.min(top, sy(i)); left = Math.min(left, sx(i)); right = Math.max(right, sx(i)) }
  if (g.pattern === 'circle') top = Math.min(top, toScreenY(v, g.center.y) - g.extentM / v.mPerPx)
  const label = planReadout(g)
  ctx.font = `600 ${11 * dpr}px ui-monospace, Menlo, monospace`
  const tw = ctx.measureText(label).width, pad = 4 * dpr
  const lx = Math.max(pad, Math.min(v.w - tw - pad, (left + right) / 2 - tw / 2)), ly = Math.max(16 * dpr, top - 14 * dpr)
  ctx.globalAlpha = 0.75; ctx.fillStyle = '#000'; ctx.fillRect(lx - pad, ly - 11 * dpr, tw + 2 * pad, 15 * dpr)
  ctx.globalAlpha = 1; ctx.fillStyle = col; ctx.fillText(label, lx, ly)
  ctx.restore()
}
