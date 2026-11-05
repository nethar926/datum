import { deriveSeed, mulberry32, gaussian, type Random } from './prng.js';
import { dbToPower, powerToDb } from './units.js';
import { geometry, createGeometry } from './kinematics.js';
import { doppler } from './doppler.js';
import { exactGain } from './lloydsMirror.js';
import { spreadingLoss, thorp } from './transmissionLoss.js';
import { ambientLevel } from './ambientNoise.js';
import { sourceLevel, fillTonals } from './sourceModel.js';
import type { Contact, Environment } from './scenario.js';
import type { Buoy } from './buoys.js';
interface CachedContact { contact:Contact; frequencies:Float64Array; powers:Float64Array; gain:number }
/** Incremental incoherent PSD renderer (Urick/Wenz). Output is PSD in dB re 1 µPa²/Hz; tonal power divided by df.
 * Independent exponential power (chi-square, 2 DOF) fluctuations per time-frequency cell.
 * Tonals deposit linearly in adjacent bins; no FFT leakage emulation. No row-time allocations. */
export class LofarGenerator {
  readonly row:Float32Array;
  readonly lines=Array.from({length:8},()=>({freqHz:0,brgDeg:0,quality:-300}));
  lineCount=0;
  readonly ambient:Float64Array;
  readonly absorption:Float64Array;
  private readonly power:Float64Array;
  private readonly shape:Float64Array;
  private readonly absorptionExponent:Float64Array;
  private readonly contacts:CachedContact[];
  private readonly rng:Random;
  private readonly g=createGeometry();
  private environment:Environment;
  bearing=0;
  constructor(readonly buoy:Buoy, contacts:Contact[],readonly bins:number,readonly fmax:number,seed:number,environment:Environment){
    this.row=new Float32Array(bins);this.power=new Float64Array(bins);this.ambient=new Float64Array(bins);this.absorption=new Float64Array(bins);this.shape=new Float64Array(bins);this.absorptionExponent=new Float64Array(bins);
    this.rng=mulberry32(deriveSeed(seed,`buoy:${buoy.id}`));this.environment={...environment};
    this.contacts=contacts.map(contact=>{const frequencies=new Float64Array(6),powers=new Float64Array(6);fillTonals(contact.params,frequencies,powers);return {contact,frequencies,powers,gain:.9+.2*mulberry32(deriveSeed(seed,`contact:${contact.id}`))()};});
    this.setEnvironment(environment);
  }
  setEnvironment(e:Environment):void {
    this.environment={...e};const df=this.fmax/(this.bins-1);
    for(let i=0;i<this.bins;i++){const f=Math.max(df/2,i*df);this.absorption[i]=thorp(f);this.absorptionExponent[i]=-this.absorption[i]*(Math.LN10/10);this.ambient[i]=dbToPower(ambientLevel(f,e.seaState,e.shipping));this.shape[i]=1/(1+(f/400)**2);}
  }
  generate(out=this.row,offset=0):Float32Array {
    if(!Number.isInteger(offset)||offset<0||out.length<offset+this.bins)throw new Error('Row size mismatch');
    this.lineCount=0;this.power.set(this.ambient);const e=this.environment,df=this.fmax/(this.bins-1);let east=0,north=0;
    for(let j=0;j<this.contacts.length;j++){
      const item=this.contacts[j],c=item.contact,g=geometry(c,this.buoy,this.g);
      const spread=dbToPower(-spreadingLoss(g.range,e.spreading,e.transition));
      const level=dbToPower(sourceLevel(c.params,c.speed,c.depth))*item.gain*spread;
      // Smooth fictional broadband PSD; absorption per bin cached, range factor updated.
      const km=Math.max(0,g.range-1)/1000;
      for(let i=0;i<this.bins;i++)this.power[i]+=level*.0001*this.shape[i]*Math.exp(this.absorptionExponent[i]*km);
      for(let k=0;k<item.frequencies.length;k++){
        const f=doppler(item.frequencies[k],g.sourceRadial,g.receiverRadial,e.soundSpeed),bin=f/df;
        if(bin>this.bins-1)continue;
        const i=Math.floor(bin),a=bin-i;
        const v=level*item.powers[k]*10**(-thorp(f)*km/10)*exactGain(f,g.horizontal,c.depth,this.buoy.depth,e.soundSpeed);
        this.power[i]+=v*(1-a)/df;if(i+1<this.bins)this.power[i+1]+=v*a/df;
        const quality=powerToDb(v/df/this.ambient[i]);
        if(quality>0){let pos=0;while(pos<this.lineCount&&this.lines[pos].quality>quality)pos++;if(pos<8){this.lineCount=Math.min(8,this.lineCount+1);for(let h=this.lineCount-1;h>pos;h--){const dst=this.lines[h],src=this.lines[h-1];dst.freqHz=src.freqHz;dst.brgDeg=src.brgDeg;dst.quality=src.quality;}const line=this.lines[pos];line.freqHz=f;line.quality=quality;line.brgDeg=(g.bearing*180/Math.PI+Math.min(90,20*10**(-quality/20))*gaussian(this.rng)+720)%360;}}
        east+=v*Math.sin(g.bearing);north+=v*Math.cos(g.bearing);
      }
    }
    // Ideal cross-spectrum beam resultant, not a multi-source bearing separator.
    this.bearing=(Math.atan2(east,north)+2*Math.PI)%(2*Math.PI);
    for(let i=0;i<this.bins;i++)out[offset+i]=powerToDb(this.power[i]*-Math.log(Math.max(this.rng(),1/4294967296)));
    return out;
  }
}
