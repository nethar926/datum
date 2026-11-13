import {describe, expect, it} from 'vitest';
import {
  AIS_CLASSES,
  AIS_DEFAULT_COUNT,
  AIS_TYPES,
  aisIdentity,
  createAisTrackSource,
  type AisType,
} from '../src/aisTrackSource.js';

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
