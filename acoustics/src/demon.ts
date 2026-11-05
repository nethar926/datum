import { mulberry32, gaussian } from './prng.js';
import { bladeRate, type Signature } from './sourceModel.js';
/** Radix-2 Cooley–Tukey FFT (1965); Hann window: standard DSP, Kinsler/Frey acoustics.
 * Unnormalized forward transform; reusable buffers, no transform-time allocation. */
export class FFT {
  readonly real:Float64Array;readonly imag:Float64Array;readonly window:Float64Array;
  private readonly cos:Float64Array;private readonly sin:Float64Array;private readonly reverse:Uint32Array;
  constructor(readonly size:number){
    if(size<4||(size&(size-1))!==0||size>1048576)throw new Error('FFT requires bounded power of two');
    this.real=new Float64Array(size);this.imag=new Float64Array(size);this.window=new Float64Array(size);this.cos=new Float64Array(size/2);this.sin=new Float64Array(size/2);this.reverse=new Uint32Array(size);
    const bits=Math.log2(size);for(let i=0;i<size;i++){let x=i,r=0;for(let j=0;j<bits;j++){r=(r<<1)|(x&1);x>>>=1;}this.reverse[i]=r;this.window[i]=.5-.5*Math.cos(2*Math.PI*i/(size-1));}
    for(let i=0;i<size/2;i++){this.cos[i]=Math.cos(-2*Math.PI*i/size);this.sin[i]=Math.sin(-2*Math.PI*i/size);}
  }
  transform(input:Float64Array|Float32Array,window=true):void {
    if(input.length!==this.size)throw new Error('FFT size mismatch');
    const re=this.real,im=this.imag;
    for(let i=0;i<this.size;i++){re[this.reverse[i]]=input[i]*(window?this.window[i]:1);im[i]=0;}
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
    this.fft.transform(this.envelope);for(let i=0;i<out.length;i++)out[i]=(this.fft.real[i]**2+this.fft.imag[i]**2)/(this.size*this.size);return out;
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
