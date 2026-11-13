import {describe, it, expect} from 'vitest';
import {
  AcousticEngine, cpaScenario, fictionalSignature, geometry, createGeometry, doppler,
  FreqTrackBook, freqTrackBearingsFromState, FREQ_TRACK_COAST_S, FREQ_TRACK_DEFAULT_GATE_HZ,
  BEARING_SNR_FLOOR,
} from '../src/index.js';
import type {Contact} from '../src/scenario.js';
import type {Buoy} from '../src/buoys.js';
import type {ContactPose} from '../src/autoBearings.js';

function contactAt(id: string, bearingDeg: number, rangeM: number, over: Partial<Contact> & {params?: Partial<Contact['params']>} = {}): Contact {
  const rad = bearingDeg * Math.PI / 180;
  const {params: paramOver, ...rest} = over;
  const params = {
    ...fictionalSignature, label: id, levelDb: 160, tonalRefDb: 160, modulation: 0, cavitationPower: 0,
    tonals: [{family: 'motor' as const, hz: 90, power: 1}],
    ...paramOver,
  };
  return {
    id, category: 'subsurface', classificationTarget: true,
    x: rangeM * Math.sin(rad), y: rangeM * Math.cos(rad), depth: 60, course: 0, speed: 0,
    motion: [{at: 0, course: rest.course ?? 0, speed: rest.speed ?? 0, depth: 60}],
    params,
    ...rest,
  };
}

function buoy(over: Partial<Buoy> = {}): Buoy {
  return {id: 'buoy-1', rfChannel: 1, x: 0, y: 0, depth: 40, course: 0, speed: 0, deployedAt: 0, life: 7200, type: 'difar', ...over};
}

function scenario(contacts: Contact[], buoys: Buoy[] = [buoy()]) {
  const s = cpaScenario();
  s.bins = 512; s.fmax = 500; s.band = [0, 500]; s.seed = 7;
  s.environment.seaState = 0; s.environment.shipping = 'light';
  s.contacts = contacts; s.buoys = buoys; s.surfacePool = []; s.surfaceTraffic = 0;
  return s;
}

function asPose(c: Contact): ContactPose {
  return {id: c.id, x: c.x, y: c.y, depth: c.depth, course: c.course, speed: c.speed, active: c.active, lines: c.params.tonals, params: c.params};
}

describe('freqTrack', () => {
  it('locks on a seeded tonal and reports the contract fields', () => {
    const c = contactAt('alpha', 45, 400);
    const b = buoy();
    const book = new FreqTrackBook();
    const id = book.start(1, 90, undefined, 0, [b]);
    expect(id).toBe(1);
    expect(FREQ_TRACK_DEFAULT_GATE_HZ).toBe(10);
    const rows = freqTrackBearingsFromState({
      tracks: book.specs(), buoys: [b], contacts: [asPose(c)],
      environment: scenario([c]).environment, seed: 7, atSimTime: 0,
    });
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r).toMatchObject({
      trackId: 1, buoyId: 1, state: 'tracking', locked: true,
    });
    expect(r.quality).toBe(r.snrDb);
    expect(r.snrDb).toBeGreaterThan(10);
    expect(r.freqHz).toBeCloseTo(90, 6);
    expect(r.brgDeg).toBeGreaterThanOrEqual(0);
    expect(r.brgDeg).toBeLessThan(360);
    expect(r.sigmaDeg).toBeGreaterThan(0);
    expect(r.sigmaDeg).toBeLessThanOrEqual(90);
    expect(r.locked).toBe(r.state === 'tracking');
    const truth = geometry(c, b, createGeometry()).bearing * 180 / Math.PI;
    const err = Math.abs(((r.brgDeg - truth + 540) % 360) - 180);
    expect(err).toBeLessThan(20);
  });

  it('follows Doppler drift of the strongest peak inside the gate', () => {
    // Crossing east: starts west of the buoy so radial velocity (and Doppler)
    // changes as it runs toward CPA.
    const speed = 25, x0 = -3000, y0 = 800, crs = Math.PI / 2, hz = 200, t1 = 80;
    const c0 = contactAt('alpha', 0, 4000, {
      x: x0, y: y0, speed, course: crs,
      params: {tonals: [{family: 'motor', hz, power: 1}]},
    });
    const env = scenario([c0]).environment;
    const book = new FreqTrackBook();
    book.start(1, hz, 10, 0, [buoy()]);
    const poseAt = (t: number): ContactPose => {
      const c = asPose(c0);
      c.x = x0 + speed * t;
      c.y = y0;
      c.speed = speed;
      c.course = crs;
      return c;
    };
    const a = freqTrackBearingsFromState({
      tracks: book.specs(), buoys: [buoy()], contactsAt: (t) => [poseAt(t)], environment: env, seed: 7, atSimTime: 0,
    })[0]!;
    const b = freqTrackBearingsFromState({
      tracks: book.specs(), buoys: [buoy()], contactsAt: (t) => [poseAt(t)], environment: env, seed: 7, atSimTime: t1,
    })[0]!;
    expect(a.state).toBe('tracking');
    expect(b.state).toBe('tracking');
    expect(a.locked).toBe(true);
    expect(b.locked).toBe(true);
    const expected = (t: number) => {
      const g = createGeometry();
      geometry({...c0, x: x0 + speed * t, y: y0, speed, course: crs} as Contact, buoy(), g);
      return doppler(hz, g.sourceRadial, g.receiverRadial, env.soundSpeed);
    };
    const f0 = expected(0), f1 = expected(t1);
    expect(a.freqHz).toBeCloseTo(f0, 9);
    expect(b.freqHz).toBeCloseTo(f1, 9);
    expect(Math.abs(f1 - f0)).toBeGreaterThan(0.5);
    expect(b.freqHz).not.toBe(a.freqHz);
  });

  it('coasts ~5 s below the SNR floor, then is lost, then reacquires', () => {
    const strong = asPose(contactAt('alpha', 45, 400));
    const env = scenario([contactAt('alpha', 45, 400)]).environment;
    const book = new FreqTrackBook();
    book.start(1, 90, 10, 0, [buoy()]);
    const contactsAt = (t: number): ContactPose[] => {
      if (t >= 3 && t < 12) return [{...strong, active: false}];
      return [strong];
    };
    const args = {tracks: book.specs(), buoys: [buoy()], contactsAt, environment: env, seed: 7};
    const at0 = freqTrackBearingsFromState({...args, atSimTime: 0})[0]!;
    expect(at0.state).toBe('tracking');
    expect(at0.locked).toBe(true);
    const midCoast = freqTrackBearingsFromState({...args, atSimTime: 3 + FREQ_TRACK_COAST_S - 1})[0]!;
    expect(midCoast.state).toBe('coasting');
    expect(midCoast.locked).toBe(false);
    expect(midCoast.freqHz).toBe(at0.freqHz);
    const lost = freqTrackBearingsFromState({...args, atSimTime: 3 + FREQ_TRACK_COAST_S})[0]!;
    expect(lost.state).toBe('lost');
    expect(lost.locked).toBe(false);
    const stillLost = freqTrackBearingsFromState({...args, atSimTime: 11})[0]!;
    expect(stillLost.state).toBe('lost');
    expect(stillLost.locked).toBe(false);
    const back = freqTrackBearingsFromState({...args, atSimTime: 12})[0]!;
    expect(back.state).toBe('tracking');
    expect(back.locked).toBe(true);
    expect(back.quality).toBe(back.snrDb);
    expect(back.snrDb).toBeGreaterThan(10);
    // Reconstructing later times does not depend on call order.
    const againLost = freqTrackBearingsFromState({...args, atSimTime: 3 + FREQ_TRACK_COAST_S})[0]!;
    expect(againLost).toEqual(lost);
  });

  it('is deterministic per seed and a different seed changes the noisy bearing', () => {
    const c = asPose(contactAt('alpha', 45, 400));
    const env = scenario([contactAt('alpha', 45, 400)]).environment;
    const book = new FreqTrackBook();
    book.start(1, 90, 10, 0, [buoy()]);
    const base = {tracks: book.specs(), buoys: [buoy()], contacts: [c], environment: env, atSimTime: 12};
    const a = freqTrackBearingsFromState({...base, seed: 11});
    const b = freqTrackBearingsFromState({...base, seed: 11});
    expect(a).toEqual(b);
    const z = freqTrackBearingsFromState({...base, seed: 99});
    expect(z[0]!.freqHz).toBeCloseTo(a[0]!.freqHz, 9);
    expect(z[0]!.brgDeg).not.toBe(a[0]!.brgDeg);
    expect(z[0]!.state).toBe('tracking');
  });

  it('throws on a non-DIFAR buoy and on an unknown buoy or track', () => {
    const omni = buoy({id: 'buoy-2', type: 'passive-omni'});
    const book = new FreqTrackBook();
    expect(() => book.start(2, 90, 10, 0, [omni])).toThrow(/Frequency track is DIFAR only/);
    expect(() => book.start(99, 90, 10, 0, [buoy()])).toThrow(/Unknown buoyId/);
    const id = book.start(1, 90, 10, 0, [buoy()]);
    book.stop(id);
    expect(() => book.stop(id)).toThrow(/Unknown trackId/);
  });

  it('AcousticEngine start/stop is a stable atSimTime stream and does not mutate time', () => {
    const s = scenario([contactAt('alpha', 45, 400)]);
    const e = new AcousticEngine(s);
    const t0 = e.time;
    const id = e.startFreqTrack(1, 90);
    expect(e.time).toBe(t0);
    const a = e.freqTrackBearings(0);
    const b = e.freqTrackBearings(0);
    expect(a).toEqual(b);
    expect(e.time).toBe(t0);
    expect(a[0]).toMatchObject({
      trackId: id, buoyId: 1, state: 'tracking', locked: true,
    });
    expect(a[0]!.quality).toBe(a[0]!.snrDb);
    const later = e.freqTrackBearings(20);
    expect(e.time).toBe(t0);
    expect(later[0]!.state).toBe('tracking');
    e.stopFreqTrack(id);
    expect(e.freqTrackBearings(0)).toEqual([]);
    const omni = scenario([contactAt('alpha', 45, 400)], [buoy({type: 'passive-omni'})]);
    const e2 = new AcousticEngine(omni);
    expect(() => e2.startFreqTrack(1, 90)).toThrow(/Frequency track is DIFAR only/);
  });
});
