/** Cold-store history quantization (dB domain). Used by precision bench + FE history candidate. */
export const UINT8_SPAN_DB=80;
export const UINT8_FLOOR_DB=40;

/** Round-to-nearest-even IEEE-754 binary16 (Math.f16round when available). */
export function f16round(x:number):number{
 if(typeof Math.f16round==='function')return Math.f16round(x);
 if(!Number.isFinite(x))return x;
 const sign=x<0||Object.is(x,-0)?-1:1;let ax=Math.abs(x);
 if(ax>65504)return sign*Infinity;
 if(ax<6.103515625e-5){
  const half=Math.pow(2,-24);
  if(ax<half/2)return sign*0;
  const scaled=ax/Math.pow(2,-24);
  const tie=Math.abs(scaled-Math.floor(scaled)-0.5)<1e-15;
  let n=tie?(Math.floor(scaled)%2===0?Math.floor(scaled):Math.ceil(scaled)):Math.round(scaled);
  return sign*n*Math.pow(2,-24);
 }
 const exp=Math.floor(Math.log2(ax));
 const e=Math.min(15,Math.max(-14,exp));
 const frac=ax/Math.pow(2,e);
 const mant=(frac-1)*1024;
 let m=Math.round(mant);
 if(Math.abs(mant-Math.floor(mant)-0.5)<1e-12){const flo=Math.floor(mant);m=flo%2===0?flo:flo+1;}
 if(m===1024)return sign*Math.pow(2,e+1);
 return sign*(1+m/1024)*Math.pow(2,e);
}

export function quantizeFloat16Db(row:Float32Array|Float64Array,out?:Float32Array):Float32Array{
 const o=out??new Float32Array(row.length);
 for(let i=0;i<row.length;i++)o[i]=f16round(row[i]);
 return o;
}

/** Uint8 over [floor, floor+span] dB; decode back to dB (cold→hot page-in). */
export function quantizeUint8Db(row:Float32Array|Float64Array,floorDb=UINT8_FLOOR_DB,spanDb=UINT8_SPAN_DB,out?:Float32Array):Float32Array{
 const o=out??new Float32Array(row.length);
 for(let i=0;i<row.length;i++){
  const u=Math.max(0,Math.min(255,Math.round((row[i]-floorDb)*(255/spanDb))));
  o[i]=floorDb+u*(spanDb/255);
 }
 return o;
}

/** Float16 of LINEAR power (from dB). Documents overflow — do not use for history. */
export function quantizeFloat16Linear(row:Float32Array|Float64Array):{out:Float32Array;overflows:number;underflows:number;maxLin:number}{
 const o=new Float32Array(row.length);let overflows=0,underflows=0,maxLin=0;
 for(let i=0;i<row.length;i++){
  const lin=Math.pow(10,row[i]/10);
  if(lin>maxLin)maxLin=lin;
  const q=f16round(lin);
  if(!Number.isFinite(q)||q===Infinity){overflows++;o[i]=row[i];continue;}
  if(q===0&&lin>0){underflows++;o[i]=-Infinity;continue;}
  o[i]=10*Math.log10(Math.max(q,1e-30));
 }
 return {out:o,overflows,underflows,maxLin};
}
