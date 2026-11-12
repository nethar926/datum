/**
 * Plane routes and drawing style. Sonya owns the closed-form kinematics: for
 * each route (circle, point-to-point, figure 8), position and heading are a
 * pure function of sim time `t`. The UI samples that once per frame and never
 * integrates step by step. This file is the UI-side placeholder until her
 * source lands, plus the capped trail ring and persisted line styles.
 */
import { fixAvoidsCrease, fixMenuFrame, type FixLayoutRect } from './fixStyle'

export const PLANE_MODES = ['circle', 'pointToPoint', 'figure8'] as const
export type PlaneRouteMode = (typeof PLANE_MODES)[number]
export const PLANE_MODE_LABEL: Record<PlaneRouteMode, string> = {
  circle: 'Circle',
  pointToPoint: 'Point-to-point',
  figure8: 'Figure 8',
}

export const TRAIL_PATTERNS = ['dotted', 'dashed', 'solid'] as const
export type PlaneTrailPattern = (typeof TRAIL_PATTERNS)[number]
export const NAV_PATTERNS = ['dashed', 'solid'] as const
export type PlaneNavPattern = (typeof NAV_PATTERNS)[number]
export const LINE_WEIGHTS = ['thin', 'thick'] as const
export type PlaneLineWeight = (typeof LINE_WEIGHTS)[number]
export const LINE_WIDTH: Record<PlaneLineWeight, number> = { thin: 1.5, thick: 3.25 }

export type PlanePose = { x: number; y: number; headingRad: number }
export type PlaneWayPoint = { x: number; y: number }

export type PlaneRouteSpec = {
  mode: PlaneRouteMode
  speedMps: number
  altitudeFt: number
  t0: number
  centerX: number
  centerY: number
  radiusM: number
  phase0: number
  points: PlaneWayPoint[]
}

export type PlaneRouteSource = {
  pose(spec: PlaneRouteSpec, atSimTime: number): PlanePose
  navPoints(spec: PlaneRouteSpec, atSimTime: number, xs: Float64Array, ys: Float64Array): number
}

export const NMI_M = 1852
export const FT_M = 0.3048
export const DEFAULT_RADIUS_NMI = 4
export const DEFAULT_RADIUS_M = DEFAULT_RADIUS_NMI * NMI_M
export const DEFAULT_SPEED_KTS = 210
export const DEFAULT_ALTITUDE_FT = 1476
export const MIN_POINTS = 2
export const MAX_POINTS = 10
export const TRAIL_CAP = 240
export const NAV_CAP = 64
export const NAV_HORIZON_M = 8 * NMI_M
export const PLANE_MENU_W = 268
export const PLANE_MENU_H = 348
export const TRAIL_RGB = '#30d158'
export const NAV_RGB = '#0a84ff'
export const TRAIL_KEY = 'datum.plane.trail'
export const NAV_KEY = 'datum.plane.nav'

export const mpsFromKts = (kts: number) => kts * NMI_M / 3600
export const ktsFromMps = (mps: number) => mps * 3600 / NMI_M
export const metersFromNmi = (nmi: number) => nmi * NMI_M
export const nmiFromMeters = (m: number) => m / NMI_M

export function headingDeg(rad: number): number {
  let d = rad * 180 / Math.PI
  d %= 360
  return d < 0 ? d + 360 : d
}

export function headingRad(dx: number, dy: number): number {
  return Math.atan2(dx, dy)
}

export function routeIsReady(spec: PlaneRouteSpec): boolean {
  if (!(spec.speedMps > 0)) return false
  if (spec.mode === 'pointToPoint') return spec.points.length >= MIN_POINTS && spec.points.length <= MAX_POINTS
  return spec.radiusM > 0
}

export type PlaneTrailStyle = { pattern: PlaneTrailPattern; weight: PlaneLineWeight }
export type PlaneNavStyle = { pattern: PlaneNavPattern; weight: PlaneLineWeight }
export const defaultTrailStyle = (): PlaneTrailStyle => ({ pattern: 'solid', weight: 'thin' })
export const defaultNavStyle = (): PlaneNavStyle => ({ pattern: 'dashed', weight: 'thin' })

export function trailStyleRaw(s: PlaneTrailStyle): string { return `${s.pattern}-${s.weight}` }
export function navStyleRaw(s: PlaneNavStyle): string { return `${s.pattern}-${s.weight}` }
export function parseTrailStyle(s: string): PlaneTrailStyle | undefined {
  const p = s.split('-')
  if (p.length !== 2) return
  if (!(TRAIL_PATTERNS as readonly string[]).includes(p[0]!) || !(LINE_WEIGHTS as readonly string[]).includes(p[1]!)) return
  return { pattern: p[0] as PlaneTrailPattern, weight: p[1] as PlaneLineWeight }
}
export function parseNavStyle(s: string): PlaneNavStyle | undefined {
  const p = s.split('-')
  if (p.length !== 2) return
  if (!(NAV_PATTERNS as readonly string[]).includes(p[0]!) || !(LINE_WEIGHTS as readonly string[]).includes(p[1]!)) return
  return { pattern: p[0] as PlaneNavPattern, weight: p[1] as PlaneLineWeight }
}

export function trailDashes(pattern: PlaneTrailPattern, dpr = 1): number[] {
  if (pattern === 'dotted') return [1.5 * dpr, 3.5 * dpr]
  if (pattern === 'dashed') return [8 * dpr, 6 * dpr]
  return []
}
export function navDashes(pattern: PlaneNavPattern, dpr = 1): number[] {
  return pattern === 'dashed' ? [8 * dpr, 6 * dpr] : []
}

const mem = new Map<string, string>()
function store(): { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void } {
  try { if (typeof localStorage !== 'undefined') return localStorage } catch { /* private mode */ }
  return { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => { mem.set(k, v) }, removeItem: (k) => { mem.delete(k) } }
}
export function loadTrailStyle(): PlaneTrailStyle {
  const v = store().getItem(TRAIL_KEY)
  return (v && parseTrailStyle(v)) || defaultTrailStyle()
}
export function saveTrailStyle(s: PlaneTrailStyle): void { store().setItem(TRAIL_KEY, trailStyleRaw(s)) }
export function loadNavStyle(): PlaneNavStyle {
  const v = store().getItem(NAV_KEY)
  return (v && parseNavStyle(v)) || defaultNavStyle()
}
export function saveNavStyle(s: PlaneNavStyle): void { store().setItem(NAV_KEY, navStyleRaw(s)) }
export function resetPlaneStylesForTests(): void { store().removeItem(TRAIL_KEY); store().removeItem(NAV_KEY) }

export type PlaneLayoutRect = FixLayoutRect
export function planeMenuFrame(
  anchorSX: number, anchorSY: number, plot: PlaneLayoutRect, crease?: PlaneLayoutRect | null,
): PlaneLayoutRect | null {
  return fixMenuFrame(anchorSX, anchorSY, plot, crease, PLANE_MENU_W, PLANE_MENU_H)
}
export function planeAvoidsCrease(frame: PlaneLayoutRect, crease?: PlaneLayoutRect | null): boolean {
  return fixAvoidsCrease(frame, crease)
}

/** Capped ring. `push` never grows the buffers. Index 0 is oldest. */
export class PlaneTrail {
  static readonly cap = TRAIL_CAP
  readonly xs: Float64Array
  readonly ys: Float64Array
  readonly capacity: number
  private head = 0
  count = 0
  constructor(capacity = TRAIL_CAP) {
    this.capacity = Math.max(1, capacity)
    this.xs = new Float64Array(this.capacity)
    this.ys = new Float64Array(this.capacity)
  }
  push(x: number, y: number): void {
    this.xs[this.head] = x
    this.ys[this.head] = y
    this.head = (this.head + 1) % this.capacity
    if (this.count < this.capacity) this.count++
  }
  point(i: number, out: { x: number; y: number }): void {
    const k = (this.head - this.count + i + this.capacity) % this.capacity
    out.x = this.xs[k]!; out.y = this.ys[k]!
  }
  clear(): void { this.head = 0; this.count = 0 }
  static fade(oldestFirst: number, count: number): number {
    if (count <= 1) return 1
    return oldestFirst / (count - 1)
  }
}

function circlePose(spec: PlaneRouteSpec, t: number): PlanePose {
  const r = Math.max(1, spec.radiusM)
  const w = spec.speedMps / r
  const phi = spec.phase0 + w * (t - spec.t0)
  const s = Math.sin(phi), c = Math.cos(phi)
  return { x: spec.centerX + r * s, y: spec.centerY + r * c, headingRad: headingRad(r * w * c, -r * w * s) }
}

function figure8Pose(spec: PlaneRouteSpec, t: number): PlanePose {
  const r = Math.max(1, spec.radiusM)
  const periodS = (6 * r) / Math.max(1e-6, spec.speedMps)
  const w = (2 * Math.PI) / periodS
  const phi = spec.phase0 + w * (t - spec.t0)
  const s = Math.sin(phi), c = Math.cos(phi)
  return {
    x: spec.centerX + r * s,
    y: spec.centerY + r * s * c,
    headingRad: headingRad(r * w * c, r * w * (c * c - s * s)),
  }
}

function pointToPointPose(spec: PlaneRouteSpec, t: number): PlanePose {
  const pts = spec.points
  if (pts.length < 2) {
    const p = pts[0] ?? { x: spec.centerX, y: spec.centerY }
    return { x: p.x, y: p.y, headingRad: 0 }
  }
  const lengths = new Array<number>(pts.length)
  let total = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!, b = pts[(i + 1) % pts.length]!
    total += Math.hypot(b.x - a.x, b.y - a.y)
    lengths[i] = total
  }
  if (total <= 1e-6) return { x: pts[0]!.x, y: pts[0]!.y, headingRad: 0 }
  let s = (spec.speedMps * (t - spec.t0)) % total
  if (s < 0) s += total
  let prev = 0
  for (let i = 0; i < pts.length; i++) {
    const end = lengths[i]!
    if (s <= end || i === pts.length - 1) {
      const a = pts[i]!, b = pts[(i + 1) % pts.length]!
      const u = (s - prev) / Math.max(1e-9, end - prev)
      return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, headingRad: headingRad(b.x - a.x, b.y - a.y) }
    }
    prev = end
  }
  return { x: pts[0]!.x, y: pts[0]!.y, headingRad: 0 }
}

/** UI-side placeholder. Sonya's closed-form source replaces this. */
export function planePose(spec: PlaneRouteSpec, atSimTime: number): PlanePose {
  if (spec.mode === 'circle') return circlePose(spec, atSimTime)
  if (spec.mode === 'figure8') return figure8Pose(spec, atSimTime)
  return pointToPointPose(spec, atSimTime)
}

export function planeNavPoints(spec: PlaneRouteSpec, atSimTime: number, xs: Float64Array, ys: Float64Array): number {
  const cap = Math.min(xs.length, ys.length, NAV_CAP)
  if (cap < 2 || !routeIsReady(spec)) return 0
  const horizonT = NAV_HORIZON_M / Math.max(1e-6, spec.speedMps)
  for (let i = 0; i < cap; i++) {
    const p = planePose(spec, atSimTime + horizonT * i / (cap - 1))
    xs[i] = p.x; ys[i] = p.y
  }
  return cap
}

export const placeholderPlaneSource: PlaneRouteSource = {
  pose: planePose,
  navPoints: planeNavPoints,
}

export function displaySimTime(simT: number, playing: boolean, rate: number, lastWall: number, now: number): number {
  if (!playing) return simT
  return simT + Math.max(0, now - lastWall) * rate
}

const scratchPt = { x: 0, y: 0 }

/** Draw the green trail as one path per style, in a fixed number of fade bands. */
export function drawPlaneTrail(
  ctx: CanvasRenderingContext2D,
  trail: PlaneTrail,
  toSX: (x: number) => number,
  toSY: (y: number) => number,
  style: PlaneTrailStyle,
  dpr: number,
): void {
  if (trail.count < 2) return
  const bands = 8
  const dash = trailDashes(style.pattern, dpr)
  const lw = LINE_WIDTH[style.weight] * dpr
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (let b = 0; b < bands; b++) {
    const i0 = Math.floor(b / bands * (trail.count - 1))
    const i1 = Math.floor((b + 1) / bands * (trail.count - 1))
    if (i1 <= i0) continue
    ctx.beginPath()
    for (let i = i0; i <= i1; i++) {
      trail.point(i, scratchPt)
      const x = toSX(scratchPt.x), y = toSY(scratchPt.y)
      if (i === i0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
    }
    const fade = PlaneTrail.fade(i1, trail.count)
    ctx.strokeStyle = TRAIL_RGB
    ctx.globalAlpha = 0.15 + 0.85 * fade
    ctx.lineWidth = lw
    ctx.setLineDash(dash)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
  ctx.setLineDash([])
}

export function drawPlaneNav(
  ctx: CanvasRenderingContext2D,
  xs: Float64Array, ys: Float64Array, n: number,
  toSX: (x: number) => number,
  toSY: (y: number) => number,
  style: PlaneNavStyle,
  dpr: number,
): void {
  if (n < 2) return
  ctx.beginPath()
  for (let i = 0; i < n; i++) {
    const x = toSX(xs[i]!), y = toSY(ys[i]!)
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y)
  }
  ctx.strokeStyle = NAV_RGB
  ctx.globalAlpha = 1
  ctx.lineWidth = LINE_WIDTH[style.weight] * dpr
  ctx.setLineDash(navDashes(style.pattern, dpr))
  ctx.stroke()
  ctx.setLineDash([])
}

// ----- session store (styles persist; route is session-only) -----

type Listener = () => void
const listeners = new Set<Listener>()
function bump(): void { for (const l of listeners) l() }
export function subscribePlane(onStoreChange: Listener): () => void {
  listeners.add(onStoreChange)
  return () => { listeners.delete(onStoreChange) }
}

export type PlaneArm = 'none' | 'centre' | 'points'

let menuOpen = false
let arm: PlaneArm = 'none'
let mode: PlaneRouteMode = 'circle'
let speedKts = DEFAULT_SPEED_KTS
let altitudeFt = DEFAULT_ALTITUDE_FT
let radiusNmi = DEFAULT_RADIUS_NMI
let centre: PlaneWayPoint | null = null
let points: PlaneWayPoint[] = []
let spec: PlaneRouteSpec | null = null
let trailStyle = loadTrailStyle()
let navStyle = loadNavStyle()
const trail = new PlaneTrail()
const navX = new Float64Array(NAV_CAP)
const navY = new Float64Array(NAV_CAP)
let navCount = 0
let pose: PlanePose = { x: 0, y: 7000, headingRad: Math.PI / 2 }
let lastTrailT = Number.NaN
let version = 0
let source: PlaneRouteSource = placeholderPlaneSource

export function setPlaneRouteSource(s: PlaneRouteSource | null): void {
  source = s ?? placeholderPlaneSource
}

export function planeState() {
  return { menuOpen, arm, mode, speedKts, altitudeFt, radiusNmi, centre, points, spec, trailStyle, navStyle, trail, navX, navY, navCount, pose, version }
}

export function planeVersion(): number { return version }
function changed(): void { version++; bump() }

export function setPlaneMenuOpen(open: boolean): void { if (menuOpen !== open) { menuOpen = open; changed() } }
export function togglePlaneMenu(): void { menuOpen = !menuOpen; changed() }
export function setPlaneMode(m: PlaneRouteMode): void { mode = m; arm = 'none'; changed() }
export function setPlaneArm(a: PlaneArm): void { arm = a; changed() }
export function setPlaneSpeedKts(v: number): void { speedKts = Math.max(1, v); changed() }
export function setPlaneAltitudeFt(v: number): void { altitudeFt = Math.max(0, v); changed() }
export function setPlaneRadiusNmi(v: number): void { radiusNmi = Math.max(0.1, v); changed() }
export function setPlaneTrailStyle(s: PlaneTrailStyle): void { trailStyle = s; saveTrailStyle(s); changed() }
export function setPlaneNavStyle(s: PlaneNavStyle): void { navStyle = s; saveNavStyle(s); changed() }

export function clearPlanePoints(): void { points = []; arm = 'points'; changed() }

export function handlePlaneTap(x: number, y: number): boolean {
  if (arm === 'none') return false
  if (arm === 'centre') { centre = { x, y }; arm = 'none'; changed(); return true }
  if (points.length < MAX_POINTS) points = points.concat({ x, y })
  if (points.length >= MAX_POINTS) arm = 'none'
  changed()
  return true
}

export function applyPlaneRoute(t: number, fallback: PlaneWayPoint): void {
  const c = centre ?? fallback
  const next: PlaneRouteSpec = {
    mode, speedMps: mpsFromKts(speedKts), altitudeFt, t0: t,
    centerX: c.x, centerY: c.y, radiusM: metersFromNmi(Math.max(0.1, radiusNmi)),
    phase0: 0, points: points.slice(),
  }
  if (!routeIsReady(next)) return
  if (!centre) centre = c
  spec = next
  arm = 'none'
  trail.clear()
  lastTrailT = Number.NaN
  samplePlane(t)
}

export function clearPlaneRoute(): void {
  spec = null; arm = 'none'; centre = null; points = []; navCount = 0
  trail.clear(); lastTrailT = Number.NaN
  changed()
}

export function resetPlaneRoute(): void {
  menuOpen = false
  mode = 'circle'
  speedKts = DEFAULT_SPEED_KTS
  altitudeFt = DEFAULT_ALTITUDE_FT
  radiusNmi = DEFAULT_RADIUS_NMI
  clearPlaneRoute()
}

export function samplePlane(t: number, engine?: PlanePose): PlanePose {
  pose = spec && routeIsReady(spec) ? source.pose(spec, t) : (engine ?? pose)
  if (lastTrailT !== t) { trail.push(pose.x, pose.y); lastTrailT = t }
  navCount = spec && routeIsReady(spec) ? source.navPoints(spec, t, navX, navY) : 0
  return pose
}

export function resetPlaneForTests(): void {
  resetPlaneStylesForTests()
  resetPlaneRoute()
  version = 0
}

/** CPU work of one 64-buoy frame that samples pose once, pushes the cap trail, and projects nav. */
export function preparePlaneFrame(
  buoyCount: number,
  trailBuf: PlaneTrail,
  navXs: Float64Array,
  navYs: Float64Array,
  specIn: PlaneRouteSpec,
  src: PlaneRouteSource,
  width: number,
  height: number,
  simTime: number,
): number {
  const poseNow = src.pose(specIn, simTime)
  trailBuf.push(poseNow.x, poseNow.y)
  const navN = src.navPoints(specIn, simTime, navXs, navYs)
  const spanM = 18000, cx = 0, cy = 0
  const mpp = spanM / Math.min(width, height)
  let n = 0
  for (let i = 0; i < buoyCount; i++) {
    const x = ((i % 8) * 800 - 2800)
    const y = (Math.floor(i / 8) * 800 - 2800)
    void (width / 2 + (x - cx) / mpp)
    void (height / 2 - (y - cy) / mpp)
    n++
  }
  const out = { x: 0, y: 0 }
  for (let i = 0; i < trailBuf.count; i++) {
    trailBuf.point(i, out)
    void (width / 2 + (out.x - cx) / mpp)
    void (height / 2 - (out.y - cy) / mpp)
    void PlaneTrail.fade(i, trailBuf.count)
    n++
  }
  for (let i = 0; i < navN; i++) {
    void (width / 2 + (navXs[i]! - cx) / mpp)
    void (height / 2 - (navYs[i]! - cy) / mpp)
    n++
  }
  void poseNow.headingRad
  return n
}

export const FRAME_BUDGET_S = 1 / 30

export function measurePlaneFrame(buoyCount = 64, repeats = 30, rate = 1): { seconds: number; marks: number; trailCount: number } {
  const trailBuf = new PlaneTrail()
  const navXs = new Float64Array(NAV_CAP)
  const navYs = new Float64Array(NAV_CAP)
  const specIn: PlaneRouteSpec = {
    mode: 'circle', speedMps: mpsFromKts(DEFAULT_SPEED_KTS), altitudeFt: DEFAULT_ALTITUDE_FT,
    t0: 0, centerX: 0, centerY: 0, radiusM: DEFAULT_RADIUS_M, phase0: 0, points: [],
  }
  const dt = rate / 30
  for (let i = 0; i < TRAIL_CAP; i++) {
    preparePlaneFrame(buoyCount, trailBuf, navXs, navYs, specIn, placeholderPlaneSource, 390, 844, i * dt)
  }
  const t0 = performance.now()
  let marks = 0
  for (let r = 0; r < repeats; r++) {
    marks = preparePlaneFrame(buoyCount, trailBuf, navXs, navYs, specIn, placeholderPlaneSource, 390, 844, (TRAIL_CAP + r) * dt)
  }
  return { seconds: (performance.now() - t0) / 1000 / Math.max(1, repeats), marks, trailCount: trailBuf.count }
}
