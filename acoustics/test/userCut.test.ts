/** UserCut save contract: recipe round-trip, short/paused windows, fallback on mismatch. */
import {describe,it,expect} from 'vitest';
import {
  AcousticEngine,
  clampParams,
  presetToParams,
  generateScenario,
  makeUserCut,
  loadUserCut,
  migrateUserCut,
  userCutSizeBytes,
  clampFallbackBuoyIds,
  applyCrewAction,
  USER_CUT_MODEL_VERSION,
  USER_CUT_VERSION,
  USER_CUT_WINDOW_S,
  USER_CUT_FALLBACK_LABEL,
  USER_CUT_FALLBACK_BUOY_CAP,
  USER_CUT_NOT_SAVED_STATUS,
  USER_CUT_NOT_SAVED_LABEL,
  RES_BINS,
  hashRowData,
  decodeFallback,
  type UserCut,
  type ResLevel,
  type CrewAction,
} from '../src/index.js';

const SEED=7;
const T_SHORT=20;
function params(){return clampParams(presetToParams('regular',SEED));}

function liveTo(tEnd:number,res:ResLevel=5){
  const p=params();
  const e=new AcousticEngine(generateScenario(p,SEED),SEED);
  const cfg=e.subscribe({channel:1,res,filter:'NB'}) as {streamId:number};
  const last=new Float32Array(RES_BINS);
  let rows=0;
  while(e.time<tEnd-1e-9){
    e.advance(Math.min(0.25,tEnd-e.time));
    while(e.rowsReady(cfg.streamId)>0){e.writeRow(cfg.streamId,last);rows++;}
  }
  return {e,p,last,rows,streamId:cfg.streamId,res};
}

describe('UserCut contract',()=>{
  it('round-trip of a short sim gives identical rows at simT1 and includes reveal',()=>{
    const {e,p,last,rows}=liveTo(T_SHORT,5);
    expect(rows).toBeGreaterThan(0);
    const cut=makeUserCut(e,e.time,'User cut 1',{params:p,resInView:[5],includeDemon:true,id:'user-test-rt',createdAt:'2026-11-12T00:00:00.000Z',preset:'regular'});
    expect(cut.v).toBe(USER_CUT_VERSION);
    expect(cut.fallbackRes).toBe(5);
    expect(cut.fallbackBuoyIds).toEqual([1]);
    expect(cut.sizeBytes).toBe(userCutSizeBytes(cut));
    expect(cut.kind).toBe('user');
    expect(cut.modelVersion).toBe(USER_CUT_MODEL_VERSION);
    expect(cut.simT0).toBe(0);
    expect(cut.simT1).toBe(T_SHORT);
    expect(cut.durationS).toBe(T_SHORT);
    expect(cut.durationS).toBeLessThanOrEqual(USER_CUT_WINDOW_S);
    expect(cut.reveal.contacts.length).toBeGreaterThan(0);
    expect(cut.reveal.contacts.every(c=>c.kind==='submarine')).toBe(true);
    const r=cut.reveal.contacts[0]!;
    expect(r.classId).toBeTruthy();
    expect(r.plant==='diesel'||r.plant==='nuclear').toBe(true);
    expect(['Blue','Green','Red']).toContain(r.force);
    expect(r.country).toBeTruthy();
    expect(Number.isFinite(r.speedKn)).toBe(true);
    expect(Number.isFinite(r.depthM)).toBe(true);
    expect(Number.isFinite(r.cpaM)&&r.cpaM>0).toBe(true);
    expect(r.behaviour).toBeTruthy();
    expect(cut.filters.difficulty).toBe('medium');
    expect(cut.filters.plant).toBe(r.plant);
    expect(cut.filters.force).toBe(r.force);
    expect(cut.fallbackRows?.encoding).toMatch(/^u8-0\.5db-(deflate-)?b64$/);
    const lofarHash=cut.check.rowHash.find(h=>h.kind==='lofar'&&h.res===5);
    expect(lofarHash).toBeTruthy();
    expect(lofarHash!.hash).toBe(hashRowData(last));

    const session=loadUserCut(cut);
    expect(session.mode).toBe('exact');
    expect(session.engine).toBeTruthy();
    expect(session.engine!.time).toBeCloseTo(cut.simT0,9);
    expect(session.reveal.contacts.length).toBe(cut.reveal.contacts.length);
  });

  it('a short sim under 900 s saves durationS equal to the available history',()=>{
    const {e,p}=liveTo(12,5);
    const cut=makeUserCut(e,e.time,'User cut 2',{params:p,resInView:[5],includeDemon:false});
    expect(cut.simT0).toBe(0);
    expect(cut.simT1).toBe(12);
    expect(cut.durationS).toBe(12);
  });

  it('a paused sim ends at the pause point (clamped to engine time)',()=>{
    const {e,p}=liveTo(30,5);
    const atPause=makeUserCut(e,e.time,'User cut 3',{params:p,resInView:[5],includeDemon:false});
    expect(atPause.simT1).toBe(30);
    expect(atPause.durationS).toBe(30);
    const earlier=makeUserCut(e,18,'User cut 3b',{params:p,resInView:[5],includeDemon:false});
    expect(earlier.simT1).toBe(18);
    expect(earlier.durationS).toBe(18);
    const later=makeUserCut(e,10_000,'User cut 3c',{params:p,resInView:[5],includeDemon:false});
    expect(later.simT1).toBe(30);
    expect(later.durationS).toBe(30);
  });

  it('a check or modelVersion mismatch plays fallback rows within 0.5 dB and keeps reveal',()=>{
    const {e,p,last}=liveTo(T_SHORT,5);
    const cut=makeUserCut(e,e.time,'User cut 4',{params:p,resInView:[5],includeDemon:false,id:'user-test-fb'});
    const stale:UserCut={...cut,modelVersion:'m3-cuts-1',check:{...cut.check,stateHashT1:'deadbeef'}};
    const session=loadUserCut(stale);
    expect(session.mode).toBe('fallback');
    expect(session.label).toBe(USER_CUT_FALLBACK_LABEL);
    expect(session.reveal.contacts.length).toBeGreaterThan(0);
    expect(session.reveal.contacts[0]!.classId).toBe(cut.reveal.contacts[0]!.classId);
    expect(session.engine).toBeUndefined();
    expect(session.fallback&&session.fallback.length).toBeGreaterThan(0);
    const stream=session.fallback!.find(s=>s.kind==='lofar'&&s.res===5)!;
    expect(stream).toBeTruthy();
    expect(stream.count).toBeGreaterThan(0);
    const off=(stream.count-1)*stream.bins;
    let maxAbs=0,compared=0,clipped=0;
    for(let i=0;i<stream.bins;i++){
      const a=last[i]!,b=stream.data[off+i]!;
      if(!Number.isFinite(a)&&!Number.isFinite(b))continue;
      expect(Number.isFinite(b)).toBe(true);
      // Existing 8-bit 0.5 dB ring (quantizeDb) stores [0, 127] dB; NB grams go negative and clip to 0.
      if(!Number.isFinite(a)||a<0||a>127){expect(a<0?b:b).toBeDefined();if(a<0){expect(b).toBe(0);clipped++;}continue;}
      const d=Math.abs(a-b);if(d>maxAbs)maxAbs=d;compared++;
    }
    expect(compared).toBeGreaterThan(0);
    expect(maxAbs).toBeLessThanOrEqual(0.5+1e-9);
    // decodeFallback matches the session pack
    const decoded=decodeFallback(cut.fallbackRows!);
    expect(decoded[0]!.count).toBe(stream.count);
  });
});

function dropActions(nBuoys:number):CrewAction[]{
  const actions:CrewAction[]=[];
  for(let i=2;i<=nBuoys;i++){
    actions.push({seq:i-1,simT:0,operatorId:'host',kind:'dropBuoy',payload:{
      channel:i,kind:'difar',x:(i-1)*400,y:0,hydrophoneDepthM:60,dropAltitudeM:0,integrationTimeS:5,
    }});
  }
  return actions;
}

function liveBuoys(nBuoys:number,tEnd:number){
  const p=params();
  const e=new AcousticEngine(generateScenario(p,SEED),SEED);
  const actions=dropActions(nBuoys);
  for(const a of actions)applyCrewAction(e,a);
  if(tEnd>e.time)e.advance(tEnd-e.time);
  const ids=e.scenario.buoys.map((b,i)=>Number(String(b.id).replace(/\D/g,''))||i+1);
  return {e,p,actions,ids};
}

describe('UserCut fallback cap and migration',()=>{
  it('clamps fallbackRows to at most 4 buoys and one RES, in deterministic id order',()=>{
    const {e,p,actions,ids}=liveBuoys(6,8);
    expect(ids.length).toBe(6);
    const cut=makeUserCut(e,e.time,'User cut cap',{
      params:p,actions,visibleBuoyIds:ids.slice().reverse(),viewRes:5,includeDemon:true,resInView:[3,5,9],
    });
    expect(cut.fallbackRes).toBe(5);
    expect(cut.fallbackBuoyIds).toEqual(ids.slice().sort((a,b)=>a-b).slice(0,USER_CUT_FALLBACK_BUOY_CAP));
    expect(cut.fallbackBuoyIds!.length).toBe(USER_CUT_FALLBACK_BUOY_CAP);
    const lofar=(cut.fallbackRows?.streams??[]).filter(s=>s.kind==='lofar');
    const demon=(cut.fallbackRows?.streams??[]).filter(s=>s.kind==='demon');
    expect(lofar.length).toBe(USER_CUT_FALLBACK_BUOY_CAP);
    expect(lofar.every(s=>s.res===5)).toBe(true);
    expect(new Set(lofar.map(s=>s.buoyId))).toEqual(new Set(cut.fallbackBuoyIds));
    expect(demon.every(s=>cut.fallbackBuoyIds!.includes(s.buoyId))).toBe(true);
    expect(clampFallbackBuoyIds([9,1,1,8,3,2,5],ids)).toEqual(ids.filter(id=>[1,2,3,5].includes(id)).sort((a,b)=>a-b).slice(0,4));
    const session=loadUserCut(cut);
    expect(session.mode).toBe('exact');
    expect(session.buoyStatus.filter(b=>b.status==='saved').map(b=>b.buoyId).sort((a,b)=>a-b)).toEqual(ids.slice().sort((a,b)=>a-b));
  });

  it('marks unsaved buoys notSaved in fallback mode with the Cuts UI label',()=>{
    const {e,p,actions,ids}=liveBuoys(6,8);
    const cut=makeUserCut(e,e.time,'User cut notSaved',{params:p,actions,visibleBuoyIds:ids,viewRes:5,includeDemon:false});
    const stale:UserCut={...cut,modelVersion:'m3-cuts-1',check:{...cut.check,stateHashT1:'deadbeef'}};
    const session=loadUserCut(stale);
    expect(session.mode).toBe('fallback');
    expect(session.label).toBe(USER_CUT_FALLBACK_LABEL);
    const saved=new Set(cut.fallbackBuoyIds);
    expect(session.buoyStatus.length).toBe(ids.length);
    for(const row of session.buoyStatus){
      if(saved.has(row.buoyId)){
        expect(row.status).toBe('saved');
        expect(row.label).toBeUndefined();
      }else{
        expect(row.status).toBe(USER_CUT_NOT_SAVED_STATUS);
        expect(row.label).toBe(USER_CUT_NOT_SAVED_LABEL);
      }
    }
    expect(session.buoyStatus.some(b=>b.status==='notSaved')).toBe(true);
    expect(session.fallback!.every(s=>saved.has(s.buoyId))).toBe(true);
  });

  it('migrates a v1 cut that lacks the cap fields',()=>{
    const {e,p}=liveTo(T_SHORT,5);
    const cut=makeUserCut(e,e.time,'User cut mig',{params:p,viewRes:5,includeDemon:false,id:'user-test-mig'});
    const {fallbackBuoyIds:_a,fallbackRes:_b,sizeBytes:_c,...rest}=cut;
    const old={...rest,v:1 as const};
    expect(old.v).toBe(1);
    expect('fallbackBuoyIds' in old).toBe(false);
    const mig=migrateUserCut(old);
    expect(mig.v).toBe(USER_CUT_VERSION);
    expect(mig.fallbackBuoyIds).toEqual(cut.fallbackBuoyIds);
    expect(mig.fallbackRes).toBe(5);
    expect(mig.sizeBytes).toBe(userCutSizeBytes(mig));
    const session=loadUserCut(old);
    expect(session.cut.v).toBe(USER_CUT_VERSION);
    expect(session.cut.fallbackBuoyIds).toEqual(cut.fallbackBuoyIds);
    expect(session.mode).toBe('exact');
  });

  it('a 16-buoy 900 s cut stays at most about 7.5 MB',()=>{
    const {e,p,actions,ids}=liveBuoys(16,USER_CUT_WINDOW_S);
    expect(ids.length).toBe(16);
    const cut=makeUserCut(e,e.time,'User cut 16',{
      params:p,actions,visibleBuoyIds:ids,viewRes:5,includeDemon:true,
      id:'user-test-16',createdAt:'2026-11-12T00:00:00.000Z',
    });
    expect(cut.fallbackBuoyIds!.length).toBeLessThanOrEqual(USER_CUT_FALLBACK_BUOY_CAP);
    const lofar=(cut.fallbackRows?.streams??[]).filter(s=>s.kind==='lofar');
    expect(new Set(lofar.map(s=>s.res)).size).toBe(1);
    const bytes=userCutSizeBytes(cut);
    expect(cut.sizeBytes).toBe(bytes);
    expect(bytes).toBeLessThanOrEqual(7.5*1024*1024);
    expect(bytes).toBeGreaterThan(1000);
  },180_000);
});
