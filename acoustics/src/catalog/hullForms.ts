/** Invented hull geometry and operator tables for manual/reveal profiles. All values are FICTIONAL
 *  teaching shapes generated deterministically per class id; no real platform dimensions.
 *  Scenario generation is unchanged: every existing hull keeps exactly one operator (the class's
 *  operatorNationId) and its flag. Export operators carry profile-only hulls until the generator
 *  is taught to spawn them. */
import {deriveSeed,mulberry32} from '../prng.js';
import type {SubmarineClass} from './schema.js';
export interface HullForm {fictional:true;lengthM:number;beamM:number;draughtSurfacedM:number;hullShape:'teardrop'|'parallel-midbody';
 sail:{fromBowFrac:number;lengthM:number;heightM:number};planes:'sail'|'bow';stern:'cruciform'|'x-form';aipPlugM?:number}
export interface OperatorHull {id:string;number:string;name:string;operatorNationId:string;inScenarioPool:boolean}
export interface ClassOperators {designOriginNationId:string;operators:{nationId:string;role:'origin'|'export';hullIds:string[]}[];hulls:OperatorHull[]}
const round=(x:number,d=1)=>Number(x.toFixed(d));
export function hullFormFor(c:Pick<SubmarineClass,'id'|'plant'|'aip'|'drivetrainCode'>):HullForm{
 const rng=mulberry32(deriveSeed(0x4a11,c.id)),u=()=>rng();
 const nuclear=c.plant==='nuclear',baseL=nuclear?(c.drivetrainCode==='NEL'?100+u()*15:92+u()*30):54+u()*24;
 const aipPlugM=c.aip?round(6+u()*4):undefined,lengthM=round(baseL+(aipPlugM??0));
 const beamM=round(lengthM/(nuclear?8.5+u()*2.5:7.5+u()*2));
 return {fictional:true,lengthM,beamM,draughtSurfacedM:round(beamM*(.78+u()*.1)),hullShape:nuclear||u()<.4?'parallel-midbody':'teardrop',
  sail:{fromBowFrac:round(.24+u()*.16,2),lengthM:round(lengthM*(.1+u()*.04)),heightM:round(4.5+u()*2.5)},planes:u()<.45?'sail':'bow',stern:u()<.35?'x-form':'cruciform',...(aipPlugM?{aipPlugM}:{})};
}
/** Fictional export deals (design origin keeps its own hulls). */
const EXPORTS:Record<string,{nationId:string;hulls:{number:string;name:string}[]}[]>={
 'red-gloamspiral':[{nationId:'dorhan-commonwealth',hulls:[{number:'FX-DQ-11E-1',name:'Gloamspiral Ember'}]}],
 'blue-orbelune':[{nationId:'tarsian-republic',hulls:[{number:'FX-TQ-02E-1',name:'Orbelune Tide'}]}],
};
export function classOperatorsFor(c:Pick<SubmarineClass,'id'|'operatorNationId'|'hulls'>):ClassOperators{
 const own:OperatorHull[]=c.hulls.map(h=>({...h,operatorNationId:c.operatorNationId,inScenarioPool:true}));
 const ex=(EXPORTS[c.id]??[]).map((x,j)=>({nationId:x.nationId,hulls:x.hulls.map((h,k)=>({id:`${c.id}-export-${j+1}-${k+1}`,...h,operatorNationId:x.nationId,inScenarioPool:false}))}));
 return {designOriginNationId:c.operatorNationId,operators:[{nationId:c.operatorNationId,role:'origin',hullIds:own.map(h=>h.id)},...ex.map(x=>({nationId:x.nationId,role:'export' as const,hullIds:x.hulls.map(h=>h.id)}))],hulls:[...own,...ex.flatMap(x=>x.hulls)]};
}
/** Fictional propeller drawing sheet (for the two prop views); type and blade count come from the catalog. */
export interface PropellerDrawing {fictional:true;type:'skewed'|'flat'|'cpp';blades:number;skewDeg:number;expandedAreaRatio:number;hubDiameterRatio:number;diameterM:number}
export function propellerDrawingFor(c:Pick<SubmarineClass,'id'|'propellerType'|'propeller'>,beamM:number):PropellerDrawing{
 const rng=mulberry32(deriveSeed(0x9a0b,c.id)),u=()=>rng(),t=c.propellerType;
 const skewDeg=round(t==='skewed'?25+u()*20:t==='cpp'?5+u()*10:u()*8,0);
 return {fictional:true,type:t,blades:c.propeller.blades,skewDeg,expandedAreaRatio:round(.55+u()*.25,2),hubDiameterRatio:round(t==='cpp'?.3+u()*.06:.18+u()*.06,2),diameterM:round(beamM*(.42+u()*.12))};
}
