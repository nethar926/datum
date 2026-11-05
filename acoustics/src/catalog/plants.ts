import {varyPlantIdentity} from './plantIdentity.js';
import {makeDrivetrain,type VesselPlantSpec,type EngineSpec,type DieselPlant,type AuxSpec} from './drivetrain.js';
import type {ClassParams} from './schema.js';
/** Invented static machinery sheets. Hunting-tooth ratios are computed, never rounded internally. */
export function legacyAux(p:ClassParams):AuxSpec[]{return p.aux.map(a=>({id:a.id,duty:'continuous',kind:a.kind==='pump'?'acPump':'dcvr',fHz:a.rate*(a.basis==='electrical'?p.electricalHz:1),harmonics:a.harmonics,stability:a.stability??(p.propulsion.startsWith('nuclear')?'stable':'unstable'),width:a.width??'discrete',...(a.sigmaBins===undefined?{}:{sigmaBins:a.sigmaBins})}));}
export function defaultVesselPlant(p:ClassParams,index:number):VesselPlantSpec {
 const maxPsrpm=p.maxShaftRpm,shafts=p.shafts,direct=makeDrivetrain('direct'),gr1=makeDrivetrain('gr1',[{pinionTeeth:20,bullTeeth:71}]),gr2=makeDrivetrain('gr2',[{pinionTeeth:17,bullTeeth:47},{pinionTeeth:19,bullTeeth:61}]),turbineGear=makeDrivetrain('gr2',[{pinionTeeth:20,bullTeeth:71},{pinionTeeth:19,bullTeeth:107}]);
 let plant:VesselPlantSpec['machinery'];
 if(p.propulsion.startsWith('diesel')){
  const electric=p.propulsion==='dieselElectric',drive=p.propulsion==='dieselDirect'?direct:index%2?gr2:gr1,stroke=p.propulsion==='dieselDirect'?2:4,cylinders=stroke===2?6:([6,8,10,12,16][index%5]),normal=electric?p.electricalHz*60/4:maxPsrpm*drive.ratio*.7,max=electric?normal*1.3:maxPsrpm*drive.ratio;
  const engines:EngineSpec[]=Array.from({length:electric?2+index%2:1},(_,i)=>({id:`fictional-engine-${index+1}-${i+1}`,stroke,cylinders,erpm:{obsMin:electric?normal*.8:max*.15,obsMax:max,normal}}));
  plant=electric?{kind:'dieselElectric',engines,generator:{polePairs:4},motor:{maxRpm:maxPsrpm*(index%2?gr1.ratio:1),drivetrain:index%2?gr1:direct}}:{kind:p.propulsion==='dieselDirect'?'dieselDirect':'dieselGR',engines,drivetrain:drive,motor:{maxRpm:maxPsrpm,drivetrain:direct}};
 }else {
  const electric=p.propulsion==='nuclearElectric',gear=index%2?gr1:turbineGear;
  plant={reactors:1,reactorSets:[{id:'fictional-reactor-1',coolantPumpHz:18+index*.4,turboGenerator:{rpm:p.electricalHz*60/2,polePairs:2}}],kind:electric?'nuclearElectric':'nuclearGR',mainTurbines:{count:shafts,maxRpm:electric?p.electricalHz*60:maxPsrpm*gear.ratio,drivetrain:electric?direct:gear},turbineGenerators:{count:1,rpm:p.electricalHz*60/2,polePairs:2},...(electric?{motor:{maxRpm:maxPsrpm*gr1.ratio,drivetrain:gr1}}:{})};
 }
 if((index===12||index===13)&&plant.kind==='dieselElectric'){plant.engines.length=index===13?1:2;for(const e of plant.engines){e.stroke=4;e.cylinders=6;}}
 return varyPlantIdentity({maxPsrpm,shafts,shaftMismatchPct:shafts>1?[.12,.65]:[0,0],machinery:plant,edas:[],aux:legacyAux(p).map((a,i)=>i===0&&index%3!==1?{...a,duty:'intermittent' as const,dutyOnS:[45+index,90+2*index] as [number,number],dutyOffS:[60+index,120+2*index] as [number,number]}:a)},`catalog-index:${index}`);
}
export function surfaceVesselPlant(id:string,maxPsrpm:number,shafts:number,hz:50|60,geared:boolean):VesselPlantSpec {
 const drivetrain=geared?makeDrivetrain('gr1',[{pinionTeeth:20,bullTeeth:71}]):makeDrivetrain('direct'),stroke=geared?4:2,cylinders=geared?8:6,max=maxPsrpm*drivetrain.ratio;
 const plant:DieselPlant={kind:geared?'dieselGR':'dieselDirect',drivetrain,...(!geared?{motor:{maxRpm:maxPsrpm,drivetrain:makeDrivetrain('direct')}}:{}),engines:Array.from({length:shafts+(geared?1:0)},(_,i)=>({id:`fictional-${id}-engine-${i+1}`,stroke,cylinders,erpm:{obsMin:.15*max,obsMax:max,normal:.7*max}}))};
 return varyPlantIdentity({maxPsrpm,shafts,shaftMismatchPct:shafts>1?[.15,.8]:[0,0],machinery:plant,edas:[],aux:[{id:'fictional-service-bus',kind:'electrical',duty:'continuous',fHz:hz,harmonics:[1,2,3],stability:'stable',width:'discrete'},{id:'fictional-hydraulics',kind:'hydp',fHz:27,harmonics:[1,2],stability:'unstable',width:'discrete',duty:'intermittent',dutyOnS:[60,120],dutyOffS:[90,180]}]},id);
}
