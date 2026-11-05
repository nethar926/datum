import type { ReceiverType } from './buoys.js';
import { deriveSeed, mulberry32 } from './prng.js';
import { transmissionLoss, type Spreading } from './transmissionLoss.js';

export type PatternKind = 'barrier' | 'ring' | 'grid' | 'wedge' | 'single';
export interface PatternOptions {
  kind: PatternKind | 'auto';
  center: { x: number; y: number };
  /** Degrees clockwise from north (+Y), as in kinematics.ts (but degrees, not radians). */
  axisDeg: number;
  count?: number;
  spacingM?: number;
  scatter?: boolean;
  seed?: number | string;
  slDb?: number;
  nlDb?: number;
  diDb?: number;
  dtDb?: number;
  fHz?: number;
  spreading?: Spreading;
}
export interface PatternPlan {
  points: { x: number; y: number }[];
  types: ReceiverType[];
  channels: number[];
  spacingM: number;
  detectionRangeM: number;
  kind: PatternKind;
}

function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
  return value;
}

/** Pure training planner; no engine state, deployments or worker protocol changes.
 * Passive FOM = SL - NL + DI - DT. Fictional defaults 140/60/0/10 dB,
 * 200 Hz, hybrid TL (including existing Thorp absorption). */
export function planPattern(opts: PatternOptions): PatternPlan {
  finite(opts.center.x, 'center.x');
  finite(opts.center.y, 'center.y');
  const hasAxis = Number.isFinite(opts.axisDeg);
  const kind = opts.kind === 'auto' ? (hasAxis ? 'barrier' : 'ring') : opts.kind;
  if (!['barrier', 'ring', 'grid', 'wedge', 'single'].includes(kind))
    throw new RangeError('Unknown pattern kind');
  // A ring has no threat axis when AUTO was called with a nonfinite axis.
  const axis = (hasAxis ? opts.axisDeg % 360 : opts.kind === 'auto' ? 0 : finite(opts.axisDeg, 'axisDeg')) * Math.PI / 180;
  const sl = finite(opts.slDb ?? 140, 'slDb'), nl = finite(opts.nlDb ?? 60, 'nlDb');
  const di = finite(opts.diDb ?? 0, 'diDb'), dt = finite(opts.dtDb ?? 10, 'dtDb');
  const f = finite(opts.fHz ?? 200, 'fHz');
  if (f < 0) throw new RangeError('fHz must be nonnegative');
  const spreading = opts.spreading ?? 'hybrid';
  if (!['spherical', 'cylindrical', 'hybrid'].includes(spreading))
    throw new RangeError('Unknown spreading mode');
  const fom = sl - nl + di - dt;
  let lo = 1000, hi = 30000;
  if (fom <= transmissionLoss(lo, f, spreading)) hi = lo;
  else if (fom >= transmissionLoss(hi, f, spreading)) lo = hi;
  else for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2;
    if (transmissionLoss(mid, f, spreading) < fom) lo = mid;
    else hi = mid;
  }
  const r = (lo + hi) / 2;
  const spacing = Math.min(3 * r, Math.max(500, .5 * r,
    finite(opts.spacingM ?? (kind === 'grid' ? Math.SQRT2 : 1.5) * r, 'spacingM')));
  let count = opts.count ?? ({ barrier: 5, ring: 6, grid: 9, wedge: 5, single: 1 }[kind]);
  if (!Number.isInteger(count) || count < 1 || count > 9999)
    throw new RangeError('count must be an integer in 1..9999');
  if (kind === 'single' && count !== 1) throw new RangeError('single requires count=1');
  // Even sectors; never allow neighbor arc length > 1.5R. No center buoy.
  if (kind === 'ring') count = Math.max(count, Math.ceil(2 * Math.PI / 1.5));
  if (opts.scatter && opts.seed === undefined) throw new RangeError('scatter requires a seed');
  if (typeof opts.seed === 'number') finite(opts.seed, 'seed');
  const seed = typeof opts.seed === 'string' ? deriveSeed(0, opts.seed) : (opts.seed ?? 0) >>> 0;
  const jitter = mulberry32(deriveSeed(seed, 'pattern:scatter'));
  const base = deriveSeed(seed, 'pattern:channels') % 9999;
  const points: PatternPlan['points'] = [];
  const add = (x: number, y: number): void => { points.push({ x, y }); };
  const alongX = Math.sin(axis), alongY = Math.cos(axis);
  const acrossX = Math.cos(axis), acrossY = -Math.sin(axis);
  const local = (along: number, across: number): void => add(
    opts.center.x + along * alongX + across * acrossX,
    opts.center.y + along * alongY + across * acrossY);
  switch (kind) {
    case 'barrier':
      for (let i = 0; i < count; i++) local(0, (i - (count - 1) / 2) * spacing);
      break;
    case 'ring':
      for (let i = 0; i < count; i++) {
        const a = axis + i * 2 * Math.PI / count;
        add(opts.center.x + r * Math.sin(a), opts.center.y + r * Math.cos(a));
      }
      break;
    case 'grid': {
      // Near-square row-major overrides; center the occupied sites' centroid.
      const cols = Math.ceil(Math.sqrt(count));
      let sumRow = 0, sumCol = 0;
      for (let i = 0; i < count; i++) { sumRow += Math.floor(i / cols); sumCol += i % cols; }
      for (let i = 0; i < count; i++) local(
        (Math.floor(i / cols) - sumRow / count) * spacing, (i % cols - sumCol / count) * spacing);
      break;
    }
    case 'wedge':
      // One shared apex, followed by alternating +30/-30 degree forward legs.
      local(2 * r, 0);
      for (let i = 1; i < count; i++) {
        const distance = Math.ceil(i / 2) * spacing;
        local(2 * r + distance * Math.cos(Math.PI / 6), (i % 2 ? 1 : -1) * distance * .5);
      }
      break;
    case 'single': local(0, 0); break;
  }
  if (opts.scatter) for (const point of points) {
    point.x += (jitter() * 2 - 1) * .05 * spacing;
    point.y += (jitter() * 2 - 1) * .05 * spacing;
  }
  const type: ReceiverType = kind === 'ring' || kind === 'grid' ? 'passive-omni' : 'difar';
  return { points, types: points.map(() => type), channels: points.map((_, i) => (base + i) % 9999 + 1),
    spacingM: spacing, detectionRangeM: r, kind };
}
