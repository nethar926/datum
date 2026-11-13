/** Per-(buoy, RES) STI warm path and DEMON warm path: generators stay on after history starts,
 * rings fill on every due row, unread until drainHistory. Legacy LOFAR and vernier are not warm. */
import {ResLofarGenerator} from './resGram.js';
import {DemonStream} from './demonStream.js';
import {resParams,RES_FRAME_S,RES_BINS,type IntegrationMode} from './res.js';
import {DEMON_CARRIER_BAND} from './cuts/norm.js';
import {RowRing,historyRingRows,HISTORY_RING_SPAN_S,quantizeDb,dequantizeDb,quantizeBearing,dequantizeBearing,PRECISION_DB,BEARING_PRECISION_DEG,type HistoryRow} from './warmRings.js';
import {isFeeding,isTuned,type Buoy} from './buoys.js';
import type {Contact,Environment,Scenario} from './scenario.js';
import type {StateHistory} from './stateHistory.js';
import type {ResLevel,GramFilter,GramConfig} from './protocol.js';
import type {WaterColumnProfile} from './waterColumn.js';

export interface WarmHost {
  time:number;
  readonly scenario:Scenario;
  readonly allContacts:Contact[];
  readonly history:StateHistory;
  readonly historyOn:boolean;
  readonly options:{deferUndeployed:boolean;lstiWarm:boolean;warmRes:boolean;ringSpanS:number;warmFill:'lazy'|'eager'};
  readonly startTime:number;
  readonly historyStart:number;
  integrationMode(i:number):IntegrationMode;
  liveTime(i:number):number;
}

const ALL_RES=[1,2,3,4,5,6,7,8,9] as ResLevel[];

export interface ResSlot {
  gen:ResLofarGenerator;
  res:ResLevel;
  start:number;
  rowPhaseS:number;
  rowRateHz:number;
  periodS:number;
  written:number;
  /** NB only (variant B): BB is derived via mapFilter on drain / BB view. */
  nb:RowRing;
}
export interface DemonSlot {
  buoy:number;
  renderer:DemonStream;
  start:number;
  rowPhaseS:number;
  rowRateHz:number;
  written:number;
  ring:RowRing;
  band:[number,number];
  streamId?:number;
}

export class WarmBank {
  readonly spanS:number;
  private readonly res=new Map<string,ResSlot>(); // `${buoy}:${res}`
  private readonly demon=new Map<string,DemonSlot>(); // `${buoy}:${lo}:${hi}`
  private readonly displayed=new Set<number>();
  private readonly displayedSince=new Map<number,number>();
  private readonly tmpNb=new Float32Array(RES_BINS);
  private readonly tmpBb=new Float32Array(RES_BINS);
  private readonly tmpBrgNb=new Float32Array(RES_BINS);
  private readonly tmpBrgBb=new Float32Array(RES_BINS);
  private readonly tmpDemon=new Float32Array(512);
  private started=false;
  constructor(private readonly host:WarmHost){this.spanS=host.options.ringSpanS;}

  markDisplayed(buoy:number):void{
    if(!this.displayed.has(buoy))this.displayedSince.set(buoy,this.host.time);
    this.displayed.add(buoy);
    this.applyDisplayedFlags(buoy);
    for(const [k,s] of this.demon)if(k.startsWith(`${buoy}:`))s.ring.displayed=true;
  }

  /** Currently viewed RES on a displayed buoy is Float32; other RES stay 8-bit (variant C). */
  private readonly viewedRes=new Map<number,ResLevel>();
  setViewed(buoy:number,res:ResLevel):void{
    this.viewedRes.set(buoy,res);
    this.applyDisplayedFlags(buoy);
  }
  private applyDisplayedFlags(buoy:number):void{
    const viewed=this.viewedRes.get(buoy);
    for(const r of ALL_RES){
      const s=this.res.get(`${buoy}:${r}`);
      if(s)s.nb.displayed=this.displayed.has(buoy)&&(viewed===undefined||viewed===r);
    }
  }

  bytes():number{
    let n=0;
    for(const s of this.res.values())n+=s.nb.bytes;
    for(const s of this.demon.values())n+=s.ring.bytes;
    return n;
  }
  allocateCapacity():void{
    for(const s of this.res.values())s.nb.allocateCapacity(true);
    for(const s of this.demon.values())s.ring.allocateCapacity(false);
  }
  resSlot(buoy:number,res:ResLevel):ResSlot|undefined{return this.res.get(`${buoy}:${res}`);}
  demonSlot(buoy:number,band:[number,number]=[DEMON_CARRIER_BAND[0],DEMON_CARRIER_BAND[1]]):DemonSlot|undefined{
    return this.demon.get(this.demonKey(buoy,band));
  }
  allDemonSlots(buoy:number):DemonSlot[]{
    const out:DemonSlot[]=[];
    for(const [k,s] of this.demon)if(k.startsWith(`${buoy}:`))out.push(s);
    return out;
  }
  private demonKey(buoy:number,band:[number,number]):string{return `${buoy}:${band[0]}:${band[1]}`;}

  /** Mark the bank started. Eager mode allocates every (buoy, RES 1–9) and default DEMON now.
   * Lazy mode allocates a slot only when ensureRes/ensureDemon is called (setViewRes / drainHistory / subscribeDemon). */
  ensure(h:WarmHost=this.host):void{
    if(!h.options.warmRes||!h.historyOn)return;
    this.started=true;
    if(h.options.warmFill!=='eager')return;
    const n=h.scenario.buoys.length;
    for(let i=0;i<n;i++){
      for(const res of ALL_RES)this.ensureRes(i,res,h);
      if(isTuned(h.scenario.buoys[i]!))this.ensureDemon(i,[DEMON_CARRIER_BAND[0],DEMON_CARRIER_BAND[1]],h);
    }
  }

  /** Create one (buoy, RES) STI slot if needed. `start` is the grid origin at *history-start time*
   * (same formula as a subscribe at that instant) so a lazy backfill is historically correct. */
  ensureRes(buoy:number,res:ResLevel,h:WarmHost=this.host):ResSlot{
    const key=`${buoy}:${res}`;
    let s=this.res.get(key);
    if(s)return s;
    const sc=h.scenario,n=sc.buoys.length,fmax=sc.fMax??sc.fmax,b=sc.buoys[buoy]!;
    // Float32 backfill only if the buoy has been displayed since history started; otherwise historical rows are 8-bit.
    const since=this.displayedSince.get(buoy),viewed=this.viewedRes.get(buoy),disp=since!==undefined&&since<=h.historyStart+1e-12&&(viewed===undefined||viewed===res);
    const p=resParams(res),frames=Math.round(p.rowPeriodS/RES_FRAME_S),phase=Math.floor(buoy*frames/n)*RES_FRAME_S;
    // Origin is the grid at the moment history turned on (host.startTime if history recorded from then,
    // otherwise current time — first RES subscribe). Using startTime when history is on from t=0.
    const t0=h.historyStart;
    const start=Math.floor((t0-phase)/p.rowPeriodS+1e-9)*p.rowPeriodS+phase;
    const gen=new ResLofarGenerator(b,h.allContacts,fmax,sc.seed,sc.environment,{res,filter:'NB'},RES_BINS);
    gen.setWaterColumn?.(sc.waterColumn);
    gen.setHistory(h.history);
    gen.setIntegrationMode(h.integrationMode(buoy),{lstiWarm:h.options.lstiWarm,startTime:h.startTime,liveTime:h.liveTime(buoy)});
    const cap=historyRingRows(p.rowPeriodS,this.spanS);
    s={gen,res,start,rowPhaseS:start+1/p.rowRateHz,rowRateHz:p.rowRateHz,periodS:p.rowPeriodS,written:0,
      nb:new RowRing(cap,RES_BINS,disp)};
    this.res.set(key,s);
    this.fillSlot(s,buoy,h);
    this.applyDisplayedFlags(buoy);
    return s;
  }

  ensureDemon(buoy:number,band:[number,number],h:WarmHost=this.host):DemonSlot{
    const key=this.demonKey(buoy,band);
    let s=this.demon.get(key);
    if(s)return s;
    const b=h.scenario.buoys[buoy],disp=this.displayed.has(buoy);
    const start=Math.floor(h.time*4)/4,rowRateHz=4;
    const renderer=new DemonStream(b,h.allContacts,h.scenario.seed,band,h.scenario.environment);
    renderer.setWaterColumn?.(h.scenario.waterColumn);
    const cap=historyRingRows(1/rowRateHz,this.spanS);
    s={buoy,renderer,start,rowPhaseS:start+1/rowRateHz,rowRateHz,written:0,ring:new RowRing(cap,512,disp),band:[band[0],band[1]]};
    this.demon.set(key,s);
    this.fillDemon(s,h);
    return s;
  }

  private fillSlot(slot:ResSlot,buoy:number,h:WarmHost):void{
    const t=h.time,b=h.scenario.buoys[buoy];if(!b)return;
    const due=Math.max(0,Math.floor((t-slot.start)*slot.rowRateHz+1e-9));
    const aboard=h.options.deferUndeployed&&t<(b.deployedAt??Number.POSITIVE_INFINITY);
    if(aboard){if(due>slot.written)slot.written=due;return;}
    while(slot.written<due){
      const k=slot.written,tEnd=slot.start+(k+1)/slot.rowRateHz,out=this.tmpNb;
      if(!isFeeding(b,t)){out.fill(NaN);slot.nb.push(k,out);slot.written++;continue;}
      slot.gen.generateAt(tEnd,out,0);
      slot.nb.push(k,out,slot.gen.bearingRow);
      slot.written++;
    }
  }
  private fillDemon(slot:DemonSlot,h:WarmHost):void{
    const t=h.time,b=h.scenario.buoys[slot.buoy];if(!b)return;
    const due=Math.max(0,Math.floor((t-slot.start)*slot.rowRateHz+1e-9));
    const aboard=h.options.deferUndeployed&&t<(b.deployedAt??Number.POSITIVE_INFINITY);
    if(aboard){if(due>slot.written)slot.written=due;return;}
    while(slot.written<due){
      const k=slot.written,out=this.tmpDemon;
      if(!isFeeding(b,t)||!isTuned(b))out.fill(NaN);
      else slot.renderer.write(out,0,k);
      slot.ring.push(k,out);
      slot.written++;
    }
  }
  /** Push environment / water-column / integration-mode into every already-allocated warm generator. */
  setEnvironment(e:Environment):void{
    for(const s of this.res.values())s.gen.setEnvironment(e);
    for(const s of this.demon.values())s.renderer.setEnvironment(e);
  }
  setWaterColumn(wc:WaterColumnProfile|undefined):void{
    for(const s of this.res.values())s.gen.setWaterColumn?.(wc);
    for(const s of this.demon.values())s.renderer.setWaterColumn?.(wc);
  }
  syncIntegration(buoy:number,apply:(gen:ResLofarGenerator)=>void):void{
    for(const [key,s] of this.res)if(Number(key.split(':')[0])===buoy)apply(s.gen);
  }

  /** Fill every already-allocated slot at the current host time. Eager mode also creates the full warm set. */
  tick(h:WarmHost=this.host):void{
    if(!h.options.warmRes||!this.started)return;
    if(h.options.warmFill==='eager')this.ensure(h);
    for(const [key,slot] of this.res)this.fillSlot(slot,Number(key.split(':')[0]!),h);
    for(const slot of this.demon.values())this.fillDemon(slot,h);
  }

  drainRes(buoy:number,res:ResLevel,filter:GramFilter,rows:number):HistoryRow[]{
    if(!this.host.historyOn)return [];
    const s=this.ensureRes(buoy,res);
    if(filter==='BB')return this.deriveBB(s,buoy,rows);
    return s.nb.drain(rows,s.rowPhaseS,s.rowRateHz);
  }

  /** Replay STI from history on a side generator (does not advance the warm gen), mapFilter BB.
   * Bit-exact to a live BB subscribe for rows still covered by StateHistory (the keep-history
   * window). 8-bit flags follow the corresponding NB row. */
  deriveBB(slot:ResSlot,buoy:number,rows:number):HistoryRow[]{
    const take=Math.min(Math.max(0,rows),slot.written);
    if(take<=0)return [];
    const startK=slot.written-take;
    const h=this.host,sc=h.scenario,fmax=sc.fMax??sc.fmax,b=sc.buoys[buoy]!;
    const gen=new ResLofarGenerator(b,h.allContacts,fmax,sc.seed,sc.environment,{res:slot.res,filter:'NB'},RES_BINS);
    gen.setWaterColumn?.(sc.waterColumn);
    gen.setHistory(h.history);
    gen.setIntegrationMode(h.integrationMode(buoy),{lstiWarm:h.options.lstiWarm,startTime:h.startTime,liveTime:h.liveTime(buoy)});
    const db=new Float32Array(RES_BINS),brg=new Float32Array(RES_BINS);
    const nbDb=new Float32Array(RES_BINS);
    const out:HistoryRow[]=[];
    for(let k=0;k<slot.written;k++){
      const tEnd=slot.start+(k+1)/slot.rowRateHz;
      if(!isFeeding(b,h.time)){db.fill(NaN);brg.fill(NaN);}
      else{gen.generateAt(tEnd,this.tmpNb,0);gen.mapFilter('BB',db,brg);}
      if(k<startK)continue;
      const flags=slot.nb.get(k,nbDb);
      let data=new Float32Array(db),bearing=new Float32Array(brg);
      let quantized=false,bearingQuantized=false,precisionDb:number|undefined,bearingPrecisionDeg:number|undefined;
      if(flags?.quantized){
        quantized=true;precisionDb=PRECISION_DB;
        for(let i=0;i<data.length;i++)data[i]=dequantizeDb(quantizeDb(data[i]!));
      }
      if(flags?.hasBearing && flags.bearingQuantized){
        bearingQuantized=true;bearingPrecisionDeg=BEARING_PRECISION_DEG;
        for(let i=0;i<bearing.length;i++)bearing[i]=dequantizeBearing(quantizeBearing(bearing[i]!));
      }
      const row:HistoryRow={k,simT:slot.rowPhaseS+k/slot.rowRateHz,data,quantized,precisionDb};
      if(flags?.hasBearing){row.bearingDeg=bearing;row.bearingQuantized=bearingQuantized;row.bearingPrecisionDeg=bearingPrecisionDeg;}
      out.push(row);
    }
    return out;
  }

  /** BB rows `[fromK, toK)` bit-exact to live / drainHistory, via AR seek then generateAt. */
  deriveBBRange(slot:ResSlot,buoy:number,fromK:number,toK:number):HistoryRow[]{
    const lo=Math.max(0,fromK),hi=Math.min(Math.max(lo,toK),slot.written);
    if(lo>=hi)return [];
    const h=this.host,sc=h.scenario,fmax=sc.fMax??sc.fmax,b=sc.buoys[buoy]!;
    const gen=new ResLofarGenerator(b,h.allContacts,fmax,sc.seed,sc.environment,{res:slot.res,filter:'NB'},RES_BINS);
    gen.setWaterColumn?.(sc.waterColumn);
    gen.setHistory(h.history);
    gen.setIntegrationMode(h.integrationMode(buoy),{lstiWarm:h.options.lstiWarm,startTime:h.startTime,liveTime:h.liveTime(buoy)});
    gen.seekRowKey(lo);
    const db=new Float32Array(RES_BINS),brg=new Float32Array(RES_BINS);
    const nbDb=new Float32Array(RES_BINS);
    const out:HistoryRow[]=[];
    for(let k=lo;k<hi;k++){
      const tEnd=slot.start+(k+1)/slot.rowRateHz;
      if(!isFeeding(b,h.time)){db.fill(NaN);brg.fill(NaN);}
      else{gen.generateAt(tEnd,this.tmpNb,0);gen.mapFilter('BB',db,brg);}
      const flags=slot.nb.get(k,nbDb);
      let data=new Float32Array(db),bearing=new Float32Array(brg);
      let quantized=false,bearingQuantized=false,precisionDb:number|undefined,bearingPrecisionDeg:number|undefined;
      if(flags?.quantized){
        quantized=true;precisionDb=PRECISION_DB;
        for(let i=0;i<data.length;i++)data[i]=dequantizeDb(quantizeDb(data[i]!));
      }
      if(flags?.hasBearing && flags.bearingQuantized){
        bearingQuantized=true;bearingPrecisionDeg=BEARING_PRECISION_DEG;
        for(let i=0;i<bearing.length;i++)bearing[i]=dequantizeBearing(quantizeBearing(bearing[i]!));
      }
      const row:HistoryRow={k,simT:slot.rowPhaseS+k/slot.rowRateHz,data,quantized,precisionDb};
      if(flags?.hasBearing){row.bearingDeg=bearing;row.bearingQuantized=bearingQuantized;row.bearingPrecisionDeg=bearingPrecisionDeg;}
      out.push(row);
    }
    return out;
  }

  /** mapFilter BB of the warm gen's last generateAt into `out` (live BB view, just-filled row). */
  mapLastBB(slot:ResSlot,out:Float32Array,bearing?:Float32Array):void{
    slot.gen.mapFilter('BB',out,bearing);
  }
  drainDemon(buoy:number,band:[number,number],rows:number):HistoryRow[]{
    const s=this.demon.get(this.demonKey(buoy,band));if(!s)return [];
    return s.ring.drain(rows,s.rowPhaseS,s.rowRateHz);
  }
}
