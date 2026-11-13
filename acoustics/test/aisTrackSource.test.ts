import {describe, expect, it} from 'vitest';
import {
  AIS_CLASSES,
  AIS_COG_NOISY_KN,
  AIS_DEFAULT_COUNT,
  AIS_TYPES,
  aisIdentity,
  createAisTrackSource,
  type AisEngineTrack,
  type AisType,
} from '../src/aisTrackSource.js';
import {knotsToMps} from '../src/units.js';

function isType(s: string): s is AisType {
  return (AIS_TYPES as readonly string[]).includes(s);
}

describe('AisTrackSource', () => {
  it('is deterministic by seed and fills callsign, class and type', () => {
    const a = createAisTrackSource({seed: 7});
    const b = createAisTrackSource({seed: 7});
    const tracks = a.aisTracks(0);
    expect(tracks.length).toBe(AIS_DEFAULT_COUNT);
    expect(b.aisTracks(0)).toEqual(tracks);
    for (const t of tracks) {
      expect(t.id).toMatch(/^ais-\d{2}$/);
      expect(t.callsign).toMatch(/^[A-Z]{2}[0-9]{2}[A-Z]$/);
      expect(t.callsign.toLowerCase().includes('fictional ')).toBe(false);
      expect(t.name.toLowerCase().startsWith('fictional ')).toBe(false);
      expect(isType(t.type)).toBe(true);
      expect(AIS_CLASSES[t.type]).toContain(t.shipClass);
      expect(t.class).toBe(t.shipClass);
      expect(t.spdMps).toBeGreaterThan(0);
      expect(t.crsDeg).toBeGreaterThanOrEqual(0);
      expect(t.crsDeg).toBeLessThan(360);
    }
    const other = createAisTrackSource({seed: 8}).aisTracks(0);
    expect(other.map((t) => t.callsign).join()).not.toBe(tracks.map((t) => t.callsign).join());
  });

  it('looks up by id and dead-reckons in a straight line between course changes', () => {
    const src = createAisTrackSource({seed: 11, count: 5});
    const t = src.aisTrack('ais-00', 42)!;
    expect(t.id).toBe('ais-00');
    expect(src.aisTrack('missing', 0)).toBeUndefined();

    // Fine sampling: heading is piecewise constant, position moves at speed.
    const id = 'ais-02';
    const dt = 1;
    let prev = src.aisTrack(id, 0)!;
    let changes = 0;
    for (let tS = dt; tS <= 3600; tS += dt) {
      const now = src.aisTrack(id, tS)!;
      const ds = Math.hypot(now.x - prev.x, now.y - prev.y);
      const expected = prev.spdMps * dt;
      if (Math.abs(now.crsDeg - prev.crsDeg) > 1e-9) {
        changes += 1;
        // Position stays continuous across a course change.
        expect(ds).toBeLessThanOrEqual(expected * 1.001 + 1e-9);
      } else {
        expect(Math.abs(ds - expected)).toBeLessThan(1e-6);
        const h = prev.crsDeg * Math.PI / 180;
        const ex = prev.x + prev.spdMps * Math.sin(h) * dt;
        const ey = prev.y + prev.spdMps * Math.cos(h) * dt;
        expect(Math.abs(now.x - ex)).toBeLessThan(1e-6);
        expect(Math.abs(now.y - ey)).toBeLessThan(1e-6);
      }
      expect(now.callsign).toBe(prev.callsign);
      expect(now.shipClass).toBe(prev.shipClass);
      expect(now.type).toBe(prev.type);
      prev = now;
    }
    expect(changes).toBeGreaterThan(0);
  });

  it('decorate keeps the incoming pose and fills identity from seed+id', () => {
    const src = createAisTrackSource({seed: 7});
    const idn = aisIdentity(7, 'surface-lumen');
    const decorated = src.decorate({
      id: 'surface-lumen', name: 'MV LUMEN',
      x: 123, y: -456, crsDeg: 410, spdMps: 6.5,
    });
    expect(decorated.callsign).toBe(idn.callsign);
    expect(decorated.shipClass).toBe(idn.shipClass);
    expect(decorated.type).toBe(idn.type);
    expect(decorated.name).toBe('MV LUMEN');
    expect(decorated.x).toBe(123);
    expect(decorated.y).toBe(-456);
    expect(decorated.crsDeg).toBe(50);
    expect(decorated.spdMps).toBe(6.5);
    expect(aisIdentity(7, 'surface-lumen')).toEqual(idn);
    expect(aisIdentity(8, 'surface-lumen')).not.toEqual(idn);
  });
});

function crabAbsDeg(t: AisEngineTrack): number | null {
  if (!t.hdgAvailable || t.hdgDeg === null) return null;
  let d = Math.abs(t.crsDeg - t.hdgDeg) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

describe('AIS heading separate from course', () => {
  it('is deterministic per seed and heading stays in [0, 360)', () => {
    const a = createAisTrackSource({seed: 7, count: 24});
    const b = createAisTrackSource({seed: 7, count: 24});
    const tracks = a.aisTracks(120);
    expect(b.aisTracks(120)).toEqual(tracks);
    for (const t of tracks) {
      expect(t.hdgAvailable).toBe(t.hdgDeg !== null);
      if (t.hdgDeg !== null) {
        expect(t.hdgDeg).toBeGreaterThanOrEqual(0);
        expect(t.hdgDeg).toBeLessThan(360);
      }
      expect(t.crsDeg).toBeGreaterThanOrEqual(0);
      expect(t.crsDeg).toBeLessThan(360);
    }
    const other = createAisTrackSource({seed: 8, count: 24}).aisTracks(120);
    expect(other.map((t) => `${t.hdgAvailable}:${t.hdgDeg}:${t.crsDeg}`).join())
      .not.toBe(tracks.map((t) => `${t.hdgAvailable}:${t.hdgDeg}:${t.crsDeg}`).join());
  });

  it('keeps course-over-ground behaviour unchanged at underway speeds', () => {
    // Existing dead-reckoning already checks crsDeg vs motion. Reconfirm decorate
    // still wraps incoming course and does not inject COG noise above 0.5 kt.
    const src = createAisTrackSource({seed: 7});
    const decorated = src.decorate({
      id: 'surface-lumen', name: 'MV LUMEN',
      x: 123, y: -456, crsDeg: 410, spdMps: 6.5,
    });
    expect(decorated.crsDeg).toBe(50);
    expect(decorated.spdMps).toBe(6.5);
    expect(decorated.x).toBe(123);
    expect(decorated.y).toBe(-456);
    expect(decorated.hdgAvailable).toBe(decorated.hdgDeg !== null);
  });

  it('puts 15–25% of tracks in no-heading and 10–20% over 15° of crab', () => {
    const src = createAisTrackSource({seed: 11, count: 800});
    const tracks = src.aisTracks(0);
    expect(tracks.length).toBe(800);
    const noHdg = tracks.filter((t) => !t.hdgAvailable && t.hdgDeg === null);
    const over15 = tracks.filter((t) => {
      const c = crabAbsDeg(t);
      return c !== null && c > 15;
    });
    const noFrac = noHdg.length / tracks.length;
    const overFrac = over15.length / tracks.length;
    expect(noFrac).toBeGreaterThanOrEqual(0.15);
    expect(noFrac).toBeLessThanOrEqual(0.25);
    expect(overFrac).toBeGreaterThanOrEqual(0.10);
    expect(overFrac).toBeLessThanOrEqual(0.20);
    const classB = noHdg.filter((t) => t.type === 'yacht' || t.type === 'fishing').length;
    expect(classB / noHdg.length).toBeGreaterThan(2 / 6);
  });

  it('holds heading steady while course is noisy under about 0.5 kt', () => {
    const src = createAisTrackSource({seed: 7});
    const slow = knotsToMps(AIS_COG_NOISY_KN * 0.4);
    const pose = {id: 'surface-lumen', x: 0, y: 0, crsDeg: 80, spdMps: slow};
    const a = src.decorate(pose, 0);
    const b = src.decorate(pose, 12);
    const c = src.decorate(pose, 12);
    expect(c).toEqual(b);
    expect(a.crsDeg).not.toBe(b.crsDeg);
    expect(a.crsDeg).not.toBe(80);
    expect(a.hdgAvailable).toBe(b.hdgAvailable);
    expect(a.hdgDeg).toBe(b.hdgDeg);
    if (a.hdgDeg !== null) {
      expect(a.hdgDeg).toBeGreaterThanOrEqual(0);
      expect(a.hdgDeg).toBeLessThan(360);
    }
    // Underway (same identity) keeps the input course and a steady heading.
    const fast = src.decorate({...pose, spdMps: 6.5}, 0);
    const fastLater = src.decorate({...pose, spdMps: 6.5}, 12);
    expect(fast.crsDeg).toBe(80);
    expect(fastLater.crsDeg).toBe(80);
    expect(fast.hdgDeg).toBe(fastLater.hdgDeg);
  });
});
