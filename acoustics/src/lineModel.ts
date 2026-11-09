import {deriveSeed,mulberry32,gaussian,type Random} from './prng.js';
import {sourceLines,type Signature,type TonalLine} from './sourceModel.js';
/** Fictional oscillator drift, Gaussian stationary OU (tau=20 s) plus row jitter.
 * Stable (AC): bound <0.009% f0 — narrow/discrete, no visible wander.
 * Unstable plant: ~0.2% f0. Unstable AUX/DC: additional ~1.5 Hz absolute so DC
 * "wanders a few Hz" on LOFAR (Wilson AC/DC bar). Does NOT apply to stable lines —
 * AIP plant tones are stable+discrete (Stirling shaft / FC pumps / closed-cycle firing;
 * see plantModel writePlantTonals). Independent seed/contact/line streams. */
export class LineWander {
 readonly lines:TonalLine[];private readonly state:Float64Array;private readonly rng:Random[];
 constructor(signature:Signature,seed:number,contactId:string){
  this.lines=sourceLines(signature);this.state=new Float64Array(this.lines.length);
  this.rng=this.lines.map(line=>mulberry32(deriveSeed(seed,`${contactId}:line:${line.id}`)));
  for(let i=0;i<this.lines.length;i++){this.state[i]=gaussian(this.rng[i]);this.write(i);}
 }
 private write(i:number):void{
  const line=this.lines[i],r=this.rng[i]();
  if(line.stability==='stable'){line.frequencyHz=Math.max(0,line.hz*(1+.00008*Math.tanh(this.state[i])+.00001*(2*r-1)));return;}
  const frac=.002*this.state[i]+.00015*(2*r-1);
  // DC/AUX teaching: absolute wander so a few Hz is visible independent of f0.
  const absHz=line.lineFamily==='AUX'?1.5*this.state[i]:0;
  line.frequencyHz=Math.max(0,line.hz*(1+frac)+absHz);
 }
 advance(dt:number):void{if(!Number.isFinite(dt)||dt<0)throw new Error('Invalid line dt');if(dt===0)return;const a=Math.exp(-dt/20),b=Math.sqrt(1-a*a);for(let i=0;i<this.lines.length;i++){this.state[i]=a*this.state[i]+b*gaussian(this.rng[i]);this.write(i);}}
}
