import { clamp } from './units.js';
export type TonalFamily='shaft'|'blade'|'src'|'gear'|'electrical'|'motor'|'diesel'|'pump';
export interface TonalLine {family:TonalFamily;hz:number;power:number}
export interface Signature { label: string; shafts?:number; electricalHz?:50|60; shaftHz: number; blades: number; tonalHz: number; levelDb: number; modulation: number; tonals?:TonalLine[]; inceptionKn?:number; cavitationPower?:number; flowNoiseDb?:number; flowRadiatedFraction?:number }
export const fictionalSignature: Signature = {label:'Fictional SSK A',shaftHz:2,blades:5,tonalHz:90,levelDb:125,modulation:.35};
/** Fictional teaching curves only. Urick: machinery harmonics, propeller blade rate and cavitation.
 * Inception speed rises with hydrostatic pressure; this illustrative fit is NOT platform data. */
export const bladeRate=(s:Signature):number => s.shaftHz*s.blades;
export const inceptionSpeed=(depth:number):number => 3+ .05*Math.sqrt(Math.max(0,depth)*100);
export function sourceLevel(s:Signature,speed:number,depth:number):number {
  return clamp(s.levelDb+(s.tonals?0:20*Math.log10(1+Math.max(0,speed)/3)+10*Math.log10(1+Math.max(0,speed-inceptionSpeed(depth))**2)),0,220);
}
export function fillTonals(s:Signature,freq:Float64Array,power:Float64Array):void {
  if(s.tonals){for(let i=0;i<freq.length;i++){const t=s.tonals[i];freq[i]=t?.hz??0;power[i]=t?.power??0;}return;}
  for(let i=0;i<freq.length;i++){ freq[i]=i<2 ? (i===0?s.shaftHz:bladeRate(s)) : s.tonalHz*(i-1); power[i]=10**(-i*3/10); }
}
