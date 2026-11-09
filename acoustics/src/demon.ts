import { mulberry32, gaussian } from './prng.js';
import { bladeRate, type Signature } from './sourceModel.js';
/** Radix-2 Cooley–Tukey FFT (1965); Hann window: standard DSP, Kinsler/Frey acoustics.
 * Unnormalized forward transform; reusable buffers, no transform-time allocation. */
/** Shared read-only twiddles/window/bit-reverse per FFT size (exact; one copy process-wide).
 * Working real/imag buffers stay per-instance so concurrent streams do not clobber each other. */
const FFT_TABLES=new Map<number,{window:Float64Array;cos:Float64Array;sin:Float64Array;reverse:Uint32Array;windowSum:number}>();
function fftTables(size:number){
 let t=FFT_TABLES.get(size);if(t)return t;
 const window=new Float64Array(size),cos=new Float64Array(size/2),sin=new Float64Array(size/2),reverse=new Uint32Array(size);let windowSum=0;
 const bits=Math.log2(size);for(let i=0;i<size;i++){let x=i,r=0;for(let j=0;j<bits;j++){r=(r<<1)|(x&1);x>>>=1;}reverse[i]=r;window[i]=.5-.5*Math.cos(2*Math.PI*i/(size-1));windowSum+=window[i];}
 for(let i=0;i<size/2;i++){cos[i]=Math.cos(-2*Math.PI*i/size);sin[i]=Math.sin(-2*Math.PI*i/size);}
 t={window,cos,sin,reverse,windowSum};FFT_TABLES.set(size,t);return t;
}
export function fftSharedTableBytes():number{let b=0;for(const t of FFT_TABLES.values())b+=t.window.byteLength+t.cos.byteLength+t.sin.byteLength+t.reverse.byteLength;return b;}
export class FFT {
  readonly real:Float64Array;readonly imag:Float64Array;readonly window:Float64Array;
  private windowSum=0;
  private readonly cos:Float64Array;private readonly sin:Float64Array;private readonly reverse:Uint32Array;
  constructor(readonly size:number){
    if(size<4||(size&(size-1))!==0||size>1048576)throw new Error('FFT requires bounded power of two');
    this.real=new Float64Array(size);this.imag=new Float64Array(size);
    const t=fftTables(size);this.window=t.window;this.cos=t.cos;this.sin=t.sin;this.reverse=t.reverse;this.windowSum=t.windowSum;
  }
  transform(input:Float64Array|Float32Array,window=true,removeDc=false):void {
    if(input.length!==this.size)throw new Error('FFT size mismatch');
    const re=this.real,im=this.imag;let mean=0;if(removeDc){for(let i=0;i<this.size;i++)mean+=input[i]*(window?this.window[i]:1);mean/=window?this.windowSum:this.size;}
    for(let i=0;i<this.size;i++){re[this.reverse[i]]=(input[i]-mean)*(window?this.window[i]:1);im[i]=0;}
    for(let width=2;width<=this.size;width*=2){const half=width/2,stride=this.size/width;
      for(let base=0;base<this.size;base+=width)for(let j=0;j<half;j++){const a=base+j,b=a+half,k=j*stride,tr=this.cos[k]*re[b]-this.sin[k]*im[b],ti=this.sin[k]*re[b]+this.cos[k]*im[b];re[b]=re[a]-tr;im[b]=im[a]-ti;re[a]+=tr;im[a]+=ti;}
    }
  }
}
/** DEMON: square-law envelope, four cascaded one-pole low-pass sections, DC removal, Hann FFT.
 * Input should already be a selected acoustic carrier band; no classification algorithms. */
export class Demon {
  readonly spectrum:Float32Array;readonly envelope:Float64Array;readonly fft:FFT;
  private readonly state=new Float64Array(4);
  private readonly alpha:number;
  constructor(readonly size:number,readonly sampleRate:number,cutoff=60){
    if(!(sampleRate>0)||!Number.isFinite(sampleRate)||!(cutoff>0)||cutoff>=sampleRate/2)throw new Error('Invalid DEMON sample rate/cutoff');
    this.fft=new FFT(size);this.envelope=new Float64Array(size);this.spectrum=new Float32Array(size/2+1);this.alpha=1-Math.exp(-2*Math.PI*cutoff/sampleRate);
  }
  process(signal:Float32Array,out=this.spectrum):Float32Array {
    if(signal.length!==this.size||out.length!==this.spectrum.length)throw new Error('DEMON size mismatch');
    // Independent block, initialized at first sample's energy to avoid artificial startup step.
    this.state.fill(signal[0]*signal[0]);let mean=0;
    for(let i=0;i<this.size;i++){let v=signal[i]*signal[i];for(let j=0;j<4;j++){this.state[j]+=this.alpha*(v-this.state[j]);v=this.state[j];}this.envelope[i]=v;mean+=v;}
    mean/=this.size;for(let i=0;i<this.size;i++)this.envelope[i]-=mean;
    this.fft.transform(this.envelope,true,true);for(let i=0;i<out.length;i++)out[i]=(this.fft.real[i]**2+this.fft.imag[i]**2)/(this.size*this.size);return out;
  }
}
/** Fictional band-limited carrier plus seeded noise, AM power at shaft/blade rates.
 * Phase continues between fill calls; square-root AM makes square-law envelope linear. */
export class ContactSynth {
  private readonly rng;private sample=0;private readonly carrier:number;
  constructor(readonly signature:Signature,readonly sampleRate:number,seed:number,carrier=700){
    if(!(sampleRate>0)||!Number.isFinite(sampleRate)||carrier<=0||carrier>=sampleRate/2)throw new Error('Invalid synth rate/carrier');
    this.rng=mulberry32(seed);this.carrier=carrier;
  }
  fill(out:Float32Array):Float32Array {
    const s=this.signature,m=Math.min(.45,s.modulation);
    for(let i=0;i<out.length;i++){const t=this.sample++/this.sampleRate;const envelope=Math.max(.01,1+m*Math.cos(2*Math.PI*s.shaftHz*t)+m*Math.cos(2*Math.PI*bladeRate(s)*t));out[i]=Math.sqrt(envelope)*(Math.cos(2*Math.PI*this.carrier*t)+.015*gaussian(this.rng));}return out;
  }
}
