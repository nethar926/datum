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
  const start=center-this.radius,base=phase*this.taps,taps=this.taps,wts=this.weights,len=out.length;
  // Interior: kernel fully in-bounds; constructor normalized Σw=1 → single pass, no renormalize.
  if(start>=0&&start+taps<=len){for(let j=0;j<taps;j++)out[start+j]+=power*wts[base+j];return;}
  let sum=0;for(let j=0;j<taps;j++){const i=start+j;if(i>=0&&i<len)sum+=wts[base+j];}if(sum<=0)return;
  const scale=power/sum;for(let j=0;j<taps;j++){const i=start+j;if(i>=0&&i<len)out[i]+=scale*wts[base+j];}
 }
 /** Deposit tonal power into the PSD target and the same energy into DIFAR east/north/signal
  * accumulators in one tap pass (signed sin/cos weights). Allocation-free. */
 depositBearing(powerOut:Float64Array,eastOut:Float64Array,northOut:Float64Array,signalOut:Float64Array,bin:number,power:number,sinB:number,cosB:number):void{
  if(!Number.isFinite(bin)||!Number.isFinite(power)||power<=0||bin<0||bin>powerOut.length-1)return;
  let center=Math.floor(bin),phase=Math.round((bin-center)*PHASES);if(phase===PHASES){center++;phase=0;}
  const start=center-this.radius,base=phase*this.taps,taps=this.taps,wts=this.weights,len=powerOut.length;
  if(start>=0&&start+taps<=len){
   // Hot: discrete taps=9; still loop (engines vary) but no bounds/renorm.
   let j=0;for(;j+3<taps;j+=4){
    let i=start+j,w=power*wts[base+j];powerOut[i]+=w;signalOut[i]+=w;eastOut[i]+=w*sinB;northOut[i]+=w*cosB;
    i=start+j+1;w=power*wts[base+j+1];powerOut[i]+=w;signalOut[i]+=w;eastOut[i]+=w*sinB;northOut[i]+=w*cosB;
    i=start+j+2;w=power*wts[base+j+2];powerOut[i]+=w;signalOut[i]+=w;eastOut[i]+=w*sinB;northOut[i]+=w*cosB;
    i=start+j+3;w=power*wts[base+j+3];powerOut[i]+=w;signalOut[i]+=w;eastOut[i]+=w*sinB;northOut[i]+=w*cosB;
   }
   for(;j<taps;j++){const i=start+j,w=power*wts[base+j];powerOut[i]+=w;signalOut[i]+=w;eastOut[i]+=w*sinB;northOut[i]+=w*cosB;}
   return;
  }
  let sum=0;for(let j=0;j<taps;j++){const i=start+j;if(i>=0&&i<len)sum+=wts[base+j];}if(sum<=0)return;
  const scale=power/sum;for(let j=0;j<taps;j++){const i=start+j;if(i<0||i>=len)continue;const w=scale*wts[base+j];powerOut[i]+=w;signalOut[i]+=w;eastOut[i]+=w*sinB;northOut[i]+=w*cosB;}
 }
}
const kernels=new Map<string,LineKernel>();
/** Configuration-time cache shared by all buoy renderers. */
export function lineKernel(width:LineWidth='discrete',sigmaBins=2.5):LineKernel{const key=width==='discrete'?'discrete':`diffuse:${sigmaBins}`;let k=kernels.get(key);if(!k){k=new LineKernel(width,sigmaBins);kernels.set(key,k);}return k;}
/** Continuous-limit Hann amplitude response at x bins (Harris 1978): sin(πx)/(πx(1−x²)), peak 1.
 * |W(±0.5)|² = 0.7205 (−1.42 dB scallop); Σ_k |W(k−x)|² = 1.5 (ENBW) for any fractional x. */
export function hannAmplitude(x:number):number{const ax=Math.abs(x);if(ax<1e-9)return 1;if(Math.abs(ax-1)<1e-9)return .5;return Math.sin(Math.PI*x)/(Math.PI*x*(1-x*x));}
/** RES-mode discrete tonal: peak-normalized Hann main lobe (|x|<2 bins) so a tone of power v reads
 * v·|W(x)|² in each bin of the current RES grid (bin spacing Δf). Bins at or beyond `limit` (dead,
 * above fmax) are skipped. DIFAR accumulators get the same energy weighted by sin/cos bearing. */
export function depositHannLine(powerOut:Float64Array,limit:number,bin:number,power:number,difar:boolean,eastOut:Float64Array,northOut:Float64Array,signalOut:Float64Array,sinB:number,cosB:number):void{
 if(!Number.isFinite(bin)||!Number.isFinite(power)||power<=0)return;
 const lo=Math.max(0,Math.ceil(bin-2+1e-9)),hi=Math.min(limit-1,Math.floor(bin+2-1e-9));
 for(let i=lo;i<=hi;i++){const a=hannAmplitude(i-bin),w=power*a*a;powerOut[i]+=w;if(difar){signalOut[i]+=w;eastOut[i]+=w*sinB;northOut[i]+=w*cosB;}}
}
/** RES-mode diffuse line: Gaussian in bins (σ_eff=√(σ²+0.6²), 0.6 ≈ Hann power main-lobe σ) whose
 * full-grid sum is the Hann ENBW (1.5) so diffuse and discrete lines of equal power agree in BB.
 * Gaussian evaluated by an allocation-free multiplicative recurrence. */
export function depositGaussianLine(powerOut:Float64Array,limit:number,bin:number,power:number,sigmaBins:number,difar:boolean,eastOut:Float64Array,northOut:Float64Array,signalOut:Float64Array,sinB:number,cosB:number):void{
 if(!Number.isFinite(bin)||!Number.isFinite(power)||power<=0)return;
 const s=Math.sqrt(sigmaBins*sigmaBins+.36),r=Math.ceil(4*s),c=Math.round(bin),start=c-r,inv=1/(2*s*s);
 // weights w_j = exp(-(j-bin)²/2s²), j=start..c+r; ratio w_{j+1}/w_j = exp(-(2(j-bin)+1)/2s²)
 let x=start-bin,w=Math.exp(-x*x*inv),q=Math.exp(-(2*x+1)*inv);const qq=Math.exp(-2*inv);let total=0;
 for(let j=start;j<=c+r;j++){total+=w;w*=q;q*=qq;}
 if(!(total>0))return;const scale=HANN_ENBW*power/total;
 x=start-bin;w=Math.exp(-x*x*inv);q=Math.exp(-(2*x+1)*inv);
 for(let j=start;j<=c+r;j++){if(j>=0&&j<limit){const v=scale*w;powerOut[j]+=v;if(difar){signalOut[j]+=v;eastOut[j]+=v*sinB;northOut[j]+=v*cosB;}}w*=q;q*=qq;}
}
const HANN_ENBW=1.5;
