import {surfaceVesselPlant} from './plants.js';
import {configurePropulsion,updatePropulsion,writePlantTonals} from './plantModel.js';
import {deriveSeed,mulberry32} from '../prng.js';
import {knotsToMps,clamp} from '../units.js';
import {type Signature} from '../sourceModel.js';
import type {Contact,Scenario} from '../scenario.js';
/** Fixed invented ship templates, not measured signatures. Offsets above a fictional 120 dB
 * reference sub: +12/+18/+20/+16/+26/+28 dB. Urick/Ross: shaft/blade/diesel/broadband mechanisms. */
const templates=[
 {id:'fishing-trawler',name:'Fictional Flaxfloat',shafts:[1,2],maxRpm:220,maxSpeedKn:12,offsetDb:12},
 {id:'coastal-freighter',name:'Fictional Mossbarge',shafts:[1,2],maxRpm:180,maxSpeedKn:16,offsetDb:18},
 {id:'ferry',name:'Fictional Prismhopper',shafts:[2,3],maxRpm:240,maxSpeedKn:24,offsetDb:20},
 {id:'tug',name:'Fictional Tumblekeel',shafts:[1,3],maxRpm:210,maxSpeedKn:11,offsetDb:16},
 {id:'bulk-carrier',name:'Fictional Thistlehaul',shafts:[1,2],maxRpm:150,maxSpeedKn:15,offsetDb:26},
 {id:'tanker',name:'Fictional Opalhold',shafts:[1,2],maxRpm:160,maxSpeedKn:16,offsetDb:28},
] as const;
export const surfaceTypes=templates.map((t,i)=>({...t,plantSpec:surfaceVesselPlant(t.id,t.maxRpm,t.shafts[0],60,[0,2,3].includes(i))}));
export const SURFACE_POOL_SIZE=18;
export const surfaceCount=(v:number,max=SURFACE_POOL_SIZE):number=>Math.round(clamp(Number.isFinite(v)?v:.5,0,1)*max);
export function createSurfacePool(seed:number,max=SURFACE_POOL_SIZE):Contact[]{
 const out:Contact[]=[];for(let rank=0;rank<max;rank++){
  const rng=mulberry32(deriveSeed(seed,`surface-pool:${rank}`)),mix=rank/Math.max(1,max-1),choices=mix<.34?[0,0,3,2,1]:mix<.67?[1,2,2,3,4]:[4,4,5,5,1],type=surfaceTypes[choices[Math.floor(rng()*choices.length)]];
  const shafts=type.shafts[0]+Math.floor(rng()*(type.shafts[1]-type.shafts[0]+1)),blades=rng()<.5?3:4,electricalHz=rng()<.5?50:60,speedKn=type.maxSpeedKn*(.45+.4*rng()),shaftHz=type.maxRpm/60*speedKn/type.maxSpeedKn;
  const params:Signature={label:type.name,shafts,electricalHz,shaftHz,blades,tonalHz:shaftHz*blades,levelDb:120+type.offsetDb+10*Math.log10(1+speedKn/5),modulation:.55,tonals:[],plantSpec:surfaceVesselPlant(type.id,type.maxRpm,shafts,electricalHz,type.plantSpec.machinery.kind==='dieselGR'),cavitationPower:.025+.04*(speedKn/type.maxSpeedKn)**2,flowNoiseDb:85+55*Math.log10(speedKn/5),flowRadiatedFraction:.02};
  configurePropulsion(params,seed,`surface-${rank+1}`);params.shaftHz=updatePropulsion(params,speedKn/type.maxSpeedKn,'SURF').shafts[0].hz;writePlantTonals(params,'SURF');
  const course=rng()*Math.PI*2,speed=knotsToMps(speedKn),depth=3+5*rng(),x=(rng()-.5)*14000,y=(rng()-.5)*14000;
  out.push({id:`surface-${rank+1}`,category:'surface',operatingMode:'SURF',classificationTarget:false,surface:{type:type.id,shafts,electricalHz,rank},active:false,x,y,depth,course,speed,params,motion:[{at:0,course,speed,depth}]});
 }return out;
}
export function getClassificationTargets(s:Scenario):Contact[]{return s.contacts.filter(c=>c.category!=='surface'&&c.classificationTarget!==false&&c.active!==false);}
