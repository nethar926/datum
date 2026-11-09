/**
 * m3-acoustics-demon-tune: lock DEMON propulsion-line contrast (AFTER floors) for the shared
 * Cuts+live carrier band, and keep non-cavitating / no-propulsion controls quiet.
 * Harness: bench/demonContrast.ts (30 s row-averaged display, contrast vs ±25-bin median).
 */
import {describe,it,expect} from 'vitest';
import {DEMON_CASES,measureCase,DEMON_BINS,type DisplayFn} from '../bench/demonContrast.js';
import {DEMON_CARRIER_BAND,DEMON_DISPLAY_DB,DEMON_NORM,normalizeDemonRow,SplitWindowNormalizer,renderCut,AcousticEngine,cpaScenario} from '../src/index.js';
import {carrierStatBandwidth,modulatedFraction,envelopeNoiseVariance} from '../src/demonStream.js';

/** FE pipeline with the shared settings: clamp → DEMON_NORM whitening → clip to DEMON_DISPLAY_DB. */
function shared():DisplayFn{const nz=new SplitWindowNormalizer(DEMON_BINS,DEMON_NORM.window,DEMON_NORM.guard);return (s,d)=>{normalizeDemonRow(s,0,d,0,DEMON_BINS,DEMON_NORM,true,nz);for(let i=0;i<DEMON_BINS;i++){const v=d[i];if(v===v)d[i]=Math.min(DEMON_DISPLAY_DB.ceilDb,Math.max(DEMON_DISPLAY_DB.floorDb,v));}};}
const byId=(id:string)=>DEMON_CASES.find(c=>c.id===id)!;

describe('shared DEMON settings',()=>{
 it('one carrier band for Cuts and live: engine default and CutSession both use DEMON_CARRIER_BAND',()=>{
  expect([...DEMON_CARRIER_BAND]).toEqual([1000,4000]);
  const e=new AcousticEngine(cpaScenario()),id=e.subscribe({kind:'demon',buoyId:1});
  expect(e.configs().find(c=>c.streamId===id)!.demodBandHz).toEqual([1000,4000]);
  const s=renderCut('cut-brindleflux-snork');
  expect(s.engine.configs().find(c=>c.streamId===s.demonStreamId)!.demodBandHz).toEqual([1000,4000]);
  s.dispose();
 });
 it('wider band buys statistical bandwidth (≈+3 dB line SNR) — the physical reason for 1–4 kHz',()=>{
  const narrow=carrierStatBandwidth(1000,2000),wide=carrierStatBandwidth(DEMON_CARRIER_BAND[0],DEMON_CARRIER_BAND[1]);
  expect(narrow).toBeGreaterThan(800);expect(narrow).toBeLessThan(950);
  expect(10*Math.log10(wide/narrow)).toBeGreaterThan(2.8);
  expect(envelopeNoiseVariance(wide)).toBeLessThan(envelopeNoiseVariance(narrow));
 });
 it('only cavitation noise is propeller-modulated; legacy hand params keep full modulation',()=>{
  expect(modulatedFraction({cavitationPower:0} as never)).toBe(0);
  expect(modulatedFraction({cavitationPower:.0001} as never)).toBeCloseTo(.5,6);
  expect(modulatedFraction({cavitationPower:.01} as never)).toBeGreaterThan(.99);
  expect(modulatedFraction({} as never)).toBe(1);
 });
 it('display LUT and NORM stay compatible with FE contract',()=>{
  expect(DEMON_DISPLAY_DB.floorDb).toBe(0);expect(DEMON_DISPLAY_DB.ceilDb).toBe(20);
  expect(DEMON_NORM).toMatchObject({window:24,guard:3,floorDb:0,ceilDb:30,clampFloorDb:-5});
 });
});

describe('DEMON propulsion contrast floors (AFTER, seeded)',()=>{
 // Floors sit ~2 dB under the measured AFTER values (bench/demonTune.bench.ts, shared settings).
 const FLOORS:Record<string,{shaft:number;br:number;br2:number}>={
  'live-fast-cav':{shaft:4,br:11,br2:4},
  'live-gloam-surf':{shaft:4,br:11,br2:4},
  'cut-cinderlilt-cav':{shaft:8,br:14,br2:7.5},
 };
 for(const [id,f] of Object.entries(FLOORS))it(`${id}: shaft, blade rate and BR2 stand out; no false lines`,()=>{
  const r=measureCase(byId(id),shared());
  expect(r.shaft.contrastDb!).toBeGreaterThan(f.shaft);
  expect(r.br.contrastDb!).toBeGreaterThan(f.br);
  expect(r.br2.contrastDb!).toBeGreaterThan(f.br2);
  // Blade rate is the strongest propulsion line (cavitation physics); shaft below it.
  expect(r.br.contrastDb!).toBeGreaterThan(r.shaft.contrastDb!);
  expect(r.falseLines).toBe(0);
 },30000);
});

describe('DEMON controls stay quiet (no invented lines, no blanket gain)',()=>{
 for(const id of ['live-slow-batt','cut-gloamspiral-aip','cut-orbelune-msr','cut-mistacorn-batt','cut-pebblewisp-demon','live-med-snork'])it(`${id}: non-cavitating / barely-incepting target shows no propulsion line`,()=>{
  const r=measureCase(byId(id),shared());
  for(const l of [r.shaft,r.br,r.br2,r.br3])if(l.contrastDb!==null)expect(l.contrastDb).toBeLessThan(3.5);
  expect(r.falseLines).toBe(0);
 },30000);
 it('masked target (cavitating sub under moderate surface traffic) stays weak',()=>{
  const r=measureCase(byId('live-fast-traffic'),shared());
  expect(r.br.contrastDb!).toBeLessThan(4);expect(r.falseLines).toBe(0);
 },30000);
 it('no-propulsion control: catalog sub below inception produces a flat envelope continuum',()=>{
  const {engine,streamId,pull}=byId('live-slow-batt').make();
  const row=new Float32Array(512),acc=new Float64Array(512);let n=0;
  for(let k=0;k<80&&pull(row);k++){for(let i=0;i<512;i++)acc[i]+=10**(row[i]/10);n++;}
  void engine;void streamId;
  const db=[...acc].slice(3).map(v=>10*Math.log10(v/n)).sort((a,b)=>a-b);
  // Averaged continuum: max within ~5 dB of the median across 0–100 Hz (no structure).
  expect(db[db.length-1]-db[db.length>>1]).toBeLessThan(5.5);
 },30000);
});
