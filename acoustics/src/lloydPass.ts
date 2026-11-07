import {nullSpacing,pathDifference} from './lloydsMirror.js';
import {C} from './units.js';

/** Why a Lloyd's-mirror pass is not a textbook symmetric bat-wing (FE qualifies CPA/range fits). */
export type LloydAsymmetryReason='depthChange'|'courseChange'|'speedChange';

/** FE-facing Lloyd pass qualifier. Physical gain always uses live zs/zr/r; this only flags
 * whether a constant-velocity fixed-depth CPA estimate is still valid. */
export interface LloydPassTruth {
  /** True only for a straight, constant-speed, constant-depth pass (apex at CPA). */
  symmetricPass:boolean;
  reasons:readonly LloydAsymmetryReason[];
  /** Live source depth (m) used for the interference calculation. */
  zsM:number;
  /** Live receiver depth (m). */
  zrM:number;
  /** Horizontal range (m). */
  rangeM:number;
  /** Instantaneous far-field null spacing Δf ≈ cR/(2 zs zr) (Hz). */
  nullSpacingHz:number;
  /** Path difference (m) from the pressure-release image formula. */
  pathDifferenceM:number;
}

export interface LloydPassSample {
  depthM:number;
  courseRad:number;
  speedMps:number;
}

const DEPTH_EPS_M=.05;
const COURSE_EPS_RAD=.5*Math.PI/180;
const SPEED_EPS_MPS=.05;

/** Accumulate whether depth/course/speed changed during a pass. Continuous — never resets
 * caller-owned history; caller decides when a new pass window starts (e.g. new CPA). */
export class LloydPassTracker {
  private readonly t0:LloydPassSample;
  private reasons=new Set<LloydAsymmetryReason>();
  constructor(initial:LloydPassSample){this.t0={...initial};}
  /** Observe live kinematics; records asymmetry reasons without clearing prior ones. */
  observe(s:LloydPassSample):void {
    if(Math.abs(s.depthM-this.t0.depthM)>DEPTH_EPS_M)this.reasons.add('depthChange');
    if(Math.abs(angDiff(s.courseRad,this.t0.courseRad))>COURSE_EPS_RAD)this.reasons.add('courseChange');
    if(Math.abs(s.speedMps-this.t0.speedMps)>SPEED_EPS_MPS)this.reasons.add('speedChange');
  }
  /** Build FE truth from live geometry. zs/zr/r always drive null spacing (closed form). */
  truth(zsM:number,zrM:number,rangeM:number,c=C):LloydPassTruth {
    const reasons=[...this.reasons] as LloydAsymmetryReason[];
    const r=Math.max(0,rangeM),zs=Math.max(0,zsM),zr=Math.max(0,zrM);
    return {
      symmetricPass:reasons.length===0,
      reasons,
      zsM:zs,zrM:zr,rangeM:r,
      nullSpacingHz:nullSpacing(r,zs,zr,c),
      pathDifferenceM:pathDifference(r,zs,zr),
    };
  }
  get asymmetryReasons():readonly LloydAsymmetryReason[]{return [...this.reasons];}
}

function angDiff(a:number,b:number):number{
  const TAU=2*Math.PI;let d=((a-b)%TAU+TAU)%TAU;if(d>Math.PI)d-=TAU;return d;
}

/** One-shot qualifier from a pair of samples (start vs now) plus live geometry. */
export function lloydPassQualifier(
  start:LloydPassSample,now:LloydPassSample,zsM:number,zrM:number,rangeM:number,c=C,
):LloydPassTruth {
  const t=new LloydPassTracker(start);t.observe(now);return t.truth(zsM,zrM,rangeM,c);
}
