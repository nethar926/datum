/**
 * Closed-form plane route kinematics for Dorian's `PlaneRouteSource` seam.
 * `pose(spec, t)` is pure and deterministic in sim time `t`. The UI samples
 * once per frame and never integrates.
 *
 * Public, unclassified path geometry only (circular arcs and a two-lobe
 * figure-8 of circular arcs). No real platform trajectories.
 */

import { NMI_M } from './convergenceZone.js';

export const PLANE_MODES = ['circle', 'pointToPoint', 'figure8'] as const;
export type PlaneRouteMode = (typeof PLANE_MODES)[number];

export type PlaneWayPoint = { x: number; y: number };

export type PlaneRouteSpec = {
  mode: PlaneRouteMode;
  /** Commanded ground speed, m/s (SI). */
  speedMps: number;
  /** Altitude in feet on the wire (Dorian's field); converted to `altM` in the pose. */
  altitudeFt: number;
  t0: number;
  centerX: number;
  centerY: number;
  radiusM: number;
  phase0: number;
  /** 2–10 waypoints; the route loops. Used by `pointToPoint`. */
  points: PlaneWayPoint[];
  /** Optional PTP fillet bound (rad/s). Default `DEFAULT_MAX_TURN_RATE_RAD_S`. */
  maxTurnRateRadS?: number;
};

/**
 * Pose in the scenario frame (x east, y north, metres). Heading is engine
 * course: 0 = north, clockwise, via `atan2(dx, dy)`. `altM` and `speedMps` are
 * SI; Dorian's UI pose can ignore them and use `x`, `y`, `headingRad`.
 */
export type PlanePose = {
  x: number;
  y: number;
  altM: number;
  headingRad: number;
  speedMps: number;
};

export type PlaneRouteSource = {
  pose(spec: PlaneRouteSpec, atSimTime: number): PlanePose;
  navPoints(spec: PlaneRouteSpec, atSimTime: number, xs: Float64Array, ys: Float64Array): number;
};

export const FT_M = 0.3048;
export const DEFAULT_RADIUS_NMI = 4;
export const DEFAULT_RADIUS_M = DEFAULT_RADIUS_NMI * NMI_M;
export const DEFAULT_SPEED_KTS = 210;
export const DEFAULT_ALTITUDE_FT = 1476;
export const MIN_POINTS = 2;
export const MAX_POINTS = 10;
export const NAV_CAP = 64;
export const NAV_HORIZON_M = 8 * NMI_M;
/** ~15 deg/s: a moderately banked patrol-aircraft turn, used for PTP fillets. */
export const DEFAULT_MAX_TURN_RATE_RAD_S = 15 * Math.PI / 180;
export const mpsFromKts = (kts: number) => kts * NMI_M / 3600;
export const ktsFromMps = (mps: number) => mps * 3600 / NMI_M;

export function headingDeg(rad: number): number {
  let d = rad * 180 / Math.PI;
  d %= 360;
  return d < 0 ? d + 360 : d;
}

/** Engine course: 0 = north, clockwise from north. */
export function headingRad(dx: number, dy: number): number {
  return Math.atan2(dx, dy);
}

export function routeIsReady(spec: PlaneRouteSpec): boolean {
  if (!(spec.speedMps > 0)) return false;
  if (spec.mode === 'pointToPoint') {
    return spec.points.length >= MIN_POINTS && spec.points.length <= MAX_POINTS;
  }
  return spec.radiusM > 0;
}

export function altMFromFt(ft: number): number {
  return ft * FT_M;
}

const TWO_PI = 2 * Math.PI;
const PI = Math.PI;

/** Wrap into [0, period). `period` must be > 0. */
export function wrapPeriod(t: number, period: number): number {
  let s = t % period;
  if (s < 0) s += period;
  return s;
}

/** Smallest signed angle into (−π, π]. */
export function wrapPi(x: number): number {
  let y = (x + PI) % TWO_PI;
  if (y < 0) y += TWO_PI;
  y -= PI;
  if (y <= -PI) return PI;
  return y;
}

function holdPose(x: number, y: number, heading: number, spec: PlaneRouteSpec, moving: boolean): PlanePose {
  return {
    x, y,
    altM: altMFromFt(spec.altitudeFt),
    headingRad: heading,
    speedMps: moving ? spec.speedMps : 0,
  };
}

function circlePeriodS(spec: PlaneRouteSpec): number {
  const r = Math.max(1, spec.radiusM);
  return TWO_PI * r / Math.max(1e-6, spec.speedMps);
}

function figure8PeriodS(spec: PlaneRouteSpec): number {
  const r = Math.max(1, spec.radiusM);
  // Two full circular lobes, constant speed.
  return 4 * PI * r / Math.max(1e-6, spec.speedMps);
}

/** CCW orbit. Phase 0 is the north point, heading east (matches Dorian's placeholder). */
function circlePose(spec: PlaneRouteSpec, t: number): PlanePose {
  const r = Math.max(1, spec.radiusM);
  const w = spec.speedMps / r;
  const period = TWO_PI / w;
  const tau = wrapPeriod(t - spec.t0, period);
  const phi = spec.phase0 + w * tau;
  const s = Math.sin(phi), c = Math.cos(phi);
  return holdPose(
    spec.centerX + r * s,
    spec.centerY + r * c,
    headingRad(r * w * c, -r * w * s),
    spec, true,
  );
}

/**
 * Figure-8 of two circular lobes stacked north/south, constant speed, C1 heading
 * at the junction (always eastbound through the centre). Lobe radius is `radiusM`.
 * `phase0` is an initial path angle (radians along the 4π total).
 */
function figure8Pose(spec: PlaneRouteSpec, t: number): PlanePose {
  const r = Math.max(1, spec.radiusM);
  const v = spec.speedMps;
  const period = 4 * PI * r / Math.max(1e-6, v);
  const tau = wrapPeriod(t - spec.t0, period);
  const psi = wrapPeriod(spec.phase0 + (v / r) * tau, 4 * PI);
  let x: number, y: number, dx: number, dy: number;
  if (psi < TWO_PI) {
    // Top lobe, CCW from the junction, heading east at ψ = 0.
    const a = psi;
    const sa = Math.sin(a), ca = Math.cos(a);
    x = spec.centerX + r * sa;
    y = spec.centerY + r * (1 - ca);
    dx = r * (v / r) * ca;
    dy = r * (v / r) * sa;
  } else {
    // Bottom lobe, CW from the junction, heading east at ψ = 2π.
    const b = psi - TWO_PI;
    const sb = Math.sin(b), cb = Math.cos(b);
    x = spec.centerX + r * sb;
    y = spec.centerY - r * (1 - cb);
    dx = r * (v / r) * cb;
    dy = -r * (v / r) * sb;
  }
  return holdPose(x, y, headingRad(dx, dy), spec, true);
}

type StraightPiece = {
  kind: 'straight';
  x0: number; y0: number;
  dx: number; dy: number;
  length: number;
  headingRad: number;
};
type ArcPiece = {
  kind: 'arc';
  cx: number; cy: number;
  radius: number;
  h0: number;
  dHeading: number;
  length: number;
};
type Piece = StraightPiece | ArcPiece;

type BuiltPath = {
  pieces: Piece[];
  total: number;
  maxOmega: number;
};

const pathCache = new WeakMap<PlaneRouteSpec, BuiltPath>();

function buildPointToPoint(spec: PlaneRouteSpec): BuiltPath {
  const cached = pathCache.get(spec);
  if (cached) return cached;
  const built = buildPointToPointUncached(spec);
  pathCache.set(spec, built);
  return built;
}

function buildStadium(A: PlaneWayPoint, B: PlaneWayPoint, R0: number, speed: number): BuiltPath {
  const dx = B.x - A.x, dy = B.y - A.y;
  const D = Math.hypot(dx, dy);
  if (D <= 1e-9) return { pieces: [], total: 0, maxOmega: 0 };
  const h = headingRad(dx, dy);
  const R = Math.max(1e-6, Math.min(R0, D / 2));
  const nx = Math.cos(h), ny = -Math.sin(h);
  const hBack = h + PI;
  // Right-offset outbound, CCW end caps (standard racetrack).
  const A1 = { x: A.x + R * nx, y: A.y + R * ny };
  const B1 = { x: B.x + R * nx, y: B.y + R * ny };
  const B2 = { x: B.x - R * nx, y: B.y - R * ny };
  const A2 = { x: A.x - R * nx, y: A.y - R * ny };
  const pieces: Piece[] = [
    { kind: 'straight', x0: A1.x, y0: A1.y, dx: B1.x - A1.x, dy: B1.y - A1.y, length: D, headingRad: h },
    // CCW semicircle around B: heading h → h−π, position = C + R * right_normal(heading).
    { kind: 'arc', cx: B.x, cy: B.y, radius: R, h0: h, dHeading: -PI, length: PI * R },
    { kind: 'straight', x0: B2.x, y0: B2.y, dx: A2.x - B2.x, dy: A2.y - B2.y, length: D, headingRad: hBack },
    { kind: 'arc', cx: A.x, cy: A.y, radius: R, h0: hBack, dHeading: -PI, length: PI * R },
  ];
  return { pieces, total: 2 * D + 2 * PI * R, maxOmega: speed / R };
}

function buildPointToPointUncached(spec: PlaneRouteSpec): BuiltPath {
  const pts = spec.points;
  const n = pts.length;
  const empty: BuiltPath = { pieces: [], total: 0, maxOmega: 0 };
  if (n < 2) return empty;
  const omega0 = Math.max(1e-9, spec.maxTurnRateRadS ?? DEFAULT_MAX_TURN_RATE_RAD_S);
  const speed = Math.max(1e-6, spec.speedMps);
  const R0 = speed / omega0;
  if (n === 2) return buildStadium(pts[0]!, pts[1]!, R0, speed);

  const segLen = new Array<number>(n);
  const head = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const a = pts[i]!, b = pts[(i + 1) % n]!;
    const dx = b.x - a.x, dy = b.y - a.y;
    const d = Math.hypot(dx, dy);
    segLen[i] = d;
    head[i] = d > 1e-9 ? headingRad(dx, dy) : 0;
  }
  // Carry heading across zero-length segments so a repeated point does not
  // invent a spurious turn.
  for (let i = 0; i < n; i++) {
    if ((segLen[i] ?? 0) <= 1e-9) {
      const prev = head[(i - 1 + n) % n] ?? 0;
      head[i] = prev;
    }
  }

  const L = new Array<number>(n).fill(0);
  const R = new Array<number>(n).fill(0);
  const turn = new Array<number>(n).fill(0);

  for (let i = 0; i < n; i++) {
    const hIn = head[(i - 1 + n) % n]!;
    const hOut = head[i]!;
    let a = wrapPi(hOut - hIn);
    const adjIn = segLen[(i - 1 + n) % n]!;
    const adjOut = segLen[i]!;
    if (Math.abs(a) < 1e-12 || adjIn <= 1e-9 || adjOut <= 1e-9) {
      turn[i] = 0;
      continue;
    }
    if (Math.abs(a) > PI - 1e-6) {
      // Exact 180° in a 3+ point list is a spike; clamp so tan(|α|/2) is finite.
      // (A 2-point out-and-back is a racetrack, handled above.)
      a = a >= 0 ? (PI - 1e-4) : -(PI - 1e-4);
    }
    const desiredL = R0 * Math.tan(Math.abs(a) / 2);
    const maxL = 0.5 * Math.min(adjIn, adjOut);
    const Li = Math.min(desiredL, Math.max(0, maxL - 1e-9));
    const Ri = Li / Math.tan(Math.abs(a) / 2);
    turn[i] = a;
    L[i] = Li;
    R[i] = Ri > 1e-9 ? Ri : 0;
  }

  const pieces: Piece[] = [];
  let maxOmega = 0;
  for (let i = 0; i < n; i++) {
    const P = pts[i]!;
    const hIn = head[(i - 1 + n) % n]!;
    const hOut = head[i]!;
    const a = turn[i]!;
    const Ri = R[i]!;
    const Li = L[i]!;
    if (Ri > 1e-9 && Math.abs(a) > 1e-12) {
      const tInX = Math.sin(hIn), tInY = Math.cos(hIn);
      const T1x = P.x - tInX * Li, T1y = P.y - tInY * Li;
      // Right normal of incoming heading: (cos h, −sin h).
      const rnX = Math.cos(hIn), rnY = -Math.sin(hIn);
      const sign = a >= 0 ? 1 : -1;
      const cx = T1x + sign * Ri * rnX;
      const cy = T1y + sign * Ri * rnY;
      pieces.push({
        kind: 'arc',
        cx, cy, radius: Ri,
        h0: hIn, dHeading: a,
        length: Ri * Math.abs(a),
      });
      maxOmega = Math.max(maxOmega, speed / Ri);
    }
    const LiNext = L[(i + 1) % n]!;
    const tOutX = Math.sin(hOut), tOutY = Math.cos(hOut);
    const hNextIn = hOut;
    const tEndX = Math.sin(hNextIn), tEndY = Math.cos(hNextIn);
    const Q = pts[(i + 1) % n]!;
    const x0 = P.x + tOutX * Li;
    const y0 = P.y + tOutY * Li;
    const x1 = Q.x - tEndX * LiNext;
    const y1 = Q.y - tEndY * LiNext;
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len > 1e-9) {
      pieces.push({
        kind: 'straight',
        x0, y0, dx, dy, length: len,
        headingRad: hOut,
      });
    }
  }

  const total = pieces.reduce((s, p) => s + p.length, 0);
  return { pieces, total, maxOmega };
}

function evalPiece(p: Piece, sLocal: number): { x: number; y: number; headingRad: number } {
  if (p.kind === 'straight') {
    const u = p.length > 0 ? sLocal / p.length : 0;
    return { x: p.x0 + p.dx * u, y: p.y0 + p.dy * u, headingRad: p.headingRad };
  }
  const u = p.length > 0 ? sLocal / p.length : 0;
  const h = p.h0 + p.dHeading * u;
  const R = p.radius;
  if (p.dHeading >= 0) {
    // Clockwise: position is centre plus left normal of heading.
    return { x: p.cx + R * -Math.cos(h), y: p.cy + R * Math.sin(h), headingRad: h };
  }
  // CCW: centre plus right normal of heading.
  return { x: p.cx + R * Math.cos(h), y: p.cy + R * -Math.sin(h), headingRad: h };
}

function pointToPointPose(spec: PlaneRouteSpec, t: number): PlanePose {
  const pts = spec.points;
  if (pts.length < 2) {
    const p = pts[0] ?? { x: spec.centerX, y: spec.centerY };
    return holdPose(p.x, p.y, 0, spec, false);
  }
  const path = buildPointToPoint(spec);
  if (path.total <= 1e-9) {
    const p = pts[0]!;
    return holdPose(p.x, p.y, 0, spec, false);
  }
  const period = path.total / Math.max(1e-6, spec.speedMps);
  const tau = wrapPeriod(t - spec.t0, period);
  let s = spec.speedMps * tau;
  if (s < 0) s = 0;
  if (s >= path.total) s = path.total;
  // Walk pieces; last piece absorbs a possible 1-ulp leftover.
  let acc = 0;
  for (let i = 0; i < path.pieces.length; i++) {
    const p = path.pieces[i]!;
    const end = acc + p.length;
    if (s <= end || i === path.pieces.length - 1) {
      const local = Math.min(p.length, Math.max(0, s - acc));
      const q = evalPiece(p, local);
      return holdPose(q.x, q.y, q.headingRad, spec, true);
    }
    acc = end;
  }
  const p = pts[0]!;
  return holdPose(p.x, p.y, 0, spec, true);
}

export function periodS(spec: PlaneRouteSpec): number {
  if (!routeIsReady(spec)) return 0;
  if (spec.mode === 'circle') return circlePeriodS(spec);
  if (spec.mode === 'figure8') return figure8PeriodS(spec);
  const path = buildPointToPoint(spec);
  return path.total / Math.max(1e-6, spec.speedMps);
}

/** Largest |d(heading)/dt| along the route (rad/s). 0 if the spec is not ready. */
export function maxTurnRateRadS(spec: PlaneRouteSpec): number {
  if (!routeIsReady(spec)) return 0;
  const v = spec.speedMps;
  if (spec.mode === 'circle' || spec.mode === 'figure8') {
    const r = Math.max(1, spec.radiusM);
    return v / r;
  }
  const path = buildPointToPoint(spec);
  return path.maxOmega;
}

/** Closed-form pose at sim time `t`. Wraps `t` at the route period. */
export function pose(spec: PlaneRouteSpec, t: number): PlanePose {
  if (!routeIsReady(spec)) {
    const p = spec.points[0] ?? { x: spec.centerX, y: spec.centerY };
    return holdPose(p.x, p.y, 0, spec, false);
  }
  if (spec.mode === 'circle') return circlePose(spec, t);
  if (spec.mode === 'figure8') return figure8Pose(spec, t);
  return pointToPointPose(spec, t);
}

export function navPoints(spec: PlaneRouteSpec, atSimTime: number, xs: Float64Array, ys: Float64Array): number {
  const cap = Math.min(xs.length, ys.length, NAV_CAP);
  if (cap < 2 || !routeIsReady(spec)) return 0;
  const horizonT = NAV_HORIZON_M / Math.max(1e-6, spec.speedMps);
  for (let i = 0; i < cap; i++) {
    const p = pose(spec, atSimTime + horizonT * i / (cap - 1));
    xs[i] = p.x; ys[i] = p.y;
  }
  return cap;
}

export const planeRouteSource: PlaneRouteSource = { pose, navPoints };
