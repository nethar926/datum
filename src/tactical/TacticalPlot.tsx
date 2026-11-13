import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { courseSpeed, formatDepth, formatRingScale, getDisplayUnits, mpsFromSpeed, rangeBearing, subscribeDisplayUnits } from '../displayUnits'
import type { SimClient } from '../engine/client'
import type { Bearing, TacticalBuoy } from '../engine/contract'
import { LONG_PRESS_MS, capDpr, exceedsSlop } from '../touch/gestures'
import { fitView, toScreenX, toScreenY, toWorld, type PlotView, PLOT_CAMERA_FITTED, PLOT_WHEEL_FACTOR, panPlotCamera, recentrePlotCamera, zoomPlotCamera, type PlotCamera } from './transform'
import { plotCameraAllows, plotDoubleTap, type PlotDoubleTapState } from './plotCameraGestures'
import { bearingTo, distToRay, type FixSource, type ManualBearings } from './manual'
import type { DropController } from './dropController'
import { dropCapturesPlot } from './fieldMode'
import { planReadout, type DropPlan } from './drop'
import { canAim, isArmed, type BearingArm } from './bearingArm'
import { placeRevealTagsInPlace, revealRangeBrg, revealShapeForCategory } from './reveal'
import { aisContacts, aisEffective, revealContacts, type PlotDifficulty } from './plotLayerPolicy'
import type { TruthContact } from '../engine/contract'
import { BUOY_STATUS_COLOR, paintHealth, type DetuneStore } from './detune'
import type { FixStore } from './fixStore'
import {
  DEFAULT_FIX_COLOR, FIX_COLOR_RGB, FIX_COLORS, FIX_HIT_PX, FIX_LINE, FIX_SHAPES,
  drawFixShape, fixLineAlpha, fixMenuFrame, hitFix, loadFixFadeS,
  type FixColor, type FixShape,
} from './fixStyle'
import {
  AIS_AFFILIATIONS, AIS_AFFILIATION_LABEL, AIS_AFFILIATION_RGB,
  aisAffiliation, aisAffiliationVersion, aisCardFrame, aisInfoFromTrack, aisSourceForSeed,
  drawSailboat, setAisAffiliation, subscribeAisAffiliations,
  type AisAffiliation,
} from './aisStyle'
import {
  NAV_RGB, displaySimTime, drawPlaneNav, drawPlaneTrail, glyphRotationRad, handlePlaneTap,
  planeMenuFrame, planeState, planeVersion, samplePlane, subscribePlane,
} from './planeRoute'
import { NIGHT_BEACON, NIGHT_NAV_LIGHTS, nightBeaconOn } from '../displayFx'
import { PlaneMenu } from './PlaneMenu'

// Only confident DIFAR lines are drawn, to keep the plot readable (lines arrive strongest-first, up to 8 per buoy).
const MIN_DRAW_Q = 10
// Bearing lines are drawn to a finite length and fade out toward the end.
const BEARING_LEN_M = 7000
const SEL_TOL_HZ = 1.5

interface Props {
  client: SimClient; showReveal: boolean; showAis?: boolean; difficulty?: PlotDifficulty; spanM?: number; selectedChannel?: number; selectedHz?: number | null; allBearings?: boolean
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
  /** Night easter egg: nav lights + flashing beacon on the plane glyph only. */
  night?: boolean
  /** Fix-bearing fade window (seconds of sim time). Same key as Settings. */
  fadeS?: number
}
const noSub = () => () => {}
/** New-buoy splash: an expanding ring for this long after a buoy appears on the plot. */
const SPLASH_MS = 700
const MAX_SPLASH = 128
const HIT_PX = 14
// Fingers need a 44 pt target: 22 px radius on coarse pointers.
const hitPx = () => (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? 22 : HIT_PX)

/** Tactical plot: aircraft track, buoys (omni / DIFAR), violet auto bearings, operator-laid fixes, optional Reveal positions. Canvas 2D. */
export function TacticalPlot({ client, showReveal, showAis = false, difficulty = 'regular', spanM = 18000, selectedChannel, selectedHz = null, allBearings = false, showAuto = true, showManual = true, manual = {}, fixSource = 'both', onManual, drop, arm, onArmPick, onArmAim, detune, fix, night = false, fadeS }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  /** m3-fe-drop: ghost + splash layer, so a drag repaints only this (the plot itself redraws on new data). */
  const oref = useRef<HTMLCanvasElement>(null)
  const props = useRef({ showReveal, showAis, difficulty, spanM, selectedChannel, selectedHz, allBearings, showAuto, showManual, manual, fixSource, arm, detune, fix, night, fadeS, picked: null as TruthContact | null, affTick: 0, planeTick: 0 })
  const [pickedFixId, setPickedFixId] = useState<number | null>(null)
  const fadeSRef = useRef(loadFixFadeS())
  const viewRef = useRef<PlotView | null>(null)
  const dragRef = useRef<number | null>(null)
  /** When set, the current pointer is an armed aim-tap (plot placement), not a buoy drag. */
  const aimTap = useRef(false)
  // Long-press a DIFAR buoy (touch stand-in for double-click) clears its manual bearing.
  const press = useRef<{ x: number; y: number; moved: boolean; timer: number } | null>(null)
  const [picked, setPicked] = useState<TruthContact | null>(null)
  const affTick = useSyncExternalStore(subscribeAisAffiliations, aisAffiliationVersion)
  const planeTick = useSyncExternalStore(subscribePlane, planeVersion)
  const units = useSyncExternalStore(subscribeDisplayUnits, getDisplayUnits)
  const simTWall = useRef({ t: 0, wall: 0 })
  props.current = { showReveal, showAis, difficulty, spanM, selectedChannel, selectedHz, allBearings, showAuto, showManual, manual, fixSource, arm, detune, fix, night, fadeS, picked, affTick, planeTick }
  const revealHits = useRef<{ id: number | string; x: number; y: number; r: number }[]>([])
  const camRef = useRef<PlotCamera>({ ...PLOT_CAMERA_FITTED })
  const camTick = useRef(0)
  const lastScen = useRef({ id: '', seed: NaN })
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ dist: number; midX: number; midY: number; cam: PlotCamera } | null>(null)
  const pan0 = useRef<{ x: number; y: number; cam: PlotCamera } | null>(null)
  const dbl = useRef<PlotDoubleTapState | null>(null)
  const dropCapRef = useRef(false)
  const brgRef = useRef(false)
  const setCam = (c: PlotCamera) => { camRef.current = c; camTick.current++ }

  useEffect(() => {
    const canvas = ref.current!, over = oref.current
    const ctx = canvas.getContext('2d'), octx = over?.getContext('2d') ?? null
    if (!ctx) return
    const css = getComputedStyle(document.documentElement)
    const col = (n: string) => css.getPropertyValue(n).trim() || '#888'
    const C = { bg: col('--plot-bg'), grid: col('--plot-grid'), ac: col('--plot-aircraft'), buoy: col('--plot-buoy'), dead: col('--plot-buoy-dead'), brg: col('--plot-bearing'), fix: col('--plot-fix'), reveal: col('--plot-reveal') || col('--plot-truth'), man: col('--plot-manual'), text: col('--phosphor-dim'), stWork: col('--plot-buoy-working') || BUOY_STATUS_COLOR.working, stDet: col('--plot-buoy-detuned') || BUOY_STATUS_COLOR.detuned, stDead: col('--plot-buoy-dead-hi') || BUOY_STATUS_COLOR.dead, stErr: col('--plot-buoy-error') || BUOY_STATUS_COLOR.error, sel: col('--select-blue') || '#0a84ff', selFill: col('--select-blue-fill') || 'rgba(10, 132, 255, 0.2)', ais: col('--plot-ais') || '#7ecfb2' }
    const p = { x: 0, y: 0 }
    let raf = 0, lastT = -1, lastKey = '', lastGhost = -1
    // Splash start times per buoy index (typed, preallocated); known = buoys already on the plot.
    const splash = new Float64Array(MAX_SPLASH), known = { n: -1 }
    let splashing = false
    let bag = makeBag(MAX_REVEAL)
    const hitPool: { id: number | string; x: number; y: number; r: number }[] = Array.from({ length: MAX_REVEAL }, () => ({ id: 0, x: 0, y: 0, r: 0 }))
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
      const { showReveal: reveal, selectedChannel: sel, selectedHz: selHz, allBearings: all, showAuto: sa, showManual: sm, manual: man, fixSource: _fs, arm: armSt } = props.current
      const dpr = capDpr(devicePixelRatio)
      const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr)
      // New run: recentre on the buoy field (same as native `load()`).
      if (st.scenarioId !== lastScen.current.id || st.seed !== lastScen.current.seed) {
        lastScen.current = { id: st.scenarioId, seed: st.seed }
        setCam(recentrePlotCamera())
      }
      const cam = camRef.current, span = cam.spanM
      const armKey = armSt?.phase === 'aim' ? `aim${armSt.buoyId}` : armSt?.phase ?? 'idle'
      const dtSnap = props.current.detune?.getSnapshot() ?? 0
      const fixSnap = props.current.fix?.getSnapshot() ?? 0
      const nightOn = !!props.current.night
      const nightFlash = nightOn && nightBeaconOn(now / 1000) ? '1' : '0'
      const fadeKey = props.current.fadeS ?? fadeSRef.current
      const key = `${w}x${h}:${reveal}:${span}:${cam.cx}:${cam.cy}:${camTick.current}:${sel}:${selHz}:${all}:${sa}:${sm}:${fs}:${armKey}:${dtSnap}:${fixSnap}:${JSON.stringify(man)}:${nightOn ? '1' : '0'}:${nightFlash}:${fadeKey}`
      const base = !(t?.simT === lastT && key === lastKey)
      if (!base && gv === lastGhost && !splashing) return
      const v = fitView(w, h, span, cam.cx, cam.cy)
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
      ctx.beginPath(); ctx.moveTo(toScreenX(v, 0), 0); ctx.lineTo(toScreenX(v, 0), h); ctx.moveTo(0, toScreenY(v, 0)); ctx.lineTo(w, toScreenY(v, 0)); ctx.stroke()
      ctx.font = `${10 * dpr}px ui-monospace, Menlo, monospace`; ctx.fillStyle = C.text
      ctx.fillText('N', toScreenX(v, 0) + 4 * dpr, 12 * dpr)
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

      // Z-order: nav line, then the plane glyph, then the green trail (nav before the glyph, trail after).
      const st = client.status
      const wall = simTWall.current
      if (wall.t !== st.simT) { wall.t = st.simT; wall.wall = performance.now() / 1000 }
      const simT = displaySimTime(st.simT, st.playing, st.rate, wall.wall, performance.now() / 1000)
      const enginePose = { x: t.aircraft.x, y: t.aircraft.y, headingRad: (t.aircraft.hdgDeg * Math.PI) / 180, altM: t.aircraft.altM, speedMps: t.aircraft.gsMps }
      const pose = samplePlane(simT, enginePose)
      const toSX = (x: number) => toScreenX(v, x), toSY = (y: number) => toScreenY(v, y)
      const ps = planeState()
      drawPlaneNav(ctx, ps.navX, ps.navY, ps.navCount, toSX, toSY, ps.navStyle, dpr)
      const ax = toSX(pose.x), ay = toSY(pose.y)
      ctx.save(); ctx.translate(ax, ay); ctx.rotate(glyphRotationRad(pose.headingRad)); ctx.fillStyle = C.ac
      ctx.beginPath(); ctx.moveTo(0, -8 * dpr); ctx.lineTo(6 * dpr, 6 * dpr); ctx.lineTo(0, 3 * dpr); ctx.lineTo(-6 * dpr, 6 * dpr); ctx.closePath(); ctx.fill()
      if (props.current.night) {
        for (const l of NIGHT_NAV_LIGHTS) {
          ctx.fillStyle = `rgba(${Math.round(l.r * 255)},${Math.round(l.g * 255)},${Math.round(l.b * 255)},${l.a})`
          ctx.beginPath(); ctx.arc(l.x * dpr, l.y * dpr, l.radius * dpr, 0, Math.PI * 2); ctx.fill()
        }
        if (nightBeaconOn(performance.now() / 1000)) {
          const b = NIGHT_BEACON
          ctx.fillStyle = `rgba(${Math.round(b.r * 255)},${Math.round(b.g * 255)},${Math.round(b.b * 255)},${b.a})`
          ctx.beginPath(); ctx.arc(b.x * dpr, b.y * dpr, b.radius * dpr, 0, Math.PI * 2); ctx.fill()
        }
      }
      ctx.restore()
      drawPlaneTrail(ctx, ps.trail, toSX, toSY, ps.trailStyle, dpr)
      if (ps.centre) {
        const sx = toSX(ps.centre.x), sy = toSY(ps.centre.y)
        ctx.strokeStyle = NAV_RGB; ctx.lineWidth = 1.5 * dpr
        ctx.beginPath(); ctx.arc(sx, sy, 4 * dpr, 0, Math.PI * 2); ctx.stroke()
      }
      if (ps.points.length) {
        ctx.strokeStyle = NAV_RGB; ctx.fillStyle = NAV_RGB; ctx.lineWidth = 1 * dpr; ctx.setLineDash([4 * dpr, 4 * dpr])
        ctx.beginPath()
        for (let i = 0; i < ps.points.length; i++) {
          const sx = toSX(ps.points[i]!.x), sy = toSY(ps.points[i]!.y)
          if (i) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy)
        }
        ctx.stroke(); ctx.setLineDash([])
        for (const q of ps.points) {
          const sx = toSX(q.x), sy = toSY(q.y)
          ctx.beginPath(); ctx.arc(sx, sy, 3 * dpr, 0, Math.PI * 2); ctx.fill()
        }
      }
      void props.current.planeTick

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
          ctx.save(); ctx.strokeStyle = C.sel || '#0a84ff'; ctx.fillStyle = C.selFill || 'rgba(10, 132, 255, 0.2)'; ctx.lineWidth = 3 * dpr
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

      // Auto fixes are not drawn (SHOW_AUTO_FIXES). crossFixes maths stay for drop planning.

      // Operator FIX tracks: ellipses, marks, legs (dim closed legs), short tags; track name on the leg.
      // Cyan snapshot bearings fade over fixFadeS of sim time (default 2 min).
      const fx = props.current.fix
      if (fx && fx.fixes.length) {
        ctx.font = `600 ${10 * dpr}px ui-monospace, Menlo, monospace`
        const fadeS = props.current.fadeS ?? fadeSRef.current
        const simT = t.simT ?? 0
        ctx.strokeStyle = FIX_LINE; ctx.lineWidth = 1.25 * dpr; ctx.setLineDash([])
        for (const f of fx.fixes) {
          const a = fixLineAlpha(simT - f.tS, fadeS)
          if (a <= 0.01) continue
          ctx.globalAlpha = a
          for (const ray of f.rays ?? []) {
            const th = (ray.brgDeg * Math.PI) / 180
            ctx.beginPath()
            ctx.moveTo(toScreenX(v, ray.x), toScreenY(v, ray.y))
            ctx.lineTo(toScreenX(v, ray.x + Math.sin(th) * BEARING_LEN_M), toScreenY(v, ray.y + Math.cos(th) * BEARING_LEN_M))
            ctx.stroke()
          }
        }
        ctx.globalAlpha = 1
        for (const leg of fx.legs) {
          const pts = leg.fixIds.map((id) => fx.fixes.find((f) => f.id === id)).filter(Boolean) as typeof fx.fixes
          if (pts.length < 2) continue
          const track = fx.tracks.find((tr) => tr.id === leg.trackId)
          ctx.globalAlpha = leg.closed ? 0.4 : 1
          ctx.strokeStyle = FIX_COLOR_RGB[DEFAULT_FIX_COLOR]; ctx.lineWidth = (leg.closed ? 1.25 : 2) * dpr
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
            ctx.fillStyle = FIX_COLOR_RGB[DEFAULT_FIX_COLOR]
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
          const col = FIX_COLOR_RGB[f.color ?? DEFAULT_FIX_COLOR]
          // Visible floor so a tight cut still reads as an ellipse on an 18 km plot.
          const majPx = Math.max(20 * dpr, el.semiMajorM / v.mPerPx)
          const minPx = Math.max(12 * dpr, el.semiMinorM / v.mPerPx)
          ctx.save()
          ctx.translate(sx, sy)
          // orientDeg is °T (0 = north); canvas +X is east → rotate (θ − 90°).
          ctx.rotate(((el.orientDeg - 90) * Math.PI) / 180)
          ctx.strokeStyle = col; ctx.lineWidth = 1.5 * dpr; ctx.globalAlpha *= 0.75
          ctx.beginPath(); ctx.ellipse(0, 0, majPx, minPx, 0, 0, Math.PI * 2); ctx.stroke()
          ctx.restore()
          ctx.globalAlpha = leg?.closed ? 0.45 : 1
          drawFixShape(ctx, f.shape ?? DEFAULT_FIX_SHAPE, sx, sy, 6 * dpr, col, 2 * dpr)
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
        ctx.globalAlpha = 1
        for (let i = 0; i < n; i++) {
          ctx.fillStyle = FIX_COLOR_RGB[fx.fixes[i]!.color ?? DEFAULT_FIX_COLOR]
          ctx.fillText(fx.fixes[i]!.tag, outX[i] + 2 * dpr, outY[i] + 10 * dpr)
        }
      }

      // Reveal positions (instructor marks only — no text dump). Zero heap traffic on the hot path.
      for (let i = 0; i < hitPool.length; i++) hitPool[i].r = 0
      hitCount.n = 0
      if (reveal && t.truth) {
        const contacts = revealContacts(t.truth.contacts, true)
        if (contacts.length > bag.cap) bag = makeBag(Math.max(contacts.length, t.truth.contacts.length))
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
      // AIS: generic fictional surface tracks (name only on the plot; course/speed on the card).
      const aisOn = aisEffective(props.current.showAis, props.current.difficulty)
      if (aisOn && t.truth) {
        const ships = t.aisTracks?.length
          ? t.aisTracks.map((a) => ({ id: a.id, label: a.name, sourceId: a.id, x: a.x, y: a.y, crsDeg: a.crsDeg, spdMps: a.spdMps, category: 'surface' as const, active: true }))
          : aisContacts(t.truth.contacts, true, props.current.difficulty)
        ctx.font = `600 ${10 * dpr}px ui-monospace, Menlo, monospace`
        for (const c of ships) {
          const sx = toScreenX(v, c.x), sy = toScreenY(v, c.y)
          const shipId = String(c.sourceId ?? c.id)
          const aff = aisAffiliation(shipId)
          const color = AIS_AFFILIATION_RGB[aff]
          const pk = props.current.picked
          const pickedAis = !!pk && pk.category === 'surface' && String(pk.sourceId ?? pk.id) === shipId
          drawSailboat(ctx, sx, sy, c.crsDeg, color, 11 * dpr, (pickedAis ? 2 : 1.25) * dpr, pickedAis)
          ctx.fillStyle = color
          const name = (c.label || c.sourceId || `C${c.id}`).toUpperCase()
          ctx.fillText(name, sx + 10 * dpr, sy + 4 * dpr)
          if (hitCount.n < hitPool.length) {
            const h = hitPool[hitCount.n++]
            h.id = c.id; h.x = sx; h.y = sy; h.r = 14 * dpr
          }
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
    const aisOn = aisEffective(props.current.showAis, props.current.difficulty)
    if (!props.current.showReveal && !aisOn) return null
    const c = ref.current; if (!c) return null
    const rect = c.getBoundingClientRect(), dpr = c.width / Math.max(1, rect.width)
    const px = (e.clientX - rect.left) * dpr, py = (e.clientY - rect.top) * dpr
    let best: { id: number | string; d: number } | null = null
    for (let i = 0; i < revealHits.current.length; i++) {
      // hitCount lives inside the effect; use r>0 as live flag — kept in sync each draw
      const h = revealHits.current[i]
      if (!h.r) continue
      const d = Math.hypot(px - h.x, py - h.y)
      if (d <= h.r && (!best || d < best.d)) best = { id: h.id, d }
    }
    return best?.id ?? null
  }
  useEffect(() => {
    setPicked((p) => {
      if (!p) return p
      const aisOn = aisEffective(showAis, difficulty)
      if (p.category === 'subsurface') return showReveal ? p : null
      if (p.category === 'surface') return aisOn ? p : null
      return null
    })
  }, [showReveal, showAis, difficulty])
  const hitLaidFix = (e: React.PointerEvent | React.MouseEvent) => {
    const fx = props.current.fix, v = viewRef.current, c = ref.current
    if (!fx || !fx.fixes.length || !v || !c) return null
    const rect = c.getBoundingClientRect(), dpr = c.width / Math.max(1, rect.width)
    const px = (e.clientX - rect.left) * dpr, py = (e.clientY - rect.top) * dpr
    const marks = fx.fixes.map((f) => ({ id: f.id, sx: toScreenX(v, f.x), sy: toScreenY(v, f.y) }))
    return hitFix(marks, px, py, FIX_HIT_PX * dpr)
  }
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
  dropCapRef.current = dropping()
  brgRef.current = brgArmed
  const cameraOn = () => plotCameraAllows({ dropCaptures: dropCapRef.current, brgArmed: brgRef.current })
  const clientWorld = (cam: PlotCamera, clientX: number, clientY: number) => {
    const c = ref.current; if (!c) return null
    const rect = c.getBoundingClientRect(), dpr = c.width / Math.max(1, rect.width)
    const v = fitView(c.width, c.height, cam.spanM, cam.cx, cam.cy)
    return toWorld(v, (clientX - rect.left) * dpr, (clientY - rect.top) * dpr)
  }
  useEffect(() => {
    const c = ref.current; if (!c) return
    const onWheel = (e: WheelEvent) => {
      if (!cameraOn()) return
      e.preventDefault()
      const cam = camRef.current
      const w = clientWorld(cam, e.clientX, e.clientY); if (!w) return
      const factor = e.deltaY < 0 ? 1 / PLOT_WHEEL_FACTOR : PLOT_WHEEL_FACTOR
      setCam(zoomPlotCamera(cam, factor, w.x, w.y))
    }
    c.addEventListener('wheel', onWheel, { passive: false })
    return () => c.removeEventListener('wheel', onWheel)
  }, [client])
  return (<>
    <canvas ref={ref} data-testid="tactical" aria-label="Tactical plot" data-arm={dropping() ? 'drop' : (arm?.phase ?? 'idle')}
      className={drop && dropping() ? 'dropping' : undefined}
      style={{ cursor: onManual || dropping() || brgArmed ? 'crosshair' : undefined, touchAction: 'none' }}
      onPointerDown={(e) => {
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
        // Two-finger pinch / pan: camera only, and only when drop and BRG are idle.
        if (pointers.current.size >= 2 && cameraOn()) {
          const pts = [...pointers.current.values()]
          const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
          const midX = (pts[0].x + pts[1].x) / 2, midY = (pts[0].y + pts[1].y) / 2
          pinch.current = { dist: Math.max(1, dist), midX, midY, cam: { ...camRef.current } }
          // Cancel any one-finger press so this cannot start a drop, a bearing, or a card pick.
          if (press.current) { clearTimeout(press.current.timer); press.current = null }
          dragRef.current = null; aimTap.current = false; pan0.current = null
          try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* synthetic */ }
          return
        }
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
          // Empty plot: one-finger drag pans; a still tap picks / dismisses a card; double-tap recentres.
          try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* synthetic */ }
          press.current = { x: e.clientX, y: e.clientY, moved: false, timer: 0 }
          dragRef.current = -1 // sentinel: empty-plot tap or pan
          pan0.current = cameraOn() ? { x: e.clientX, y: e.clientY, cam: { ...camRef.current } } : null
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
        if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
        if (pinch.current && pointers.current.size >= 2 && cameraOn()) {
          const pts = [...pointers.current.values()].slice(0, 2)
          const dist = Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y))
          const midX = (pts[0].x + pts[1].x) / 2, midY = (pts[0].y + pts[1].y) / 2
          const start = pinch.current
          const w0 = clientWorld(start.cam, start.midX, start.midY); if (!w0) return
          let cam = zoomPlotCamera(start.cam, start.dist / dist, w0.x, w0.y)
          const w1 = clientWorld(cam, midX, midY)
          if (w1) cam = panPlotCamera(cam, w0.x - w1.x, w0.y - w1.y)
          setCam(cam)
          return
        }
        const dp = dropPress.current
        if (dp && drop) {
          if (e.pointerId !== dp.id) return
          if (!dp.moved) { if (!exceedsSlop(dp.x, dp.y, e.clientX, e.clientY)) return; dp.moved = true }
          const w = world(e); if (w) drop.dispatch({ type: 'drag', at: { x: w.x, y: w.y } }); return
        }
        const id = dragRef.current; if (id === null) return
        const pr = press.current
        if (pr && !pr.moved) { if (!exceedsSlop(pr.x, pr.y, e.clientX, e.clientY)) return; pr.moved = true; clearTimeout(pr.timer) }
        // Empty-plot drag: pan (mouse or one finger). Not while drop/BRG own the plot; not on a buoy.
        if (id === -1) {
          const start = pan0.current
          if (pr?.moved && start && cameraOn()) {
            const c = ref.current
            if (c) {
              const rect = c.getBoundingClientRect(), dpr = c.width / Math.max(1, rect.width)
              const v = fitView(c.width, c.height, start.cam.spanM, start.cam.cx, start.cam.cy)
              const dx = -(e.clientX - start.x) * dpr * v.mPerPx
              const dy = (e.clientY - start.y) * dpr * v.mPerPx
              setCam(panPlotCamera(start.cam, dx, dy))
            }
          }
          return
        }
        if (aimTap.current) return // aim tap: placement on up
        const w = world(e); if (w) setFrom(id, w.x, w.y, false)
      }}
      onPointerUp={(e) => {
        pointers.current.delete(e.pointerId)
        if (pinch.current) {
          if (pointers.current.size < 2) pinch.current = null
          dragRef.current = null; aimTap.current = false; pan0.current = null
          if (press.current) { clearTimeout(press.current.timer); press.current = null }
          return
        }
        const dp = dropPress.current
        if (dp && drop) { if (e.pointerId !== dp.id) return; dropPress.current = null; drop.dispatch({ type: 'release' }); return }
        const id = dragRef.current; const aiming = aimTap.current
        dragRef.current = null; aimTap.current = false
        const pr = press.current; press.current = null; if (pr) clearTimeout(pr.timer)
        pan0.current = null
        if (id === null) return
        const w = world(e)
        // Empty-plot tap (sentinel -1): double-tap recentres (and dismisses a card); otherwise pick / dismiss.
        if (id === -1) {
          if (pr && !pr.moved) {
            const r = plotDoubleTap(dbl.current, e.clientX, e.clientY, performance.now() / 1000)
            dbl.current = r.last
            if (r.kind === 'recentre') { setCam(recentrePlotCamera()); setPicked(null); setPickedFixId(null); return }
            if (planeState().arm !== 'none' && w) { handlePlaneTap(w.x, w.y); return }
            const fid = hitLaidFix(e)
            if (fid !== null) { setPickedFixId(fid); setPicked(null); return }
            setPickedFixId(null)
            const rid = hitReveal(e)
            if (rid !== null) {
              const tac = client.status.tactical
              if (typeof rid === 'string') {
                // AIS ships come from engine.aisTracks (string ids), not truth contacts.
                const a = tac?.aisTracks?.find((x) => x.id === rid)
                setPicked(a ? ({ id: -1, label: a.name, sourceId: a.id, x: a.x, y: a.y, crsDeg: a.crsDeg, spdMps: a.spdMps, category: 'surface', active: true } as unknown as TruthContact) : null)
              } else setPicked(tac?.truth?.contacts.find((x) => x.id === rid) ?? null)
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
        pointers.current.clear(); pinch.current = null; pan0.current = null
        if (dropPress.current && drop) { dropPress.current = null; drop.dispatch({ type: 'cancel' }); return }
        dragRef.current = null; aimTap.current = false; if (press.current) clearTimeout(press.current.timer); press.current = null
      }}
      onContextMenu={(e) => e.preventDefault()}
      onDoubleClick={(e) => {
        if (dropping() || brgArmed) return
        const h = hitBuoy(e)
        // Existing: double-click a DIFAR buoy clears its manual bearing.
        if (h) { onManual?.(h.id, null, true); return }
        if (cameraOn()) { setCam(recentrePlotCamera()); setPicked(null) }
      }} />
    <canvas ref={oref} className="tac-overlay" data-testid="tactical-overlay" aria-hidden />
    <div className="ring-scale" data-testid="ring-scale" aria-hidden>{formatRingScale(2000, units.distance)}</div>
    {picked && picked.category === 'surface' && aisEffective(showAis, difficulty) && (() => {
      const tac = client.status.tactical
      const track = picked.sourceId ? tac?.aisTracks?.find((x) => x.id === picked.sourceId) : undefined
      const info = aisInfoFromTrack(track ?? {
        id: String(picked.sourceId ?? picked.id),
        name: picked.label,
        x: picked.x, y: picked.y, crsDeg: picked.crsDeg, spdMps: picked.spdMps,
      }, aisSourceForSeed(client.status.seed), client.status.simT)
      const aff = aisAffiliation(info.id)
      const v = viewRef.current, c = ref.current
      if (!v || !c) return null
      const rect = c.getBoundingClientRect()
      const dpr = c.width / Math.max(1, rect.width)
      const frame = aisCardFrame(toScreenX(v, picked.x) / dpr, toScreenY(v, picked.y) / dpr, { x: 0, y: 0, width: rect.width, height: rect.height })
      if (!frame) return null
      void affTick
      return (
        <div
          className="ais-card readout"
          data-testid="ais-card"
          role="dialog"
          aria-label="AIS contact"
          style={{ left: frame.x, top: frame.y, width: frame.width }}
        >
          <div className="ais-card-head" style={{ color: AIS_AFFILIATION_RGB[aff] }}>{info.callsign.toUpperCase()}</div>
          <div>Class  {info.shipClass ? info.shipClass.toUpperCase() : '—'}</div>
          <div>Type  {info.type ? info.type.toUpperCase() : '—'}</div>
          <div>{courseSpeed(info.crsDeg, mpsFromSpeed(info.spdKts, 'kts'), units)}</div>
          <div className="ais-card-aff" role="group" aria-label="Affiliation">
            {AIS_AFFILIATIONS.map((a) => (
              <button key={a} type="button" aria-label={AIS_AFFILIATION_LABEL[a]} aria-pressed={aff === a}
                className={aff === a ? 'on' : undefined}
                onClick={() => setAisAffiliation(info.id, a as AisAffiliation)}>
                <i style={{ background: AIS_AFFILIATION_RGB[a] }} />
                {AIS_AFFILIATION_LABEL[a]}
              </button>
            ))}
          </div>
        </div>
      )
    })()}
    {picked && picked.category !== 'surface' && showReveal && (() => {
      const buoy = client.status.tactical?.buoys.find((b) => b.channel === selectedChannel)
      const rb = revealRangeBrg(buoy, picked)
      const spd = picked.spdMps ?? (picked.spdKts != null ? mpsFromSpeed(picked.spdKts, 'kts') : 0)
      const cls = (picked.label || picked.sourceId || `C${picked.id}`).toUpperCase()
      return (
        <div className="reveal-card readout" data-testid="reveal-card" role="dialog" aria-label="Reveal contact">
          <div className="reveal-card-head">{cls}</div>
          <div>{courseSpeed(picked.crsDeg, spd, units)}{picked.depthM !== undefined ? ` · ${formatDepth(picked.depthM, units.depth)}` : ''}</div>
          {rb && <div>{rangeBearing(rb.rngM, rb.brgDeg, units)}</div>}
          {!rb && buoy && <div className="dim">On selected buoy</div>}
          {!rb && !buoy && <div className="dim">Select a buoy for RNG/BRG</div>}
        </div>
      )
    })()}
    {planeState().menuOpen && (() => {
      const v = viewRef.current, c = ref.current
      if (!v || !c) return null
      const rect = c.getBoundingClientRect()
      const frame = planeMenuFrame(rect.width - 20, 52, { x: 0, y: 0, width: rect.width, height: rect.height })
      if (!frame) return null
      const tac = client.status.tactical?.aircraft
      return (
        <div style={{ position: 'absolute', left: frame.x, top: frame.y, width: frame.width, zIndex: 7 }}>
          <PlaneMenu simT={client.status.simT} fallback={{ x: tac?.x ?? 0, y: tac?.y ?? 7000 }} />
        </div>
      )
    })()}
    {pickedFixId != null && fix && (() => {
      const f = fix.fixes.find((x) => x.id === pickedFixId)
      const v = viewRef.current, c = ref.current
      if (!f || !v || !c) return null
      const rect = c.getBoundingClientRect()
      const dpr = c.width / Math.max(1, rect.width)
      const frame = fixMenuFrame(toScreenX(v, f.x) / dpr, toScreenY(v, f.y) / dpr, { x: 0, y: 0, width: rect.width, height: rect.height })
      if (!frame) return null
      return (
        <div
          className="fix-menu"
          data-testid="fix-menu"
          role="dialog"
          aria-label="Fix menu"
          style={{ left: frame.x, top: frame.y, width: frame.width }}
        >
          <button type="button" className="fix-menu-del" onClick={() => { fix.deleteFix(f.id); setPickedFixId(null) }}>Delete</button>
          <div className="fix-menu-colors" role="group" aria-label="Colour">
            {FIX_COLORS.map((col) => (
              <button key={col} type="button" aria-label={col} aria-pressed={f.color === col}
                className={f.color === col ? 'on' : undefined}
                style={{ background: FIX_COLOR_RGB[col] }}
                onClick={() => fix.setFixColor(f.id, col as FixColor)} />
            ))}
          </div>
          <div className="fix-menu-shapes" role="group" aria-label="Shape">
            {FIX_SHAPES.map((sh) => (
              <button key={sh} type="button" aria-label={sh} aria-pressed={f.shape === sh}
                className={f.shape === sh ? 'on' : undefined}
                onClick={() => fix.setFixShape(f.id, sh as FixShape)}>
                <FixShapeIcon shape={sh} color={FIX_COLOR_RGB[f.color]} />
              </button>
            ))}
          </div>
        </div>
      )
    })()}
  </>)
}

function FixShapeIcon({ shape, color }: { shape: FixShape; color: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      {shape === 'multiply' && <path d="M4 4 L14 14 M14 4 L4 14" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" />}
      {shape === 'plus' && <path d="M3 9 H15 M9 3 V15" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" />}
      {shape === 'sub' && <path d="M9 3 L15 15 H3 Z" fill={color} />}
      {shape !== 'multiply' && shape !== 'plus' && shape !== 'sub' && (
        <polygon fill={color} points={starPoints(9, 9, 7, shape === 'star.fill' ? 5 : shape === 'staroflife.fill' ? 6 : 8, shape === 'burst.fill' ? 0.35 : 0.45)} />
      )}
    </svg>
  )
}
function starPoints(x: number, y: number, r: number, points: number, inner: number): string {
  const out: string[] = []
  for (let i = 0; i < points * 2; i++) {
    const a = i * Math.PI / points - Math.PI / 2
    const rad = r * (i % 2 === 0 ? 1 : inner)
    out.push(`${x + Math.cos(a) * rad},${y + Math.sin(a) * rad}`)
  }
  return out.join(' ')
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
