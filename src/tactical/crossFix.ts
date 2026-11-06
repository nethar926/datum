/**
 * Operator FIX cross-fix math (FE-owned).
 * Closed-form 2-line intersect, N-line least-squares fix, covariance→error ellipse,
 * and constant-velocity leg fit (CSE °T / SPD kt). Public textbooks only (Urick geometry).
 */

export const MIN_CROSS_DEG = 15
/** Default 1σ bearing uncertainty used for the error ellipse when a ray omits sigmaDeg. */
export const BEARING_SIGMA_DEG = 2
/** Bearings older than this (sim seconds) are not "fresh" for laying a FIX. */
export const FRESH_WINDOW_S = 120
const MPS_TO_KTS = 3600 / 1852
const DEG = Math.PI / 180

export interface BearingRay {
  buoyId: number
  x: number
  y: number
  brgDeg: number
  /** 1σ bearing uncertainty in degrees (defaults to BEARING_SIGMA_DEG). */
  sigmaDeg?: number
}

export interface Point2 { x: number; y: number }

export type Intersect2Ok = { ok: true; x: number; y: number; crossDeg: number }
export type Intersect2Fail = { ok: false; reason: 'parallel' | 'behind'; crossDeg: number }
export type Intersect2Result = Intersect2Ok | Intersect2Fail

/** Acute crossing angle between two true bearings (0…90°). */
export function crossingAngleDeg(brgA: number, brgB: number): number {
  let d = Math.abs(((brgA - brgB) % 360 + 360) % 360)
  if (d > 180) d = 360 - d
  if (d > 90) d = 180 - d
  return d
}

/**
 * Closed-form intersection of two bearing rays (x east, y north, brg clockwise from north).
 * Rejects near-parallel cuts (cross < minCrossDeg) and intersections behind either buoy.
 */
export function intersect2(
  a: BearingRay,
  b: BearingRay,
  minCrossDeg = MIN_CROSS_DEG,
): Intersect2Result {
  const crossDeg = crossingAngleDeg(a.brgDeg, b.brgDeg)
  if (crossDeg < minCrossDeg) return { ok: false, reason: 'parallel', crossDeg }
  const ta = a.brgDeg * DEG, tb = b.brgDeg * DEG
  const uax = Math.sin(ta), uay = Math.cos(ta)
  const ubx = Math.sin(tb), uby = Math.cos(tb)
  // P_a + s ua = P_b + t ub  →  s ua − t ub = P_b − P_a
  const dx = b.x - a.x, dy = b.y - a.y
  const det = uax * (-uby) - uay * (-ubx) // = −(uax uby − uay ubx) wait: use Cramer on [ua | −ub]
  const det2 = uax * (-uby) - (-ubx) * uay // = -uax*uby + ubx*uay
  if (Math.abs(det2) < 1e-12) return { ok: false, reason: 'parallel', crossDeg }
  const s = (dx * (-uby) - (-ubx) * dy) / det2
  const t = (uax * dy - uay * dx) / det2
  if (!(s > 0) || !(t > 0)) return { ok: false, reason: 'behind', crossDeg }
  return { ok: true, x: a.x + s * uax, y: a.y + s * uay, crossDeg }
}

export interface LsqFix {
  x: number
  y: number
  residualM: number
  n: number
  /** Smallest pairwise acute crossing angle among the rays used. */
  crossDegMin: number
}

export type LsqResult =
  | { ok: true; fix: LsqFix }
  | { ok: false; reason: 'too-few' | 'parallel' | 'behind'; crossDegMin: number }

/**
 * N-line least-squares fix: minimise sum of squared perpendicular distances to each bearing line.
 * Same normal-equation form as the auto teaching aid in fix.ts, with parallel / behind rejection.
 */
export function leastSquaresFix(
  rays: readonly BearingRay[],
  minCrossDeg = MIN_CROSS_DEG,
): LsqResult {
  if (rays.length < 2) return { ok: false, reason: 'too-few', crossDegMin: 0 }
  let crossDegMin = 90
  for (let i = 0; i < rays.length; i++) {
    for (let j = i + 1; j < rays.length; j++) {
      crossDegMin = Math.min(crossDegMin, crossingAngleDeg(rays[i].brgDeg, rays[j].brgDeg))
    }
  }
  if (crossDegMin < minCrossDeg) return { ok: false, reason: 'parallel', crossDegMin }

  let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0
  for (const r of rays) {
    const t = r.brgDeg * DEG
    const nx = Math.cos(t), ny = -Math.sin(t)
    const c = nx * r.x + ny * r.y
    a11 += nx * nx; a12 += nx * ny; a22 += ny * ny; b1 += nx * c; b2 += ny * c
  }
  const det = a11 * a22 - a12 * a12
  if (Math.abs(det) < 0.05 * rays.length) return { ok: false, reason: 'parallel', crossDegMin }
  const x = (a22 * b1 - a12 * b2) / det
  const y = (a11 * b2 - a12 * b1) / det

  let rSum = 0, ahead = 0
  for (const r of rays) {
    const t = r.brgDeg * DEG
    const nx = Math.cos(t), ny = -Math.sin(t)
    rSum += (nx * (x - r.x) + ny * (y - r.y)) ** 2
    if (Math.sin(t) * (x - r.x) + Math.cos(t) * (y - r.y) > 0) ahead++
  }
  if (ahead < rays.length) return { ok: false, reason: 'behind', crossDegMin }
  return {
    ok: true,
    fix: { x, y, residualM: Math.sqrt(rSum / rays.length), n: rays.length, crossDegMin },
  }
}

export interface ErrorEllipse {
  /** Semi-major axis (m). */
  semiMajorM: number
  /** Semi-minor axis (m). */
  semiMinorM: number
  /** Orientation of the major axis, degrees true (0 = north, clockwise). */
  orientDeg: number
}

/**
 * Linearised 1σ error ellipse at a fix from bearing uncertainty.
 * Each ray contributes a perpendicular constraint with σ_perp ≈ R · σ_θ(rad);
 * covariance = (Jᵀ W J)⁻¹ with W = diag(1/σ_perp²).
 */
export function covarianceEllipse(
  rays: readonly BearingRay[],
  fix: Point2,
  defaultSigmaDeg = BEARING_SIGMA_DEG,
): ErrorEllipse | null {
  if (rays.length < 2) return null
  let a11 = 0, a12 = 0, a22 = 0
  for (const r of rays) {
    const dx = fix.x - r.x, dy = fix.y - r.y
    const R = Math.hypot(dx, dy)
    if (R < 1) continue
    const sig = (r.sigmaDeg ?? defaultSigmaDeg) * DEG
    const sigPerp = Math.max(1, R * sig) // metres
    const w = 1 / (sigPerp * sigPerp)
    const t = r.brgDeg * DEG
    const nx = Math.cos(t), ny = -Math.sin(t)
    a11 += w * nx * nx
    a12 += w * nx * ny
    a22 += w * ny * ny
  }
  const det = a11 * a22 - a12 * a12
  if (!(det > 1e-18)) return null
  // Covariance = A⁻¹
  const c11 = a22 / det, c12 = -a12 / det, c22 = a11 / det
  // Eigenvalues of [[c11,c12],[c12,c22]]
  const tr = c11 + c22, disc = Math.sqrt(Math.max(0, (c11 - c22) ** 2 + 4 * c12 * c12))
  const l1 = 0.5 * (tr + disc), l2 = 0.5 * (tr - disc)
  const major = Math.sqrt(Math.max(0, l1)), minor = Math.sqrt(Math.max(0, l2))
  // Eigenvector for λ1: (c12, λ1 − c11) or (λ1 − c22, c12)
  let vx: number, vy: number
  if (Math.abs(c12) > 1e-12) { vx = c12; vy = l1 - c11 }
  else if (c11 >= c22) { vx = 1; vy = 0 }
  else { vx = 0; vy = 1 }
  // atan2(east, north) → deg true
  const orientDeg = ((Math.atan2(vx, vy) / DEG) + 360) % 360
  return { semiMajorM: major, semiMinorM: minor, orientDeg }
}

export interface TimedFix { x: number; y: number; tS: number }

export interface LegFit {
  /** Course made good, degrees true. */
  cseDeg: number
  /** Speed made good, knots. */
  spdKts: number
  residualM: number
  n: number
}

/**
 * Constant-velocity least-squares fit through timed fixes.
 * Needs ≥2 fixes with a positive time span. Returns null if degenerate.
 */
export function fitLeg(fixes: readonly TimedFix[]): LegFit | null {
  if (fixes.length < 2) return null
  const t0 = fixes[0].tS
  let sT = 0, sTT = 0, sX = 0, sY = 0, sTX = 0, sTY = 0
  const n = fixes.length
  for (const f of fixes) {
    const t = f.tS - t0
    sT += t; sTT += t * t; sX += f.x; sY += f.y; sTX += t * f.x; sTY += t * f.y
  }
  const den = n * sTT - sT * sT
  if (Math.abs(den) < 1e-9) return null
  const vx = (n * sTX - sT * sX) / den
  const vy = (n * sTY - sT * sY) / den
  const x0 = (sX - vx * sT) / n
  const y0 = (sY - vy * sT) / n
  let r = 0
  for (const f of fixes) {
    const t = f.tS - t0
    const ex = f.x - (x0 + vx * t), ey = f.y - (y0 + vy * t)
    r += ex * ex + ey * ey
  }
  const spdMps = Math.hypot(vx, vy)
  if (spdMps < 1e-6) return null
  const cseDeg = ((Math.atan2(vx, vy) / DEG) + 360) % 360
  return { cseDeg, spdKts: spdMps * MPS_TO_KTS, residualM: Math.sqrt(r / n), n }
}

/** Collect fresh manual bearings as rays; returns [] if fewer than 2 live DIFAR with fresh cursors. */
export function freshRays(
  manual: Readonly<Record<number, number>>,
  ages: Readonly<Record<number, number>>,
  buoys: readonly { id: number; x: number; y: number; kind: string; state: string }[],
  simT: number,
  windowS = FRESH_WINDOW_S,
): BearingRay[] {
  const out: BearingRay[] = []
  for (const b of buoys) {
    if (b.kind !== 'difar' || b.state !== 'live') continue
    const deg = manual[b.id]
    if (deg === undefined) continue
    const age = ages[b.id]
    if (age === undefined || simT - age > windowS) continue
    out.push({ buoyId: b.id, x: b.x, y: b.y, brgDeg: deg })
  }
  return out
}

/** Operator-facing reject copy for near-parallel cuts. */
export function parallelRejectMessage(crossDeg: number): string {
  return `Cut too shallow (${crossDeg.toFixed(0)}°) — need ≥${MIN_CROSS_DEG}°`
}
