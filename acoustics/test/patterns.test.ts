import { describe, expect, it } from 'vitest';
import { planPattern, transmissionLoss, deriveSeed, type PatternOptions, type PatternKind } from '../src/index.js';

const center = { x: 1234, y: -5678 };
const defaults = { center, axisDeg: 37 };
const distance = (a: typeof center, b: typeof center) => Math.hypot(a.x - b.x, a.y - b.y);
const local = (p: typeof center, axis = defaults.axisDeg, origin = center) => {
  const a = axis * Math.PI / 180, x = p.x - origin.x, y = p.y - origin.y;
  return { along: x * Math.sin(a) + y * Math.cos(a), across: x * Math.cos(a) - y * Math.sin(a) };
};

describe('planPattern geometry (clockwise from north)', () => {
  it.each([0, 37, 90, 180, 270, -53, 397])('barrier is centered and perpendicular at %s degrees', axisDeg => {
    const plan = planPattern({ ...defaults, kind: 'barrier', axisDeg });
    expect(plan.points).toHaveLength(5);
    plan.points.forEach((p, i) => {
      expect(local(p, axisDeg).along).toBeCloseTo(0, 8);
      expect(local(p, axisDeg).across).toBeCloseTo((i - 2) * plan.spacingM, 8);
      if (i) expect(distance(p, plan.points[i - 1])).toBeCloseTo(plan.spacingM, 8);
    });
    expect(plan.spacingM).toBe(1.5 * plan.detectionRangeM);
  });
  it('ring is six equally spaced circumference-only sites at R', () => {
    const plan = planPattern({ ...defaults, kind: 'ring' });
    expect(plan.points).toHaveLength(6);
    plan.points.forEach((p, i) => {
      expect(distance(p, center)).toBeCloseTo(plan.detectionRangeM, 8);
      const a = (defaults.axisDeg + i * 60) * Math.PI / 180;
      expect(p.x).toBeCloseTo(center.x + plan.detectionRangeM * Math.sin(a), 8);
      expect(p.y).toBeCloseTo(center.y + plan.detectionRangeM * Math.cos(a), 8);
      expect(distance(p, plan.points[(i + 1) % 6])).toBeCloseTo(plan.detectionRangeM, 8);
    });
  });
  it('grid is aligned 3x3 with sqrt(2)R edge spacing and 2R diagonals', () => {
    const plan = planPattern({ ...defaults, kind: 'grid' }), r = plan.detectionRangeM;
    expect(plan.points).toHaveLength(9);
    expect(plan.spacingM).toBe(Math.SQRT2 * r);
    plan.points.forEach((p, i) => {
      expect(local(p).along).toBeCloseTo((Math.floor(i / 3) - 1) * plan.spacingM, 8);
      expect(local(p).across).toBeCloseTo((i % 3 - 1) * plan.spacingM, 8);
    });
    expect(distance(plan.points[0], plan.points[4])).toBeCloseTo(2 * r, 8);
  });
  it('wedge counts one shared apex plus two sites on each forward +/-30 degree leg', () => {
    const plan = planPattern({ ...defaults, kind: 'wedge' }), apex = plan.points[0];
    expect(plan.points).toHaveLength(5);
    expect(local(apex).along).toBeCloseTo(2 * plan.detectionRangeM, 8);
    expect(local(apex).across).toBeCloseTo(0, 8);
    plan.points.slice(1).forEach((p, j) => {
      const i = j + 1, v = local(p, defaults.axisDeg, apex);
      expect(Math.atan2(v.across, v.along) * 180 / Math.PI).toBeCloseTo(i % 2 ? 30 : -30, 8);
      expect(distance(p, apex)).toBeCloseTo(Math.ceil(i / 2) * plan.spacingM, 8);
    });
    expect(distance(plan.points[1], plan.points[3])).toBeCloseTo(plan.spacingM, 8);
    expect(distance(plan.points[2], plan.points[4])).toBeCloseTo(plan.spacingM, 8);
  });
  it('single copies center exactly', () => {
    const plan = planPattern({ ...defaults, kind: 'single' });
    expect(plan.points).toEqual([center]);
    expect(plan.points[0]).not.toBe(center);
  });
  it('AUTO resolves to barrier across the supplied axis', () => {
    expect(planPattern({ ...defaults, kind: 'auto' })).toEqual(planPattern({ ...defaults, kind: 'barrier' }));
  });
  it('AUTO without a finite threat axis resolves to a north-oriented ring', () => {
    expect(planPattern({ ...defaults, kind: 'auto', axisDeg: NaN })).toEqual(planPattern({ ...defaults, kind: 'ring', axisDeg: 0 }));
  });
});

describe('passive sonar range and spacing', () => {
  it.each(['spherical', 'hybrid', 'cylindrical'] as const)('inverts TL including Thorp within 1m (%s)', spreading => {
    const target = 12345.67, fHz = 200, nlDb = 70, diDb = 7.8, dtDb = 8;
    const slDb = transmissionLoss(target, fHz, spreading) + nlDb - diDb + dtDb;
    const plan = planPattern({ ...defaults, kind: 'barrier', slDb, nlDb, diDb, dtDb, fHz, spreading });
    expect(Math.abs(plan.detectionRangeM - target)).toBeLessThan(1);
    expect(transmissionLoss(plan.detectionRangeM, fHz, spreading)).toBeCloseTo(slDb - nlDb + diDb - dtDb, 9);
  });
  it('uses fictional 120/70/0/10 dB, 200Hz and spherical defaults', () => {
    expect(planPattern({ ...defaults, kind: 'barrier' })).toEqual(planPattern({ ...defaults, kind: 'barrier', slDb: 120, nlDb: 70, diDb: 0, dtDb: 10, fHz: 200, spreading: 'spherical' }));
    // Default FOM=40 dB, below spherical TL(1km), hence lower-bound clamp.
    expect(planPattern({ ...defaults, kind: 'barrier' }).detectionRangeM).toBe(1000);
  });
  it.each([[0, 1000], [250, 30000]])('clamps source level %s to range %s', (slDb, r) => {
    expect(planPattern({ ...defaults, kind: 'single', slDb }).detectionRangeM).toBe(r);
  });
  it.each([120, 160])('clamps 0.4R and 5R spacing at SL=%s', slDb => {
    const opts = { ...defaults, kind: 'barrier' as const, slDb }, r = planPattern(opts).detectionRangeM;
    expect(planPattern({ ...opts, spacingM: .4 * r }).spacingM).toBe(Math.max(500, .5 * r));
    expect(planPattern({ ...opts, spacingM: 5 * r }).spacingM).toBe(3 * r);
  });
  it('explicit grid spacing overrides the geometric default', () => {
    expect(planPattern({ ...defaults, kind: 'grid', spacingM: 1000 }).spacingM).toBe(1000);
  });
});

describe('seeds, receiver types and count overrides', () => {
  const kinds: PatternKind[] = ['barrier', 'ring', 'grid', 'wedge', 'single'];
  it.each(kinds)('%s assigns matching receiver types and unique RF integers', kind => {
    const plan = planPattern({ ...defaults, kind, seed: 'training' });
    expect(plan.types).toEqual(plan.points.map(() => kind === 'ring' || kind === 'grid' ? 'passive-omni' : 'difar'));
    expect(plan.channels).toHaveLength(plan.points.length);
    expect(new Set(plan.channels).size).toBe(plan.points.length);
    expect(plan.channels.every(c => Number.isInteger(c) && c >= 1 && c <= 9999)).toBe(true);
  });
  it.each(kinds)('%s scatter is independent, bounded and repeatable for number/string seeds', kind => {
    const opts = { ...defaults, kind }, clean = planPattern(opts);
    expect(planPattern({ ...opts, scatter: false }).points).toEqual(clean.points);
    expect(planPattern({ ...opts, seed: 99 }).points).toEqual(clean.points);
    for (const seed of [42, 'fixture']) {
      const a = planPattern({ ...opts, seed, scatter: true });
      expect(a).toEqual(planPattern({ ...opts, seed, scatter: true }));
      expect(a.points).not.toEqual(planPattern({ ...opts, seed: 'other', scatter: true }).points);
      expect(a.channels).toEqual(planPattern({ ...opts, seed }).channels);
      a.points.forEach((p, i) => {
        expect(Math.abs(p.x - clean.points[i].x)).toBeLessThanOrEqual(.05 * a.spacingM);
        expect(Math.abs(p.y - clean.points[i].y)).toBeLessThanOrEqual(.05 * a.spacingM);
      });
    }
  });
  it.each([['barrier', 4], ['ring', 8], ['grid', 4], ['wedge', 7]] as const)('honors %s count=%s', (kind, count) => {
    expect(planPattern({ ...defaults, kind, count }).points).toHaveLength(count);
  });
  it('promotes a sparse ring override only to meet the 1.5R arc limit', () => {
    const plan = planPattern({ ...defaults, kind: 'ring', count: 3 });
    expect(plan.points).toHaveLength(5);
    expect(2 * Math.PI * plan.detectionRangeM / plan.points.length).toBeLessThanOrEqual(1.5 * plan.detectionRangeM);
  });
  it('centers partially filled grid count overrides on the occupied centroid', () => {
    const plan = planPattern({ ...defaults, kind: 'grid', count: 7 });
    expect(plan.points.reduce((sum, p) => sum + p.x, 0) / 7).toBeCloseTo(center.x, 8);
    expect(plan.points.reduce((sum, p) => sum + p.y, 0) / 7).toBeCloseTo(center.y, 8);
  });
  it('channels wrap without collisions even for all 9999 channels', () => {
    const seed = 'wrap', plan = planPattern({ ...defaults, kind: 'barrier', count: 9999, seed });
    expect(new Set(plan.channels).size).toBe(9999);
    expect(plan.channels[0]).toBe(deriveSeed(deriveSeed(0, seed), 'pattern:channels') % 9999 + 1);
    plan.channels.slice(1).forEach((c, i) => expect(c).toBe(plan.channels[i] % 9999 + 1));
  });
  it('does not mutate input or share result state', () => {
    const opts = Object.freeze({ ...defaults, center: Object.freeze({ ...center }), kind: 'barrier' as const });
    const first = planPattern(opts), second = planPattern(opts);
    expect(first).toEqual(second);
    first.points[0].x = 0;
    first.channels[0] = 0;
    expect(planPattern(opts)).toEqual(second);
  });
  it.each([
    { scatter: true }, { count: 0 }, { count: 1.5 }, { count: 10000 }, { count: NaN },
    { spacingM: NaN }, { slDb: Infinity }, { nlDb: NaN }, { diDb: Infinity },
    { dtDb: NaN }, { fHz: -1 }, { seed: NaN }, { axisDeg: Infinity },
    { center: { x: NaN, y: 0 } }, { kind: 'single', count: 2 },
  ] as Partial<PatternOptions>[])('rejects invalid options: %j', extra => {
    expect(() => planPattern({ ...defaults, kind: 'barrier', ...extra })).toThrow(RangeError);
  });
});
