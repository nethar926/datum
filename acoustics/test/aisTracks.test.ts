/** AcousticEngine.aisTracks, mirrored from Swift AisTracksTests. */
import {it,expect,describe} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {AcousticEngine,cpaScenario,clampParams,generateScenario,AIS_POSITION_JITTER_M,createAisTrackSource} from '../src/index.js';

function bits(x:number):string{
  const b=new Float64Array([x]);const u=new Uint32Array(b.buffer);
  return (u[1]!.toString(16).padStart(8,'0')+u[0]!.toString(16).padStart(8,'0'));
}
function engine7(){return new AcousticEngine(generateScenario(clampParams({seed:7})),7);}
function noSub(tracks:{id:string}[]){
  for(const t of tracks){
    expect(t.id.startsWith('fictional-'),t.id).toBe(false);
    expect(t.id.startsWith('surface-'),t.id).toBe(true);
  }
}

const fxPath=fileURLToPath(new URL('../../ios/DatumAcoustics/Fixtures/ais-tracks-seed7.json',import.meta.url));
const fx=JSON.parse(readFileSync(fxPath,'utf8')) as {
  seed:number;times:number[];nAt0:number;names:string[];ids:string[];
  at:Record<string,{id:string;name:string;x:number;y:number;crsDeg:number;spdMps:number;xBits:string;yBits:string;crsBits:string;spdBits:string}[]>;
};

describe('aisTracks (matches Swift SimEngine.aisTracks)',()=>{
  it('cpa scenario (subsurface only, no traffic) is empty',()=>{
    const e=new AcousticEngine(cpaScenario());
    e.scenario.contacts.forEach(c=>{c.category='subsurface';c.classificationTarget=true;});
    // cpa has a surface pool created at init; set traffic 0 and retune via setSurfaceTraffic.
    e.setSurfaceTraffic(0);
    expect(e.aisTracks(0)).toEqual([]);
    e.advance(2);
    expect(e.aisTracks(e.time)).toEqual([]);
  });

  it('frozen seed 7: names, ids, bit-exact poses, never subsurface',()=>{
    const e=engine7();
    expect(e.aisTracks(0).map(t=>t.id)).toEqual(fx.ids);
    expect(e.aisTracks(0).map(t=>t.name)).toEqual(fx.names);
    expect(e.time).toBe(0);
    for(const t of fx.times){
      const got=e.aisTracks(t);
      const exp=fx.at[`t${t}`]??fx.at[`t${Math.trunc(t)}`];
      expect(got.length).toBe(exp.length);
      expect(got.length).toBe(fx.nAt0);
      noSub(got);
      for(let i=0;i<got.length;i++){
        expect(got[i]!.id).toBe(exp[i]!.id);
        expect(got[i]!.name).toBe(exp[i]!.name);
        expect(bits(got[i]!.x)).toBe(exp[i]!.xBits);
        expect(bits(got[i]!.y)).toBe(exp[i]!.yBits);
        expect(bits(got[i]!.crsDeg)).toBe(exp[i]!.crsBits);
        expect(bits(got[i]!.spdMps)).toBe(exp[i]!.spdBits);
      }
    }
    for(const n of fx.names){
      expect(n.toLowerCase().startsWith('fictional ')).toBe(false);
      expect(['Prismhopper','Pebblewake','Tumblekeel','Mossbarge','Thistlehaul','Opalhold','Flaxfloat']).toContain(n);
    }
  });

  it('plot coords at current time match live contact (Reveal frame); query is read-only',()=>{
    const e=engine7();
    for(let i=0;i<40;i++)e.advance(.25);
    const tracks=e.aisTracks(e.time);
    expect(tracks.length).toBeGreaterThan(0);
    noSub(tracks);
    for(const t of tracks){
      const c=e.scenario.contacts.find(x=>x.id===t.id)!;
      expect(c.category).toBe('surface');
      expect(c.classificationTarget).not.toBe(true);
      expect(c.active).not.toBe(false);
      const dist=Math.hypot(t.x-c.x,t.y-c.y);
      expect(dist).toBeLessThanOrEqual(AIS_POSITION_JITTER_M+1e-12);
      expect(t.spdMps).toBe(c.speed);
      expect(t.name).toBe(c.params.label.trim());
      expect(t.name.toLowerCase().startsWith('fictional ')).toBe(false);
      expect(t.callsign).toMatch(/^[A-Z]{2}[0-9]{2}[A-Z]$/);
      expect(t.shipClass).toBeTruthy();
      expect(t.class).toBe(t.shipClass);
      expect(t.hdgAvailable).toBe(t.hdgDeg!=null);
      const src=createAisTrackSource({seed:7,count:0});
      const dec=src.decorate({id:t.id,name:t.name,x:c.x,y:c.y,crsDeg:AcousticEngine.degreesTrue(c.course),spdMps:c.speed},e.time);
      expect(t.crsDeg).toBe(dec.crsDeg);
      expect(t.hdgDeg).toBe(dec.hdgDeg);
      expect(t.hdgAvailable).toBe(dec.hdgAvailable);
      expect(t.callsign).toBe(dec.callsign);
      expect(t.type).toBe(dec.type);
    }
    const snap=e.scenario.contacts.map(c=>({x:c.x,y:c.y,course:c.course,speed:c.speed}));
    const t0=e.time;
    e.aisTracks(500);
    expect(e.time).toBe(t0);
    e.scenario.contacts.forEach((c,i)=>{
      expect(c.x).toBe(snap[i]!.x);expect(c.y).toBe(snap[i]!.y);
      expect(c.course).toBe(snap[i]!.course);expect(c.speed).toBe(snap[i]!.speed);
    });
  });

  it('future-time replay is independent of how far the live engine has stepped',()=>{
    const a=engine7(),b=engine7();
    const replay=a.aisTracks(100);
    for(let i=0;i<100/.25;i++)b.advance(.25);
    expect(a.time).toBe(0);
    expect(b.time).toBe(100);
    const fromMid=b.aisTracks(300),fromZero=a.aisTracks(300);
    expect(fromMid.map(t=>({...t,xBits:bits(t.x),yBits:bits(t.y),crsBits:bits(t.crsDeg),spdBits:bits(t.spdMps)})))
      .toEqual(fromZero.map(t=>({...t,xBits:bits(t.x),yBits:bits(t.y),crsBits:bits(t.crsDeg),spdBits:bits(t.spdMps)})));
    expect(replay.length).toBe(9);
    expect(a.time).toBe(0);
    expect(b.time).toBe(100);
  });

  it('many seeds never emit subsurface or classification targets',()=>{
    for(const seed of [1,7,8,42,91,131,371]){
      const e=new AcousticEngine(generateScenario(clampParams({seed})),seed);
      for(const t of [0,30,120,600]){
        const tracks=e.aisTracks(t);
        noSub(tracks);
        for(const tr of tracks){
          const c=e.scenario.contacts.find(x=>x.id===tr.id)!;
          expect(c.category).toBe('surface');
          expect(c.classificationTarget).not.toBe(true);
        }
      }
    }
  });


  it('every AIS track id maps to an active surface contact; no phantoms by default',()=>{
    for(const seed of [1,7,8,42,91,131,371]){
      const e=new AcousticEngine(generateScenario(clampParams({seed})),seed);
      for(const t of [0,30,120,600]){
        const tracks=e.aisTracks(t);
        const ids=new Set(tracks.map(tr=>tr.id));
        expect(ids.size).toBe(tracks.length);
        for(const tr of tracks){
          const c=e.scenario.contacts.find(x=>x.id===tr.id);
          expect(c,`missing surface contact for AIS id ${tr.id} seed=${seed}`).toBeTruthy();
          expect(c!.category).toBe('surface');
          expect(c!.classificationTarget).not.toBe(true);
          expect(c!.active).not.toBe(false);
          const pose=t===e.time?c!:null;
          if(pose){
            expect(Math.hypot(tr.x-pose.x,tr.y-pose.y)).toBeLessThanOrEqual(AIS_POSITION_JITTER_M+1e-12);
          }
        }
      }
    }
  });

  it('backgroundAisOnly (default off) may add planner ships that are not gram contacts',()=>{
    const e=engine7();
    expect(e.scenario.backgroundAisOnly).toBeFalsy();
    const base=e.aisTracks(0);
    expect(base.every(t=>e.scenario.contacts.some(c=>c.id===t.id))).toBe(true);
    e.scenario.backgroundAisOnly=true;
    const withBg=e.aisTracks(0);
    expect(withBg.length).toBeGreaterThan(base.length);
    const phantoms=withBg.filter(t=>!e.scenario.contacts.some(c=>c.id===t.id));
    expect(phantoms.length).toBeGreaterThan(0);
    expect(phantoms.every(t=>t.id.startsWith('ais-'))).toBe(true);
  });

  it('invalid time throws',()=>{
    const e=engine7();
    expect(()=>e.aisTracks(NaN)).toThrow(/AIS time/);
    expect(()=>e.aisTracks(Infinity)).toThrow(/AIS time/);
  });
});
