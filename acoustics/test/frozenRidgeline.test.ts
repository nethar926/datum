import {describe,expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {AcousticEngine,loadScenario} from '../src/index.js';
// Frozen 2026-11-10: the app's seed-7 'ridgeline-field' training scenario exactly as
// src/scenarios/training.ts buildScenario('ridgeline-field', 7, 1000, 2048) produced it (default band
// lofar1k: fmax 1000 Hz, 2048 bins), byte-identical to the iOS bundled ridgeline-field-7.json.
const FILE=new URL('../src/scenario/frozen/ridgeline-field-7.json',import.meta.url);
const FILE_SHA256='bfccab3223cec360ae1fd295f180024a8d2259601536fd820a99ecbd7ebacdd1';
const LOFAR_HASH='1a52d0cf';
function fnv(h:number,bytes:Uint8Array):number{for(let i=0;i<bytes.length;i++){h^=bytes[i];h=Math.imul(h,16777619)>>>0;}return h;}
function frozenLofarHash():{hash:string;rows:number}{
 const e=new AcousticEngine(loadScenario(JSON.parse(readFileSync(FILE,'utf8'))));
 const cfgs=e.scenario.buoys.map(b=>e.subscribe({channel:b.rfChannel}));let h=2166136261,rows=0;
 for(let k=0;k<120;k++){e.advance(.25);for(const c of cfgs){const row=new Float32Array(c.bins);while(e.rowsReady(c.streamId)>0){e.writeRow(c.streamId,row);h=fnv(h,new Uint8Array(row.buffer));rows++;}}}
 return {hash:h.toString(16).padStart(8,'0'),rows};
}
describe('frozen ridgeline-field seed 7',()=>{
 it('file is pinned byte-exact',()=>{expect(createHash('sha256').update(readFileSync(FILE)).digest('hex')).toBe(FILE_SHA256);});
 it('loadScenario on it gives today\'s engine output (30 s LOFAR, every buoy)',()=>{const r=frozenLofarHash();expect(r.rows).toBe(6*120);expect(r.hash).toBe(LOFAR_HASH);});
});
