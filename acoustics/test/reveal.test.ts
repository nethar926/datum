/** Reveal (truth / truthContacts / UserCut) returns only submarines. */
import {it,expect,describe} from 'vitest';
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {AcousticEngine,cpaScenario,clampParams,generateScenario,isSubmarineContact} from '../src/index.js';

function engine7(){return new AcousticEngine(generateScenario(clampParams({seed:7})),7);}

const fxPath=fileURLToPath(new URL('../../ios/DatumAcoustics/Fixtures/reveal-seed7.json',import.meta.url));

describe('reveal is submarines only',()=>{
  it('truth() and truthContacts() contain only submarines with kind submarine',()=>{
    const e=engine7();
    const all=e.allTruthContacts();
    expect(all.length).toBeGreaterThan(0);
    expect(all.some(c=>c.category==='surface')).toBe(true);
    expect(all.some(c=>isSubmarineContact(c))).toBe(true);
    const revealed=e.truthContacts();
    expect(revealed).toBeDefined();
    expect(revealed!.length).toBeGreaterThan(0);
    expect(revealed!.length).toBe(all.filter(c=>c.kind==='submarine').length);
    expect(revealed!.every(c=>c.kind==='submarine')).toBe(true);
    expect(revealed!.every(c=>c.category!=='surface')).toBe(true);
    const t=e.truth();
    expect(t!.contacts.map(c=>c.sourceId)).toEqual(revealed!.map(c=>c.sourceId));
    const tac=e.tactical();
    expect(tac.truth!.contacts.every(c=>c.kind==='submarine')).toBe(true);
    expect(tac.truth!.contacts.map(c=>c.sourceId).sort()).toEqual(revealed!.map(c=>c.sourceId).sort());
    // Surface contacts are covered by AIS, not Reveal.
    for(const c of all.filter(c=>c.category==='surface')){
      expect(revealed!.some(r=>r.sourceId===c.sourceId)).toBe(false);
      expect(e.aisTracks(0).some(t=>t.id===c.sourceId)).toBe(c.active!==false);
    }
  });

  it('HostPolicy allowRevealLocation / allowAisConnectivity still gate the public APIs',()=>{
    const e=engine7();
    e.crewHostPolicy={allowRevealLocation:false,allowAisConnectivity:true};
    expect(e.isCrewSession).toBe(true);
    expect(e.truth()).toBeUndefined();
    expect(e.truthContacts()).toBeUndefined();
    expect(e.tactical().truth).toBeUndefined();
    expect(e.aisTracks(0).length).toBeGreaterThan(0);
    expect(e.allTruthContacts().length).toBeGreaterThan(0);
    e.crewHostPolicy={allowRevealLocation:true,allowAisConnectivity:false};
    expect(e.truthContacts()!.every(c=>c.kind==='submarine')).toBe(true);
    expect(e.aisTracks(0)).toEqual([]);
    e.crewNoAisConnectivity=true;
    e.crewHostPolicy={allowRevealLocation:true,allowAisConnectivity:true};
    expect(e.aisTracks(0)).toEqual([]);
    e.crewHostPolicy=null;
    e.crewNoAisConnectivity=true;
    expect(e.aisTracks(0).length).toBeGreaterThan(0);
    expect(e.truthContacts()!.every(c=>c.kind==='submarine')).toBe(true);
  });

  it('cpa subsurface-only still reveals the sub and has empty AIS at traffic 0',()=>{
    const e=new AcousticEngine(cpaScenario());
    e.setSurfaceTraffic(0);
    const rev=e.truthContacts()!;
    expect(rev.length).toBeGreaterThan(0);
    expect(rev.every(c=>c.kind==='submarine')).toBe(true);
    expect(e.aisTracks(0)).toEqual([]);
  });

  it('frozen seed 7 reveal sourceIds match the Swift parity fixture',()=>{
    const e=engine7();
    const contacts=e.truthContacts(0)!;
    const got=contacts.map(c=>({sourceId:c.sourceId,id:c.id,kind:c.kind,category:c.category,x:c.x,y:c.y,depthM:c.depthM,crsDeg:c.crsDeg,spdMps:c.spdMps,active:c.active}));
    let fx:typeof got;
    try{fx=JSON.parse(readFileSync(fxPath,'utf8')).contacts;}
    catch{
      writeFileSync(fxPath,JSON.stringify({seed:7,contacts:got},null,2));
      fx=got;
    }
    expect(got.map(c=>c.sourceId)).toEqual(fx.map(c=>c.sourceId));
    expect(got.every(c=>c.kind==='submarine')).toBe(true);
    for(let i=0;i<got.length;i++){
      expect(got[i]!.kind).toBe(fx[i]!.kind);
      expect(got[i]!.category).toBe(fx[i]!.category);
      expect(got[i]!.id).toBe(fx[i]!.id);
    }
  });
});
