import {gaussian,type Random} from './prng.js';
/** RES 1–9 zoom-FFT LOFAR resolution model (public DSP theory only; no real sensor parameters).
 *
 * Display is always RES_BINS=1024 bins. Δf(n)=0.03125·2^(n−1) Hz, band B=1024·Δf, integration T=1/Δf.
 * Modeled zoom-FFT chain (Lyons, "Understanding DSP", zoom FFT / complex down-conversion):
 * source rate 16384 Hz → complex baseband mix to centre fc → lowpass → decimate to 1.25·B
 * (decimation 16384/(1.25B), non-integer in general) → 1280-pt Hann FFT → keep the centre 1024 bins.
 * Bin k is at fc+(k−512)·Δf, so fc lands exactly on bin 512.
 *
 * Hann window (Harris 1978, Proc. IEEE 66(1) Table I): ENBW 1.5 bins, scallop loss 1.42 dB,
 * overlap correlation 65.9 % (amplitude) at 75 % overlap, 16.7 % at 50 %.
 * Overlap 75 %: hop T/4, row period P=max(2 s, T/4), K=P/(T/4) hop-spaced FFTs averaged per row.
 *
 * Welch (1967, IEEE Trans. Audio Electroacoust. AU-15:70) equivalent degrees of freedom for K
 * averaged segments with power correlation ρ(m)=c(m)² between segments m hops apart
 * (c = Harris amplitude overlap correlation Σw[n]w[n+mD]/Σw[n]²):
 *     ν = 2K / (1 + 2 Σ_{m=1}^{K−1} (1 − m/K) ρ(m))
 * Averaged bin power ~ (S/ν)·χ²_ν, drawn as Gamma(ν/2, scale 2/ν) (Marsaglia & Tsang 2000).
 * When K=1 (RES1–3, P=T/4) consecutive rows are single FFTs 75 % overlapped: their complex bin
 * amplitudes correlate with c(1)=0.659, so powers correlate with c(1)²=0.4345. That case is
 * modelled exactly with an AR(1) complex-Gaussian blend z←c·z+√(1−c²)·e (|z|² stays Exp(1)). */
import type {ResLevel,GramFilter} from './protocol.js';
export interface ResGramSettings {res:ResLevel;filter:GramFilter;vernierHz?:number}
export const RES_BINS=1024,RES_CENTER_BIN=512,RES_SOURCE_RATE_HZ=16384,RES_FFT_POINTS=1280,RES_OVERSAMPLE=1.25,RES_DEFAULT:ResLevel=5,RES_MIN_ROW_PERIOD_S=2;
export const HANN_ENBW_BINS=1.5,HANN_SCALLOP_DB=1.42;
/** Struzinski & Lowe (1984, JASA 76:1738) two-pass split-window (TPSW) background for NB.
 * Window: ±32 bins; centre gap: ±3 bins (covers the ±2-bin Hann main lobe plus one guard bin);
 * pass-1 cells above clipFactor×(pass-1 mean) are replaced by that mean before pass 2.
 * Pass-2 output is divided by the analytic clip bias for the row's χ²_ν noise (tpswBias). */
export const TPSW={halfWindowBins:32,halfGapBins:3,clipFactor:2.5} as const;
/** BB smoothing: 1/24-octave constant-relative-bandwidth window centred on each bin. */
export const BB_SMOOTH_OCTAVE=1/24;
/** Diffuse line widths (sigmaBins) are defined against a 0.5 Hz reference bin (≈ legacy/RES5). */
export const DIFFUSE_REFERENCE_BIN_HZ=.5;
/** Harris amplitude overlap correlation of a periodic N-point Hann at a shift of `fraction`·N. */
export function hannOverlapCorrelation(fraction:number,n=RES_FFT_POINTS):number{
 const d=Math.round(fraction*n);let s=0,s2=0;for(let i=0;i<n;i++){const w=.5-.5*Math.cos(2*Math.PI*i/n);s2+=w*w;if(i+d<n)s+=w*(.5-.5*Math.cos(2*Math.PI*(i+d)/n));}return s2>0?s/s2:0;
}
/** c(1)=0.6592 (75 % overlap), c(2)=0.1667, c(3)=0.0075; zero at ≥4 hops (no overlap). */
export const HANN_OVERLAP_AMPLITUDE=[1,hannOverlapCorrelation(.25),hannOverlapCorrelation(.5),hannOverlapCorrelation(.75)] as const;
export const HANN_75_AMPLITUDE_CORRELATION=HANN_OVERLAP_AMPLITUDE[1];
export const HANN_75_POWER_CORRELATION=HANN_75_AMPLITUDE_CORRELATION**2;
const rho=(m:number):number=>m<4?HANN_OVERLAP_AMPLITUDE[m]**2:0;
/** Welch EDOF for K hop-spaced (T/4) Hann segments, see module comment. */
export function welchEdof(k:number):number{let den=1;for(let m=1;m<k;m++)den+=2*(1-m/k)*rho(m);return 2*k/den;}
/** Correlation of consecutive K-segment averages (rows), from the same ρ(m). K=1 → 0.4345. */
export function welchRowCorrelation(k:number):number{let num=0,den=0;for(let i=0;i<k;i++)for(let j=0;j<k;j++){num+=rho(k+j-i);den+=rho(Math.abs(i-j));}return num/den;}
export interface ResParams {res:ResLevel;fBin:number;bandHz:number;integrationS:number;hopS:number;rowPeriodS:number;rowRateHz:number;averages:number;decimation:number;basebandRateHz:number;enbwHz:number;edof:number;rowCorrelation:number;noise:'ar1-exponential'|'gamma'}
export function isResLevel(v:unknown):v is ResLevel{return typeof v==='number'&&Number.isInteger(v)&&v>=1&&v<=9;}
export function resParams(res:ResLevel):ResParams{
 if(!isResLevel(res))throw new Error('Invalid res (integer 1..9)');
 const fBin=.03125*2**(res-1),bandHz=RES_BINS*fBin,integrationS=1/fBin,hopS=integrationS/4,rowPeriodS=Math.max(RES_MIN_ROW_PERIOD_S,hopS),averages=Math.round(rowPeriodS/hopS),basebandRateHz=RES_OVERSAMPLE*bandHz;
 return {res,fBin,bandHz,integrationS,hopS,rowPeriodS,rowRateHz:1/rowPeriodS,averages,decimation:RES_SOURCE_RATE_HZ/basebandRateHz,basebandRateHz,enbwHz:HANN_ENBW_BINS*fBin,edof:welchEdof(averages),rowCorrelation:welchRowCorrelation(averages),noise:averages===1?'ar1-exponential':'gamma'};
}
export interface ResBand {f0:number;fcHz:number;bandLimited:boolean;liveBins:number;slid:boolean}
/** Vernier placement. No vernier → f0=0. Vernier → f0=fc−512Δf, slid (Δf kept) to stay within
 * [0, fmax]; a band wider than fmax clamps at f0=0 with bins above fmax dead (bandLimited). */
export function resBand(res:ResLevel,vernierHz:number|undefined,fmaxHz:number):ResBand{
 const {fBin}=resParams(res);let f0=0,slid=false;
 if(vernierHz!==undefined){if(!Number.isFinite(vernierHz)||vernierHz<0||vernierHz>1e6)throw new Error('Invalid vernierHz');f0=vernierHz-RES_CENTER_BIN*fBin;if(f0+(RES_BINS-1)*fBin>fmaxHz){f0=fmaxHz-(RES_BINS-1)*fBin;slid=true;}if(f0<0){f0=0;slid=true;}}
 const liveBins=Math.max(1,Math.min(RES_BINS,Math.floor((fmaxHz-f0)/fBin+1e-9)+1));
 return {f0,fcHz:f0+RES_CENTER_BIN*fBin,bandLimited:liveBins<RES_BINS,liveBins,slid};
}
/** Gamma(shape, scale 1/shape): unit-mean χ²_{2·shape}/(2·shape). Marsaglia & Tsang (2000), shape≥1.
 * Allocation-free; consumes a variable but seeded number of draws. */
export function gammaUnit(rng:Random,shape:number):number{
 const d=shape-1/3,c=1/Math.sqrt(9*d);
 for(;;){const x=gaussian(rng),t=1+c*x;if(t<=0)continue;const v=t*t*t,u=Math.max(rng(),1/4294967296);if(u<1-.0331*x*x*x*x||Math.log(u)<.5*x*x+d*(1-v+Math.log(v)))return d*v/shape;}
}
function lnGamma(x:number):number{const g=[676.5203681218851,-1259.1392167224028,771.32342877765313,-176.61502916214059,12.507343278686905,-.13857109526572012,9.9843695780195716e-6,1.5056327351493116e-7];if(x<.5)return Math.log(Math.PI/Math.sin(Math.PI*x))-lnGamma(1-x);x-=1;let a=.99999999999999977;const t=x+7.5;for(let i=0;i<8;i++)a+=g[i]/(x+i+1);return .5*Math.log(2*Math.PI)+(x+.5)*Math.log(t)-t+Math.log(a);}
/** Regularized lower incomplete gamma P(a,x) (Numerical Recipes series / continued fraction). */
export function gammaP(a:number,x:number):number{
 if(x<=0)return 0;const gln=lnGamma(a);
 if(x<a+1){let ap=a,sum=1/a,del=sum;for(let n=0;n<500;n++){ap++;del*=x/ap;sum+=del;if(Math.abs(del)<Math.abs(sum)*1e-15)break;}return sum*Math.exp(-x+a*Math.log(x)-gln);}
 let b=x+1-a,c=1e300,d=1/b,h=d;for(let i=1;i<500;i++){const an=-i*(i-a);b+=2;d=an*d+b;if(Math.abs(d)<1e-300)d=1e-300;c=b+an/c;if(Math.abs(c)<1e-300)c=1e-300;d=1/d;const del=d*c;h*=del;if(Math.abs(del-1)<1e-15)break;}
 return 1-Math.exp(-x+a*Math.log(x)-gln)*h;
}
/** Mean of a unit-mean χ²_ν cell after TPSW clipping at α (replace by mean): E[X;X≤α]+P(X>α)
 * = P(ν/2+1, να/2) + 1 − P(ν/2, να/2). ν=2, α=2.5 → 1−α·e^−α = 0.795 (−1.0 dB). */
export function tpswBias(edof:number,clip:number=TPSW.clipFactor):number{const a=edof/2;return gammaP(a+1,a*clip)+1-gammaP(a,a*clip);}
