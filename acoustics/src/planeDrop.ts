/**
 * Plane-capture drop clock: a planned buoy is released when the aircraft's
 * horizontal distance to its drop point first reaches DROP_CAPTURE_M.
 * Crossing time is a 1 ms bisection of pose() on the tick interval.
 */
import {pose, type PlaneRouteSpec} from './planeRoute.js';

export const DROP_CAPTURE_M = 150;
/** Bisection tolerance for the exact crossing time (seconds). */
export const DROP_CAPTURE_TOL_S = 0.001;

export type PlannedDrop = {x: number; y: number; order: number};

export function isPlanned(b: {placed?: boolean; deployedAt?: number | null}): boolean {
  return b.placed === false && !(typeof b.deployedAt === 'number' && Number.isFinite(b.deployedAt));
}

export function horizontalDist(px: number, py: number, x: number, y: number): number {
  return Math.hypot(px - x, py - y);
}

function distToDrop(spec: PlaneRouteSpec, dropX: number, dropY: number, t: number): number {
  const p = pose(spec, t);
  return horizontalDist(p.x, p.y, dropX, dropY);
}

function bisectCapture(spec: PlaneRouteSpec, dropX: number, dropY: number, lo: number, hi: number, captureM: number): number {
  // d(lo) > captureM, d(hi) <= captureM. Return the first t within 1 ms that is inside.
  while (hi - lo > DROP_CAPTURE_TOL_S) {
    const mid = (lo + hi) / 2;
    if (distToDrop(spec, dropX, dropY, mid) <= captureM) hi = mid;
    else lo = mid;
  }
  return hi;
}

/**
 * First time in [t0, t1] at which the plane is within `captureM` of (dropX, dropY),
 * or null if the path stays outside. If already inside at t0, returns t0.
 */
export function firstCaptureTime(
  spec: PlaneRouteSpec, dropX: number, dropY: number, t0: number, t1: number, captureM = DROP_CAPTURE_M,
): number | null {
  if (!(t1 > t0)) {
    return distToDrop(spec, dropX, dropY, t1) <= captureM ? t1 : null;
  }
  if (distToDrop(spec, dropX, dropY, t0) <= captureM) return t0;
  const span = t1 - t0;
  const step = Math.min(0.05, Math.max(DROP_CAPTURE_TOL_S, span / 32));
  let prev = t0;
  let t = t0 + step;
  while (t < t1 - 1e-15) {
    if (distToDrop(spec, dropX, dropY, t) <= captureM) {
      return bisectCapture(spec, dropX, dropY, prev, t, captureM);
    }
    prev = t;
    t += step;
  }
  if (distToDrop(spec, dropX, dropY, t1) <= captureM) {
    return bisectCapture(spec, dropX, dropY, prev, t1, captureM);
  }
  return null;
}
