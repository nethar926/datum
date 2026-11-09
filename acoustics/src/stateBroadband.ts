import {clamp} from './units.js';
import type {OperatingMode} from './catalog/schema.js';
import {normalizeMode,type ModeInput} from './catalog/schema.js';

/** Teaching broadband flashes for snort induction/exhaust and surfaced wave-slap.
 * Levels depend on operating state (never constant): snort tracks engine load/ERPM,
 * wave-slap tracks speed and sea state. Ramps on mode/depth edges via gain. */

export interface StateBroadbandSpec {
  /** Active when snorting (SNORK, submerged periscope band). */
  snort:{active:boolean;/** Linear power gain 0..~1 before sea-state boost. */level:number;loHz:number;hiHz:number};
  /** Active when surfaced. */
  waveSlap:{active:boolean;level:number;loHz:number;hiHz:number};
}

export interface StateBroadbandInput {
  mode:ModeInput;
  /** Keel depth (m). */
  depthM:number;
  /** Speed (kn). */
  speedKn:number;
  /** Mean running engine ERPM (0 if none). */
  erpm:number;
  /** Engine sheet normal ERPM for load ratio (fallback 750). */
  erpmNormal?:number;
  /** Sea state 0..6. */
  seaState:number;
  /** Periscope/snorkel keel depth (m). */
  periscopeDepthM:number;
  primary?:string;
}

/** Snort level grows with engine load (ERPM/normal) and sea state. Zero when not snorting. */
export function snortBroadbandLevel(erpm:number,erpmNormal:number,seaState:number):number {
  if(!(erpm>0))return 0;
  const load=clamp(erpm/Math.max(1,erpmNormal),0,1.4);
  const sea=1+.12*clamp(seaState,0,6); // monotonic in sea state
  // Invented: snort induction/exhaust broadband is a prominent teaching cue when diesels run;
  // public RN texts describe large snort-vs-battery deltas (Ross/Urick); magnitude fictional.
  return clamp(.35+.9*load,0,1.6)*sea;
}

/** Wave-slap level grows with speed and sea state. Zero when stopped in dead calm is near-zero. */
export function waveSlapBroadbandLevel(speedKn:number,seaState:number):number {
  const v=clamp(speedKn/12,0,2); // ~12 kn reference
  const sea=1+.18*clamp(seaState,0,6);
  return clamp(.08+.5*Math.sqrt(Math.max(0,v)),0,1.2)*sea;
}

export function stateBroadband(input:StateBroadbandInput):StateBroadbandSpec {
  const mode=normalizeMode(input.mode,input.primary??'');
  const surfaced=input.depthM<=.5;
  const peri=input.depthM>0.5&&input.depthM<=input.periscopeDepthM+.5;
  const snortOn=mode==='SNORK'&&peri&&!surfaced;
  const slapOn=surfaced||mode==='SURF';
  const normal=input.erpmNormal??750;
  return {
    snort:{active:snortOn,level:snortOn?snortBroadbandLevel(input.erpm,normal,input.seaState):0,loHz:40,hiHz:420},
    waveSlap:{active:slapOn,level:slapOn?waveSlapBroadbandLevel(input.speedKn,input.seaState):0,loHz:20,hiHz:280},
  };
}
