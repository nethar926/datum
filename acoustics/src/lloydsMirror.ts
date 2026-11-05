import { C } from './units.js';
/** Pressure-release surface image source, reflection -1 (Urick; Jensen et al., Computational Ocean Acoustics).
 * Coherent field normalized by direct-path 1/R1: 1 - (R1/R2) exp(i k (R2-R1)).
 * Unequal spreading means exact phase nulls are minima, not strictly zero field. */
export function pathDifference(r: number, zs: number, zr: number): number {
  const a=Math.hypot(r,zs-zr), b=Math.hypot(r,zs+zr);
  return b+a>0 ? 4*zs*zr/(a+b) : 0;
}
export function exactGain(f: number, r: number, zs: number, zr: number, c=C): number {
  r=Math.max(0,r); zs=Math.max(0,zs); zr=Math.max(0,zr);
  const a=Math.hypot(r,zs-zr), b=Math.hypot(r,zs+zr), q=b>0?a/b:1;
  const s=Math.sin(Math.PI*f*pathDifference(r,zs,zr)/Math.max(1,c));
  return (1-q)*(1-q)+4*q*s*s;
}
/** Equal-amplitude two-path interference, useful for locating exact phase nulls. */
export function interferenceGain(f: number,r: number,zs: number,zr: number,c=C): number {
  return 4*Math.sin(Math.PI*f*pathDifference(r,zs,zr)/Math.max(1,c))**2;
}
export const farFieldGain=(f:number,r:number,zs:number,zr:number,c=C):number => 4*Math.sin(2*Math.PI*f*zs*zr/(Math.max(1e-9,r)*c))**2;
export const nullRange=(f:number,zs:number,zr:number,n=1,c=C):number => 2*f*zs*zr/(Math.max(1,n)*c);
export const nullSpacing=(r:number,zs:number,zr:number,c=C):number => c*r/Math.max(1e-12,2*zs*zr);
