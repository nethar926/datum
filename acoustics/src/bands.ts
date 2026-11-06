/** Named LOFAR frequency-band presets for training (fictional product labels; not classified sonar tables).
 *
 * Nested 0–fMax views match textbook-ish training LOFAR splits: each preset widens the display
 * upper edge while keeping f0 = 0 so bin 0 stays DC and fBin = fMax/(bins−1). Edges chosen to
 * fit the existing analytic engine and the M1 default (LF = scenario [0,500]):
 *   ELF 0–50 Hz   — very-low machinery / shaft region training window
 *   VLF 0–200 Hz  — shaft/blade + low plant region
 *   LF  0–500 Hz  — classic LOFAR / M1 scenario default
 *   MF  0–2000 Hz — wider machinery/electrical training view
 * Bands are nested (not exclusive partitions). Explicit [f0,fMax] subscribe still wins over a
 * preset when both are supplied. */
import type {LofarBandPresetId} from './protocol.js';
export type {LofarBandPresetId};
export interface LofarBandPreset {readonly id:LofarBandPresetId;readonly label:string;readonly band:readonly [number,number]}
export const LOFAR_BAND_PRESETS:readonly LofarBandPreset[]=Object.freeze([
  Object.freeze({id:'ELF',label:'ELF',band:Object.freeze([0,50] as [number,number])}),
  Object.freeze({id:'VLF',label:'VLF',band:Object.freeze([0,200] as [number,number])}),
  Object.freeze({id:'LF',label:'LF',band:Object.freeze([0,500] as [number,number])}),
  Object.freeze({id:'MF',label:'MF',band:Object.freeze([0,2000] as [number,number])}),
]);
const PRESET_BY_ID:ReadonlyMap<LofarBandPresetId,LofarBandPreset>=new Map(LOFAR_BAND_PRESETS.map(p=>[p.id,p]));
export function isLofarBandPresetId(v:unknown):v is LofarBandPresetId{
  return v==='ELF'||v==='VLF'||v==='LF'||v==='MF';
}
/** Resolve a named preset or an explicit [f0,fMax] to a mutable [f0,fMax] pair.
 * Throws on unknown preset ids or invalid numeric edges (same rules as LOFAR subscribe). */
export function resolveLofarBand(input:LofarBandPresetId|readonly [number,number]|[number,number]):[number,number]{
  if(typeof input==='string'){
    if(!isLofarBandPresetId(input))throw new Error(`Unknown LOFAR band preset: ${input}`);
    const p=PRESET_BY_ID.get(input)!;return [p.band[0],p.band[1]];
  }
  if(!Array.isArray(input)||input.length!==2||!input.every(Number.isFinite)||input[0]<0||input[1]>1e6||input[1]-input[0]<1e-6)throw new Error('Invalid LOFAR band');
  return [input[0],input[1]];
}
/** Look up a frozen preset by id, or undefined. */
export function lofarBandPreset(id:LofarBandPresetId):LofarBandPreset|undefined{return PRESET_BY_ID.get(id);}
