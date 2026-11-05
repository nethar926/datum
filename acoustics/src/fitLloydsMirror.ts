/** Public far-field Lloyd spacing fit: df(t)=c r(t)/(2 zs zr), Urick/Jensen.
 * Absolute depth is NOT identifiable without an independent range/velocity basis. */
export interface LloydSpacingSample {simT:number;spacingHz:number}
export interface LegacyLloydRangeSource {kind:'cpaFit'|'manual';rCpaM:number;speedMps:number;tCpa?:number}
export interface LloydRangeSource {kind:'cpaFit'|'manual';rCPA:number;speed:number;tCPA?:number}
export interface LloydFitOptions {zrM?:number;zr?:number;cMps?:number;c?:number;rangeSource?:LloydRangeSource|LegacyLloydRangeSource|'none'|null;basis?:LloydRangeSource|LegacyLloydRangeSource|'none'|null}
export interface LloydFit {ok:boolean;basis:'cpaFit'|'manual'|'none';zs:number;depthRatio:number;rCPA:number;speed:number;tCPA:number;residualRms:number}
export function fitLloydsMirror(inputSamples:readonly (LloydSpacingSample|{tS:number;fHz:number})[],opts:LloydFitOptions):LloydFit {
 const samples=inputSamples.map(s=>'simT' in s?s:{simT:s.tS,spacingHz:s.fHz}),input=opts.basis??opts.rangeSource,raw=input&&input!=='none'?input:undefined,source=raw?('rCPA' in raw?{kind:raw.kind,rCpaM:raw.rCPA,speedMps:raw.speed,tCpa:raw.tCPA}:raw):undefined,basis=source?.kind??'none',zr=opts.zrM??opts.zr??40;
 const bad=():LloydFit=>({ok:false,basis,zs:NaN,depthRatio:NaN,rCPA:source?.rCpaM??NaN,speed:source?.speedMps??NaN,tCPA:NaN,residualRms:NaN}),c=opts.cMps??opts.c??1500;
 if(samples.length<3||!Number.isFinite(zr)||zr<=0||!Number.isFinite(c)||c<=0||samples.some(s=>!Number.isFinite(s.simT)||!Number.isFinite(s.spacingHz)||s.spacingHz<=0))return bad();
 const center=samples.reduce((n,s)=>n+s.simT,0)/samples.length,scale=Math.max(1,...samples.map(s=>Math.abs(s.simT-center)));
 // Least squares spacing² = a*u²+b*u+d; tiny pivoted 3x3 solve, analysis path only.
 const m=[[0,0,0,0],[0,0,0,0],[0,0,0,0]];
 for(const s of samples){const u=(s.simT-center)/scale,x=[u*u,u,1],y=s.spacingHz*s.spacingHz;for(let i=0;i<3;i++){for(let j=0;j<3;j++)m[i][j]+=x[i]*x[j];m[i][3]+=x[i]*y;}}
 for(let i=0;i<3;i++){let pivot=i;for(let j=i+1;j<3;j++)if(Math.abs(m[j][i])>Math.abs(m[pivot][i]))pivot=j;[m[pivot],m[i]]=[m[i],m[pivot]];if(Math.abs(m[i][i])<1e-12)return bad();const v=m[i][i];for(let j=i;j<4;j++)m[i][j]/=v;for(let k=0;k<3;k++)if(k!==i){const q=m[k][i];for(let j=i;j<4;j++)m[k][j]-=q*m[i][j];}}
 const a=m[0][3],b=m[1][3],d=m[2][3];let tCpa=a>1e-12?center-scale*b/(2*a):center,K=Math.sqrt(Math.max(0,a>1e-12?d-b*b/(4*a):d));
 if(source){if(!['manual','cpaFit'].includes(source.kind)||!Number.isFinite(source.rCpaM)||source.rCpaM<=0||!Number.isFinite(source.speedMps)||source.speedMps<0||(source.tCpa!==undefined&&!Number.isFinite(source.tCpa)))return bad();tCpa=source.tCpa??tCpa;let xy=0,xx=0;for(const s of samples){const q=Math.hypot(1,source.speedMps*(s.simT-tCpa)/source.rCpaM);xy+=q*s.spacingHz;xx+=q*q;}K=xy/xx;}
 let error=0;for(const s of samples){const u=(s.simT-center)/scale,predicted=source?K*Math.hypot(1,source.speedMps*(s.simT-tCpa)/source.rCpaM):Math.sqrt(Math.max(0,a*u*u+b*u+d));error+=(predicted-s.spacingHz)**2;}
 const rmsHz=Math.sqrt(error/samples.length),depthRatio=2*zr*K/c,ok=depthRatio>0&&Number.isFinite(depthRatio)&&rmsHz/Math.max(1e-12,K)<.1&&(source!==undefined||a>=-1e-9);
 return {ok,basis,zs:source&&ok?source.rCpaM/depthRatio:NaN,depthRatio,rCPA:source?.rCpaM??NaN,speed:source?.speedMps??NaN,tCPA:tCpa,residualRms:rmsHz};
}
