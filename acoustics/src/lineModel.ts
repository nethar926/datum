import {deriveSeed,mulberry32,gaussian,type Random} from './prng.js';
import {sourceLines,type Signature,type TonalLine} from './sourceModel.js';
/** Fictional oscillator drift, Gaussian stationary OU (tau=20 s) plus row jitter.
 * Stable bound <0.009% f0; unstable stationary sigma ~0.2% f0, jitter ±0.015%.
 * Independent seed/contact/line streams; update once on the source clock, never per receiver. */
export class LineWander {
 readonly lines:TonalLine[];private readonly state:Float64Array;private readonly rng:Random[];
 constructor(signature:Signature,seed:number,contactId:string){
  this.lines=sourceLines(signature);this.state=new Float64Array(this.lines.length);
  this.rng=this.lines.map(line=>mulberry32(deriveSeed(seed,`${contactId}:line:${line.id}`)));
  for(let i=0;i<this.lines.length;i++){this.state[i]=gaussian(this.rng[i]);this.write(i);}
 }
 private write(i:number):void{const line=this.lines[i],r=this.rng[i](),drift=line.stability==='stable'?.00008*Math.tanh(this.state[i])+.00001*(2*r-1):.002*this.state[i]+.00015*(2*r-1);line.frequencyHz=Math.max(0,line.hz*(1+drift));}
 advance(dt:number):void{if(!Number.isFinite(dt)||dt<0)throw new Error('Invalid line dt');if(dt===0)return;const a=Math.exp(-dt/20),b=Math.sqrt(1-a*a);for(let i=0;i<this.lines.length;i++){this.state[i]=a*this.state[i]+b*gaussian(this.rng[i]);this.write(i);}}
}
