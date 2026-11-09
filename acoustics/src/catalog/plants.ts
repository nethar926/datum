import {varyPlantIdentity} from './plantIdentity.js';
import {makeDrivetrain,type VesselPlantSpec,type EngineSpec,type DieselPlant,type AuxSpec} from './drivetrain.js';
import type {ClassParams} from './schema.js';
/** Invented static machinery sheets. Hunting-tooth ratios are computed, never rounded internally. */
export function legacyAux(p:ClassParams):AuxSpec[]{return p.aux.map(a=>{const kind:AuxSpec['kind']=a.kind==='pump'?'acPump':a.basis==='electrical'?'electrical':'dcvr';const ac=kind==='acPump'||kind==='electrical';return {id:a.id,duty:'continuous',kind,fHz:a.rate*(a.basis==='electrical'?p.electricalHz:1),harmonics:a.harmonics,stability:a.stability??(ac?'stable':'unstable'),width:a.width??'discrete',...(!ac&&a.sigmaBins!==undefined?{sigmaBins:a.sigmaBins}:{})};});}
/** Invented, deterministic per-class turbine vane count in 20..80 (from catalog index only; no real platform data). */
export function fictionalVaneCount(index:number):number{return 20+(index*37+11)%61;}
/** Pick a single-stage hunting-tooth GR near targetRatio (shaft = ERPM / ratio). */
function grNear(targetRatio:number){
 const pinionTeeth=19;let bullTeeth=Math.max(pinionTeeth+1,Math.round(pinionTeeth*Math.max(2.2,Math.min(4.6,targetRatio))));
 const gcd=(a:number,b:number):number=>b?gcd(b,a%b):a;while(gcd(pinionTeeth,bullTeeth)!==1)bullTeeth++;
 return makeDrivetrain('gr1',[{pinionTeeth,bullTeeth}]);
}
export function defaultVesselPlant(p:ClassParams,index:number):VesselPlantSpec {
 const maxPsrpm=p.maxShaftRpm,shafts=p.shafts,direct=makeDrivetrain('direct');
 let plant:VesselPlantSpec['machinery'];
 if(p.propulsion.startsWith('diesel')){
  const electric=p.propulsion==='dieselElectric',directDrive=p.propulsion==='dieselDirect';
  // D/D: 2-stroke, ratio 1, CFR≡CSR≡PSR when coupled (Wilson). GR: 4-stroke + single-stage reduction.
  // D/E: 4-stroke gensets; ERPM bus-locked and decoupled from shaft.
  const stroke:2|4=directDrive?2:4;
  const cylinders=stroke===2?6:([6,8,10,12,16][index%5] as 6|8|10|12|16);
  if(electric){
   const polePairs=4,normal=p.electricalHz*60/polePairs;
   // D/E ERPM is bus-locked at `normal`; keep the teaching band but always contain it.
   let obsMin=p.erpmMin||normal*.8,obsMax=p.erpmMax||normal*1.3;
   if(obsMin>normal)obsMin=normal*.85;if(obsMax<normal)obsMax=normal*1.15;
   obsMin=Math.max(150,Math.min(obsMin,normal*.95));obsMax=Math.min(2000,Math.max(obsMax,normal*1.05));
   const engines:EngineSpec[]=Array.from({length:2+index%2},(_,i)=>({id:`fictional-engine-${index+1}-${i+1}`,stroke,cylinders,erpm:{obsMin,obsMax,normal}}));
   // Motor gearing sets shaft from maxPsrpm; ERPM stays on the generator sheet.
   plant={kind:'dieselElectric',engines,generator:{polePairs},motor:{maxRpm:maxPsrpm*(index%2?grNear(3.2).ratio:1),drivetrain:index%2?grNear(3.2):direct}};
  }else if(directDrive){
   // ERPM band covers the shaft operating range; obsMax must equal maxPsrpm.
   const engines:EngineSpec[]=[{id:`fictional-engine-${index+1}-1`,stroke,cylinders,erpm:{obsMin:p.erpmMin||150,obsMax:maxPsrpm,normal:Math.min(maxPsrpm,Math.max(p.erpmMin||150,maxPsrpm*.7))}}];
   plant={kind:'dieselDirect',engines,drivetrain:direct,motor:{maxRpm:maxPsrpm,drivetrain:direct}};
  }else {
   // Gear-reduction: choose ratio so shaft max ≈ erpmMax/ratio stays in ~100–550.
   const erpmMax=p.erpmMax||Math.min(2000,maxPsrpm*3.5),erpmMin=p.erpmMin||Math.max(150,erpmMax*.35);
   const drive=grNear(erpmMax/Math.max(1,maxPsrpm));
   const engines:EngineSpec[]=[{id:`fictional-engine-${index+1}-1`,stroke,cylinders,erpm:{obsMin:erpmMin,obsMax:erpmMax,normal:erpmMin+.55*(erpmMax-erpmMin)}}];
   plant={kind:'dieselGR',engines,drivetrain:drive,motor:{maxRpm:maxPsrpm,drivetrain:direct}};
  }
 }else {
  const electric=p.propulsion==='nuclearElectric',gear=index%2?grNear(3.4):makeDrivetrain('gr2',[{pinionTeeth:20,bullTeeth:71},{pinionTeeth:19,bullTeeth:107}]);
  plant={reactors:1,reactorSets:[{id:'fictional-reactor-1',coolantPumpHz:18+index*.4,turboGenerator:{rpm:p.electricalHz*60/2,polePairs:2}}],kind:electric?'nuclearElectric':'nuclearGR',mainTurbines:{count:shafts,maxRpm:electric?p.electricalHz*60:maxPsrpm*gear.ratio,drivetrain:electric?direct:gear,vaneCount:fictionalVaneCount(index)},turbineGenerators:{count:1,rpm:p.electricalHz*60/2,polePairs:2},...(electric?{motor:{maxRpm:maxPsrpm*grNear(3.4).ratio,drivetrain:grNear(3.4)}}:{})};
 }
 if((index===12||index===13)&&plant.kind==='dieselElectric'){plant.engines.length=index===13?1:2;for(const e of plant.engines){e.stroke=4;e.cylinders=6;}}
 return varyPlantIdentity({maxPsrpm,shafts,shaftMismatchPct:shafts>1?[.12,.65]:[0,0],machinery:plant,edas:[],aux:legacyAux(p).map((a,i)=>i===0&&index%3!==1?{...a,duty:'intermittent' as const,dutyOnS:[45+index,90+2*index] as [number,number],dutyOffS:[60+index,120+2*index] as [number,number]}:a)},`catalog-index:${index}`);
}
export function surfaceVesselPlant(id:string,maxPsrpm:number,shafts:number,hz:50|60,geared:boolean):VesselPlantSpec {
 const drivetrain=geared?grNear(3.2):makeDrivetrain('direct'),stroke=geared?4:2,cylinders=geared?8:6,max=Math.min(2000,maxPsrpm*drivetrain.ratio);
 const plant:DieselPlant={kind:geared?'dieselGR':'dieselDirect',drivetrain,...(!geared?{motor:{maxRpm:maxPsrpm,drivetrain:makeDrivetrain('direct')}}:{}),engines:Array.from({length:shafts+(geared?1:0)},(_,i)=>({id:`fictional-${id}-engine-${i+1}`,stroke,cylinders,erpm:{obsMin:Math.max(150,.15*max),obsMax:max,normal:.7*max}}))};
 return varyPlantIdentity({maxPsrpm,shafts,shaftMismatchPct:shafts>1?[.15,.8]:[0,0],machinery:plant,edas:[],aux:[{id:'fictional-service-bus',kind:'electrical',duty:'continuous',fHz:hz,harmonics:[1,2,3],stability:'stable',width:'discrete'},{id:'fictional-hydraulics',kind:'hydp',fHz:27,harmonics:[1,2],stability:'unstable',width:'discrete',duty:'intermittent',dutyOnS:[60,120],dutyOffS:[90,180]}]},id);
}
