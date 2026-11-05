/** Public moving-source CPA Doppler curve, Urick. Assumes stationary receiver,
 * one constant source tone/speed and straight-line pass; not a tracker/classifier. */
export interface DopplerSample {tS:number;fHz:number}
export interface CpaFit {ok:boolean;f0:number;speed:number;tCPA:number;rCPA:number;residualRms:number}
export function fitCpaFromDoppler(samples:readonly DopplerSample[],opts:{c?:number;maxSpeed?:number}={}):CpaFit {
 const bad=():CpaFit=>({ok:false,f0:NaN,speed:NaN,tCPA:NaN,rCPA:NaN,residualRms:NaN}),c=opts.c??1500,maxSpeed=opts.maxSpeed??100;
 if(samples.length<5||!Number.isFinite(c)||c<=0||!Number.isFinite(maxSpeed)||maxSpeed<=0||samples.some(s=>!Number.isFinite(s.tS)||!Number.isFinite(s.fHz)||s.fHz<=0))return bad();
 let min=Infinity,max=-Infinity,minF=Infinity,maxF=-Infinity;for(const s of samples){min=Math.min(min,s.tS);max=Math.max(max,s.tS);minF=Math.min(minF,s.fHz);maxF=Math.max(maxF,s.fHz);}const span=max-min;if(span<=0||maxF-minF<1e-8*Math.max(1,maxF))return bad();
 let best=Infinity,bestT=(min+max)/2,bestL=0,bestA=0,bestB=0;
 const score=(t:number,logTau:number):void=>{const tau=Math.exp(logTau);let sx=0,sy=0,sxx=0,sxy=0;for(const s of samples){const u=s.tS-t,x=u/Math.hypot(tau,u),y=1/s.fHz;sx+=x;sy+=y;sxx+=x*x;sxy+=x*y;}const n=samples.length,den=n*sxx-sx*sx;if(den<1e-12)return;const B=(n*sxy-sx*sy)/den,A=(sy-B*sx)/n,v=c*B/A;if(A<=0||v<=0||v>maxSpeed)return;let e=0;for(const s of samples){const u=s.tS-t,f=1/(A+B*u/Math.hypot(tau,u));e+=(f-s.fHz)**2;}if(e<best){best=e;bestT=t;bestL=logTau;bestA=A;bestB=B;}};
 const low=Math.log(span*.01),high=Math.log(span*5);for(let i=0;i<=32;i++)for(let j=0;j<=32;j++)score(min-span*.5+i*span/16,low+j*(high-low)/32);
 if(!Number.isFinite(best))return bad();let dt=span/16,dl=(high-low)/32;
 for(let k=0;k<22;k++){const t=bestT,l=bestL;for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++)score(t+i*dt,l+j*dl);dt*=.5;dl*=.5;}
 const f0=1/bestA,speed=c*bestB/bestA,residualRms=Math.sqrt(best/samples.length),rCPA=speed*Math.exp(bestL);
 return {ok:Number.isFinite(rCPA)&&residualRms<Math.max(.05,f0*.003),f0,speed,tCPA:bestT,rCPA,residualRms};
}
