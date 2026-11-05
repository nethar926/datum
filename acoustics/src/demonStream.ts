import {Demon,ContactSynth} from './demon.js';
import {deriveSeed} from './prng.js';
import {powerToDb} from './units.js';
import type {Contact} from './scenario.js';
import type {Buoy} from './buoys.js';
/** In-place quickselect: no sort scratch allocation in the row path. */
function select(a:Float32Array,k:number):number{let lo=0,hi=a.length-1;while(lo<hi){const pivot=a[(lo+hi)>>>1];let i=lo,j=hi;while(i<=j){while(a[i]<pivot)i++;while(a[j]>pivot)j--;if(i<=j){const v=a[i];a[i++]=a[j];a[j--]=v;}}if(k<=j)hi=j;else if(k>=i)lo=i;else break;}return a[k];}
/** Selected-band DEMON of the strongest contact at a buoy. Real square-law/LP/FFT signal path;
 * fixed 5.11 s analysis block, 512 envelope bins 0..100 Hz, median-relative dB.
 * A lean strongest-contact approximation, not coherent multi-contact waveform summation. */
export class DemonStream {
 readonly bins=512;readonly fBin=100/511;
 private readonly signal=new Float32Array(65536);
 private readonly median=new Float32Array(512);
 private readonly detector=new Demon(65536,65536*100/511,120);
 private readonly synths:ContactSynth[];
 constructor(private readonly buoy:Buoy,private readonly contacts:Contact[],seed:number,band:[number,number]){
  const carrier=(band[0]+band[1])/2;this.synths=contacts.map(c=>new ContactSynth(c.params,65536*100/511,deriveSeed(seed,`demon:${buoy.id}:${c.id}`),carrier));
 }
 write(out:Float32Array,offset:number):void {
  let best=-1,power=-1;for(let i=0;i<this.contacts.length;i++){const c=this.contacts[i],r2=(c.x-this.buoy.x)**2+(c.y-this.buoy.y)**2+(c.depth-this.buoy.depth)**2,v=10**(c.params.levelDb/10)/Math.max(1,r2);if(v>power){power=v;best=i;}}
  if(best<0){out.fill(NaN,offset,offset+512);return;}this.synths[best].fill(this.signal);const spectrum=this.detector.process(this.signal);
  for(let i=0;i<512;i++)this.median[i]=spectrum[i];const median=Math.max(1e-30,(select(this.median,255)+select(this.median,256))/2);
  for(let i=0;i<512;i++)out[offset+i]=powerToDb(spectrum[i]/median);
 }
}
