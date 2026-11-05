import {isDiesel,type SubmarineClass,type OperatingState} from './schema.js';
import type {Random} from '../prng.js';
/** Static invented patrol policy. Mode draws are independent from platform/traffic draws.
 * AIP is backup power, never a primary propulsion class; a 10% eligible slow-diesel draw. */
export function chooseOperatingState(c:SubmarineClass,speedKn:number,depthM:number,quiet:boolean,rng:Random,reactorOffline=false):OperatingState {
 let mode:OperatingState['mode'];const diesel=isDiesel(c.params.propulsion),max=c.maxSpeedKts;
 if(diesel){mode=depthM===0?'SURF':depthM<=c.snorkelDepthM?(rng()<.85?'SNORK':'BATT'):'BATT';speedKn=Math.min(speedKn,mode==='SURF'?max.surfaced:mode==='SNORK'?max.snorkel:max.battery);
  if(mode==='BATT'&&speedKn>c.quietSpeedKts[1]&&rng()<.85)speedKn=Math.min(speedKn,c.quietSpeedKts[0]+rng()*(c.quietSpeedKts[1]-c.quietSpeedKts[0]));
  if(mode==='BATT'&&depthM>c.snorkelDepthM&&c.aip&&speedKn<=c.aip.maxSpeedKts&&rng()<.1)mode='AIP';
 }else{mode=reactorOffline&&c.aip&&depthM>0?'AIP':'NUC';speedKn=Math.min(speedKn,depthM===0?max.surfaced:max.submerged);if(mode==='AIP')speedKn=Math.min(speedKn,c.aip!.maxSpeedKts);}
 if(quiet)speedKn=Math.min(speedKn,c.quietSpeedKts[1]);return {mode,speedKn:Math.max(0,speedKn),depthM,...(reactorOffline?{reactorOffline:true}:{})};
}
