import {describe,it,expect} from 'vitest';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {resForBand,SIM_STREAM_SET,parseLofarStreamId} from '../src/streamSet.js';
import {resParams} from '../src/res.js';
import {LOFAR_BAND_PRESETS} from '../src/bands.js';
import {SCENARIO_CUTS,renderCut} from '../src/cuts/index.js';
describe('per-band pickup comes from analysis windows, not offsets',()=>{
 it('maps each preset to the finest RES that covers it',()=>{
  expect(LOFAR_BAND_PRESETS.map(p=>resForBand(p.id))).toEqual([2,4,5,7]);
  for(const p of LOFAR_BAND_PRESETS)expect(resParams(resForBand(p.id)).bandHz).toBeGreaterThanOrEqual(p.band[1]-p.band[0]);
 });
 it('low bands integrate longer (T=1/Δf)',()=>{
  const T=LOFAR_BAND_PRESETS.map(p=>resParams(resForBand(p.id)).integrationS);
  expect(T).toEqual([16,4,2,.5]);
 });
 it('cut streams use per-band RES and share one time axis',()=>{
  const s=renderCut(SCENARIO_CUTS[0]!);const e:any=s.engine;
  for(const id of SIM_STREAM_SET){const p=parseLofarStreamId(id);if(!p)continue;const n=s.openStream(id)!;expect(e.subscriptions.get(n).config.res).toBe(resForBand(p.bandPreset));}
  s.dispose();
 });
 it('no explicit per-band time offset/delay exists in source',()=>{
  const walk=(d:string):string[]=>readdirSync(d,{withFileTypes:true}).flatMap(x=>x.isDirectory()?walk(join(d,x.name)):x.name.endsWith('.ts')?[join(d,x.name)]:[]);
  const re=/(band|vlf|elf|lf|mf)\w*(Lag|Lead|Delay|Offset)S\b|(lag|delay|lead)(Ms|S)?ByBand|BAND_(LAG|DELAY|LEAD|TIME_OFFSET)/i;
  for(const f of walk(join(__dirname,'../src')))expect(re.test(readFileSync(f,'utf8')),f).toBe(false);
 });
});
