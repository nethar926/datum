import type {WaterColumnProfile} from './waterColumn.js';
import {clamp} from './units.js';

/** NM → m. Public teaching CZ range band ~30–35 nmi when depth excess exists (Urick Ch. 6). */
export const NMI_M=1852;
export const CZ_RANGE_NMI_DEFAULT=32.5;
export const CZ_RANGE_NMI_BAND=[30,35] as const;
/** Minimum depth excess (m) for a CZ teaching flag — order-of-magnitude, not a navy criterion. */
export const CZ_MIN_DEPTH_EXCESS_M=200;

/**
 * Convergence-zone estimate from the BT/SSP water column + geometry (no ray trace).
 *
 * Method (public acoustics teaching approximation — Urick, Principles of Underwater Sound;
 * Jensen et al., Computational Ocean Acoustics overview):
 * 1. Sample sound speed at the source depth zs from the SSP.
 * 2. Find the deep *critical depth* below the SOFAR axis where c(z) returns to c(zs)
 *    (or surface c if zs is in the mixed layer). Requires a deep sound channel shape.
 * 3. Depth excess = bottomDepth − criticalDepth. CZ possible only when excess ≥ CZ_MIN_DEPTH_EXCESS_M
 *    and bottom is deeper than the critical depth.
 * 4. Range is a parameterized skip-distance: default 32.5 nmi (~60 km), weakly stretched when
 *    excess is large. NOT a full PE/ray solution — documented limits below / in docs.
 *
 * TODO(wilson): optional bilinear/Munk closed-form skip distance from the live SSP curvature
 * once FE needs range precision beyond the 30–35 nmi teaching band.
 */
export interface ConvergenceZoneEstimate {
  possible:boolean;
  /** First-CZ range (m), or null when not possible. */
  rangeM:number|null;
  rangeNmi:number|null;
  /** Deep conjugate / critical depth (m), or null if SSP has no return to c(zs). */
  criticalDepthM:number|null;
  depthExcessM:number;
  sourceDepthM:number;
  receiverDepthM:number;
  bottomDepthM:number;
  soundSpeedAtSourceMps:number;
  /** Human-readable limit / reason for FE chrome. */
  note:string;
}

export interface ConvergenceZoneRequest {
  profile:WaterColumnProfile;
  /** Source (contact) depth m. */
  zsM:number;
  /** Receiver (buoy hydrophone) depth m. */
  zrM:number;
  /** Seafloor depth m (scenario bathymetry; defaults to profile max depth). */
  bottomDepthM?:number;
}

function lerpC(profile:WaterColumnProfile,z:number):number {
  const d=profile.depthM,c=profile.soundSpeedMps;if(d.length===0)return 1500;
  if(z<=d[0]!)return c[0]!;
  if(z>=d[d.length-1]!)return c[c.length-1]!;
  let i=1;while(i<d.length&&d[i]!<z)i++;
  const z0=d[i-1]!,z1=d[i]!,u=(z-z0)/Math.max(1e-9,z1-z0);
  return c[i-1]!+(c[i]!-c[i-1]!)*u;
}

/** Deepest depth below the sound-channel axis where c rises back to cRef. */
export function criticalDepthM(profile:WaterColumnProfile,cRef:number):number|null {
  const d=profile.depthM,c=profile.soundSpeedMps;if(d.length<3)return null;
  // Axis = depth of minimum sound speed.
  let iAxis=0;for(let i=1;i<c.length;i++)if(c[i]!<c[iAxis]!)iAxis=i;
  // Need a duct: c should increase below the axis.
  for(let i=iAxis+1;i<c.length;i++){
    if(c[i]!>=cRef){
      // Interpolate between i-1 and i.
      const c0=c[i-1]!,c1=c[i]!,z0=d[i-1]!,z1=d[i]!;
      const u=c1===c0?0:clamp((cRef-c0)/(c1-c0),0,1);
      return z0+(z1-z0)*u;
    }
  }
  return null;
}

export function estimateConvergenceZone(req:ConvergenceZoneRequest):ConvergenceZoneEstimate {
  const p=req.profile,zs=Math.max(0,req.zsM),zr=Math.max(0,req.zrM);
  const bottom=req.bottomDepthM??p.depthM[p.depthM.length-1]??0;
  const cSrc=lerpC(p,zs);
  const zc=criticalDepthM(p,cSrc);
  const excess=zc===null?0:bottom-zc;
  const base:Omit<ConvergenceZoneEstimate,'possible'|'rangeM'|'rangeNmi'|'note'>={
    criticalDepthM:zc,depthExcessM:Math.max(0,excess),sourceDepthM:zs,receiverDepthM:zr,
    bottomDepthM:bottom,soundSpeedAtSourceMps:cSrc,
  };
  if(zc===null){
    return {...base,possible:false,rangeM:null,rangeNmi:null,
      note:'No deep conjugate depth in SSP (c never returns to c(zs) below the axis). CZ not predicted.'};
  }
  if(excess<CZ_MIN_DEPTH_EXCESS_M){
    return {...base,possible:false,rangeM:null,rangeNmi:null,
      note:`Depth excess ${excess.toFixed(0)} m < ${CZ_MIN_DEPTH_EXCESS_M} m teaching threshold; CZ unlikely.`};
  }
  // Weak stretch with excess: +0..2.5 nmi over the default band centre.
  const stretch=clamp((excess-CZ_MIN_DEPTH_EXCESS_M)/2000,0,1)*2.5;
  const nmi=CZ_RANGE_NMI_DEFAULT+stretch;
  const rangeM=nmi*NMI_M;
  // Receiver in the duct helps; shallow receiver still sees CZ in teaching model.
  void zr;
  return {...base,possible:true,rangeM,rangeNmi:nmi,
    note:`Parameterized CZ ≈ ${nmi.toFixed(1)} nmi from SSP critical depth ${zc.toFixed(0)} m + excess ${excess.toFixed(0)} m (Urick teaching band ${CZ_RANGE_NMI_BAND[0]}–${CZ_RANGE_NMI_BAND[1]} nmi; not a ray trace).`};
}

/** Default: CZ propagation boost OFF until FE opts in. */
export const DEFAULT_CZ_ENABLED=false;

/**
 * Linear power multiplier from a CZ annulus teaching boost.
 * Returns 1 when disabled, impossible, or forceZero — so streams match a no-CZ path.
 * Peak ~+28 dB (±8% range half-width) when enabled — strong enough to lift CZ-range signal above ambient for teaching/FE.
 */
export function czPropagationGainLinear(
  rangeM:number,
  estimate:ConvergenceZoneEstimate|null|undefined,
  opts:{enabled?:boolean;forceZero?:boolean}={},
):number {
  if(opts.forceZero||opts.enabled!==true)return 1;
  if(!estimate?.possible||estimate.rangeM==null||!(estimate.rangeM>0))return 1;
  const half=estimate.rangeM*.08,d=Math.abs(rangeM-estimate.rangeM);
  if(d>half*3)return 1;
  const db=28*Math.exp(-(d*d)/(2*half*half));
  return 10**(db/10);
}

/** Resolve CZ estimate for live geometry when a water column is present. */
export function czEstimateFor(
  profile:import('./waterColumn.js').WaterColumnProfile|undefined,
  zsM:number,zrM:number,bottomDepthM?:number,
):ConvergenceZoneEstimate|null {
  if(!profile)return null;
  return estimateConvergenceZone({profile,zsM,zrM,bottomDepthM});
}
