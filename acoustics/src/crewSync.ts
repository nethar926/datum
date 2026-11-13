/** Crew action log types matching ios/DatumAcoustics CrewAction / CrewActionKind.
 * Transport-agnostic; used by crew sync and by UserCut.actions. */
import type {AcousticEngine} from './engine.js';
import {DEFAULT_RADIUS_M,type PlaneRouteMode,type PlaneRouteSpec,type PlaneWayPoint} from './planeRoute.js';

export const CREW_ACTION_KINDS=['dropBuoy','setPlaneRoute','manualBearing','startFreqTrack','stopFreqTrack','mark','scuttleBuoy'] as const;
export type CrewActionKind=typeof CREW_ACTION_KINDS[number];

export interface CrewAction {
  seq:number;
  simT:number;
  operatorId:string;
  kind:CrewActionKind;
  payload:Record<string,unknown>;
}

export function isCrewActionKind(v:unknown):v is CrewActionKind{
  return typeof v==='string'&&(CREW_ACTION_KINDS as readonly string[]).includes(v);
}

/** Deterministic FNV-1a over mixed scalars; matches Swift CrewHasher (hex lower 8). */
export class CrewHasher {
  h=2166136261>>>0;
  mixU32(u:number):void{this.h=((this.h^u)>>>0)*16777619>>>0;}
  mixInt(i:number):void{this.mixU32(i>>>0);}
  mixBool(b:boolean):void{this.mixU32(b?1:0);}
  mixString(s:string):void{for(let i=0;i<s.length;i++)this.mixU32(s.charCodeAt(i)&0xff);this.mixU32(0xff);}
  mixF64(d:number):void{
    const x=Number.isNaN(d)?NaN:d;
    const buf=new DataView(new ArrayBuffer(8));
    buf.setFloat64(0,x,true);
    this.mixU32(buf.getUint32(0,true));
    this.mixU32(buf.getUint32(4,true));
  }
  get hex():string{return this.h.toString(16).padStart(8,'0');}
}

function num(v:unknown):number|undefined{return typeof v==='number'&&Number.isFinite(v)?v:undefined;}
function int(v:unknown):number|undefined{const n=num(v);return n!==undefined&&Number.isInteger(n)?n:undefined;}
function str(v:unknown):string|undefined{return typeof v==='string'?v:undefined;}
function bool(v:unknown):boolean|undefined{return typeof v==='boolean'?v:undefined;}

function asPoints(v:unknown):PlaneWayPoint[]{
  if(!Array.isArray(v))return [];
  const out:PlaneWayPoint[]=[];
  for(const item of v){
    if(!item||typeof item!=='object')continue;
    const o=item as Record<string,unknown>;
    const x=num(o.x),y=num(o.y);
    if(x!==undefined&&y!==undefined)out.push({x,y});
  }
  return out;
}

/** Apply one crew action to an AcousticEngine. Mirrors Swift CrewSync.perform. */
export function applyCrewAction(engine:AcousticEngine,a:CrewAction):void{
  const p=a.payload??{};
  switch(a.kind){
    case 'dropBuoy':{
      const channel=int(p.channel),kind=str(p.kind),x=num(p.x),y=num(p.y),depth=num(p.hydrophoneDepthM);
      if(channel===undefined||!kind||x===undefined||y===undefined||depth===undefined)throw new Error('invalidPayload: dropBuoy');
      engine.dropBuoy({id:int(p.id),channel,kind:kind as 'omni'|'difar',x,y,hydrophoneDepthM:depth,lifeS:num(p.lifeS),
        dropAltitudeM:num(p.dropAltitudeM),descentRateMps:num(p.descentRateMps),integrationTimeS:num(p.integrationTimeS)});
      return;
    }
    case 'setPlaneRoute':{
      if(bool(p.clear)===true){engine.setPlaneRoute(null);return;}
      const mode=str(p.mode),speed=num(p.speedMps),alt=num(p.altitudeFt);
      if(!mode||speed===undefined||alt===undefined)throw new Error('invalidPayload: setPlaneRoute');
      const spec:PlaneRouteSpec={
        mode:mode as PlaneRouteMode,speedMps:speed,altitudeFt:alt,t0:num(p.t0)??0,
        centerX:num(p.centerX)??0,centerY:num(p.centerY)??0,radiusM:num(p.radiusM)??DEFAULT_RADIUS_M,
        phase0:num(p.phase0)??0,points:asPoints(p.points),
      };
      engine.setPlaneRoute(spec);
      return;
    }
    case 'manualBearing':{
      const buoyId=int(p.buoyId),freq=num(p.freqHz);
      if(buoyId===undefined||freq===undefined)throw new Error('invalidPayload: manualBearing');
      engine.sendBearingFromPeak(buoyId,freq,a.simT);
      return;
    }
    case 'startFreqTrack':{
      const buoyId=int(p.buoyId),freq=num(p.freqHz);
      if(buoyId===undefined||freq===undefined)throw new Error('invalidPayload: startFreqTrack');
      engine.startFreqTrack(buoyId,freq,num(p.gateHz));
      return;
    }
    case 'stopFreqTrack':{
      const trackId=int(p.trackId);
      if(trackId===undefined)throw new Error('invalidPayload: stopFreqTrack');
      engine.stopFreqTrack(trackId);
      return;
    }
    case 'mark':
      return;
    case 'scuttleBuoy':{
      const buoyId=int(p.buoyId);
      if(buoyId===undefined)throw new Error('invalidPayload: scuttleBuoy');
      engine.scuttleBuoy(buoyId);
      return;
    }
    default:
      throw new Error(`invalidPayload: ${(a as CrewAction).kind}`);
  }
}
