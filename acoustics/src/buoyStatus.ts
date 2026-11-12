/** Per-buoy lifecycle status (AcousticEngine.buoyStatus; Swift SimEngine.buoyStatus).
 * Phase is the deploy sequence: loaded → deployed (1 s) → descending → integrating → tuned.
 * `descending` matches the UI label (not "falling"). */
import {deployStatus,type DeployBuoy} from './deploySequence.js';
/** Default rows for a full waterfall screen (web FE CURRENT_HISTORY_ROWS). Kept for API compatibility;
 * phase no longer depends on the row grid. */
export const BUOY_STATUS_SCREEN_ROWS=600;
export type BuoyPhase='loaded'|'deployed'|'descending'|'integrating'|'tuned';
export interface BuoyStatus {
  phase:BuoyPhase;
  /** 0…1 of the *current* phase (not of a gram screen). */
  fill:number;
  /** Sim seconds remaining in the current phase (0 once tuned). */
  etaSeconds:number;
  /** Absolute sim time of water entry. Equal to deployedAt for placed buoys. */
  splashTime:number;
  /** Absolute sim time the buoy goes live. Equal to deployedAt for placed buoys. */
  liveTime:number;
  /** RF-tuned (`rfChannel > 0`); omitted on the pure helper, always set on engine queries. */
  isTuned?:boolean;
}
/** Deploy-sequence status. `anchor`/`period`/`screenRows` are accepted for call-site compatibility and ignored. */
export function buoyStatusOnGrid(t:number,deployedAt:number,anchor=0,period=1,screenRows=1,b:DeployBuoy={deployedAt}):BuoyStatus{
  void anchor;void period;void screenRows;
  const s=deployStatus(t,{...b,deployedAt});
  return s;
}
export function buoyDeployStatus(t:number,b:DeployBuoy):BuoyStatus{return deployStatus(t,b);}
