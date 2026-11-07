import type {SubmarineClass} from './catalog/schema.js';
import {clamp} from './units.js';

/** Per-class depth / rate envelope for procedural maneuvering (fictional teaching).
 * Test depth = ClassParams.depthM[1] (already catalogued). Periscope/snorkel keel depth
 * reuses SubmarineClass.snorkelDepthM for diesels; nuclear classes get a teaching default.
 * Rates are public-order-of-magnitude limits (Urick kinematics context), not platform data. */
export interface DepthEnvelope {
  classId:string;
  /** Collapse / test depth (m) — never exceed. */
  testDepthM:number;
  /** Typical max operating depth (m) — slightly shallower than test. */
  maxOperatingDepthM:number;
  /** Typical patrol band [shallow, deep] m. */
  typicalPatrolDepthM:readonly [number,number];
  /** Keel depth (m) for periscope/snorkel operations (~15–20 m teaching). */
  periscopeDepthM:number;
  /** Surfaced keel depth (m); 0 for boats flush on surface. */
  surfacedKeelDepthM:number;
  /** Max dive rate (m/s, positive down). */
  diveRateMps:number;
  /** Max rise rate (m/s, positive up; emergency blow may use a higher transient elsewhere). */
  riseRateMps:number;
  /** Max speed increase (kn/s). */
  accelKnPerS:number;
  /** Max speed decrease (kn/s). */
  decelKnPerS:number;
  /** Rudder-limited turn rate (rad/s) at reference speed. */
  turnRateRadPerS:number;
  /** Reference speed (kn) for turnRateRadPerS (turn rate scales with speed/ref, clamped). */
  turnRateRefKn:number;
}

/** Nuclear teaching periscope depth when class.snorkelDepthM === 0. */
const NUCLEAR_PERISCOPE_M=18;
const SURFACED_KEEL_M=0;

/** Deterministic envelope from existing catalog fields — no classes.ts edits (merge-safe). */
export function depthEnvelopeFor(c:Pick<SubmarineClass,'id'|'plant'|'params'|'snorkelDepthM'|'maxSpeedKts'|'quietSpeedKts'>):DepthEnvelope {
  const test=c.params.depthM[1];
  const maxOps=Math.max(c.params.depthM[0]+10,Math.round(test*.85));
  const peri=c.plant==='diesel'?Math.max(8,c.snorkelDepthM||15):NUCLEAR_PERISCOPE_M;
  // Coastal / littoral (test < 200 m): shallow patrol; deep boats: mid-layer patrol.
  const patrolLo=test<=200?Math.min(peri+5,Math.max(peri,test*.25)):Math.min(80,Math.max(peri+20,test*.15));
  const patrolHi=test<=200?Math.min(test*.75,maxOps):Math.min(maxOps,Math.max(patrolLo+40,test*.55));
  const nuclear=c.plant==='nuclear';
  const maxKn=c.maxSpeedKts.submerged;
  return {
    classId:c.id,
    testDepthM:test,
    maxOperatingDepthM:maxOps,
    typicalPatrolDepthM:[Number(patrolLo.toFixed(1)),Number(patrolHi.toFixed(1))],
    periscopeDepthM:peri,
    surfacedKeelDepthM:SURFACED_KEEL_M,
    // ~1–2 m/s dive; nuclear a touch stiffer. Rise similar; emergency blow is a transient flash.
    diveRateMps:nuclear?1.4:1.0,
    riseRateMps:nuclear?1.6:1.2,
    accelKnPerS:nuclear?.12:.06,
    decelKnPerS:nuclear?.15:.08,
    // ~1 °/s at ~8 kn teaching; scales with speed/ref.
    turnRateRadPerS:(nuclear?1.2:.9)*Math.PI/180,
    turnRateRefKn:clamp(Math.max(6,c.quietSpeedKts[1]||8),4,Math.min(12,maxKn)),
  };
}

/** Clamp a requested depth into [surfaced, test]; returns the clamped value. */
export function clampDepthM(env:DepthEnvelope,depthM:number):number {
  return clamp(depthM,env.surfacedKeelDepthM,env.testDepthM);
}

/** True when depth is within periscope/snorkel band (keel ≤ periscopeDepthM, > surfaced). */
export function atPeriscopeDepth(env:DepthEnvelope,depthM:number,tolM=.5):boolean {
  return depthM>env.surfacedKeelDepthM+tolM&&depthM<=env.periscopeDepthM+tolM;
}

/** True when effectively surfaced. */
export function isSurfaced(env:DepthEnvelope,depthM:number,tolM=.5):boolean {
  return depthM<=env.surfacedKeelDepthM+tolM;
}
