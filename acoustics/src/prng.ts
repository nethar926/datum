/** Mulberry32 (Tommy Ettinger); Box–Muller transform (1958). Non-cryptographic. */
import './jsMath.js';
export type Random = (() => number) & {reset?:(seed:number)=>void};
export function mulberry32(seed: number): Random {
  let a = seed >>> 0;
  const next:Random = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
    t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  next.reset=(seed:number)=>{a=seed>>>0;};return next;
}
export function gaussian(rng: Random): number {
  return Math.sqrt(-2 * Math.log(Math.max(rng(), 1 / 4294967296))) * Math.cos(2 * Math.PI * rng());
}
/** FNV-1a keyed derivation: stable independent contact/buoy streams. */
export function deriveSeed(seed: number, id: string): number {
  let h = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}
