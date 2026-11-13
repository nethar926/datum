/** Planned drops wait for the plane to reach the drop point (Wilson). */
import {it, expect, describe} from 'vitest';
import {
  AcousticEngine, clampParams, generateScenario,
  DROP_CAPTURE_M, DROP_CAPTURE_TOL_S, firstCaptureTime, isPlanned,
  DEFAULT_ALTITUDE_FT, DEFAULT_MAX_TURN_RATE_RAD_S, DEFAULT_DROP_ALTITUDE_M, DEFAULT_DESCENT_RATE_MPS,
  firstEmitTime, type PlaneRouteSpec,
} from '../src/index.js';

const R = 2000;
const V = 100;

function bits(x: number): string {
  const b = new Float64Array([x]);
  const u = new Uint32Array(b.buffer);
  return u[1]!.toString(16).padStart(8, '0') + u[0]!.toString(16).padStart(8, '0');
}

function circleSpec(): PlaneRouteSpec {
  return {
    mode: 'circle', speedMps: V, altitudeFt: DEFAULT_ALTITUDE_FT,
    t0: 0, centerX: 0, centerY: 0, radiusM: R, phase0: 0, points: [],
  };
}

/** 2-point stadium: outbound is a right-offset straight (y = -V/ω) through the drop. */
function ptpSpec(): PlaneRouteSpec {
  return {
    mode: 'pointToPoint', speedMps: V, altitudeFt: DEFAULT_ALTITUDE_FT,
    t0: 0, centerX: 0, centerY: 0, radiusM: R, phase0: 0,
    points: [{x: -8000, y: 0}, {x: 8000, y: 0}],
  };
}
function ptpDropY(): number { return -V / DEFAULT_MAX_TURN_RATE_RAD_S; }
function ptpClosedForm(): number { return (8000 - DROP_CAPTURE_M) / V; }

/** Closed-form first capture for a drop on the circle at heading φ. */
function circleCaptureClosedForm(phiDrop: number): number {
  const w = V / R;
  const tHit = phiDrop / w;
  const dPhi = 2 * Math.asin(DROP_CAPTURE_M / (2 * R));
  return tHit - dPhi / w;
}

function unplaced(seed = 7): AcousticEngine {
  return new AcousticEngine(generateScenario(clampParams({seed})), seed, {buoyStartMode: 'unplaced'});
}

function plannedBuoy(id: string, x: number, y: number, order: number, channel: number) {
  return {
    id, type: 'difar' as const, x, y, depth: 40, course: 0, speed: 0,
    rfChannel: channel, life: 7200, placed: false as const,
    plannedDrop: {x, y, order},
    dropAltitudeM: DEFAULT_DROP_ALTITUDE_M,
    descentRateMps: DEFAULT_DESCENT_RATE_MPS,
    integrationTimeS: 5,
  };
}

function stepUntilReleased(e: AcousticEngine, dt = 0.25, until = 1e4): number {
  while (isPlanned(e.scenario.buoys[0]!) && e.time < until) e.advance(dt);
  const t = e.scenario.buoys[0]!.deployedAt;
  if (typeof t !== 'number') throw new Error('buoy never released');
  return t;
}

function collectRows(e: AcousticEngine, sid: number, until: number, dt = 0.25): {pre: number; bits: string[]} {
  const buf = new Float32Array(4096);
  const bins = e.scenario.bins;
  const out: string[] = [];
  let pre = 0;
  const released = () => typeof e.scenario.buoys[0]!.deployedAt === 'number';
  while (e.time < until) {
    const before = e.time;
    e.advance(dt);
    while (e.rowsReady(sid) > 0) {
      e.writeRow(sid, buf);
      const slice = buf.subarray(0, bins);
      const real = Array.from(slice).some(Number.isFinite);
      if (real && !released() || real && before < (e.scenario.buoys[0]!.deployedAt ?? Infinity)) {
        // row emitted while still planned or before release time
        pre++;
      }
      const u = new Uint32Array(slice.buffer, slice.byteOffset, slice.length);
      out.push(Array.from(u).map(x => x.toString(16).padStart(8, '0')).join(''));
    }
  }
  return {pre, bits: out};
}

describe('plane-capture planned drops', () => {
  it('circle drop time equals the closed-form crossing (within 1 ms)', () => {
    const spec = circleSpec();
    const x = R, y = 0;
    const expected = circleCaptureClosedForm(Math.PI / 2);
    const direct = firstCaptureTime(spec, x, y, 0, expected + 5);
    expect(direct).not.toBeNull();
    expect(Math.abs(direct! - expected)).toBeLessThanOrEqual(DROP_CAPTURE_TOL_S);

    const e = unplaced();
    e.addBuoy(plannedBuoy('buoy-1', x, y, 0, 1));
    e.setPlaneRoute(spec);
    expect(e.buoyStatus(0, 9).phase).toBe('planned');
    expect(e.buoyStatus(0, 9).releaseAt).toBeNull();
    expect(e.buoyStatus(0, 9).plannedDrop).toEqual({x, y, order: 0});
    const t = stepUntilReleased(e);
    expect(Math.abs(t - expected)).toBeLessThanOrEqual(DROP_CAPTURE_TOL_S);
    expect(e.buoyStatus(0, 9).releaseAt).toBe(t);
    expect(e.buoyStatus(0, 9).phase).not.toBe('planned');
  });

  it('pointToPoint drop time equals the closed-form crossing (within 1 ms)', () => {
    const spec = ptpSpec();
    const expected = ptpClosedForm();
    const y = ptpDropY();
    const direct = firstCaptureTime(spec, 0, y, 0, expected + 5);
    expect(direct).not.toBeNull();
    expect(Math.abs(direct! - expected)).toBeLessThanOrEqual(DROP_CAPTURE_TOL_S);

    const e = unplaced();
    e.addBuoy(plannedBuoy('buoy-1', 0, y, 0, 1));
    e.setPlaneRoute(spec);
    const t = stepUntilReleased(e);
    expect(Math.abs(t - expected)).toBeLessThanOrEqual(DROP_CAPTURE_TOL_S);
  });

  it('emits no rows before release; post-release rows are byte-identical to a sequence buoy with the same deployedAt', () => {
    const spec = ptpSpec();
    const expected = ptpClosedForm();
    const y = ptpDropY();
    const liveA = unplaced();
    liveA.addBuoy(plannedBuoy('buoy-1', 0, y, 0, 1));
    liveA.setPlaneRoute(spec);
    const sidA = (liveA.subscribe({kind: 'lofar', channel: 1}) as {streamId: number}).streamId;

    // Advance just past capture, record exact deployedAt, then continue to firstEmit+2.
    const tRel = stepUntilReleased(liveA);
    expect(Math.abs(tRel - expected)).toBeLessThanOrEqual(DROP_CAPTURE_TOL_S);
    const first = firstEmitTime(liveA.scenario.buoys[0]!, 0.25);
    const until = first + 2;

    const ctrl = unplaced();
    ctrl.addBuoy({...plannedBuoy('buoy-1', 0, y, 0, 1), deployedAt: tRel, plannedDrop: undefined});
    const sidC = (ctrl.subscribe({kind: 'lofar', channel: 1}) as {streamId: number}).streamId;

    const plannedFromStart = unplaced();
    plannedFromStart.addBuoy(plannedBuoy('buoy-1', 0, y, 0, 1));
    plannedFromStart.setPlaneRoute(spec);
    const sidP = (plannedFromStart.subscribe({kind: 'lofar', channel: 1}) as {streamId: number}).streamId;

    const preP = collectRows(plannedFromStart, sidP, until);
    // ctrl starts at 0 and must be stepped the same way
    const preC = collectRows(ctrl, sidC, until);

    // liveA already advanced past release; collect remaining from here is not a fair compare.
    // The plannedFromStart vs ctrl pair is the identity check.
    expect(preP.pre).toBe(0);
    expect(preC.pre).toBe(0);
    expect(preP.bits.length).toBeGreaterThan(0);
    expect(preP.bits).toEqual(preC.bits);

    // Also confirm the already-running liveA produced no real pre-release rows by repeating from 0.
    const probe = unplaced();
    probe.addBuoy(plannedBuoy('buoy-1', 0, y, 0, 1));
    probe.setPlaneRoute(spec);
    const sid = (probe.subscribe({kind: 'lofar', channel: 1}) as {streamId: number}).streamId;
    const buf = new Float32Array(4096);
    while (isPlanned(probe.scenario.buoys[0]!) || probe.time < (probe.scenario.buoys[0]!.deployedAt ?? 0)) {
      probe.advance(0.25);
      while (probe.rowsReady(sid) > 0) {
        probe.writeRow(sid, buf);
        const real = Array.from(buf.subarray(0, probe.scenario.bins)).some(Number.isFinite);
        expect(real).toBe(false);
      }
    }
  });

  it('is deterministic across two engines', () => {
    const spec = circleSpec();
    const run = () => {
      const e = unplaced(11);
      e.addBuoy(plannedBuoy('buoy-1', R, 0, 0, 1));
      e.setPlaneRoute(spec);
      const t = stepUntilReleased(e);
      return {t, bits: bits(t), phase: e.buoyStatus(0, 9).phase};
    };
    const a = run(), b = run();
    expect(a.bits).toBe(b.bits);
    expect(a.t).toBe(b.t);
    expect(a.phase).toBe(b.phase);
  });

  it('never drops when no route is set', () => {
    const e = unplaced();
    e.addBuoy(plannedBuoy('buoy-1', 0, 0, 0, 1));
    expect(e.buoyStatus(0, 9).phase).toBe('planned');
    e.advance(120);
    expect(e.buoyStatus(0, 9).phase).toBe('planned');
    expect(e.scenario.buoys[0]!.deployedAt).toBeUndefined();
    expect(e.buoyStatus(0, 9).releaseAt).toBeNull();
  });

  it('dropBuoy without a route still releases immediately (existing sequence behaviour)', () => {
    const e = unplaced();
    e.dropBuoy({channel: 3, kind: 'difar', x: 0, y: 0, hydrophoneDepthM: 40});
    expect(e.scenario.buoys[0]!.deployedAt).toBe(0);
    expect(e.buoyStatus(0, 9).phase).toBe('deployed');
  });
});
