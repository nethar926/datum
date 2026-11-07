import {ambientLevel} from './ambientNoise.js';
import {transmissionLoss,type Spreading} from './transmissionLoss.js';
import {clamp,knotsToMps} from './units.js';
import {sourceLevel} from './sourceModel.js';
import type {Signature} from './sourceModel.js';
import {deriveSeed,mulberry32} from './prng.js';

/** Fade-in when broadband SNR at the teaching frequency crosses this threshold (dB). */
export const FADE_IN_SNR_DB=3;
/** Hard ceiling: a sub must start fading in within this many seconds (Wilson 2–3 min). */
export const FADE_IN_MAX_S=180;
/** Preferred window for outside-range approaches. */
export const FADE_IN_TARGET_S=[120,180] as const;
/** Teaching frequency for SNR/TL estimate (Hz). */
export const FADE_IN_FREQ_HZ=100;

export interface SpawnEnv {
  seaState:number;
  shipping:'light'|'moderate'|'heavy';
  shippingDensity?:number;
  soundSpeed:number;
  spreading:Spreading;
  transition:number;
}

export interface SpawnPlacement {
  x:number;y:number;course:number;speed:number;depth:number;
  /** Initial horizontal range to buoy (m). */
  startRangeM:number;
  /** Estimated time until SNR crosses FADE_IN_SNR_DB (s); 0 if already above. */
  fadeInS:number;
  /** True when seeded inside the detection (fade) range. */
  inside:boolean;
}

/** Broadband SNR (dB) ≈ sourceLevel − TL − ambient at frequency f. */
export function broadbandSnrDb(levelDb:number,rangeM:number,f:number,env:SpawnEnv):number {
  const tl=transmissionLoss(Math.max(1,rangeM),f,env.spreading,env.transition);
  const amb=ambientLevel(f,env.seaState,env.shipping,env.shippingDensity);
  return levelDb-tl-amb;
}

/** Largest range (m) where SNR ≥ threshold (binary search). */
export function fadeInRangeM(levelDb:number,env:SpawnEnv,f=FADE_IN_FREQ_HZ,thresholdDb=FADE_IN_SNR_DB):number {
  let lo=10,hi=80_000;
  if(broadbandSnrDb(levelDb,lo,f,env)<thresholdDb)return lo; // even close is quiet — treat as immediate
  for(let k=0;k<40;k++){
    const mid=.5*(lo+hi);
    if(broadbandSnrDb(levelDb,mid,f,env)>=thresholdDb)lo=mid;else hi=mid;
  }
  return lo;
}

export interface SpawnRequest {
  seed:number;
  contactId:string;
  /** m/s */
  speed:number;
  depth:number;
  levelDb:number;
  env:SpawnEnv;
  buoy?:{x:number;y:number};
  /** Force inside/outside; default seeded ~40% inside. */
  inside?:boolean;
  /** Target fade-in time when outside; default uniform in FADE_IN_TARGET_S. */
  targetFadeInS?:number;
}

/**
 * Seeded start geometry: sometimes beside the buoy, sometimes outside detection range.
 * When outside, range + inbound course are chosen so SNR crosses the fade-in threshold
 * within ≤ FADE_IN_MAX_S (target 120–180 s) at the contact's speed.
 */
export function placeContactSpawn(req:SpawnRequest):SpawnPlacement {
  const rng=mulberry32(deriveSeed(req.seed,`spawn:${req.contactId}`));
  const buoy=req.buoy??{x:0,y:0};
  const inside=req.inside??rng()<.4;
  const rFade=fadeInRangeM(req.levelDb,req.env);
  const speed=Math.max(1e-3,req.speed);
  if(inside){
    const r=Math.max(50,rFade*(.15+.55*rng()));
    const brg=rng()*2*Math.PI;
    const course=brg+Math.PI+ (rng()-.5)*.4; // mostly outbound / abeam so CPA geometry stays interesting
    return {
      x:buoy.x+r*Math.sin(brg),y:buoy.y+r*Math.cos(brg),course,speed,depth:req.depth,
      startRangeM:r,fadeInS:0,inside:true,
    };
  }
  let tFade=req.targetFadeInS??(FADE_IN_TARGET_S[0]+rng()*(FADE_IN_TARGET_S[1]-FADE_IN_TARGET_S[0]));
  tFade=clamp(tFade,30,FADE_IN_MAX_S);
  // Closing component ≈ speed (head-on). Place beyond fade range by speed*tFade.
  const r0=rFade+speed*tFade;
  const brg=rng()*2*Math.PI; // bearing of contact from buoy
  // Course toward buoy (inbound), small lateral offset so CPA ≠ 0.
  const cpa=Math.min(400,80+rng()*300);
  const course=brg+Math.PI;
  // Position: along radial at r0, offset laterally by cpa in the cross-track direction.
  const cross=brg+Math.PI/2;
  const x=buoy.x+r0*Math.sin(brg)+cpa*Math.sin(cross);
  const y=buoy.y+r0*Math.cos(brg)+cpa*Math.cos(cross);
  const startRangeM=Math.hypot(x-buoy.x,y-buoy.y);
  // Closing speed toward buoy ≈ component of velocity along LOS.
  const losX=buoy.x-x,losY=buoy.y-y,losR=Math.hypot(losX,losY)||1;
  const vx=Math.sin(course)*speed,vy=Math.cos(course)*speed;
  const close=Math.max(1e-3,(vx*losX+vy*losY)/losR);
  const fadeInS=Math.max(0,(startRangeM-rFade)/close);
  return {
    x,y,course,speed,depth:req.depth,startRangeM,fadeInS:Math.min(fadeInS,FADE_IN_MAX_S*1.05),inside:false,
  };
}

/** Convenience: levelDb from a catalog signature at a given speed/depth. */
export function spawnLevelDb(params:Signature,speedMps:number,depthM:number):number {
  return sourceLevel(params,speedMps,depthM);
}

export {knotsToMps};
