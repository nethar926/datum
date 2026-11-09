import {AcousticEngine} from '../engine.js';
import {modulatedFraction} from '../demonStream.js';
import {getClass} from '../catalog/derive.js';
import {modeSpeedCap} from '../maneuver.js';
import {knotsToMps} from '../units.js';
import type {Contact,Scenario} from '../scenario.js';
import type {CutDemonLessonPack,CutSeed} from './types.js';
import {scenarioFromCut} from './render.js';
import {validateCutSeed} from './validate.js';

/**
 * DEMON answer-key expectations. REVEAL / CUT-METADATA ONLY: these are never attached to
 * GramConfig, DEMON rows, subscribe results, tactical() or any live Contact the FE reads during
 * play (that would give the answer away; live DEMON shows a fixed generic hint instead).
 * Derived from the model's cavitation state, not a hand list.
 */
export const DEMON_REASONS=['cavitating','not-cavitating'] as const;
export type DemonReason=typeof DEMON_REASONS[number];
/**
 * A propulsion comb is expected on DEMON when cavitation noise is at least half the
 * modulated-carrier mix (demonStream.modulatedFraction ≥ .5, i.e. cavitationPower ≥ 1e-4,
 * ≈7 % past inception) and the source has nonzero blade/shaft modulation.
 */
export const DEMON_EXPECTED_MIN_MOD_FRACTION=.5;

export interface DemonExpectation {
 demonExpected:boolean;
 demonReason:DemonReason;
 /** Speed past cavitation inception, % ((v/v_i − 1)·100); negative = below. null when no inception model. */
 pastInceptionPct:number|null;
 /** Time-weighted fraction of the cut / leg plan spent above inception speed (0..1); null when no inception model. */
 pastInceptionFraction:number|null;
 /** Fraction of the modulated carrier that is cavitation (demonStream.modulatedFraction). */
 modulatedFraction:number;
}
export interface ContactDemonExpectation extends DemonExpectation {contactId:string;category:'surface'|'subsurface';classificationTarget:boolean}
export interface CutDemonExpectation extends DemonExpectation {cutId:string;mode:string;speedKn:number;depthM:number;inceptionKn:number|null;contacts:readonly ContactDemonExpectation[]}

const MPS_PER_KN=knotsToMps(1);
const round=(x:number,d=1)=>Math.round(x*10**d)/10**d;

function legFraction(c:Contact,inceptionKn:number,durationS:number):number{
 const legs=[...c.motion].sort((a,b)=>a.at-b.at);let above=0;
 for(let i=0;i<legs.length;i++){const t0=Math.max(0,legs[i].at),t1=Math.min(durationS,i+1<legs.length?legs[i+1].at:durationS);if(t1>t0&&legs[i].speed/MPS_PER_KN>inceptionKn)above+=t1-t0;}
 return durationS>0?above/durationS:0;
}

/** Per-contact expectation from the contact's rendered Signature (+ its motion legs over `durationS`). */
export function contactDemonExpectation(c:Contact,durationS=900):ContactDemonExpectation{
 const p=c.params,frac=p.modulation>0?modulatedFraction(p):0;
 const inc=p.inceptionKn&&p.inceptionKn>0?p.inceptionKn:null;
 const speedKn=(c.motion[0]?.speed??c.speed)/MPS_PER_KN;
 const demonExpected=p.modulation>0&&frac>=DEMON_EXPECTED_MIN_MOD_FRACTION;
 return {contactId:c.id,category:c.category??'subsurface',classificationTarget:!!c.classificationTarget,demonExpected,demonReason:demonExpected?'cavitating':'not-cavitating',
  pastInceptionPct:inc===null?null:round((speedKn/inc-1)*100),pastInceptionFraction:inc===null?null:round(legFraction(c,inc,durationS),3),modulatedFraction:round(frac,4)};
}

/** Per-cut (target) + per-contact (target and seeded traffic) DEMON answer key. Cut metadata only. */
export function cutDemonExpectation(cut:CutSeed):CutDemonExpectation{
 validateCutSeed(cut);
 const engine=new AcousticEngine(scenarioFromCut(cut),cut.seed);
 const contacts=engine.scenario.contacts.map(c=>contactDemonExpectation(c,cut.durationS));
 const target=engine.scenario.contacts.find(c=>c.classificationTarget)??engine.scenario.contacts[0];
 const t=contacts.find(c=>c.contactId===target.id)!;
 const {contactId:_i,category:_c,classificationTarget:_t,...head}=t;
 return Object.freeze({cutId:cut.id,mode:cut.mode,speedKn:cut.speedKn,depthM:cut.depthM,inceptionKn:target.params.inceptionKn?round(target.params.inceptionKn,2):null,...head,contacts:Object.freeze(contacts)});
}

/** Live scenario reveal / answer key: call ONLY at reveal; result is a fresh object, never stored on the scenario. */
export function scenarioDemonAnswerKey(scenario:Pick<Scenario,'contacts'>,horizonS=900):readonly ContactDemonExpectation[]{
 return scenario.contacts.filter(c=>c.active!==false).map(c=>contactDemonExpectation(c,horizonS));
}

/** Validate the DEMON lesson pack: 900 s, valid mode caps, model says cavitating, unique ids. */
export function validateDemonLessonPack(pack:CutDemonLessonPack,starters:readonly CutSeed[]):void{
 if(pack.packVersion!==1)throw new Error('DemonLessonPack.packVersion must be 1');
 if(!starters.some(c=>c.id===pack.mainLessonCutId))throw new Error('DEMON main lesson must be a starter cut');
 const ids=new Set(starters.map(c=>c.id));
 const all=[pack.mainLessonCutId,...pack.cuts.map(c=>c.id)];
 if(JSON.stringify(all)!==JSON.stringify(pack.lessonCutIds))throw new Error('DemonLessonPack.lessonCutIds must be main lesson then cuts');
 for(const c of pack.cuts){
  validateCutSeed(c);
  if(ids.has(c.id))throw new Error(`Duplicate cut id ${c.id}`);ids.add(c.id);
  if(c.durationS!==900)throw new Error(`${c.id}: DEMON pack cuts are 900 s`);
  const cap=modeSpeedCap(getClass(c.classId),c.mode);
  if(c.speedKn>cap+1e-9)throw new Error(`${c.id}: ${c.speedKn} kn exceeds ${c.mode} cap ${cap}`);
  if(c.mode==='SURF'&&c.depthM!==0)throw new Error(`${c.id}: SURF must be 0 m`);
  if(!cutDemonExpectation(c).demonExpected)throw new Error(`${c.id}: model says not cavitating`);
 }
}
