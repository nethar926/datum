import {getClass} from '../catalog/derive.js';
import type {CutLookalikePair,CutSeed} from './types.js';

/** Assert the declared differOn key actually differs between the two cuts' classes. */
export function lookalikeDiffersOn(pair:CutLookalikePair,cuts:readonly CutSeed[]):boolean {
 const a=cuts.find(c=>c.id===pair.cutIds[0]),b=cuts.find(c=>c.id===pair.cutIds[1]);
 if(!a||!b)return false;
 const ca=getClass(a.classId),cb=getClass(b.classId);
 switch(pair.differOn){
  case 'HYDP':return (ca.hydp?.nominalHz??NaN)!==(cb.hydp?.nominalHz??NaN);
  case 'blades':return ca.params.blades!==cb.params.blades;
  case 'shafts':return ca.shafts!==cb.shafts;
  default:return false;
 }
}
