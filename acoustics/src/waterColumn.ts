import {clamp,soundSpeed,mackenzieOutOfRange,MACKENZIE_VALID,type MackenzieOutOfRange} from './units.js';

/** Default salinity (ppt / PSU) when a scenario omits it. Constant with depth — no S(z) profile. */
export const DEFAULT_SALINITY_PSU=35;

/** Bathythermograph + sound-speed profile on a shared depth axis.
 * Citation: K. V. Mackenzie, J. Acoust. Soc. Am. 70(3), 807–812 (1981); NPL summary
 * http://resource.npl.co.uk/acoustics/techguides/soundseawater/
 * Invented mixed-layer / thermocline shape for training; FE graphs the arrays.
 *
 * Salinity assumption: a single scalar `salinityPsu` (default 35 ppt), constant with depth.
 * No salinity profile is modeled. Validity enforced: T −2…30 °C, S 25…40 ppt, D 0…8000 m.
 * Out-of-range request inputs are clamped for the equation and flagged on `outOfRange`.
 * FE must visibly mark clamped values in plots (see docs/water-column-fe.md). */
export interface WaterColumnProfile {
  /** Depth samples (m), shallow → deep. */
  depthM:Float64Array;
  /** Temperature °C at each depth (BT). */
  temperatureC:Float64Array;
  /** Sound speed m/s at each depth (SSP), Mackenzie. */
  soundSpeedMps:Float64Array;
  /** Mixed-layer depth (m). */
  mixedLayerDepthM:number;
  /** Thermocline base depth (m). */
  thermoclineBaseM:number;
  /** Salinity ppt — constant with depth (see salinityAssumption). */
  salinityPsu:number;
  /** How salinity is applied along the column. Always `'constant'` in M3. */
  salinityAssumption:'constant';
  /** Published Mackenzie domain echoed for FE (do not extrapolate beyond). */
  mackenzieValid:{temperatureC:readonly [number,number];salinityPsu:readonly [number,number];depthM:readonly [number,number]};
  /** True when any request input was outside Mackenzie validity before clamping. */
  outOfRange:MackenzieOutOfRange;
}

export interface WaterColumnRequest {
  /** Surface temperature °C. */
  surfaceTempC:number;
  /** Deep temperature °C (below thermocline). */
  deepTempC:number;
  salinityPsu:number;
  /** Profile extent (m). */
  maxDepthM:number;
  /** Optional mixed-layer depth; default ~40 m. */
  mixedLayerDepthM?:number;
  /** Optional thermocline thickness; default ~80 m. */
  thermoclineThicknessM?:number;
  /** Sample count inclusive of surface and maxDepth. */
  samples?:number;
}

/** Build paired BT/SSP arrays. Deterministic for a fixed request.
 * Clamps Mackenzie inputs to the published domain and sets `outOfRange` when the
 * request (surface/deep T, S, or max depth) was outside before clamping. */
export function buildWaterColumn(req:WaterColumnRequest):WaterColumnProfile {
  const reqMaxD=req.maxDepthM,reqS=req.salinityPsu,reqTs=req.surfaceTempC,reqTd=req.deepTempC;
  const flagT=mackenzieOutOfRange(reqTs,DEFAULT_SALINITY_PSU,0).temperature
    ||mackenzieOutOfRange(reqTd,DEFAULT_SALINITY_PSU,0).temperature;
  const flagS=mackenzieOutOfRange(15,reqS,0).salinity;
  const flagD=mackenzieOutOfRange(15,DEFAULT_SALINITY_PSU,reqMaxD).depth;
  const outOfRange:MackenzieOutOfRange={temperature:flagT,salinity:flagS,depth:flagD,any:flagT||flagS||flagD};

  const maxD=clamp(reqMaxD,10,MACKENZIE_VALID.depthM[1]),n=Math.max(8,Math.min(512,Math.floor(req.samples??64)));
  const mld=clamp(req.mixedLayerDepthM??40,5,maxD*.6);
  const thick=clamp(req.thermoclineThicknessM??80,10,maxD-mld);
  const base=Math.min(maxD,mld+thick);
  const S=clamp(reqS,MACKENZIE_VALID.salinityPsu[0],MACKENZIE_VALID.salinityPsu[1]);
  const Ts=clamp(reqTs,MACKENZIE_VALID.temperatureC[0],MACKENZIE_VALID.temperatureC[1]);
  const Td=clamp(reqTd,MACKENZIE_VALID.temperatureC[0],Ts);
  const depthM=new Float64Array(n),temperatureC=new Float64Array(n),soundSpeedMps=new Float64Array(n);
  for(let i=0;i<n;i++){
   const z=i===n-1?maxD:(i/(n-1))*maxD;depthM[i]=z;
   let T:number;
   if(z<=mld)T=Ts;
   else if(z>=base)T=Td;
   else {const u=(z-mld)/(base-mld);const s=u*u*(3-2*u);T=Ts+(Td-Ts)*s;}
   temperatureC[i]=T;soundSpeedMps[i]=soundSpeed(T,S,z);
  }
  return {
   depthM,temperatureC,soundSpeedMps,mixedLayerDepthM:mld,thermoclineBaseM:base,salinityPsu:S,
   salinityAssumption:'constant',mackenzieValid:{...MACKENZIE_VALID},outOfRange,
  };
}

/** Attach a water-column profile to a scenario environment (FE graphs BT/SSP). */
export function attachWaterColumn(env:{temperatureC?:number;salinityPsu?:number;soundSpeed:number;maxDepthM?:number},profile?:WaterColumnProfile):WaterColumnProfile {
  const p=profile??buildWaterColumn({
   surfaceTempC:env.temperatureC??15,deepTempC:(env.temperatureC??15)-8,
   salinityPsu:env.salinityPsu??DEFAULT_SALINITY_PSU,maxDepthM:env.maxDepthM??400,
  });
  // Keep scalar soundSpeed as near-surface Mackenzie for existing TL paths.
  env.soundSpeed=p.soundSpeedMps[0]!;
  env.temperatureC=p.temperatureC[0];
  env.salinityPsu=p.salinityPsu;
  return p;
}
