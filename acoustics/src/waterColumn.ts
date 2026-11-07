import {clamp,soundSpeed} from './units.js';

/** Bathythermograph + sound-speed profile on a shared depth axis (Mackenzie 1981).
 * Invented mixed-layer / thermocline shape for training; FE graphs the arrays. */
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
  salinityPsu:number;
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

/** Build paired BT/SSP arrays. Deterministic for a fixed request. */
export function buildWaterColumn(req:WaterColumnRequest):WaterColumnProfile {
  const maxD=clamp(req.maxDepthM,10,8000),n=Math.max(8,Math.min(512,Math.floor(req.samples??64)));
  const mld=clamp(req.mixedLayerDepthM??40,5,maxD*.6);
  const thick=clamp(req.thermoclineThicknessM??80,10,maxD-mld);
  const base=Math.min(maxD,mld+thick),S=clamp(req.salinityPsu,30,40);
  const Ts=clamp(req.surfaceTempC,-2,30),Td=clamp(req.deepTempC,-2,Ts);
  const depthM=new Float64Array(n),temperatureC=new Float64Array(n),soundSpeedMps=new Float64Array(n);
  for(let i=0;i<n;i++){
   const z=i===n-1?maxD:(i/(n-1))*maxD;depthM[i]=z;
   let T:number;
   if(z<=mld)T=Ts;
   else if(z>=base)T=Td;
   else {const u=(z-mld)/(base-mld);const s=u*u*(3-2*u);T=Ts+(Td-Ts)*s;}
   temperatureC[i]=T;soundSpeedMps[i]=soundSpeed(T,S,z);
  }
  return {depthM,temperatureC,soundSpeedMps,mixedLayerDepthM:mld,thermoclineBaseM:base,salinityPsu:S};
}

/** Attach a water-column profile to a scenario environment (FE graphs BT/SSP). */
export function attachWaterColumn(env:{temperatureC?:number;salinityPsu?:number;soundSpeed:number;maxDepthM?:number},profile?:WaterColumnProfile):WaterColumnProfile {
  const p=profile??buildWaterColumn({
   surfaceTempC:env.temperatureC??15,deepTempC:(env.temperatureC??15)-8,
   salinityPsu:env.salinityPsu??35,maxDepthM:env.maxDepthM??400,
  });
  // Keep scalar soundSpeed as near-surface Mackenzie for existing TL paths.
  env.soundSpeed=p.soundSpeedMps[0]!;
  env.temperatureC=p.temperatureC[0];
  env.salinityPsu=p.salinityPsu;
  return p;
}
