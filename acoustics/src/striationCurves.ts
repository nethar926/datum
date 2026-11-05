/** Urick/Jensen far-field Lloyd null curves, f_n(t)=n*c*r(t)/(2*zs*zr).
 * Absolute lengths metres, speed m/s, time sim seconds, output Hz. No allocation.
 * Relative mode uses depthRatio=rCPA/zs and speedOverRange=speed/rCPA (s^-1);
 * it never infers an absolute source depth from an unscaled spacing fit. */
export interface StriationParams {rCPA:number;speed:number;tCPA:number;zs:number;zr:number;c?:number}
export interface RelativeStriationParams {basis:'none';depthRatio:number;speedOverRange:number;tCPA:number;zr:number;c?:number}
export function striationCurves(p:StriationParams,nMax:number,tS:Float64Array|Float32Array|readonly number[],out:Float32Array):Float32Array;
export function striationCurves(p:RelativeStriationParams,nMax:number,tS:Float64Array|Float32Array|readonly number[],out:Float32Array):Float32Array;
export function striationCurves(p:StriationParams|RelativeStriationParams,nMax:number,tS:Float64Array|Float32Array|readonly number[],out:Float32Array):Float32Array {
 if(!Number.isInteger(nMax)||nMax<0)throw new RangeError('nMax must be a nonnegative integer');
 const count=nMax*tS.length;if(!Number.isSafeInteger(count)||out.length<count)throw new RangeError('Striation output too short');
 if(!p||typeof p!=='object'){out.fill(NaN,0,count);return out;}
 const c=p.c??1500,relative='depthRatio' in p;
 let valid=Number.isFinite(c)&&c>0&&Number.isFinite(p.tCPA)&&Number.isFinite(p.zr)&&p.zr>0;
 if(relative)valid=valid&&p.basis==='none'&&Number.isFinite(p.depthRatio)&&p.depthRatio>0&&Number.isFinite(p.speedOverRange)&&p.speedOverRange>=0;
 else valid=valid&&Number.isFinite(p.rCPA)&&p.rCPA>=0&&Number.isFinite(p.speed)&&p.speed>=0&&Number.isFinite(p.zs)&&p.zs>0;
 if(!valid){out.fill(NaN,0,count);return out;}
 for(let i=0;i<tS.length;i++){
  const dt=tS[i]-p.tCPA,r=relative?p.depthRatio*Math.hypot(1,p.speedOverRange*dt):Math.hypot(p.rCPA,p.speed*dt),base=relative?c*r/(2*p.zr):c*r/(2*p.zs*p.zr);
  for(let n=1;n<=nMax;n++){const f=n*base;out[(n-1)*tS.length+i]=Number.isFinite(tS[i])&&Number.isFinite(f)&&f<=3.4028234663852886e38?f:NaN;}
 }return out;
}
