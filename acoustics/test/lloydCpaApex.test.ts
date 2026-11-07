import { describe, it, expect } from 'vitest';
import { pathDifference } from '../src/index.js';
// Straight constant-speed pass at fixed depths: the Lloyd's mirror fringe turning point lands exactly at CPA.
describe("Lloyd's mirror fringe apex at CPA", () => {
  it('order-n null frequency is extremal (minimum) at CPA and symmetric about it', () => {
    const c = 1500, zs = 60, zr = 90, v = 5, cpa = 1200, tCpa = 37.5, n = 3;
    const fNull = (t: number) => { const r = Math.hypot(cpa, v * (t - tCpa)); return n * c / pathDifference(r, zs, zr); };
    let best = Infinity, tBest = NaN;
    for (let t = -600; t <= 600; t += 0.25) { const f = fNull(t); if (f < best) { best = f; tBest = t; } }
    expect(tBest).toBeCloseTo(tCpa, 6);
    for (const dt of [10, 60, 300]) expect(fNull(tCpa + dt)).toBeCloseTo(fNull(tCpa - dt), 9);
    expect(fNull(tCpa + 60)).toBeGreaterThan(fNull(tCpa));
  });
});
