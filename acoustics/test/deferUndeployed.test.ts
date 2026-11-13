/** AcousticEngineOptions.deferUndeployed (TS twin of Swift SimEngineOptions.deferUndeployed, DeferUndeployedTests).
 * Same seeded run, skip vs no-skip, both subscribed at t = 0 and drained every tick: the deferred buoy emits nothing
 * before deployedAt and every row it emits afterwards is bit-exact (same row index, same tick) to the default engine.
 * Rows whose integration window straddles deployedAt may differ; they are counted and listed (expected none).
 * Also: on the committed many-32 golden run the deferred engine's rows equal the TS golden row hashes (the Swift
 * DeferUndeployedTests.testDeferredMany32MatchesTSGolden checks the Swift deferred engine against the same hashes). */
import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {AcousticEngine,resParams,setTileAccumBudget,type AcousticEngineOptions} from '../src/index.js';
import type {ResLevel} from '../src/protocol.js';

const golden=JSON.parse(readFileSync(new URL('../../ios/DatumAcoustics/Fixtures/golden/e2e.json',import.meta.url),'utf8'));
const goldenHashes=(()=>{const b=readFileSync(new URL('../../ios/DatumAcoustics/Fixtures/golden/e2e-hashes.bin',import.meta.url));return new Uint16Array(b.buffer,b.byteOffset,b.byteLength/2);})();
const many=golden.runs.find((r:any)=>r.name==='many-32');
/** Exporter rowHash (NaN canonicalised). */
function rowHash(a:Float32Array){const u=new Uint32Array(a.buffer,a.byteOffset,a.length);let h=0x811c9dc5;for(let i=0;i<a.length;i++){const v=Number.isNaN(a[i])?0x7fc00000:u[i];h^=v;h=Math.imul(h,0x01000193)>>>0;}return h>>>0;}
/** Swift/TS parity pin: chains of the deferred rows (Swift DeferUndeployedTests.tsDigest asserts the same table). */
const DIGEST:Record<string,number>={'RES1 NB':1036205115,'RES2 NB':503211430,'RES3 NB':1935425923,'RES5 NB':4260436442,'RES7 NB':1580845402,'RES9 NB':405046596,'RES3 BB FULLBAND':1193319322,'RES5 BB FULLBAND':1343046509,'RES5 vernier 300':667203418,'LOFAR':4238430556,'DEMON':216088475,'buoy-1 RES5 NB (deployed at 0)':2418889051};
type Spec={name:string;sub:(e:AcousticEngine)=>number;window:number};
const resWin=(r:number)=>{const p=resParams(r as ResLevel);return p.integrationS+(p.averages-1)*p.hopS+p.rowPeriodS;};
const res=(name:string,req:Record<string,unknown>,r:number):Spec=>({name,window:resWin(r),sub:e=>(e.subscribe({kind:'lofar',...req} as any) as any).streamId});
type Row={t:number;bits:Uint32Array;hash:number};

/** Run one engine to the end, draining every stream every tick (exporter loop). Fresh module RES scratch per run. */
function run(make:(o:AcousticEngineOptions)=>AcousticEngine,o:AcousticEngineOptions,specs:Spec[],steps:number,dt:number){
  setTileAccumBudget(Math.floor(3.2*1024*1024));
  const e=make(o),ids=specs.map(s=>s.sub(e)),rows=specs.map(()=>new Map<number,Row>());
  const bufs=ids.map(id=>new Float32Array(e.configs().find(c=>c.streamId===id)?.bins??512));
  for(let k=0;k<steps;k++){e.advance(dt);for(let j=0;j<ids.length;j++){while(e.rowsReady(ids[j])>0){const i=e.writeRow(ids[j],bufs[j],0);if(i<0)break;rows[j].set(i,{t:e.time,bits:new Uint32Array(new Float32Array(bufs[j]).buffer),hash:rowHash(bufs[j])});}}}
  return {e,rows};
}
function compare(specs:Spec[],a:Map<number,Row>[],b:Map<number,Row>[],dropAt:number,deferred:(k:number)=>boolean){
  let straddle=0;const lines:string[]=[];
  for(let k=0;k<specs.length;k++){
    const name=specs[k].name,diffs:number[]=[];let beyond=0,aboardNaN=0;
    expect(a[k].size,`${name}: no rows after deployment`).toBeGreaterThan(0);
    for(const [i,r] of a[k]){
      if(deferred(k))expect(r.t,`${name}: row ${i} before deployedAt`).toBeGreaterThanOrEqual(dropAt);
      const o=b[k].get(i);expect(o,`${name}: row ${i} missing in the no-skip engine`).toBeDefined();if(!o)continue;
      expect(o.t,`${name} row ${i} drained at a different tick`).toBe(r.t);
      const same=o.bits.length===r.bits.length&&o.bits.every((v,q)=>v===r.bits[q]);
      if(!same){if(r.t-dropAt<specs[k].window)diffs.push(i);else beyond++;}
    }
    for(const [i,o] of b[k]){if(o.t<dropAt&&deferred(k)){aboardNaN++;expect(Array.from(new Float32Array(o.bits.buffer)).every(Number.isNaN),`${name}: aboard row ${i} not NaN`).toBe(true);}
      else expect(a[k].has(i),`${name}: post-deploy row ${i} missing with skip`).toBe(true);}
    expect(beyond,`${name}: rows differ beyond the straddle window`).toBe(0);
    if(!deferred(k))expect(a[k].size).toBe(b[k].size);
    straddle+=diffs.length;
    lines.push(`TS-DEFER-UNDEPLOYED ${name}: rows ${a[k].size} bit-exact ${a[k].size-diffs.length} straddle-diff ${diffs.length} [${diffs.sort((x,y)=>x-y)}] aboard-skipped(NaN in no-skip) ${aboardNaN} window ${specs[k].window} s`);
  }
  console.log(lines.join('\n'));return straddle;
}

describe('deferUndeployed (opt-in, default off; Swift DeferUndeployedTests twin)',()=>{
  it('default off: options and NaN aboard rows unchanged',()=>{
    const e=new AcousticEngine(structuredClone(many.scenario),many.seed);expect(e.options.deferUndeployed).toBe(false);
    const id=(e.subscribe({channel:4,kind:'lofar',res:9,filter:'NB'}) as any).streamId,buf=new Float32Array(1024);let aboard=0;
    for(let k=0;k<16;k++){e.advance(.25);while(e.rowsReady(id)>0){e.writeRow(id,buf);if(Array.from(buf).every(Number.isNaN))aboard++;}}
    expect(aboard).toBeGreaterThan(0);expect(e.aboardRowsSkipped).toBe(0);
  });

  it('Swift DeferUndeployedTests scenario: rows from deployedAt bit-exact on RES1-9 NB, FULLBAND RES3/5, vernier, LOFAR, DEMON',()=>{
    const dropAt=13.3;
    const make=(o:AcousticEngineOptions)=>{const sc=structuredClone(many.scenario);sc.contacts=sc.contacts.slice(0,3);sc.time=0;const t=sc.buoys[0];
      sc.buoys=[{id:'buoy-1',type:t.type,x:0,y:0,depth:t.depth,course:0,speed:0,rfChannel:1,deployedAt:0,life:1e6},{id:'buoy-2',type:t.type,x:2500,y:400,depth:t.depth,course:0,speed:0,rfChannel:2,deployedAt:dropAt,life:1e6}];
      return new AcousticEngine(sc,many.seed,o);};
    const specs:Spec[]=[...[1,2,3,5,7,9].map(r=>res(`RES${r} NB`,{channel:2,res:r,filter:'NB'},r)),...[3,5].map(r=>res(`RES${r} BB FULLBAND`,{channel:2,res:r,filter:'BB',fullAxis:true},r)),
      res('RES5 vernier 300',{channel:2,res:5,filter:'NB',vernierHz:300},5),{name:'LOFAR',window:1,sub:e=>(e.subscribe({channel:2,kind:'lofar'}) as any).streamId},
      {name:'DEMON',window:1,sub:e=>e.subscribe({kind:'demon',buoyId:2})},res('buoy-1 RES5 NB (deployed at 0)',{channel:1,res:5,filter:'NB'},5)];
    const steps=Math.ceil((dropAt+72)/.25);
    const A=run(make,{deferUndeployed:true},specs,steps,.25),B=run(make,{},specs,steps,.25);
    const straddle=compare(specs,A.rows,B.rows,dropAt,k=>k<specs.length-1);
    // Cross-language digest (Swift DeferUndeployedTests prints the same DEFER-DIGEST lines).
    console.log(specs.map((sp,k)=>{const ks=[...A.rows[k].keys()].sort((x,y)=>x-y);let h=0x811c9dc5;for(const i of ks){const v=A.rows[k].get(i)!.hash;for(let q=0;q<4;q++){h^=(v>>>(8*q))&0xff;h=Math.imul(h,0x01000193)>>>0;}}expect(h>>>0,`${sp.name}: DEFER-DIGEST vs Swift`).toBe(DIGEST[sp.name]);return `TS-DEFER-DIGEST ${sp.name} rows ${ks.length} first ${ks[0]??-1} chain ${h>>>0}`;}).join('\n'));
    console.log(`TS-DEFER-UNDEPLOYED total straddle-diff rows ${straddle}, aboardRowsSkipped ${A.e.aboardRowsSkipped}`);
    expect(A.e.aboardRowsSkipped).toBeGreaterThan(0);expect(B.e.aboardRowsSkipped).toBe(0);
  },600000);

  it('many-32 golden run (buoy-4 deploys at 20 s): deferred rows = no-skip rows = committed TS golden row hashes',()=>{
    const dropAt=20,steps=Number(process.env.DEFER_MANY32_STEPS??200);
    const specs:Spec[]=many.streams.map((g:any,k:number)=>{const sp=g.spec;const name=`${k} ${JSON.stringify(sp)}`;
      if(sp.kind==='lofar')return {name,window:1,sub:(e:AcousticEngine)=>(e.subscribe({channel:sp.channel,kind:'lofar'}) as any).streamId};
      if(sp.kind==='demon')return {name,window:1,sub:(e:AcousticEngine)=>e.subscribe({kind:'demon',buoyId:sp.buoyId,band:sp.band})};
      const {kind:_k,...req}=sp;return res(name,req,sp.res);});
    const make=(o:AcousticEngineOptions)=>new AcousticEngine(structuredClone(many.scenario),many.seed,o);
    const A=run(make,{deferUndeployed:true},specs,steps,many.dt),B=run(make,{},specs,steps,many.dt);
    const onBuoy4=(k:number)=>many.streams[k].spec.channel===4||many.streams[k].spec.buoyId===4;
    const straddle=compare(specs,A.rows,B.rows,dropAt,onBuoy4);
    let golden=0;
    for(let k=0;k<specs.length;k++){const p=many.streams[k].rows;for(const [i,r] of A.rows[k]){if(i>=p.count)continue;expect(r.hash&0xffff,`${specs[k].name} row ${i} vs golden`).toBe(goldenHashes[p.offset+i]);golden++;}}
    console.log(`TS-DEFER-UNDEPLOYED many-32 steps ${steps}: straddle-diff ${straddle}, deferred rows checked against golden ${golden}, aboardRowsSkipped ${A.e.aboardRowsSkipped}`);
    expect(straddle).toBe(0);expect(A.e.aboardRowsSkipped).toBeGreaterThan(0);
  },600000);
});
