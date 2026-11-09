/** Field-manual / reveal class profiles. Every acoustic figure is a RANGE or MAXIMUM derived from the
 *  same catalog sheets the generator uses; nothing here is a fixed per-contact value. All fictional. */
import {catalog as defaultCatalog} from './classes.js';
import type {Catalog,SubmarineClass} from './schema.js';
import {NATIONS} from './nations.js';
import {firingRateHz,edaFrequencyHz,type EngineSpec} from './drivetrain.js';
import {depthEnvelopeFor} from '../depthEnvelope.js';
import {hullFormFor,classOperatorsFor,propellerDrawingFor,type HullForm,type ClassOperators,type PropellerDrawing} from './hullForms.js';
export type Range=[number,number];
export interface EngineProduct {productId:string;productName:string;stroke:2|4;cylinders:number;erpmBand:Range;usedByClassIds:string[]}
export interface ClassProfile {
 id:string;name:string;hullForm:HullForm;operators:ClassOperators&{designOrigin:string;operatorNames:string[]};operatorNation:string;force:string;/** Fictional nations in the same force/alliance. */alliedNations:string[];/** Nations operating other classes that use one of this class's engine products. */engineSharedWithNations:string[];plant:'diesel'|'nuclear';drivetrain:string;aip?:{kind:string;maxSpeedKts:number};
 era:number;quietingTier:string;hulls:{number:string;name:string}[];variants:string[];
 hull:{shafts:number;propeller:{type:'skewed'|'flat'|'cpp';blades:number};propellerDrawing:PropellerDrawing};
 speedKts:{surfaced:number;submerged:number;snorkel:number;battery:number;quiet:Range};
 depthM:{periscope:number;typicalPatrol:Range;maxOperating:number;test:number};
 /** psrHzQuiet is TPK-derived (shaft rate ∝ speed); CPP classes may hold shaft rate below tpkMinKts. */
 shaft:{psrHzMax:number;psrHzQuiet:Range;brHzMax:number;brHzQuiet:Range;psrHarmonicsStopAtBlades:boolean;propResonanceOrders?:Range};
 /** Prime Movers: the main diesel engines (diesel plants) or main turbines (nuclear). Distinct from propulsion motor, shaft and auxiliaries. */
 primeMovers:{kind:'diesel';productId:string;productName:string;count:number;csrHz:Range;cfrHz:Range;efrHz:Range}[]|{kind:'turbine';count:number;rotorHzMax:number;vaneCount:number;vanePassHzMax:number}[];
 propulsionMotor?:{maxShaftRpm:number};
 edas:{name:string;cfrMultiple:Range;hzRange:Range;harmonics:number[]}[];
 /** Independent sources: nominal Hz plus the model's 1-sigma wander (LineWander: stable ≤0.008% f0; unstable 0.2% f0 + 1.5 Hz AUX). */
 independentAux:{id:string;kind:string;duty:string;nominalHz:number;wander1SigmaHz:number;stability:string;harmonics:number[]}[];
 hydp?:{nominalHz:Range;pairSpacingHz:Range};
 /** SRC: current model emits a fixed fundamental (plus 2nd harmonic) while gated on; SWATH: band. */
 speedRelated:{name:string;kind:string;speedKts:Range;hz:Range}[];
 electricalHz:50|60;
}
const r=(a:number,b:number):Range=>[Math.min(a,b),Math.max(a,b)];
const round=(x:number,d=3)=>Number(x.toFixed(d));
const rr=(x:Range,d=3):Range=>[round(x[0],d),round(x[1],d)];
const PRODUCT_PREFIX=['Halvard','Corvane','Dunmere','Pellor','Ashgrove','Tamsin','Orrin','Veskel','Brannoc','Quillon','Merrow','Sallis'];
const engineKey=(e:EngineSpec)=>`${e.stroke}|${e.cylinders}|${round(e.erpm.obsMin,1)}|${round(e.erpm.obsMax,1)}`;
/** Fictional engine "products": identical engine sheets across classes are one exported product. */
export function buildEngineProducts(source:Catalog=defaultCatalog):EngineProduct[]{
 const m=new Map<string,EngineProduct>();
 for(const c of source.classes){if(!('engines' in c.machinery))continue;for(const e of c.machinery.engines){const k=engineKey(e);let p=m.get(k);
  if(!p){const n=m.size;p={productId:`fx-engine-${n+1}`,productName:`${PRODUCT_PREFIX[n%PRODUCT_PREFIX.length]} ${e.cylinders}${e.stroke===2?'T':'V'}-${Math.round(e.erpm.obsMax)}${n>=PRODUCT_PREFIX.length?` Mk${1+Math.floor(n/PRODUCT_PREFIX.length)}`:''}`,stroke:e.stroke,cylinders:e.cylinders,erpmBand:rr([e.erpm.obsMin,e.erpm.obsMax],1),usedByClassIds:[]};m.set(k,p);}
  if(!p.usedByClassIds.includes(c.id))p.usedByClassIds.push(c.id);}}
 return [...m.values()];
}
export function buildClassProfiles(source:Catalog=defaultCatalog):ClassProfile[]{
 const products=buildEngineProducts(source),byKey=new Map<string,EngineProduct>();
 for(const c of source.classes)if('engines' in c.machinery)for(const e of c.machinery.engines)byKey.set(engineKey(e),products.find(p=>p.usedByClassIds.includes(c.id)&&p.stroke===e.stroke&&p.cylinders===e.cylinders&&p.erpmBand[0]===round(e.erpm.obsMin,1)&&p.erpmBand[1]===round(e.erpm.obsMax,1))!);
 return source.classes.map(c=>profileFor(c,source,byKey));
}
function profileFor(c:SubmarineClass,source:Catalog,byKey:Map<string,EngineProduct>):ClassProfile{
 const p=c.params,blades=c.propeller.blades,env=depthEnvelopeFor(c),psrMax=c.maxPsrpm/60;
 // Coupled shaft rate scales with speed (TPK); quiet band PSR from quiet speed window.
 const psrQRaw=r(c.quietSpeedKts[0]*c.tpk/60,c.quietSpeedKts[1]*c.tpk/60),psrQuiet=rr(psrQRaw);
 const sameClassName=source.classes.filter(x=>x.name.replace(/^Fictional /,'')!==c.name.replace(/^Fictional /,'')&&'engines' in x.machinery&&'engines' in c.machinery&&x.machinery.engines.some(e=>(c.machinery as {engines:EngineSpec[]}).engines.some(f=>engineKey(f)===engineKey(e)))).map(x=>x.country);
 const engines:{kind:'diesel';productId:string;productName:string;count:number;csrHz:Range;cfrHz:Range;efrHz:Range}[]=[];let cfrAll:Range|undefined;
 if('engines' in c.machinery){const groups=new Map<string,{e:EngineSpec;n:number}>();for(const e of c.machinery.engines){const k=engineKey(e),g=groups.get(k);if(g)g.n++;else groups.set(k,{e,n:1});}
  for(const [k,{e,n}] of groups){const prod=byKey.get(k)!,lo=e.erpm.obsMin,hi=e.erpm.obsMax,cfr=r(lo/60/(e.stroke===4?2:1),hi/60/(e.stroke===4?2:1));cfrAll=cfrAll?r(Math.min(cfrAll[0],cfr[0]),Math.max(cfrAll[1],cfr[1])):cfr;
   engines.push({kind:'diesel',productId:prod.productId,productName:prod.productName,count:n,csrHz:rr(r(lo/60,hi/60)),cfrHz:rr(cfr),efrHz:rr(r(firingRateHz(e,lo),firingRateHz(e,hi)))});}}
 const turbines='mainTurbines' in c.machinery?{kind:'turbine' as const,count:c.machinery.mainTurbines.count,rotorHzMax:round(c.machinery.mainTurbines.maxRpm/60),vaneCount:c.machinery.mainTurbines.vaneCount,vanePassHzMax:round(c.machinery.mainTurbines.maxRpm/60*c.machinery.mainTurbines.vaneCount,1)}:undefined;
 const edaKeys=c.idKeys.edas??[];
 const edas=c.edas.map(e=>{const m=edaKeys.find(k=>k.name===e.name)?.cfrMultiple??[e.cfrMultiple,e.cfrMultiple];const base=cfrAll??[0,0];return {name:e.name,cfrMultiple:rr(m as Range),hzRange:rr(r(edaFrequencyHz(base[0],m[0]),edaFrequencyHz(base[1],m[1])),2),harmonics:e.harmonics};});
 const nation=NATIONS.find(n=>n.id===c.operatorNationId)!,ops=classOperatorsFor(c),nm=(id:string)=>NATIONS.find(n=>n.id===id)!.name;
 const hf=hullFormFor(c);
 return {id:c.id,name:c.name,hullForm:hf,operators:{...ops,designOrigin:nm(ops.designOriginNationId),operatorNames:ops.operators.map(o=>nm(o.nationId))},operatorNation:nation.name,force:c.force,alliedNations:NATIONS.filter(n=>n.force===c.force&&n.id!==nation.id).map(n=>n.name),engineSharedWithNations:[...new Set(sameClassName)].filter(n=>n!==nation.name).sort(),plant:c.plant,drivetrain:c.drivetrainLabel,...(c.aip?{aip:{kind:c.aip.kind,maxSpeedKts:c.aip.maxSpeedKts}}:{}),
  era:c.era,quietingTier:c.quietingTier,hulls:c.hulls.map(h=>({number:h.number,name:h.name})),variants:c.variants.map(v=>v.name),
  hull:{shafts:c.shafts,propeller:{type:c.propellerType,blades},propellerDrawing:propellerDrawingFor(c,hf.beamM)},
  speedKts:{...c.maxSpeedKts,quiet:rr(c.quietSpeedKts as Range,1)},
  depthM:{periscope:env.periscopeDepthM,typicalPatrol:[env.typicalPatrolDepthM[0],env.typicalPatrolDepthM[1]],maxOperating:env.maxOperatingDepthM,test:env.testDepthM},
  shaft:{psrHzMax:round(psrMax),psrHzQuiet:psrQuiet,brHzMax:round(psrMax*blades),brHzQuiet:rr([psrQRaw[0]*blades,psrQRaw[1]*blades]),psrHarmonicsStopAtBlades:!!c.psrHarmonicsStopAtBlades,...(c.idKeys.propResonance?{propResonanceOrders:c.idKeys.propResonance.orders as Range}:{})},
  primeMovers:turbines?[turbines]:engines,...('motor' in c.machinery&&c.machinery.motor?{propulsionMotor:{maxShaftRpm:round(c.machinery.motor.maxRpm/c.machinery.motor.drivetrain.ratio,1)}}:{}),edas,
  independentAux:c.aux.filter(a=>a.kind!=='hydp').map(a=>({id:a.id,kind:a.kind,duty:a.duty,nominalHz:round(a.fHz,2),wander1SigmaHz:round(a.stability==='stable'?.00008*a.fHz:.002*a.fHz+1.5,3),stability:a.stability,harmonics:a.harmonics})),
  ...(c.idKeys.hydp?{hydp:{nominalHz:rr(c.idKeys.hydp.nominalHz as Range,1),pairSpacingHz:rr(c.idKeys.hydp.pairSpacingHz as Range,3)}}:{}),
  speedRelated:c.speedWindows.map(w=>({name:w.name,kind:w.kind,speedKts:rr(w.speedKts as Range,1),hz:w.kind==='SRC'?rr([w.hz,w.hz],2):rr([w.loHz,w.hiHz],1)})),
  electricalHz:p.electricalHz};
}
