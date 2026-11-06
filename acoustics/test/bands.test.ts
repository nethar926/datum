import {describe,it,expect} from 'vitest';
import {
  AcousticEngine,cpaScenario,LOFAR_BAND_PRESETS,resolveLofarBand,isLofarBandPresetId,
  lofarBandPreset,WorkerRuntime,
} from '../src/index.js';
import type {WorkerResponse} from '../src/index.js';

describe('LOFAR_BAND_PRESETS frozen table',()=>{
  it('exports ELF/VLF/LF/MF with documented Hz edges',()=>{
    expect(LOFAR_BAND_PRESETS.map(p=>p.id)).toEqual(['ELF','VLF','LF','MF']);
    expect(Object.isFrozen(LOFAR_BAND_PRESETS)).toBe(true);
    const want:{[k:string]:[number,number]}={ELF:[0,50],VLF:[0,200],LF:[0,500],MF:[0,2000]};
    for(const p of LOFAR_BAND_PRESETS){
      expect(Object.isFrozen(p)).toBe(true);
      expect(Object.isFrozen(p.band)).toBe(true);
      expect([...p.band]).toEqual(want[p.id]);
      expect(lofarBandPreset(p.id)).toBe(p);
    }
  });
  it('isLofarBandPresetId guards ids',()=>{
    expect(isLofarBandPresetId('ELF')).toBe(true);
    expect(isLofarBandPresetId('MF')).toBe(true);
    expect(isLofarBandPresetId('HF')).toBe(false);
    expect(isLofarBandPresetId(null)).toBe(false);
  });
});

describe('resolveLofarBand',()=>{
  it('resolves presets and explicit pairs',()=>{
    expect(resolveLofarBand('ELF')).toEqual([0,50]);
    expect(resolveLofarBand('VLF')).toEqual([0,200]);
    expect(resolveLofarBand('LF')).toEqual([0,500]);
    expect(resolveLofarBand('MF')).toEqual([0,2000]);
    expect(resolveLofarBand([100,300])).toEqual([100,300]);
  });
  it('rejects unknown presets and invalid edges',()=>{
    expect(()=>resolveLofarBand('HF' as 'ELF')).toThrow(/Unknown LOFAR band preset/);
    expect(()=>resolveLofarBand([500,0])).toThrow(/Invalid LOFAR band/);
    expect(()=>resolveLofarBand([-1,100])).toThrow(/Invalid LOFAR band/);
  });
});

describe('subscribe bandPreset',()=>{
  it('preset produces expected f0/fMax/fBin and stamps bandPreset on config',()=>{
    const e=new AcousticEngine(cpaScenario());
    for(const p of LOFAR_BAND_PRESETS){
      const c=e.subscribe({channel:1,bandPreset:p.id});
      expect(c).toMatchObject({kind:'lofar',f0:p.band[0],bandPreset:p.id,bins:1024});
      expect(c.fBin).toBe((p.band[1]-p.band[0])/1023);
      expect(c.f0+c.fBin*(c.bins-1)).toBeCloseTo(p.band[1],10);
      e.unsubscribe(c.streamId);
    }
  });
  it('explicit band overrides preset (no bandPreset on config)',()=>{
    const e=new AcousticEngine(cpaScenario());
    const c=e.subscribe({channel:1,bandPreset:'ELF',band:[100,300]});
    expect(c.f0).toBe(100);
    expect(c.fBin).toBe(200/1023);
    expect(c.bandPreset).toBeUndefined();
  });
  it('LF preset matches scenario default edges',()=>{
    const e=new AcousticEngine(cpaScenario());
    const c=e.subscribe({channel:1,bandPreset:'LF'});
    expect(c).toMatchObject({f0:0,fBin:500/1023,bandPreset:'LF'});
  });
  it('band/bandPreset exclusive with RES path',()=>{
    const e=new AcousticEngine(cpaScenario());
    expect(()=>e.subscribe({channel:1,res:5,bandPreset:'LF'})).toThrow(/exclusive/);
    expect(()=>e.subscribe({channel:1,res:5,band:[0,500]})).toThrow(/exclusive/);
  });
});

describe('only subscribed buoy×band pairs are rendered',()=>{
  it('cache holds one renderer per distinct non-default buoy×band; unused presets are absent',()=>{
    const s=cpaScenario();
    s.buoys=Array.from({length:4},(_,i)=>({...s.buoys[0],id:`buoy-${i+1}`,rfChannel:i+1,x:i*100}));
    const e=new AcousticEngine(s);
    expect(e.lofarBandCacheSize()).toBe(0);
    const a=e.subscribe({channel:1,bandPreset:'ELF'});
    const b=e.subscribe({channel:2,bandPreset:'MF'});
    const c=e.subscribe({channel:1,bandPreset:'ELF'}); // same buoy×band → shared cache entry
    expect(e.lofarBandCacheSize()).toBe(2);
    expect(e.lofarBandPairs()).toEqual([
      {streamId:a.streamId,channel:1,f0:0,fMax:50,bandPreset:'ELF'},
      {streamId:b.streamId,channel:2,f0:0,fMax:2000,bandPreset:'MF'},
      {streamId:c.streamId,channel:1,f0:0,fMax:50,bandPreset:'ELF'},
    ]);
    // Default-band subscribe reuses the base generator (no cache entry).
    const d=e.subscribe({channel:3,bandPreset:'LF'});
    expect(d.bandPreset).toBe('LF');
    expect(e.lofarBandCacheSize()).toBe(2);
    const out=new Float32Array(1024);
    e.advance(.25);
    expect(e.writeRow(a.streamId,out)).toBe(0);
    expect(e.writeRow(b.streamId,out)).toBe(0);
    expect([...out].every(Number.isFinite)).toBe(true);
    // Unsubscribe releases shared refs.
    e.unsubscribe(a.streamId);expect(e.lofarBandCacheSize()).toBe(2);
    e.unsubscribe(c.streamId);expect(e.lofarBandCacheSize()).toBe(1);
    e.unsubscribe(b.streamId);expect(e.lofarBandCacheSize()).toBe(0);
    e.unsubscribe(d.streamId);
    expect(e.lofarBandPairs()).toEqual([]);
  });
  it('worker subscribe with bandPreset emits matching gramConfig',()=>{
    const messages:WorkerResponse[]=[],r=new WorkerRuntime((m,t=[])=>messages.push(structuredClone(m,{transfer:t})));
    r.command({v:1,type:'init',simT:0,seed:42,scenarioId:'cpa-pass'});
    r.command({v:1,type:'subscribe',simT:0,channel:1,bandPreset:'VLF'});
    const c=messages.at(-1);
    expect(c).toMatchObject({type:'gramConfig',kind:'lofar',f0:0,bandPreset:'VLF'});
    if(c?.type==='gramConfig')expect(c.fBin).toBe(200/1023);
  });
});
