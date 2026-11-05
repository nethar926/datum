/** Geometric spreading: Urick. Thorp (1967) empirical absorption, f in Hz; result dB/km. */
export function thorp(f: number): number { const q=(Math.max(0,f)/1000)**2; return .11*q/(1+q)+44*q/(4100+q)+2.75e-4*q+.003; }
export type Spreading = 'spherical' | 'cylindrical' | 'hybrid';
export function spreadingLoss(range: number, mode: Spreading='spherical', transition=1000): number {
  const r=Math.max(1,range), t=Math.max(1,transition);
  if(mode==='cylindrical') return 10*Math.log10(r);
  return mode==='hybrid' && r>t ? 20*Math.log10(t)+10*Math.log10(r/t) : 20*Math.log10(r);
}
export function transmissionLoss(range:number,f:number,mode:Spreading='spherical',transition=1000):number {
  return spreadingLoss(range,mode,transition)+thorp(f)*Math.max(0,range-1)/1000;
}
