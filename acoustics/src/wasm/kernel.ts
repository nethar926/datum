/** WASM SIMD broadband+Lloyd prototype loader. Default OFF — JS fast path remains production default.
 * Loading: inline base64 of broadband_lloyd.wasm (committed); Vite resolves this TS module with no
 * extra asset plugin. Feature-detect via WebAssembly.validate on a tiny SIMD module; fall back to
 * JS on failure. Memory: linear buffer reused across ticks (tables + outputs); copy-in/out timed. */
import {BROADBAND_LLOYD_WASM_BASE64} from './broadband_lloyd_b64.js';

export type ResKernel='js'|'wasm';
let KERNEL:ResKernel='js';
export function setResKernel(k:ResKernel):void{KERNEL=k;}
export function resKernel():ResKernel{return KERNEL;}

function simdProbeBytes():Uint8Array{
  return Uint8Array.from([
    0x00,0x61,0x73,0x6d,0x01,0x00,0x00,0x00,0x01,0x05,0x01,0x60,0x00,0x01,0x7b,0x03,0x02,0x01,0x00,
    0x07,0x05,0x01,0x01,0x70,0x00,0x00,0x0a,0x0f,0x01,0x0d,0x00,0x44,0x00,0x00,0x00,0x00,0x00,0x00,0xf0,0x3f,0xfd,0x14,0x0b
  ]);
}

let simdSupported:boolean|null=null;
export function wasmSimdSupported():boolean{
  if(simdSupported!==null)return simdSupported;
  try{simdSupported=typeof WebAssembly!=='undefined'&&WebAssembly.validate(simdProbeBytes() as BufferSource);}
  catch{simdSupported=false;}
  return !!simdSupported;
}

export interface WasmKernelStats{
  instantiateMs:number;copyInMs:number;kernelMs:number;copyOutMs:number;
  linearMemoryBytes:number;calls:number;fallback:'none'|'no-simd'|'instantiate'|'error';
}
const stats:WasmKernelStats={instantiateMs:0,copyInMs:0,kernelMs:0,copyOutMs:0,linearMemoryBytes:0,calls:0,fallback:'none'};
export function wasmKernelStats():WasmKernelStats{return {...stats};}
export function resetWasmKernelStats():void{Object.assign(stats,{instantiateMs:0,copyInMs:0,kernelMs:0,copyOutMs:0,calls:0,fallback:'none'});}

type Exports={memory:WebAssembly.Memory;processContact:(...a:number[])=>void};
let exportsRef:Exports|null=null;
let initPromise:Promise<boolean>|null=null;

function b64ToU8(b64:string):Uint8Array{
  if(typeof Buffer!=='undefined')return new Uint8Array(Buffer.from(b64,'base64'));
  const bin=atob(b64);const u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i)!;return u;
}

export async function ensureWasmKernel():Promise<boolean>{
  if(exportsRef)return true;
  if(initPromise)return initPromise;
  initPromise=(async()=>{
    if(!wasmSimdSupported()){stats.fallback='no-simd';return false;}
    const t0=performance.now();
    try{
      const bytes=b64ToU8(BROADBAND_LLOYD_WASM_BASE64);
      const inst=await WebAssembly.instantiate(bytes,{});
      const ex=('instance' in inst?(inst as unknown as WebAssembly.WebAssemblyInstantiatedSource).instance:inst as WebAssembly.Instance).exports as unknown as Exports;
      exportsRef=ex;
      stats.instantiateMs=performance.now()-t0;
      stats.linearMemoryBytes=ex.memory.buffer.byteLength;
      return true;
    }catch{
      stats.fallback='instantiate';stats.instantiateMs=performance.now()-t0;exportsRef=null;return false;
    }
  })();
  return initPromise;
}

export function wasmKernelReady():boolean{return !!exportsRef;}

const HDR=32;
let capBins=0;
let ptrSe=0,ptrAbs=0,ptrCoh=0,ptrP=0,ptrE=0,ptrN=0,ptrAb=0;
let tablesKey='';

function ensureCapacity(L:number):void{
  const need=HDR+L*7;
  const bytes=need*8;
  const mem=exportsRef!.memory;
  while(mem.buffer.byteLength<bytes)mem.grow(1);
  stats.linearMemoryBytes=mem.buffer.byteLength;
  if(L<=capBins)return;
  capBins=L;
  let o=HDR;
  ptrSe=o;o+=L;ptrAbs=o;o+=L;ptrCoh=o;o+=L;ptrP=o;o+=L;ptrE=o;o+=L;ptrN=o;o+=L;ptrAb=o;
}

export function wasmUploadTables(key:string,se:Float64Array,absE:Float64Array,cohE:Float64Array,L:number):void{
  if(!exportsRef)return;
  ensureCapacity(L);
  if(tablesKey===key)return;
  const t0=performance.now();
  const f64=new Float64Array(exportsRef.memory.buffer);
  f64.set(se.subarray(0,L),ptrSe);
  f64.set(absE.subarray(0,L),ptrAbs);
  f64.set(cohE.subarray(0,L),ptrCoh);
  tablesKey=key;
  stats.copyInMs+=performance.now()-t0;
}

export function wasmClearOutputs(L:number,difar:boolean):void{
  if(!exportsRef)return;
  const f64=new Float64Array(exportsRef.memory.buffer);
  f64.fill(0,ptrP,ptrP+L);
  if(difar){f64.fill(0,ptrE,ptrE+L);f64.fill(0,ptrN,ptrN+L);}
}

export function wasmProcessContact(opts:{
  L:number;difar:boolean;coh:boolean;keepAb:boolean;
  broadband:number;flow:number;q:number;km:number;grazing2:number;
  phase:number;step:number;sinB:number;cosB:number;
}):void{
  if(!exportsRef)return;
  const t0=performance.now();
  exportsRef.processContact(
    opts.L,opts.difar?1:0,opts.coh?1:0,
    ptrSe*8,ptrAbs*8,ptrCoh*8,ptrP*8,ptrE*8,ptrN*8,ptrAb*8,
    opts.broadband,opts.flow,opts.q,opts.km,opts.grazing2,
    opts.phase,opts.step,opts.sinB,opts.cosB,opts.keepAb?1:0
  );
  stats.kernelMs+=performance.now()-t0;stats.calls++;
}

export function wasmCopyOutputs(P:Float64Array,sE:Float64Array,sN:Float64Array,AB:Float64Array,L:number,difar:boolean,keepAb:boolean):void{
  if(!exportsRef)return;
  const t0=performance.now();
  const f64=new Float64Array(exportsRef.memory.buffer);
  P.set(f64.subarray(ptrP,ptrP+L));
  if(difar){sE.set(f64.subarray(ptrE,ptrE+L));sN.set(f64.subarray(ptrN,ptrN+L));}
  if(keepAb)AB.set(f64.subarray(ptrAb,ptrAb+L));
  stats.copyOutMs+=performance.now()-t0;
}
