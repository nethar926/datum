import {describe, expect, it} from 'vitest';
import {
  DEFAULT_ALTITUDE_FT,
  DEFAULT_MAX_TURN_RATE_RAD_S,
  DEFAULT_RADIUS_M,
  DEFAULT_SPEED_KTS,
  FT_M,
  MAX_POINTS,
  MIN_POINTS,
  NAV_CAP,
  altMFromFt,
  maxTurnRateRadS,
  mpsFromKts,
  navPoints,
  periodS,
  planeRouteSource,
  pose,
  routeIsReady,
  wrapPeriod,
  wrapPi,
  type PlaneRouteSpec,
  type PlaneWayPoint,
} from '../src/planeRoute.js';

const SPEED = mpsFromKts(DEFAULT_SPEED_KTS);

function circle(over: Partial<PlaneRouteSpec> = {}): PlaneRouteSpec {
  return {
    mode: 'circle', speedMps: SPEED, altitudeFt: DEFAULT_ALTITUDE_FT,
    t0: 0, centerX: 0, centerY: 0, radiusM: DEFAULT_RADIUS_M, phase0: 0, points: [],
    ...over,
  };
}

function figure8(over: Partial<PlaneRouteSpec> = {}): PlaneRouteSpec {
  return {...circle(over), mode: 'figure8'};
}

function boxPoints(): PlaneWayPoint[] {
  const s = 4000;
  return [{x: -s, y: -s}, {x: s, y: -s}, {x: s, y: s}, {x: -s, y: s}];
}

function ptp(points: PlaneWayPoint[], over: Partial<PlaneRouteSpec> = {}): PlaneRouteSpec {
  return {
    mode: 'pointToPoint', speedMps: SPEED, altitudeFt: DEFAULT_ALTITUDE_FT,
    t0: 0, centerX: 0, centerY: 0, radiusM: DEFAULT_RADIUS_M, phase0: 0, points,
    ...over,
  };
}

function angDiff(a: number, b: number): number {
  return wrapPi(b - a);
}

function relErr(got: number, exp: number): number {
  return Math.abs(got - exp) / Math.max(1, Math.abs(exp));
}

describe('planeRoute pose', () => {
  it('is ready only for valid specs', () => {
    expect(routeIsReady(circle())).toBe(true);
    expect(routeIsReady(figure8())).toBe(true);
    expect(routeIsReady(ptp(boxPoints()))).toBe(true);
    expect(routeIsReady(circle({speedMps: 0}))).toBe(false);
    expect(routeIsReady(circle({radiusM: 0}))).toBe(false);
    expect(routeIsReady(ptp([{x: 0, y: 0}]))).toBe(false);
    expect(routeIsReady(ptp(Array.from({length: MAX_POINTS + 1}, (_, i) => ({x: i * 100, y: 0}))))).toBe(false);
    expect(MIN_POINTS).toBe(2);
  });

  it('circle at phase 0, t0 is the north point heading east', () => {
    const p = pose(circle(), 0);
    expect(relErr(p.x, 0)).toBeLessThan(1e-9);
    expect(relErr(p.y, DEFAULT_RADIUS_M)).toBeLessThan(1e-9);
    expect(Math.abs(angDiff(p.headingRad, Math.PI / 2))).toBeLessThan(1e-12);
    expect(p.speedMps).toBe(SPEED);
    expect(p.altM).toBe(altMFromFt(DEFAULT_ALTITUDE_FT));
    expect(p.altM).toBe(DEFAULT_ALTITUDE_FT * FT_M);
  });

  it('circle period closes and wraps t', () => {
    const spec = circle({t0: 12, phase0: 0.3, centerX: 1000, centerY: -400});
    const T = periodS(spec);
    const a = pose(spec, 12);
    const b = pose(spec, 12 + T);
    const c = pose(spec, 12 + 7 * T + 1e-12);
    for (const q of [b, c]) {
      expect(relErr(q.x, a.x)).toBeLessThan(1e-9);
      expect(relErr(q.y, a.y)).toBeLessThan(1e-9);
      expect(Math.abs(angDiff(q.headingRad, a.headingRad))).toBeLessThan(1e-9);
    }
  });

  it('figure 8 is centred, loops, and crosses heading east', () => {
    const spec = figure8();
    const T = periodS(spec);
    expect(T).toBeCloseTo(4 * Math.PI * DEFAULT_RADIUS_M / SPEED, 12);
    const junction = pose(spec, 0);
    expect(relErr(junction.x, 0)).toBeLessThan(1e-9);
    expect(relErr(junction.y, 0)).toBeLessThan(1e-9);
    expect(Math.abs(angDiff(junction.headingRad, Math.PI / 2))).toBeLessThan(1e-12);
    const mid = pose(spec, T / 2);
    expect(relErr(mid.x, 0)).toBeLessThan(1e-9);
    expect(relErr(mid.y, 0)).toBeLessThan(1e-9);
    expect(Math.abs(angDiff(mid.headingRad, Math.PI / 2))).toBeLessThan(1e-9);
    const top = pose(spec, T / 4);
    expect(top.y).toBeGreaterThan(DEFAULT_RADIUS_M);
    const bot = pose(spec, 3 * T / 4);
    expect(bot.y).toBeLessThan(-DEFAULT_RADIUS_M);
    const looped = pose(spec, T);
    expect(relErr(looped.x, junction.x)).toBeLessThan(1e-9);
    expect(relErr(looped.y, junction.y)).toBeLessThan(1e-9);
  });

  it('point-to-point loops 2–10 waypoints with continuous heading at joins', () => {
    const two = ptp([{x: 0, y: 0}, {x: 0, y: 8000}]);
    const T2 = periodS(two);
    expect(T2).toBeGreaterThan(0);
    const a0 = pose(two, 0);
    const aT = pose(two, T2);
    expect(relErr(aT.x, a0.x)).toBeLessThan(1e-9);
    expect(relErr(aT.y, a0.y)).toBeLessThan(1e-9);
    const box = ptp(boxPoints());
    const corners = boxPoints();
    // Mid-first-straight should be on the south side, heading east.
    const T = periodS(box);
    let sawEast = false, minD = Infinity;
    for (let i = 0; i < 400; i++) {
      const p = pose(box, (i / 400) * T);
      if (Math.abs(p.y + 4000) < 20 && p.x > -3000 && p.x < 3000) {
        expect(Math.abs(angDiff(p.headingRad, Math.PI / 2))).toBeLessThan(0.05);
        sawEast = true;
      }
      const d = Math.min(...corners.map((c) => Math.hypot(p.x - c.x, p.y - c.y)));
      if (d < minD) minD = d;
    }
    expect(sawEast).toBe(true);
    // Fillets cut the corners, so the path does not have to hit a vertex.
    expect(minD).toBeLessThan(800);
    const ten = ptp(Array.from({length: 10}, (_, i) => {
      const a = i * 2 * Math.PI / 10;
      return {x: 6000 * Math.sin(a), y: 6000 * Math.cos(a)};
    }));
    expect(periodS(ten)).toBeGreaterThan(0);
    expect(maxTurnRateRadS(ten)).toBeGreaterThan(0);
    expect(maxTurnRateRadS(ten)).toBeGreaterThanOrEqual(DEFAULT_MAX_TURN_RATE_RAD_S * 0.5);
  });

  it('pose and navPoints on the source match the free functions', () => {
    const spec = circle();
    const t = 5;
    const a = planeRouteSource.pose(spec, t);
    const b = pose(spec, t);
    expect(a).toEqual(b);
    const xs = new Float64Array(NAV_CAP), ys = new Float64Array(NAV_CAP);
    const n = planeRouteSource.navPoints(spec, t, xs, ys);
    expect(n).toBe(NAV_CAP);
    expect(xs[0]).toBeCloseTo(a.x, 12);
    expect(ys[0]).toBeCloseTo(a.y, 12);
    const n2 = navPoints(spec, t, xs, ys);
    expect(n2).toBe(NAV_CAP);
  });

  it('is continuous at 30 fps for 1x, 4x and 16x (position and heading)', () => {
    const specs: PlaneRouteSpec[] = [
      circle(),
      figure8({centerX: 500, centerY: -200, phase0: 0.4}),
      ptp(boxPoints(), {t0: 3}),
      ptp([{x: -2000, y: 0}, {x: 5000, y: 1500}, {x: 0, y: 6000}]),
      ptp([{x: 0, y: 0}, {x: 0, y: 5000}]),
    ];
    for (const spec of specs) {
      const v = spec.speedMps;
      const omega = maxTurnRateRadS(spec);
      for (const rate of [1, 4, 16]) {
        const dt = rate / 30;
        const T = periodS(spec);
        const end = T * 2 + spec.t0 + 1;
        let prev = pose(spec, spec.t0);
        for (let t = spec.t0 + dt; t <= end; t += dt) {
          const p = pose(spec, t);
          const ds = Math.hypot(p.x - prev.x, p.y - prev.y);
          expect(ds).toBeLessThanOrEqual(v * dt * 1.001 + 1e-9);
          const dh = Math.abs(angDiff(prev.headingRad, p.headingRad));
          expect(dh).toBeLessThanOrEqual(omega * dt * 1.001 + 1e-9);
          prev = p;
        }
      }
    }
  });

  it('pose for 1 plane at 16x costs well under 0.05 ms', () => {
    const specs = [circle(), figure8(), ptp(boxPoints())];
    const dt = 16 / 30;
    const n = 8000;
    // Warm
    for (const spec of specs) pose(spec, 0);
    const t0 = performance.now();
    for (let i = 0; i < n; i++) pose(specs[i % specs.length]!, i * dt);
    const ms = (performance.now() - t0) / n;
    expect(ms).toBeLessThan(0.05);
  });
});

describe('planeRoute wrap helpers', () => {
  it('wrapPeriod and wrapPi are stable at the seams', () => {
    expect(wrapPeriod(5, 4)).toBe(1);
    expect(wrapPeriod(-1, 4)).toBe(3);
    expect(Math.abs(wrapPi(Math.PI) - Math.PI)).toBeLessThan(1e-15);
    expect(Math.abs(Math.abs(wrapPi(-Math.PI)) - Math.PI)).toBeLessThan(1e-15);
    expect(Math.abs(wrapPi(3 * Math.PI) - Math.PI)).toBeLessThan(1e-12);
  });
});
