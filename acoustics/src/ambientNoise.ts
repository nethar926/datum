import { dbToPower, powerToDb, clamp } from './units.js';
export type Shipping = 'light' | 'moderate' | 'heavy';
/** Wenz (1962), JASA 34:1936; Knudsen et al. (1948): smooth illustrative component fit,
 * not calibrated measured data. f Hz, output dB re 1 µPa²/Hz. Sea state mapped to wind m/s. */
export function ambientLevel(f:number,seaState:number,shipping:Shipping='moderate',density?:number):number {
  const k=Math.max(.01,f/1000), s=shipping==='light'?0:shipping==='heavy'?1:.5;
  const wind=[0,1.5,3.5,6,9,12,16][Math.round(clamp(seaState,0,6))];
  const turbulence=17-30*Math.log10(k);
  const ships=40+20*(s-.5)+26*Math.log10(k)-60*Math.log10(k+.03);
  const waves=50+7.5*Math.sqrt(wind)+20*Math.log10(k)-40*Math.log10(k+.4);
  const thermal=-15+20*Math.log10(k);
  return powerToDb(dbToPower(turbulence)+(density===undefined?dbToPower(ships):clamp(density,0,1)*dbToPower(ships+20*(1-s)))+dbToPower(waves)+dbToPower(thermal));
}
