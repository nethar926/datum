import type {VesselPlantSpec,PropulsionTruth,SpeedGated} from './catalog/drivetrain.js';
import { clamp } from './units.js';
export type TonalFamily='shaft'|'blade'|'src'|'gear'|'electrical'|'motor'|'diesel'|'pump'|'crank'|'cylinder'|'eda'|'turbine';
export type LineStability='stable'|'unstable';
export type LineWidth='discrete'|'diffuse';
export interface LineProfile {stability:LineStability;width:LineWidth;sigmaBins?:number}
export type LineProfiles=Partial<Record<TonalFamily,LineProfile>>;
export type LineFamily='CSR'|'CFR'|'EFR'|'EDA'|'PSR'|'MSR'|'COOLANT'|'TG'|'BR'|'GRID'|'SRC'|'MESH'|'AUX'|'TURBINE';
export type EngineLineFamily=LineFamily;
export interface TonalLine {eda?:{name:string;cfrMultiple:number};reactorId?:string;lineFamily?:EngineLineFamily;fundamentalHz?:number;engineId?:string;family:TonalFamily;hz:number;power:number;id?:string;stability?:LineStability;width?:LineWidth;sigmaBins?:number;frequencyHz?:number;shaftIndex?:number;harmonic?:number;engineIndex?:number}
const stable:LineProfile={stability:'stable',width:'discrete'},aux:LineProfile={stability:'unstable',width:'discrete'},diffuse:LineProfile={stability:'unstable',width:'diffuse',sigmaBins:2.5};
export function defaultLineProfile(family:TonalFamily):LineProfile{return family==='src'||family==='blade'?diffuse:family==='pump'||family==='diesel'?aux:stable;}
/** Nominal frequencies remain unchanged; these fictional tags describe oscillator behavior, not platforms. */
export function tagLine(line:TonalLine,index:number,profile:LineProfile=defaultLineProfile(line.family)):void {
 line.id??=`${line.family}:${index}`;if(line.family==='shaft'){line.lineFamily??='PSR';line.harmonic??=1;line.fundamentalHz??=line.hz/line.harmonic;}line.stability??=profile.stability;line.width??=profile.width;line.sigmaBins??=line.width==='diffuse'?(profile.sigmaBins??2.5):0;
}
export function sourceLines(s:Signature):TonalLine[]{
 const lines=s.tonals??Array.from({length:6},(_,i)=>({family:i===0?'shaft':i===1?'blade':'motor',hz:i<2?(i===0?s.shaftHz:bladeRate(s)):s.tonalHz*(i-1),power:10**(-i*3/10)} as TonalLine));
 for(let i=0;i<lines.length;i++)tagLine(lines[i],i,s.lineProfiles?.[lines[i].family]);return lines;
}
export interface Signature {speedGated?:SpeedGated[];reactorOffline?:boolean; plantSpec?:VesselPlantSpec;propulsion?:PropulsionTruth; label: string; shafts?:number; electricalHz?:50|60; shaftHz: number; blades: number; tonalHz: number; levelDb: number; modulation: number; lineProfiles?:LineProfiles; tonals?:TonalLine[]; inceptionKn?:number; cavitationPower?:number; flowNoiseDb?:number; flowRadiatedFraction?:number }
export const fictionalSignature: Signature = {label:'Fictional SSK A',shaftHz:2,blades:5,tonalHz:90,levelDb:125,modulation:.35};
/** Fictional teaching curves only. Urick: machinery harmonics, propeller blade rate and cavitation.
 * Inception speed rises with hydrostatic pressure; this illustrative fit is NOT platform data. */
export const bladeRate=(s:Signature):number => s.shaftHz*s.blades;
export const inceptionSpeed=(depth:number):number => 3+ .05*Math.sqrt(Math.max(0,depth)*100);
export function sourceLevel(s:Signature,speed:number,depth:number):number {
  return clamp(s.levelDb+(s.tonals?0:20*Math.log10(1+Math.max(0,speed)/3)+10*Math.log10(1+Math.max(0,speed-inceptionSpeed(depth))**2)),0,220);
}
export function fillTonals(s:Signature,freq:Float64Array,power:Float64Array,lines=s.tonals):void {
  if(lines){for(let i=0;i<freq.length;i++){const t=lines[i];freq[i]=t?.frequencyHz??t?.hz??0;power[i]=t?.power??0;}return;}
  for(let i=0;i<freq.length;i++){ freq[i]=i<2 ? (i===0?s.shaftHz:bladeRate(s)) : s.tonalHz*(i-1); power[i]=10**(-i*3/10); }
}
