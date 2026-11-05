import { C, clamp } from './units.js';
/** Urick: source radial positive toward receiver; receiver radial positive toward source. */
export function doppler(f: number, sourceRadial: number, receiverRadial=0, c=C): number {
  c=Math.max(1,c); return Math.max(0,f)*(c+clamp(receiverRadial,-.99*c,.99*c))/(c-clamp(sourceRadial,-.99*c,.99*c));
}
export function dopplerApprox(f: number, sourceRadial: number, receiverRadial=0, c=C): number {
  return Math.max(0,f*(1+(sourceRadial+receiverRadial)/Math.max(1,c)));
}
