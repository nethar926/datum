import type {LineWidth} from './sourceModel.js';
const PHASES=128;
/** Kinsler/Frey and standard Fourier window theory: squared Hann transform for discrete
 * lines; Gaussian power kernel for diffuse lines. Fractional-bin kernels normalized once.
 * Bin-centred sampled Hann -3 dB width ≈1.33 bins (continuous limit ≈1.44); Gaussian
 * power FWHM=2 sqrt(2 ln 2)*sigmaBins. No deposit-time allocation. */
export class LineKernel {
 readonly radius:number;private readonly taps:number;private readonly weights:Float32Array;
 constructor(readonly width:LineWidth='discrete',readonly sigmaBins=2.5){
  if(width!=='discrete'&&width!=='diffuse')throw new Error('Invalid line width');
  if(width==='diffuse'&&(!Number.isFinite(sigmaBins)||sigmaBins<.75||sigmaBins>16))throw new Error('Diffuse sigmaBins must be 0.75..16');
  this.radius=width==='discrete'?4:Math.ceil(4*sigmaBins);this.taps=2*this.radius+1;this.weights=new Float32Array(PHASES*this.taps);
  for(let p=0;p<PHASES;p++){let total=0;for(let j=0;j<this.taps;j++){const x=j-this.radius-p/PHASES,amp=Math.abs(x)<1e-12?1:Math.abs(Math.abs(x)-1)<1e-12?.5:Math.sin(Math.PI*x)/(Math.PI*x*(1-x*x)),v=width==='diffuse'?Math.exp(-.5*(x/sigmaBins)**2):amp*amp;this.weights[p*this.taps+j]=v;total+=v;}for(let j=0;j<this.taps;j++)this.weights[p*this.taps+j]/=total;}
 }
 deposit(out:Float64Array|Float32Array,bin:number,power:number):void{
  if(!Number.isFinite(bin)||!Number.isFinite(power)||power<=0||bin<0||bin>out.length-1)return;
  let center=Math.floor(bin),phase=Math.round((bin-center)*PHASES);if(phase===PHASES){center++;phase=0;}
  const start=center-this.radius,base=phase*this.taps;let sum=0;for(let j=0;j<this.taps;j++)if(start+j>=0&&start+j<out.length)sum+=this.weights[base+j];if(sum<=0)return;
  const scale=power/sum;for(let j=0;j<this.taps;j++)if(start+j>=0&&start+j<out.length)out[start+j]+=scale*this.weights[base+j];
 }
 /** Deposit tonal power into the PSD target and the same energy into DIFAR east/north/signal
  * accumulators in one tap pass (signed sin/cos weights). Allocation-free. */
 depositBearing(powerOut:Float64Array,eastOut:Float64Array,northOut:Float64Array,signalOut:Float64Array,bin:number,power:number,sinB:number,cosB:number):void{
  if(!Number.isFinite(bin)||!Number.isFinite(power)||power<=0||bin<0||bin>powerOut.length-1)return;
  let center=Math.floor(bin),phase=Math.round((bin-center)*PHASES);if(phase===PHASES){center++;phase=0;}
  const start=center-this.radius,base=phase*this.taps;let sum=0;for(let j=0;j<this.taps;j++)if(start+j>=0&&start+j<powerOut.length)sum+=this.weights[base+j];if(sum<=0)return;
  const scale=power/sum;for(let j=0;j<this.taps;j++){const i=start+j;if(i<0||i>=powerOut.length)continue;const w=scale*this.weights[base+j];powerOut[i]+=w;signalOut[i]+=w;eastOut[i]+=w*sinB;northOut[i]+=w*cosB;}
 }
}
const kernels=new Map<string,LineKernel>();
/** Configuration-time cache shared by all buoy renderers. */
export function lineKernel(width:LineWidth='discrete',sigmaBins=2.5):LineKernel{const key=width==='discrete'?'discrete':`diffuse:${sigmaBins}`;let k=kernels.get(key);if(!k){k=new LineKernel(width,sigmaBins);kernels.set(key,k);}return k;}
