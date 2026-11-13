/**
 * Plane routes and drawing style. Sonya owns the closed-form kinematics: for
 * each route (circle, point-to-point, figure 8), position and heading are a
 * pure function of sim time `t`. The UI samples that once per frame and never
 * integrates step by step. Pose comes from Sonya's `planeRouteSource`.
 */
import { planeRouteSource as sonyaPlaneRouteSource } from '@acoustics'
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
export const NAV_PATTERNS = ['dashed', 'solid', 'discreet'] as const
export type PlaneNavPattern = (typeof NAV_PATTERNS)[number]
/** Settings display order: Discreet, Dashed, Solid. Stored values stay in NAV_PATTERNS order. */
export const NAV_DISPLAY_ORDER: readonly PlaneNavPattern[] = ['discreet', 'dashed', 'solid']
export const NAV_PATTERN_LABEL: Record<PlaneNavPattern, string> = {
  discreet: 'Discreet', dashed: 'Dashed', solid: 'Solid',
}
/** Discreet is a solid line at 20 % opacity. */
export function navOpacity(pattern: PlaneNavPattern): number { return pattern === 'discreet' ? 0.2 : 1 }

/** Old Thin/Thick tokens, still accepted when migrating persisted styles. */
export const LINE_WEIGHTS = ['thin', 'thick'] as const
export type PlaneLineWeightToken = (typeof LINE_WEIGHTS)[number]
/** Global trail/nav width in points (0.5–4, 0.5 steps). */
export type PlaneLineWeight = number
export const LINE_WEIGHT_MIN = 0.5
export const LINE_WEIGHT_MAX = 4
export const LINE_WEIGHT_STEP = 0.5
export const LINE_WEIGHT_KEY = 'datum.plane.lineWeight'
export const LINE_WIDTH_THIN = 1.5
export const LINE_WIDTH_THICK = 3.25
/** @deprecated Use `lineWidthPts`. Kept as a lookup of the old tokens. */
export const LINE_WIDTH: Record<PlaneLineWeightToken, number> = { thin: LINE_WIDTH_THIN, thick: 3.5 }

/** Snap to 0.5 pt inside [0.5, 4]. Midpoints (3.25) round half up, so Thick → 3.5. */
export function snapLineWeight(value: number): number {
  if (!Number.isFinite(value)) return LINE_WIDTH_THIN
  const clamped = Math.min(LINE_WEIGHT_MAX, Math.max(LINE_WEIGHT_MIN, value))
  return Math.round(clamped / LINE_WEIGHT_STEP + 1e-12) * LINE_WEIGHT_STEP
}
export function parseLineWeight(s: string): number | undefined {
  const k = s.trim().toLowerCase()
  if (k === 'thin') return snapLineWeight(LINE_WIDTH_THIN)
  if (k === 'thick') return snapLineWeight(LINE_WIDTH_THICK)
  const v = Number(k)
  if (!Number.isFinite(v)) return
  return snapLineWeight(v)
}
export function lineWidthPts(weight: PlaneLineWeight | PlaneLineWeightToken = loadLineWeight()): number {
  return typeof weight === 'number' ? snapLineWeight(weight) : LINE_WIDTH[weight]
}
export function lineWeightLabel(weight: number = loadLineWeight()): string {
  const w = snapLineWeight(weight)
  return Number.isInteger(w) ? `${w.toFixed(0)} pt` : `${w.toFixed(1)} pt`
}

export type PlanePose = { x: number; y: number; headingRad: number; altM: number; speedMps: number }
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
  /** Optional PTP fillet bound (rad/s). Undefined keeps Sonya's default (~15 deg/s). */
  maxTurnRateRadS?: number
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
/** ~15 deg/s; a missing spec value leaves Sonya's default for PTP fillets. */
export const DEFAULT_MAX_TURN_RATE_RAD_S = 15 * Math.PI / 180

/** Web chevron points north (−Y). Compass heading (0 = north, clockwise) rotates by heading alone.
 *  Native SF "airplane" points east, so it uses heading − 90°. */
export function glyphRotationRad(headingRad: number): number {
  return headingRad
}
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

export type PlaneTrailStyle = { pattern: PlaneTrailPattern; weight: PlaneLineWeightToken }
export type PlaneNavStyle = { pattern: PlaneNavPattern; weight: PlaneLineWeightToken }
export const defaultTrailStyle = (): PlaneTrailStyle => ({ pattern: 'solid', weight: 'thin' })
export const defaultNavStyle = (): PlaneNavStyle => ({ pattern: 'dashed', weight: 'thin' })

export function trailStyleRaw(s: PlaneTrailStyle): string { return `${s.pattern}-${s.weight}` }
export function navStyleRaw(s: PlaneNavStyle): string { return `${s.pattern}-${s.weight}` }
export function parseTrailStyle(s: string): PlaneTrailStyle | undefined {
  const p = s.split('-')
  if (p.length !== 2) return
  if (!(TRAIL_PATTERNS as readonly string[]).includes(p[0]!) || !(LINE_WEIGHTS as readonly string[]).includes(p[1]!)) return
  return { pattern: p[0] as PlaneTrailPattern, weight: p[1] as PlaneLineWeightToken }
}
export function parseNavStyle(s: string): PlaneNavStyle | undefined {
  const p = s.split('-')
  if (p.length !== 2) return
  if (!(NAV_PATTERNS as readonly string[]).includes(p[0]!) || !(LINE_WEIGHTS as readonly string[]).includes(p[1]!)) return
  return { pattern: p[0] as PlaneNavPattern, weight: p[1] as PlaneLineWeightToken }
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
export function storedLineWeight(raw: string | null | undefined): number | undefined {
  if (!raw) return
  const p = raw.split('-')
  const token = p.length >= 2 ? p[1] : raw
  return parseLineWeight(token!)
}
/** Collapse old per-line trail / nav thicknesses into one global value. The thicker wins. */
export function migrateLineWeight(trailRaw?: string | null, navRaw?: string | null): number {
  const tw = storedLineWeight(trailRaw ?? null)
  const nw = storedLineWeight(navRaw ?? null)
  if (tw != null && nw != null) return tw >= nw ? tw : nw
  if (tw != null) return tw
  if (nw != null) return nw
  return LINE_WIDTH_THIN
}
export function loadLineWeight(): number {
  const s = store().getItem(LINE_WEIGHT_KEY)
  if (s) {
    const w = parseLineWeight(s)
    if (w != null) return w
  }
  const w = migrateLineWeight(store().getItem(TRAIL_KEY), store().getItem(NAV_KEY))
  store().setItem(LINE_WEIGHT_KEY, String(w))
  return w
}
export function saveLineWeight(w: number): void { store().setItem(LINE_WEIGHT_KEY, String(snapLineWeight(w))) }
export function resetPlaneStylesForTests(): void {
  store().removeItem(TRAIL_KEY); store().removeItem(NAV_KEY); store().removeItem(LINE_WEIGHT_KEY)
}


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

function toEngineSpec(spec: PlaneRouteSpec): Parameters<typeof sonyaPlaneRouteSource.pose>[0] {
  return {
    mode: spec.mode,
    speedMps: spec.speedMps,
    altitudeFt: spec.altitudeFt,
    t0: spec.t0,
    centerX: spec.centerX,
    centerY: spec.centerY,
    radiusM: spec.radiusM,
    phase0: spec.phase0,
    points: spec.points,
    maxTurnRateRadS: spec.maxTurnRateRadS,
  }
}

function fromEnginePose(p: { x: number; y: number; headingRad: number; altM: number; speedMps: number }): PlanePose {
  return { x: p.x, y: p.y, headingRad: p.headingRad, altM: p.altM, speedMps: p.speedMps }
}

/** Sonya's closed-form `planeRouteSource.pose(spec, atSimTime)`. */
export function planePose(spec: PlaneRouteSpec, atSimTime: number): PlanePose {
  return fromEnginePose(sonyaPlaneRouteSource.pose(toEngineSpec(spec), atSimTime))
}

export function planeNavPoints(spec: PlaneRouteSpec, atSimTime: number, xs: Float64Array, ys: Float64Array): number {
  return sonyaPlaneRouteSource.navPoints(toEngineSpec(spec), atSimTime, xs, ys)
}

export const enginePlaneSource: PlaneRouteSource = {
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
  const lw = lineWidthPts() * dpr
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
  ctx.globalAlpha = navOpacity(style.pattern)
  ctx.lineWidth = lineWidthPts() * dpr
  ctx.setLineDash(navDashes(style.pattern, dpr))
  ctx.stroke()
  ctx.setLineDash([])
  ctx.globalAlpha = 1
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
let lineWeight = loadLineWeight()
const trail = new PlaneTrail()
const navX = new Float64Array(NAV_CAP)
const navY = new Float64Array(NAV_CAP)
let navCount = 0
let pose: PlanePose = { x: 0, y: 7000, headingRad: Math.PI / 2, altM: DEFAULT_ALTITUDE_FT * FT_M, speedMps: mpsFromKts(DEFAULT_SPEED_KTS) }
let lastTrailT = Number.NaN
let version = 0
let source: PlaneRouteSource = enginePlaneSource

export function setPlaneRouteSource(s: PlaneRouteSource | null): void {
  source = s ?? enginePlaneSource
}

export function planeState() {
  return { menuOpen, arm, mode, speedKts, altitudeFt, radiusNmi, centre, points, spec, trailStyle, navStyle, lineWeight, trail, navX, navY, navCount, pose, version }
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
export function setPlaneLineWeight(w: number): void { lineWeight = snapLineWeight(w); saveLineWeight(lineWeight); changed() }

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
  trailStyle = loadTrailStyle()
  navStyle = loadNavStyle()
  lineWeight = loadLineWeight()
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
    preparePlaneFrame(buoyCount, trailBuf, navXs, navYs, specIn, enginePlaneSource, 390, 844, i * dt)
  }
  const t0 = performance.now()
  let marks = 0
  for (let r = 0; r < repeats; r++) {
    marks = preparePlaneFrame(buoyCount, trailBuf, navXs, navYs, specIn, enginePlaneSource, 390, 844, (TRAIL_CAP + r) * dt)
  }
  return { seconds: (performance.now() - t0) / 1000 / Math.max(1, repeats), marks, trailCount: trailBuf.count }
}
