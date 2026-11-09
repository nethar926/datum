import {isDiesel,normalizeMode,type ModeInput,type OperatingMode,type SubmarineClass} from './catalog/schema.js';
import {atPeriscopeDepth,isSurfaced,depthEnvelopeFor,type DepthEnvelope} from './depthEnvelope.js';

/** Which acoustic source families are physically present for a live plant/mode/depth.
 * Reuses existing plantModel rules: EDAs follow engine running state (silent only on BATT /
 * engine-off); independent aux (SSMA, electrical) remain; nuclear reactor aux continuous on NUC.
 * Surfaced adds wave-slap broadband; snort adds induction/exhaust broadband. */
export interface SourceGate {
  mode:OperatingMode;
  depthM:number;
  /** Diesel engine lines (CSR/CFR/EFR) + EDAs. */
  dieselEngine:boolean;
  /** EDAs specifically (same as dieselEngine under current plantModel; called out for tests). */
  edas:boolean;
  /** Motor / MSR when shaft on motor (BATT/AIP/D/E or declutched). */
  motor:boolean;
  /** Reactor coolant / TG / main-turbine continuous aux. */
  reactorPlant:boolean;
  /** Independent continuous aux (SSMA, electrical, pumps). */
  independentAux:boolean;
  /** Snort induction/exhaust broadband (SNORK at periscope depth). */
  snortBroadband:boolean;
  /** Surfaced wave-slap / hull broadband. */
  waveSlapBroadband:boolean;
  /** Cavitation depth suppression active (deeper → higher inception). False when surfaced. */
  cavitationDepthSuppression:boolean;
  /** AIP plant lines. */
  aipPlant:boolean;
}

type GateClass=Pick<SubmarineClass,'plant'|'params'|'aip'|'aipCapable'|'snorkelDepthM'|'id'|'machinery'>;

function hasMotor(c:GateClass):boolean {
  const m=c.machinery;return !!(m&&'motor' in m&&m.motor);
}

export function sourceGateFor(c:GateClass,modeIn:ModeInput,depthM:number,clutchEngaged?:boolean,envIn?:DepthEnvelope):SourceGate {
  const mode=normalizeMode(modeIn,c.params.propulsion);
  const diesel=isDiesel(c.params.propulsion);
  const env=envIn??depthEnvelopeFor(c as SubmarineClass);
  const surfaced=isSurfaced(env,depthM);
  const peri=atPeriscopeDepth(env,depthM)||surfaced;
  // Engine present: SURF/SNORK/D/E for diesel; never on BATT/AIP. Depth must allow snort/surf for SNORK/SURF.
  const dieselEngine=diesel&&(mode==='SURF'||mode==='SNORK'||mode==='D/E')&&(mode==='D/E'||peri);
  // Motor: BATT/AIP/D/E always; SNORK/SURF when declutched (clutchEngaged===false).
  const wantMotor=mode==='BATT'||mode==='AIP'||mode==='D/E'||(diesel&&clutchEngaged===false&&(mode==='SNORK'||mode==='SURF'));
  const nuclear=!diesel;
  return {
    mode,depthM,
    dieselEngine,
    edas:dieselEngine,
    motor:wantMotor&&hasMotor(c),
    reactorPlant:nuclear&&mode==='NUC',
    independentAux:true,
    snortBroadband:diesel&&mode==='SNORK'&&peri&&!surfaced,
    waveSlapBroadband:surfaced||mode==='SURF',
    cavitationDepthSuppression:!surfaced&&depthM>1,
    aipPlant:mode==='AIP'&&!!c.aip,
  };
}

/** Compact gating truth table row for docs/tests. */
export function gatingTableRow(g:SourceGate):Record<string,boolean|string> {
  return {
    mode:g.mode,
    dieselEngine:g.dieselEngine,edas:g.edas,motor:g.motor,reactorPlant:g.reactorPlant,
    independentAux:g.independentAux,snortBroadband:g.snortBroadband,
    waveSlapBroadband:g.waveSlapBroadband,cavitationDepthSuppression:g.cavitationDepthSuppression,
    aipPlant:g.aipPlant,
  };
}
