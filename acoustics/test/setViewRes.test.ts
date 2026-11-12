/** setViewRes + drainHistory contracts (engine-side scratch of Dorian's keepHistory 47fd575). */
import {describe,it,expect} from 'vitest';
import {AcousticEngine,cpaScenario,resParams,HISTORY_RING_SPAN_S,historyRingRows,historyRingRowsForRes,DrainHandle} from '../src/index.js';
import type {HistoryRow} from '../src/index.js';
import type {ResLevel} from '../src/protocol.js';

function scenario(n=1){
  const s=cpaScenario();
  s.buoys=Array.from({length:n},(_,i)=>({...s.buoys[0],id:`buoy-${i+1}`,rfChannel:i+1,x:i*400,y:0,deployedAt:0}));
  return s;
}
function hash(a:Float32Array){let h=2166136261;for(let i=0;i<a.length;i++){h^=(a[i]!+1)*1000|0;h=Math.imul(h,16777619);}return h>>>0;}

describe('history ring sizes',()=>{
  it('ceil(900/P) is RES1 113, RES2 225, RES3–9 450, DEMON 3600',()=>{
    expect(HISTORY_RING_SPAN_S).toBe(900);
    expect(historyRingRowsForRes(1)).toBe(113);
    expect(historyRingRowsForRes(2)).toBe(225);
    for(const r of [3,4,5,6,7,8,9] as ResLevel[])expect(historyRingRowsForRes(r)).toBe(450);
    expect(historyRingRows(0.25)).toBe(3600);
  });
  it('ring size is configurable',()=>{
    expect(historyRingRowsForRes(5,100)).toBe(50);
  });
});

describe('setViewRes + drainHistory',()=>{
  it('RES switch keeps same id, does not restart the destination clock, and drainHistory has historical rows',()=>{
    const e=new AcousticEngine(scenario()),c=e.subscribe({channel:1,res:5});
    const out=new Float32Array(c.bins),orig:Float32Array[]=[];
    for(let i=0;i<16;i++){e.advance(2);expect(e.rowsReady(c.streamId)).toBe(1);e.writeRow(c.streamId,out);orig.push(out.slice());}
    const cfg=e.setViewRes(c.streamId,3);
    expect(cfg.streamId).toBe(c.streamId);
    expect(cfg.res).toBe(3);
    expect(cfg.filter).toBe('NB');
    expect(cfg.rowRateHz).toBe(resParams(3).rowRateHz);
    expect(cfg.rowPhaseS).toBe(resParams(3).rowPeriodS); // stagger 0 at t=0
    expect(cfg.integrationMode).toBe('sti');
    expect(cfg.integrationSpanS).toBeDefined();
    expect(e.rowsReady(c.streamId)).toBe(0); // clock is the RES3 clock, already caught up
    const hist=e.drainHistory(c.streamId,3,100);
    expect(hist.length).toBeGreaterThan(1);
    expect(hist.length).toBe(16); // 32 s / 2 s
    for(let i=0;i<hist.length;i++){
      expect(hist[i]!.k).toBe(i);
      expect(hist[i]!.simT).toBeCloseTo(cfg.rowPhaseS!+i/cfg.rowRateHz,9);
      expect(hist[i]!.quantized).toBeFalsy(); // displayed buoy: Float32
    }
    // oldest first, first row at rowPhaseS
    expect(hist[0]!.simT).toBe(cfg.rowPhaseS);
  });

  it('switching back to a RES restores already-emitted rows bit-exactly',()=>{
    const e=new AcousticEngine(scenario()),c=e.subscribe({channel:1,res:5});
    const out=new Float32Array(c.bins),orig:Float32Array[]=[];
    for(let i=0;i<16;i++){e.advance(2);e.writeRow(c.streamId,out);orig.push(out.slice());}
    const hashes=orig.map(hash);
    e.setViewRes(c.streamId,3);
    e.setViewRes(c.streamId,5);
    const back=e.drainHistory(c.streamId,5,16);
    expect(back.length).toBe(16);
    for(let i=0;i<16;i++){
      expect(hash(back[i]!.data)).toBe(hashes[i]);
      expect([...back[i]!.data]).toEqual([...orig[i]!]);
    }
  });

  it('NB ↔ BB via setViewRes({filter}) restores exact original NB rows, same id',()=>{
    const e=new AcousticEngine(scenario()),c=e.subscribe({channel:1,res:5,filter:'NB'});
    const out=new Float32Array(c.bins),orig:Float32Array[]=[];
    for(let i=0;i<8;i++){e.advance(2);e.writeRow(c.streamId,out);orig.push(out.slice());}
    const bb=e.setViewRes(c.streamId,5,{filter:'BB'});
    expect(bb.streamId).toBe(c.streamId);
    expect(bb.filter).toBe('BB');
    expect(bb.rowPhaseS).toBe(c.rowPhaseS); // same RES clock
    const bbHist=e.drainHistory(c.streamId,5,8);
    expect(bbHist.length).toBe(8);
    // BB is a different mapping of the same spectrum — not equal to NB
    expect([...bbHist[0]!.data]).not.toEqual([...orig[0]!]);
    const nb=e.setViewRes(c.streamId,5,{filter:'NB'});
    expect(nb.streamId).toBe(c.streamId);
    expect(nb.filter).toBe('NB');
    const back=e.drainHistory(c.streamId,5,8);
    for(let i=0;i<8;i++)expect([...back[i]!.data]).toEqual([...orig[i]!]);
  });

  it('LOFAR ↔ DEMON: own id, idempotent subscribe, drainHistory(null), non-null throws, simT, no unsubscribe, restore',()=>{
    const e=new AcousticEngine(scenario());
    const lofar=e.subscribe({channel:1,res:5});
    const demonId=e.subscribe({kind:'demon',buoyId:1}) as number;
    const out=new Float32Array(lofar.bins),orig:Float32Array[]=[];
    for(let i=0;i<8;i++){e.advance(2);e.writeRow(lofar.streamId,out);orig.push(out.slice());}
    expect(demonId).not.toBe(lofar.streamId);
    expect(e.subscribe({kind:'demon',buoyId:1})).toBe(demonId);
    expect(()=>e.drainHistory(demonId,5,10)).toThrow(/DEMON requires res=null/);
    const dcfg=e.streamConfig(demonId);
    const drained=e.drainHistory(demonId,null,100);
    expect(drained.length).toBeGreaterThan(1);
    for(let k=0;k<drained.length;k++){
      expect(drained[k]!.k).toBe(k);
      expect(drained[k]!.simT).toBeCloseTo(dcfg.rowPhaseS!+k/dcfg.rowRateHz,9);
    }
    // switching back (show the LOFAR id, drain its history) — neither stream unsubscribed
    expect(e.streamConfig(lofar.streamId).streamId).toBe(lofar.streamId);
    const back=e.drainHistory(lofar.streamId,5,8);
    expect(back.length).toBe(8);
    for(let i=0;i<8;i++)expect([...back[i]!.data]).toEqual([...orig[i]!]);
    // still can drain DEMON
    expect(e.drainHistory(demonId,null,100).length).toBe(drained.length);
  });

  it('8-bit rings on a non-displayed buoy are flagged quantized / precisionDb 0.25',()=>{
    // Two buoys: subscribe only channel 1 (displayed). Channel 2 stays 8-bit until subscribed.
    const e=new AcousticEngine(scenario(2));
    e.subscribe({channel:1,res:5});
    for(let i=0;i<8;i++)e.advance(2);
    // Need a stream on buoy 2 to drainHistory — subscribe then immediately drain (history already filled at 8-bit)
    const late=e.subscribe({channel:2,res:5});
    const hist=e.drainHistory(late.streamId,5,8);
    expect(hist.length).toBe(8);
    for(const r of hist){
      expect(r.quantized).toBe(true);
      expect(r.precisionDb).toBe(0.25);
      if(r.bearingDeg){expect(r.bearingQuantized).toBe(true);expect(r.bearingPrecisionDeg).toBeCloseTo(360/256/2,9);}
    }
  });


  it('drained BB (mapFilter from NB on drain) is bit-exact to live BB at RES1 and RES5',()=>{
    for(const res of [1,5] as ResLevel[]){
      const e=new AcousticEngine(scenario());
      const c=e.subscribe({channel:1,res,filter:'BB'});
      const step=resParams(res).rowPeriodS,out=new Float32Array(c.bins),live:Float32Array[]=[];
      const n=res===1?4:8;
      for(let i=0;i<n;i++){e.advance(step);expect(e.rowsReady(c.streamId)).toBe(1);e.writeRow(c.streamId,out);live.push(out.slice());}
      const hist=e.drainHistory(c.streamId,res,n);
      expect(hist.length).toBe(n);
      for(let i=0;i<n;i++){
        expect(hist[i]!.k).toBe(i);
        expect(hist[i]!.simT).toBeCloseTo(c.rowPhaseS!+i/c.rowRateHz,9);
        expect(hist[i]!.data.length).toBe(live[i]!.length);
        for(let j=0;j<live[i]!.length;j++){
          const a=hist[i]!.data[j]!,b=live[i]![j]!;
          if(Number.isNaN(a)||Number.isNaN(b))expect(Number.isNaN(a)&&Number.isNaN(b)).toBe(true);
          else expect(a).toBe(b);
        }
      }
    }
  });

  it('drained BB of the oldest full-ring rows is bit-exact to live BB (RES1 113, RES5 450)',()=>{
    const sizes:{res:ResLevel;n:number}[]=[{res:1,n:113},{res:5,n:450}];
    for(const {res,n} of sizes){
      const e=new AcousticEngine(scenario());
      const c=e.subscribe({channel:1,res,filter:'BB'});
      const step=resParams(res).rowPeriodS,out=new Float32Array(c.bins),live:Float32Array[]=[];
      for(let i=0;i<n;i++){e.advance(step);expect(e.rowsReady(c.streamId)).toBe(1);e.writeRow(c.streamId,out);live.push(out.slice());}
      const hist=e.drainHistory(c.streamId,res,n);
      expect(hist.length).toBe(n);
      // oldest row first — k=0 is the first emitted live row, now at the back of a full 900 s ring
      expect(hist[0]!.k).toBe(0);
      expect(hist[0]!.simT).toBeCloseTo(c.rowPhaseS!,9);
      for(let i=0;i<n;i++){
        expect(hist[i]!.k).toBe(i);
        expect(hist[i]!.simT).toBeCloseTo(c.rowPhaseS!+i/c.rowRateHz,9);
        expect(hist[i]!.data.length).toBe(live[i]!.length);
        for(let j=0;j<live[i]!.length;j++){
          const a=hist[i]!.data[j]!,b=live[i]![j]!;
          if(Number.isNaN(a)||Number.isNaN(b))expect(Number.isNaN(a)&&Number.isNaN(b)).toBe(true);
          else expect(a).toBe(b);
        }
      }
    }
  },30_000);

  it('setViewRes / drainHistory throw on unknown id; drainHistory(null) on RES throws',()=>{
    const e=new AcousticEngine(scenario()),c=e.subscribe({channel:1,res:5});
    expect(()=>e.setViewRes(999,3)).toThrow(/Unknown streamId/);
    expect(()=>e.drainHistory(999,5,4)).toThrow(/Unknown streamId/);
    expect(()=>e.drainHistory(c.streamId,null,4)).toThrow(/requires a ResLevel/);
  });
});

describe('vernier-as-slice golden',()=>{
  function cmpSlice(fmax:number,V:number){
    const s=scenario();s.fmax=s.fMax=fmax;
    const mk=()=>new AcousticEngine(structuredClone(s));
    const ev=mk(),cv=ev.subscribe({channel:1,res:5,vernierHz:V});
    const ef=mk(),cf=ef.subscribe({channel:1,res:5,fullAxis:true,vernierHz:V});
    ev.advance(2);ef.advance(2);
    const outV=new Float32Array(cv.bins),outF=new Float32Array(cf.bins);
    ev.writeRow(cv.streamId,outV);ef.writeRow(cf.streamId,outF);
    const f0=cv.f0,fBin=cv.fBin,live=cv.liveBins??cv.bins;
    const tile=ef.lastFullAxisTile(cf.streamId);
    const tileF0=tile?.f0??cf.f0,off=Math.round((f0-tileF0)/fBin);
    let equal=false,compared=0;
    if(tile&&off>=0&&off+live<=outF.length){
      compared=live;equal=true;
      for(let i=0;i<live;i++){
        const a=outV[i]!,b=outF[off+i]!;
        if(a!==b&&!(Number.isNaN(a)&&Number.isNaN(b))){equal=false;break;}
      }
    }
    return {equal,compared,off,f0,tileF0,fBin,live,tile};
  }
  /** f0=0 (vernier slid against a 500 Hz ceiling): FULLBAND tile-0 slice == vernier subscribe. */
  it('f0-aligned (slid) FULLBAND slice equals today\'s vernier subscribe',()=>{
    const r=cmpSlice(500,300);
    console.log('vernier-as-slice f0-aligned',r);
    expect(r.equal).toBe(true);
    expect(r.f0).toBe(0);
  });
  /** Mid-band vernier (fmax 2000, V=300 → f0=44). Identity is recorded; setViewRes vernier
   *  still rebuilds (warm set is 1024-bin f0=0, not FULLBAND 4096, so there is nothing to slice). */
  it('records mid-band FULLBAND-slice vs vernier identity (slice path not enabled)',()=>{
    const r=cmpSlice(2000,300);
    console.log('vernier-as-slice mid-band',r);
    expect(r.f0).toBeGreaterThan(0);
    expect(r.compared).toBeGreaterThan(0);
    // Mid-band is NOT bit-exact today; setViewRes({vernierHz}) stays on the rebuild path.
    // Invert this and enable a slice only if a future change makes mid-band identity hold.
    expect(r.equal).toBe(false);
  });
});


function assertPartial(handle:DrainHandle,gold:HistoryRow[]){
  expect(handle.rows.length).toBe(gold.length);
  for(let k=0;k<handle.rows.length;k++){
    const row=handle.rows[k]!,g=gold[k]!;
    expect(row.k).toBe(k);
    const filled=k>=handle.filledFrom;
    for(let i=0;i<row.data.length;i++){
      if(!filled)expect(Number.isNaN(row.data[i]!)).toBe(true);
      else{
        const a=row.data[i]!,b=g.data[i]!;
        if(Number.isNaN(a)||Number.isNaN(b))expect(Number.isNaN(a)&&Number.isNaN(b)).toBe(true);
        else expect(a).toBe(b);
      }
    }
    if(row.bearingDeg){
      expect(row.bearingDeg.length).toBe(g.bearingDeg!.length);
      for(let i=0;i<row.bearingDeg.length;i++){
        if(!filled)expect(Number.isNaN(row.bearingDeg[i]!)).toBe(true);
        else{
          const a=row.bearingDeg[i]!,b=g.bearingDeg![i]!;
          if(Number.isNaN(a)||Number.isNaN(b))expect(Number.isNaN(a)&&Number.isNaN(b)).toBe(true);
          else expect(a).toBe(b);
        }
      }
    }
  }
}

describe('chunked beginDrain',()=>{
  function primed(res:ResLevel,filter:'NB'|'BB',n=16){
    const e=new AcousticEngine(scenario());
    const c=e.subscribe({channel:1,res,filter});
    const step=resParams(res).rowPeriodS,out=new Float32Array(c.bins);
    for(let i=0;i<n;i++){e.advance(step);e.writeRow(c.streamId,out);}
    return {e,c,n,gold:e.drainHistory(c.streamId,res,n)};
  }

  it('preallocates NaN, most-recent-first, NaN below filledFrom and bit-exact at-or-above (RES1 AR, RES5 gamma BB)',()=>{
    for(const res of [1,5] as ResLevel[]){
      const {e,c,gold}=primed(res,'BB',16);
      expect(gold.length).toBe(16);
      const events:{from:number;to:number;filledFrom:number}[]=[];
      const h=e.beginDrain(c.streamId,res,16,{onDrainProgress:(handle,fromRow,toRow)=>{
        events.push({from:fromRow,to:toRow,filledFrom:handle.filledFrom});
      }});
      expect(h.streamId).toBe(c.streamId);
      expect(h.res).toBe(res);
      expect(h.filledFrom).toBe(16);
      expect(h.state).toBe('running');
      expect(h.rows.length).toBe(16);
      for(let k=0;k<16;k++){
        expect(h.rows[k]!.k).toBe(k);
        expect(h.rows[k]!.simT).toBeCloseTo(c.rowPhaseS!+k/c.rowRateHz,9);
        expect(h.rows[k]!.data.every(Number.isNaN)).toBe(true);
        if(h.rows[k]!.bearingDeg)expect(h.rows[k]!.bearingDeg!.every(Number.isNaN)).toBe(true);
      }
      const seen:number[]=[];
      while(h.state==='running'){
        const prev=h.filledFrom;
        const st=e.pumpDrain(h,{maxRows:1});
        expect(h.filledFrom).toBe(prev-1);
        expect(h.filledFrom).toBeLessThan(prev);
        seen.push(h.filledFrom);
        assertPartial(h,gold);
        if(h.filledFrom===0)expect(st).toBe('done');
      }
      expect(h.state).toBe('done');
      expect(h.filledFrom).toBe(0);
      expect(seen).toEqual(Array.from({length:16},(_,i)=>15-i));
      expect(events.length).toBe(16);
      for(let i=0;i<16;i++){
        expect(events[i]!.from).toBe(15-i);
        expect(events[i]!.to).toBe(15-i);
        expect(events[i]!.filledFrom).toBe(15-i);
      }
      const evN=events.length;
      expect(e.pumpDrain(h,{maxRows:1})).toBe('done');
      expect(h.filledFrom).toBe(0);
      expect(events.length).toBe(evN);
    }
  },20_000);

  

  it('onDrainProgress reports the inclusive range of a multi-row chunk',()=>{
    const {e,c,gold}=primed(5,'BB',16);
    const events:{from:number;to:number}[]=[];
    const h=e.beginDrain(c.streamId,5,16,{onDrainProgress:(_h,from,to)=>events.push({from,to})});
    expect(e.pumpDrain(h,{maxRows:5})).toBe('running');
    expect(h.filledFrom).toBe(11);
    expect(events).toEqual([{from:11,to:15}]);
    assertPartial(h,gold);
    expect(e.pumpDrain(h,{maxRows:11})).toBe('done');
    expect(h.filledFrom).toBe(0);
    expect(events[1]).toEqual({from:0,to:10});
    assertPartial(h,gold);
  });

  it('filledFrom only decreases; cancelDrain freezes state and stops writes and events',()=>{
    const {e,c,gold}=primed(5,'BB',16);
    const events:number[]=[];
    const h=e.beginDrain(c.streamId,5,16,{onDrainProgress:(_h,from,to)=>{events.push(from,to);}});
    e.pumpDrain(h,{maxRows:3});
    expect(h.filledFrom).toBe(13);
    expect(h.state).toBe('running');
    assertPartial(h,gold);
    const snap=h.rows.map(r=>({data:Float32Array.from(r.data),brg:r.bearingDeg?Float32Array.from(r.bearingDeg):undefined}));
    const ff=h.filledFrom,evN=events.length;
    e.cancelDrain(h);
    expect(h.state).toBe('cancelled');
    expect(h.filledFrom).toBe(ff);
    expect(e.pumpDrain(h,{maxRows:8})).toBe('cancelled');
    expect(h.filledFrom).toBe(ff);
    expect(h.state).toBe('cancelled');
    expect(events.length).toBe(evN);
    for(let k=0;k<16;k++){
      expect([...h.rows[k]!.data]).toEqual([...snap[k]!.data]);
      if(snap[k]!.brg)expect([...h.rows[k]!.bearingDeg!]).toEqual([...snap[k]!.brg!]);
    }
  });

  it('second beginDrain auto-cancels the first; new handle never reuses the first buffer',()=>{
    const {e,c,gold}=primed(1,'BB',16);
    const ev1:number[]=[],ev2:number[]=[];
    const h1=e.beginDrain(c.streamId,1,16,{onDrainProgress:()=>{ev1.push(1);}});
    e.pumpDrain(h1,{maxRows:4});
    const ff=h1.filledFrom,snap=Float32Array.from(h1.rows[15]!.data),evN=ev1.length;
    const h2=e.beginDrain(c.streamId,1,16,{onDrainProgress:()=>{ev2.push(1);}});
    expect(h1.state).toBe('cancelled');
    expect(h1.filledFrom).toBe(ff);
    expect(h2.id).not.toBe(h1.id);
    expect(h2.rows).not.toBe(h1.rows);
    expect(h2.rows[0]!.data).not.toBe(h1.rows[0]!.data);
    expect(h2.state).toBe('running');
    expect(h2.filledFrom).toBe(16);
    while(h2.state==='running')e.pumpDrain(h2,{maxRows:8});
    expect(h2.state).toBe('done');
    expect(h2.filledFrom).toBe(0);
    expect(h1.state).toBe('cancelled');
    expect(h1.filledFrom).toBe(ff);
    expect([...h1.rows[15]!.data]).toEqual([...snap]);
    expect(ev1.length).toBe(evN);
    expect(ev2.length).toBeGreaterThan(0);
    assertPartial(h2,gold);
    assertPartial(h1,gold);
    expect(e.pumpDrain(h1,{maxRows:1})).toBe('cancelled');
  });

  it('setViewRes and unsubscribe auto-cancel and freeze',()=>{
    const a=primed(5,'NB',16);
    const ev:[number,number][]=[];
    const h=a.e.beginDrain(a.c.streamId,5,16,{onDrainProgress:(_h,from,to)=>{ev.push([from,to]);}});
    a.e.pumpDrain(h,{maxRows:2});
    const ff=h.filledFrom,evN=ev.length,snap=h.rows.map(r=>Float32Array.from(r.data));
    a.e.setViewRes(a.c.streamId,3);
    expect(h.state).toBe('cancelled');
    expect(h.filledFrom).toBe(ff);
    expect(ev.length).toBe(evN);
    expect(a.e.pumpDrain(h,{maxRows:4})).toBe('cancelled');
    for(let k=0;k<16;k++)expect([...h.rows[k]!.data]).toEqual([...snap[k]!]);

    const b=primed(5,'BB',8);
    const evb:number[]=[];
    const h2=b.e.beginDrain(b.c.streamId,5,8,{onDrainProgress:()=>{evb.push(1);}});
    b.e.pumpDrain(h2,{maxRows:1});
    const ff2=h2.filledFrom,evN2=evb.length,snap2=h2.rows.map(r=>Float32Array.from(r.data));
    expect(b.e.unsubscribe(b.c.streamId)).toBe(true);
    expect(h2.state).toBe('cancelled');
    expect(h2.filledFrom).toBe(ff2);
    expect(evb.length).toBe(evN2);
    expect(b.e.pumpDrain(h2,{maxRows:4})).toBe('cancelled');
    for(let k=0;k<8;k++)expect([...h2.rows[k]!.data]).toEqual([...snap2[k]!]);
  });

  it('NB and DEMON chunked drains are bit-exact to drainHistory',()=>{
    const {e,c,gold}=primed(5,'NB',8);
    const h=e.beginDrain(c.streamId,5,8);
    while(h.state==='running')e.pumpDrain(h,{maxRows:3});
    expect(h.state).toBe('done');
    assertPartial(h,gold);

    const ed=new AcousticEngine(scenario());
    ed.subscribe({channel:1,res:5});
    const id=ed.subscribe({kind:'demon',buoyId:1}) as number;
    const step=0.25,out=new Float32Array(512);
    for(let i=0;i<8;i++){ed.advance(step);ed.writeRow(id,out);}
    const dgold=ed.drainHistory(id,null,8);
    expect(dgold.length).toBe(8);
    const hd=ed.beginDrain(id,null,8);
    expect(hd.res).toBeNull();
    expect(hd.filledFrom).toBe(8);
    expect(hd.rows[0]!.data.every(Number.isNaN)).toBe(true);
    while(hd.state==='running')ed.pumpDrain(hd,{maxRows:2});
    expect(hd.state).toBe('done');
    assertPartial(hd,dgold);
  });
});
