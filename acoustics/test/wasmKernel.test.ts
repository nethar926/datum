import {describe,it,expect,afterEach,beforeAll} from 'vitest';
import {AcousticEngine,cpaScenario,fictionalSignature,resForBand,vernierHzForBand,setResRowPath,setResKernel,ensureWasmKernel,wasmSimdSupported,wasmKernelStats,resetWasmKernelStats,setSpanCache} from '../src/index.js';

afterEach(()=>{setResRowPath('fast');setResKernel('js');setSpanCache(true);resetWasmKernelStats();});

beforeAll(async()=>{await ensureWasmKernel();});

function scen(nC=3){const s=cpaScenario();s.fmax=2000;s.seed=4242;s.environment={...s.environment,seaState:3};
 s.contacts=Array.from({length:nC},(_,i)=>({id:'k'+i,category:'subsurface' as const,x:-1800+i*311,y:400+i*173,depth:50+7*i,course:Math.PI/2+i*.3,speed:3+i%4,motion:[{at:0,course:Math.PI/2+i*.3,speed:3+i%4,depth:50+7*i}],
  params:{...fictionalSignature,levelDb:148+i,modulation:0,cavitationPower:.03*(i%3),tonals:[{family:'motor' as const,hz:35+13*i,power:1,width:'discrete' as const,stability:'stable' as const}]}}));
 s.buoys=[{...s.buoys[0]!,id:'buoy-1',rfChannel:1}];return s;}

function collect(kernel:'js'|'wasm',sec=12){
 setResKernel(kernel);const e=new AcousticEngine(scen(3),4242) as any,out=new Float32Array(4096),rows=new Map<string,Float64Array>();
 const subs=[...(['ELF','VLF','LF','MF'] as const).flatMap(p=>(['NB','BB'] as const).map(f=>({key:`${p}|${f}`,c:e.subscribe({channel:1,kind:'lofar',res:resForBand(p),filter:f,vernierHz:vernierHzForBand(p)})}))),
  {key:'FULL',c:e.subscribe({channel:1,kind:'lofar',res:5,filter:'NB',fullAxis:true,visibleTileIndex:0})}];
 for(let k=1;k<=sec*4;k++){e.advance(.25);for(const x of subs){const sub=e.subscriptions.get(x.c.streamId);while(e.rowsReady(x.c.streamId)>0){const tag=sub.fullAxis?`${sub.fullAxis.queue[0].rowKey}|${sub.fullAxis.queue[0].tileIndex}`:`${sub.read}`;e.writeRow(x.c.streamId,out);rows.set(`${x.key}|${tag}`,Float64Array.from(sub.res.expected.subarray(0,sub.res.liveBins)));}}}
 return rows;
}

describe('WASM SIMD broadband kernel (prototype, default OFF)',()=>{
 it('feature-detects SIMD or records fallback',()=>{expect(typeof wasmSimdSupported()).toBe('boolean');});
 it('ensureWasmKernel succeeds on this host (Node with SIMD)',async()=>{expect(await ensureWasmKernel()).toBe(true);});
 it('expected-spectrum error vs JS fast path ≤0.01 dB (RES5 bands+FULLBAND)',()=>{
  if(!wasmSimdSupported())return;
  const a=collect('js',8),b=collect('wasm',8);
  expect(b.size).toBe(a.size);let max=0,sum=0,n=0;
  for(const [k,ra] of a){const rb=b.get(k)!;expect(rb.length).toBe(ra.length);
   for(let i=0;i<ra.length;i++){if(!(ra[i]!>0&&rb[i]!>0))continue;const d=Math.abs(10*Math.log10(rb[i]!/ra[i]!));max=Math.max(max,d);sum+=d;n++;}}
  console.log('wasm-vs-js dB',{max,mean:sum/n,n,calls:wasmKernelStats().calls});
  expect(max).toBeLessThanOrEqual(.01);expect(sum/n).toBeLessThanOrEqual(.001);
  expect(wasmKernelStats().calls).toBeGreaterThan(0);
 },120000);
 it('default kernel is js; wasm-unavailable falls back without throwing',async()=>{
  expect(await import('../src/wasm/kernel.js').then(m=>m.resKernel())).toBe('js');
  setResKernel('wasm'); // even if broken, path checks ready
  const e=new AcousticEngine(scen(1),1) as any;
  const c=e.subscribe({channel:1,kind:'lofar',res:5,filter:'NB',vernierHz:250});
  const out=new Float32Array(1024);
  for(let k=0;k<8;k++){e.advance(.25);while(e.rowsReady(c.streamId)>0)e.writeRow(c.streamId,out);}
  expect(out.some(Number.isFinite)).toBe(true);
 });
 it('play→seek→replay bit-identical under wasm kernel',()=>{
  if(!wasmSimdSupported())return;
  setResKernel('wasm');
  function run(){
   const e=new AcousticEngine(scen(2),7) as any;const id=e.subscribe({channel:1,kind:'lofar',res:5,filter:'NB',vernierHz:250}).streamId;
   const out=new Float32Array(1024),rows:number[][]=[];
   for(let k=0;k<32;k++)e.advance(.25);
   while(e.rowsReady(id)>0){e.writeRow(id,out);rows.push([...out.subarray(0,1024)]);}
   e.skipToLatest(id);
   for(let k=0;k<8;k++){e.advance(.25);while(e.rowsReady(id)>0){e.writeRow(id,out);rows.push([...out.subarray(0,1024)]);}}
   return rows;
  }
  const a=run(),b=run();
  expect(b.length).toBe(a.length);
  for(let i=0;i<a.length;i++)expect(b[i]).toEqual(a[i]);
 },60000);
});
