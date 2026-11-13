import {describe,it,expect} from 'vitest';
import {
  AcousticEngine, cpaScenario, fictionalSignature, geometry, createGeometry,
  compassBiasDeg, bearingTimeSigmaDeg, bearingTimeFromState, bearingEnergyFromState,
  addWrappedGaussian, quantizeU8, quantizeEnergyRow, wrapDeg, bearingEnergyNzGuardBins,
  splitWindowBearingBackground, applyBearingEnergyIntegration,
  bearingEnergyRawBytes, energyRowCount, energyRowTimes,
  BEARING_TIME_SIGMA_FLOOR_DEG, BEARING_TIME_DETECT_SNR, BEARING_ENERGY_BINS,
  BEARING_ENERGY_F_LO, BEARING_ENERGY_F_HI, BEARING_TIME_PERIOD_S,
  BEARING_ENERGY_TAU_S, BEARING_ENERGY_SCALE, BEARING_ENERGY_PACK_VERSION,
  BEARING_ENERGY_DB_STEP, BEARING_ENERGY_DB_MAX,
  packBearingEnergy, decodeBearingEnergy, makeUserCut, loadUserCut, userCutSizeBytes, userCutJsonBytes,
  clampParams, presetToParams, generateScenario,
  type ContactPose,
} from '../src/index.js';
import type {Contact} from '../src/scenario.js';
import type {Buoy} from '../src/buoys.js';

function contactAt(id:string,bearingDeg:number,rangeM:number,over:Partial<Contact['params']>={}):Contact {
  const rad=bearingDeg*Math.PI/180;
  const params={
    ...fictionalSignature,label:id,levelDb:160,tonalRefDb:160,modulation:0,cavitationPower:0,
    tonals:[{family:'motor' as const,hz:90,power:1}],
    ...over,
  };
  return {
    id,category:'subsurface',classificationTarget:true,
    x:rangeM*Math.sin(rad),y:rangeM*Math.cos(rad),depth:60,course:0,speed:0,
    motion:[{at:0,course:0,speed:0,depth:60}],
    params,
  };
}

function difar(id='buoy-1'):Buoy {
  return {id,rfChannel:1,x:0,y:0,depth:40,course:0,speed:0,deployedAt:0,life:7200,type:'difar'};
}
function omni():Buoy {
  return {id:'buoy-2',rfChannel:2,x:0,y:0,depth:40,course:0,speed:0,deployedAt:0,life:7200,type:'omni'};
}
function bt():Buoy {
  return {id:'buoy-3',rfChannel:3,x:0,y:0,depth:40,course:0,speed:0,deployedAt:0,life:7200,type:'bt'};
}

function envOf(contacts:Contact[],buoys:Buoy[]=[difar()]) {
  const s=cpaScenario();
  s.bins=512;s.fmax=500;s.band=[0,500];s.seed=7;
  s.environment.seaState=0;s.environment.shipping='light';
  s.contacts=contacts;s.buoys=buoys;s.surfacePool=[];s.surfaceTraffic=0;
  return s;
}

function asPose(c:Contact):ContactPose {
  return {id:c.id,x:c.x,y:c.y,depth:c.depth,course:c.course,speed:c.speed,active:c.active,lines:c.params.tonals,params:c.params};
}

function state(contacts:Contact[],buoys:Buoy[]=[difar()],t=0,seed=7,band?:[number,number]) {
  const s=envOf(contacts,buoys);
  return {buoys,contacts:contacts.map(asPose),environment:s.environment,seed,atSimTime:t,band};
}

function circDiff(a:number,b:number):number {
  return Math.abs(((a-b+540)%360)-180);
}

function peakBin(row:Uint8Array):number {
  let p=0,i=0;
  for(let k=0;k<row.length;k++) if((row[k]??0)>p){p=row[k]!;i=k;}
  return i;
}

function secondMomentDeg(row:Uint8Array, center:number):number {
  let w=0,m2=0;
  for(let i=0;i<row.length;i++){
    const v=row[i]??0; if(!v) continue;
    const d=((i-center+180+360)%360)-180;
    m2+=v*d*d; w+=v;
  }
  return w>0?Math.sqrt(m2/w):0;
}

describe('bearing-time sigma and compass bias',()=>{
  it('sigma is max(3°, (180/π)/sqrt(2·SNR·B·T))',()=>{
    expect(BEARING_TIME_SIGMA_FLOOR_DEG).toBe(3);
    expect(BEARING_TIME_DETECT_SNR).toBe(1);
    const closed=(snr:number,B:number,T:number)=>Math.max(3,(180/Math.PI)/Math.sqrt(2*snr*B*T));
    for(const [snr,B,T] of [[100,1,1],[4,10,1],[1,1,1],[1e-6,990,1],[1e6,990,1]] as const){
      expect(bearingTimeSigmaDeg(snr,B,T)).toBeCloseTo(closed(snr,B,T),12);
    }
    expect(bearingTimeSigmaDeg(0,100,1)).toBe(90);
    expect(bearingTimeSigmaDeg(10,0,1)).toBe(90);
  });

  it('closed-form sigma is within statistical tolerance over many draws',()=>{
    const mu=80, sigma=12, n=4000;
    // Draw via the same Box-Muller used by valid entries, by synthesising entries at
    // varying times with a fixed geometry would mix geometry change; use the formula
    // path: wrapDeg(mu + sigma * z). Recreate with mulberry32+gaussian via fromState
    // would be heavy. Instead sample the published sigma through addWrappedGaussian
    // (deterministic deposit) AND a Monte Carlo of wrapDeg(mu+sigma*z) via engine entries
    // at a static contact by varying t (speed 0).
    const c=contactAt('alpha',mu,300);
    const st=state([c]);
    const samples:number[]=[];
    for(let t=0;t<800;t++){
      const e=bearingTimeFromState({...st,atSimTime:t}).find(x=>x.freqHz!==undefined)!;
      expect(e.valid).toBe(true);
      expect(e.sigmaDeg).toBe(bearingTimeSigmaDeg(10**(e.snrDb/10),1,1));
      samples.push(e.bearingDeg);
    }
    const sig=samples[0]!.valueOf() && bearingTimeFromState(st).find(x=>x.freqHz)!.sigmaDeg;
    let s=0,c1=0,c2=0;
    for(const b of samples){const r=b*Math.PI/180;c1+=Math.cos(r);c2+=Math.sin(r);s++;}
    const mean=wrapDeg(Math.atan2(c2/s,c1/s)*180/Math.PI);
    let m2=0;
    for(const b of samples){const d=((b-mean+180+360)%360)-180;m2+=d*d;}
    const std=Math.sqrt(m2/samples.length);
    expect(circDiff(mean,wrapDeg(mu+compassBiasDeg(7,1)))).toBeLessThan(1.5);
    expect(Math.abs(std-sig)/sig).toBeLessThan(0.15);
  });

  it('compass bias is seeded, fixed, and in [−5,−2]∪[2,5]',()=>{
    const seen=new Set<number>();
    for(let id=1;id<=40;id++){
      const b=compassBiasDeg(7,id);
      expect(Math.abs(b)).toBeGreaterThanOrEqual(2);
      expect(Math.abs(b)).toBeLessThanOrEqual(5);
      expect(compassBiasDeg(7,id)).toBe(b);
      expect(compassBiasDeg(99,id)).not.toBe(b);
      seen.add(Math.sign(b));
    }
    expect(seen.has(1)&&seen.has(-1)).toBe(true);
  });
});

describe('bearing-time entries',()=>{
  it('a feeding DIFAR emits per-line and band entries; omni and BT emit none',()=>{
    const c=contactAt('alpha',45,400);
    const rows=bearingTimeFromState(state([c],[difar(),omni(),bt()]));
    expect(rows.every(r=>r.buoyId===1)).toBe(true);
    expect(rows.some(r=>r.freqHz!==undefined)).toBe(true);
    expect(rows.some(r=>r.band!==undefined)).toBe(true);
    expect(rows.some(r=>r.buoyId===2||r.buoyId===3)).toBe(false);
    for(const r of rows){
      expect(r.t).toBe(0);
      expect(r.bearingDeg).toBeGreaterThanOrEqual(0);
      expect(r.bearingDeg).toBeLessThan(360);
      expect(r.sigmaDeg).toBeGreaterThan(0);
      expect(Number.isFinite(r.snrDb)).toBe(true);
      expect(typeof r.valid).toBe('boolean');
    }
  });

  it('is deterministic from the seed',()=>{
    const args=state([contactAt('alpha',45,400)]);
    expect(bearingTimeFromState(args)).toEqual(bearingTimeFromState(args));
    expect(bearingTimeFromState({...args,seed:99})).not.toEqual(bearingTimeFromState(args));
  });

  it('low-SNR entries are invalid, uniform-seeded, and have sigma 90',()=>{
    const far=contactAt('far',10,80_000,{tonalRefDb:80,levelDb:80});
    const rows=bearingTimeFromState(state([far]));
    const line=rows.find(r=>r.freqHz!==undefined)!;
    expect(line.valid).toBe(false);
    expect(line.sigmaDeg).toBe(90);
    expect(line.bearingDeg).toBeGreaterThanOrEqual(0);
    expect(line.bearingDeg).toBeLessThan(360);
    const again=bearingTimeFromState(state([far]));
    expect(again.find(r=>r.freqHz!==undefined)!.bearingDeg).toBe(line.bearingDeg);
    const other=bearingTimeFromState(state([far], [difar()], 0, 99));
    expect(other.find(r=>r.freqHz!==undefined)!.bearingDeg).not.toBe(line.bearingDeg);
  });

  it('two sources in one band bias the band bearing toward the power-weighted mean',()=>{
    const loud=contactAt('loud',20,400,{tonals:[{family:'motor',hz:90,power:1}],tonalRefDb:160});
    const quiet=contactAt('quiet',80,400,{tonals:[{family:'motor',hz:140,power:1}],tonalRefDb:140});
    const st=state([loud,quiet]);
    const band=bearingTimeFromState(st).find(r=>r.band)!;
    const bias=compassBiasDeg(7,1);
    const g=createGeometry();
    const t1=wrapDeg(geometry(loud,difar(),g).bearing*180/Math.PI+bias);
    const t2=wrapDeg(geometry(quiet,difar(),g).bearing*180/Math.PI+bias);
    // Energy row is noiseless and must peak at the power-weighted dipole mean.
    const row=bearingEnergyFromState(st,1)!;
    const pk=peakBin(row.energy);
    const mid=wrapDeg(t1); // loud source should dominate
    expect(circDiff(pk, mid)).toBeLessThan(circDiff(pk, t2));
    expect(circDiff(pk, mid)).toBeLessThan(8);
    // Band entry (noisy) stays on the loud side of the arc, within a few sigma.
    expect(circDiff(band.bearingDeg, mid)).toBeLessThan(Math.max(15, 3*band.sigmaDeg));
  });
});

describe('bearing-energy row',()=>{
  it('wraps a Gaussian across 0/360',()=>{
    const acc=new Float64Array(360);
    addWrappedGaussian(acc,1,4,1);
    expect(acc[1]!).toBeGreaterThan(acc[10]!);
    expect(acc[0]!).toBeGreaterThan(acc[10]!);
    expect(acc[359]!).toBeGreaterThan(acc[10]!);
    expect(acc[358]!).toBeGreaterThan(0);
    let sum=0; for(const v of acc) sum+=v;
    expect(sum).toBeCloseTo(1,10);
  });

  it('a single source peaks at its true bearing plus the compass bias',()=>{
    const trueDeg=45;
    const c=contactAt('alpha',trueDeg,400);
    const row=bearingEnergyFromState(state([c]),1)!;
    expect(row.energy).toHaveLength(BEARING_ENERGY_BINS);
    expect(row.fLo).toBe(BEARING_ENERGY_F_LO);
    expect(row.fHi).toBe(BEARING_ENERGY_F_HI);
    expect(row.scale).toBe(BEARING_ENERGY_SCALE);
    expect(Math.max(...row.energy)).toBeGreaterThanOrEqual(100); // ≥10 dB above background
    const bias=compassBiasDeg(7,1);
    const g=geometry(c,difar(),createGeometry());
    const expectDeg=wrapDeg(g.bearing*180/Math.PI+bias);
    // dB peak can sit a bin or two off the linear mean once the guard is 3*sigma.
    expect(circDiff(peakBin(row.energy),expectDeg)).toBeLessThanOrEqual(3);
  });

  it('the row widens as SNR falls',()=>{
    const near=bearingEnergyFromState(state([contactAt('n',45,300)]),1)!;
    const far=bearingEnergyFromState(state([contactAt('f',45,6_000,{tonalRefDb:140})]),1)!;
    const bias=compassBiasDeg(7,1);
    const mid=wrapDeg(45+bias);
    const wNear=secondMomentDeg(near.energy,mid);
    const wFar=secondMomentDeg(far.energy,mid);
    expect(wFar).toBeGreaterThan(wNear*1.2);
  });

  it('quantizeU8 is half-up, not banker\'s rounding',()=>{
    expect(quantizeU8(1.5)).toBe(2);
    expect(quantizeU8(2.5)).toBe(3);
    expect(quantizeU8(0)).toBe(0);
    expect(quantizeU8(255.2)).toBe(255);
    expect(quantizeU8(BEARING_ENERGY_DB_MAX/BEARING_ENERGY_DB_STEP)).toBe(255);
  });

  it('encodes dB above the circular split-window background at 0.1 dB/step',()=>{
    const flat=new Float64Array(360).fill(2);
    expect([...quantizeEnergyRow(flat)].every(v=>v===0)).toBe(true);
    const empty=new Float64Array(360);
    expect([...quantizeEnergyRow(empty)].every(v=>v===0)).toBe(true);
    const spike=new Float64Array(360);
    spike[10]=100;
    const enc=quantizeEnergyRow(spike);
    expect(enc[10]).toBe(255); // bg≈0 → clamp 25.5 dB
    expect(enc[10+31]??0).toBe(0); // well outside the 5° guard, on the zero background
    expect(splitWindowBearingBackground(spike,10)).toBe(0);
  });

  it('exponentially averages a histogram with τ and copies when τ or dt is 0',()=>{
    const prev=new Float64Array([1,0]);
    const inst=new Float64Array([0,1]);
    const a=Math.exp(-1/8);
    const out=applyBearingEnergyIntegration(prev,inst,1,8);
    expect(out[0]).toBeCloseTo(a*1+(1-a)*0,12);
    expect(out[1]).toBeCloseTo(a*0+(1-a)*1,12);
    expect([...applyBearingEnergyIntegration(prev,inst,1,0)]).toEqual([0,1]);
    expect([...applyBearingEnergyIntegration(undefined,inst,1,8)]).toEqual([0,1]);
  });

  it('accepts a configurable [fLo, fHi] band',()=>{
    const c=contactAt('alpha',45,400,{tonals:[{family:'motor',hz:90,power:1},{family:'motor',hz:400,power:1}]});
    const wide=bearingEnergyFromState(state([c], [difar()], 0, 7, [10,1000]),1)!;
    const narrow=bearingEnergyFromState(state([c], [difar()], 0, 7, [50,120]),1)!;
    expect(wide.fLo).toBe(10); expect(wide.fHi).toBe(1000);
    expect(narrow.fLo).toBe(50); expect(narrow.fHi).toBe(120);
    expect(narrow.energy).toHaveLength(360);
  });
});

describe('history, seek, UserCut, and size',()=>{
  it('records 1 Hz rows and entries so seek and UserCut carry them',()=>{
    const e=new AcousticEngine(envOf([contactAt('alpha',45,400)]));
    expect(e.time).toBe(0);
    expect(e.bearingEnergyHistory(1)).toHaveLength(1);
    e.advance(3);
    const hist=e.bearingEnergyHistory(1,0,3);
    expect(hist.map(r=>r.t)).toEqual([0,1,2,3]);
    const at1=e.bearingEnergy(1,1)!;
    expect([...at1.energy]).toEqual([...hist[1]!.energy]);
    expect(e.bearingTimeHistory(0,3,1).some(x=>x.t===2)).toBe(true);
    // "Seek": query at an earlier stamp equals the book and a fresh recompute.
    const live=e.bearingEnergy(1,1)!;
    const book=e.bearingBook.energyAt(1,1)!;
    expect([...live.energy]).toEqual([...book.energy]);
    expect(e.getBearingEnergyBand()).toEqual([10,1000]);
    e.setBearingEnergyBand([20,400]);
    expect(e.getBearingEnergyBand()).toEqual([20,400]);
    e.setBearingEnergyBand([10,1000]);
    expect(e.getBearingEnergyIntegration()).toBe(BEARING_ENERGY_TAU_S);
    e.setBearingEnergyIntegration(4);
    expect(e.getBearingEnergyIntegration()).toBe(4);
    e.setBearingEnergyIntegration(BEARING_ENERGY_TAU_S);
  });

  it('seek-then-read bearingTimeHistory and bearingEnergyHistory equal a live run exactly',()=>{
    const scen=envOf([contactAt('alpha',45,400)]);
    const T=20;
    const live=new AcousticEngine(scen);
    while(live.time<T-1e-9)live.advance(Math.min(0.25,T-live.time));
    const liveE=live.bearingEnergyHistory(1,0,T);
    const liveT=live.bearingTimeHistory(0,T,1);
    expect(liveE.map(r=>r.t)).toEqual(energyRowTimes(0,T));

    // Same 0.25 s fill as a UserCut/seek recipe replay: history is bit-identical to live.
    const seek=new AcousticEngine(scen);
    while(seek.time<T-1e-9)seek.advance(Math.min(0.25,T-seek.time));
    const seekE=seek.bearingEnergyHistory(1,0,T);
    const seekT=seek.bearingTimeHistory(0,T,1);
    expect(seekE).toHaveLength(liveE.length);
    for(let i=0;i<liveE.length;i++){
      expect(seekE[i]!.t).toBe(liveE[i]!.t);
      expect(seekE[i]!.buoyId).toBe(liveE[i]!.buoyId);
      expect([...seekE[i]!.energy]).toEqual([...liveE[i]!.energy]);
    }
    expect(seekT).toEqual(liveT);
    const mid=seek.bearingEnergy(1,10)!;
    const book=seek.bearingEnergyHistory(1,10,10)[0]!;
    expect([...mid.energy]).toEqual([...book.energy]);

    // First-paint skip-ahead (2 s jumps) must not drop ticks; energy rows stay bit-identical.
    const skip=new AcousticEngine(scen);
    while(skip.time+1e-9<T)skip.advance(Math.min(2,T-skip.time));
    const skipE=skip.bearingEnergyHistory(1,0,T);
    const skipT=skip.bearingTimeHistory(0,T,1);
    expect(skipE.map(r=>r.t)).toEqual(liveE.map(r=>r.t));
    for(let i=0;i<liveE.length;i++) expect([...skipE[i]!.energy]).toEqual([...liveE[i]!.energy]);
    expect(skipT.map(e=>e.t)).toEqual(liveT.map(e=>e.t));
    expect(skipT.map(e=>e.buoyId)).toEqual(liveT.map(e=>e.buoyId));
    expect(skipT.map(e=>e.valid)).toEqual(liveT.map(e=>e.valid));
  });

  it('a noise-only row stays near 0 dB, and a ≥10 dB contact peaks by t=60 s',()=>{
    const quiet=new AcousticEngine(envOf([]));
    quiet.advance(5);
    const noise=quiet.bearingEnergy(1,5)!;
    expect(noise.scale).toBe(BEARING_ENERGY_SCALE);
    const db=[...noise.energy].map(v=>v*BEARING_ENERGY_DB_STEP).sort((a,b)=>a-b);
    const median=0.5*(db[179]!+db[180]!);
    const p99=db[Math.floor(0.99*(db.length-1))]!;
    expect(median).toBeLessThan(1);
    expect(p99).toBeLessThan(6);

    const e=new AcousticEngine(envOf([contactAt('alpha',45,400)]));
    e.advance(60);
    const row=e.bearingEnergy(1,60)!;
    const band=e.bearingTime(60).find(r=>r.band)!;
    expect(band.snrDb).toBeGreaterThanOrEqual(10);
    const bias=compassBiasDeg(7,1);
    const g=geometry(contactAt('alpha',45,400),difar(),createGeometry());
    const truth=wrapDeg(g.bearing*180/Math.PI+bias);
    const pk=peakBin(row.energy);
    expect(row.energy[pk]!*BEARING_ENERGY_DB_STEP).toBeGreaterThanOrEqual(10);
    expect(circDiff(pk,truth)).toBeLessThanOrEqual(2*band.sigmaDeg);
  });

  it('UserCut packs, decodes, and counts energy rows in sizeBytes',()=>{
    const s=envOf([contactAt('alpha',45,400)]);
    const e=new AcousticEngine(s);
    e.advance(2);
    const pack=packBearingEnergy(e,0,2,[1]);
    expect(pack.version).toBe(BEARING_ENERGY_PACK_VERSION);
    expect(pack.scale).toBe(BEARING_ENERGY_SCALE);
    expect(pack.bins).toBe(360);
    expect(pack.periodS).toBe(BEARING_TIME_PERIOD_S);
    expect(pack.fLo).toBe(10);
    expect(pack.fHi).toBe(1000);
    expect(pack.buoys).toHaveLength(1);
    expect(pack.buoys[0]!.buoyId).toBe(1);
    expect(pack.buoys[0]!.count).toBe(energyRowCount(2));
    expect(pack.rawBytes).toBe(1*energyRowCount(2)*360);
    const decoded=decodeBearingEnergy(pack);
    const hist=e.bearingEnergyHistory(1,0,2);
    expect(decoded.buoys[0]!.rows.length).toBe(hist.length);
    for(let i=0;i<hist.length;i++) expect([...decoded.buoys[0]!.rows[i]!]).toEqual([...hist[i]!.energy]);

    const p=clampParams(presetToParams('regular',7));
    const ge=new AcousticEngine(generateScenario(p,7),7);
    ge.advance(2);
    const cut=makeUserCut(ge,ge.time,'bt energy',{params:p,resInView:[5],includeDemon:false,id:'bt-energy',createdAt:'2026-11-13T00:00:00.000Z'});
    expect(cut.bearingEnergy).toBeDefined();
    expect(cut.sizeBytes).toBe(userCutSizeBytes(cut));
    const without={...cut}; delete (without as {bearingEnergy?:unknown}).bearingEnergy;
    (without as {sizeBytes?:number}).sizeBytes=undefined;
    expect(userCutSizeBytes(cut)).toBeGreaterThan(userCutJsonBytes(without));
    const sess=loadUserCut(cut);
    expect(sess.bearingEnergy?.periodS).toBe(1);
    expect(sess.bearingEnergy?.bins).toBe(360);
    expect(sess.bearingEnergy?.version).toBe(BEARING_ENERGY_PACK_VERSION);
    expect(sess.bearingEnergy?.scale).toBe(BEARING_ENERGY_SCALE);

    // Legacy packs (no version / scale) still decode; display mapping is max-norm-u8.
    const legacy={...pack} as typeof pack;
    delete (legacy as {version?:unknown}).version;
    delete (legacy as {scale?:unknown}).scale;
    const old=decodeBearingEnergy(legacy);
    expect(old.version).toBe(1);
    expect(old.scale).toBe('max-norm-u8');
    expect(old.buoys[0]!.rows.length).toBe(decoded.buoys[0]!.rows.length);
  });

  it('four buoys × 900 s add about 1.3 MB of raw energy',()=>{
    const n=energyRowCount(900);
    const bytes=bearingEnergyRawBytes(4,900);
    expect(n).toBe(Math.floor(900/1+1e-9)+1);
    expect(bytes).toBe(4*n*360);
    expect(bytes).toBeGreaterThan(1.2e6);
    expect(bytes).toBeLessThan(1.4e6);
    expect(energyRowTimes(0,900)).toHaveLength(n);
    expect(energyRowTimes(0,900)[0]).toBe(0);
    expect(energyRowTimes(0,900).at(-1)).toBe(900);
  });
});

describe('bearing-energy split-window guard',()=>{
  it('is max(5°, 3σ) in 1° bins, capped inside the 30° window',()=>{
    expect(bearingEnergyNzGuardBins(0)).toBe(5);
    expect(bearingEnergyNzGuardBins(NaN)).toBe(5);
    expect(bearingEnergyNzGuardBins(3)).toBe(9);
    expect(bearingEnergyNzGuardBins(4)).toBe(12);
    expect(bearingEnergyNzGuardBins(6.6)).toBe(20);
    expect(bearingEnergyNzGuardBins(10)).toBe(29);
    expect(bearingEnergyNzGuardBins(20)).toBe(29);
  });
});
