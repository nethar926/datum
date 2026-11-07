import {describe,it,expect} from 'vitest';
import {
  catalog,listCutSeeds,SCENARIO_PACK,renderCut,getClass,
} from '../src/index.js';

const NO_HYDP=new Set([
  'green-fennelglint','green-opalweft','red-cinderlilt','green-russetwake',
  'red-marigoldrift','blue-quartzwhorl','red-ivorycoil','green-thistledrift',
]);

function teachesHydp(cut:{classifyingLines:readonly {lineFamily?:string}[];hydpShape?:unknown;scenario?:string}):boolean {
  if(cut.hydpShape)return true;
  if(cut.scenario==='hydp-masked')return true;
  if(cut.scenario==='no-hydp')return false;
  return cut.classifyingLines.some(l=>l.lineFamily==='HYDP');
}

describe('HYDP cut audit (no NO_HYDP class for HYDP lessons)',()=>{
  it('every HYDP-teaching starter cut uses an equipped class and has HYDP energy in truth',()=>{
    const hydpCuts=listCutSeeds().filter(teachesHydp);
    expect(hydpCuts.length).toBeGreaterThan(0);
    for(const cut of hydpCuts){
      expect(NO_HYDP.has(cut.classId),cut.id).toBe(false);
      const klass=getClass(cut.classId);
      expect(klass.hydp,cut.id).toBeTruthy();
      const s=renderCut(cut);
      const contact=s.engine.scenario.contacts.find(c=>c.category!=='surface')!;
      expect(contact.params.plantSpec?.hydp,cut.id).toBeTruthy();
      const hydpLines=contact.params.tonals!.filter(l=>l.lineFamily==='HYDP');
      expect(hydpLines.length,cut.id).toBeGreaterThan(0);
      // Advance into scheduled HYDP burst when present
      const at=contact.transients?.find(t=>t.kind==='hydp')?.at??0;
      if(at>0)s.engine.advance(at+0.5);
      const live=contact.params.tonals!.filter(l=>l.lineFamily==='HYDP'&&l.power>0);
      expect(live.length,`${cut.id} live HYDP`).toBeGreaterThan(0);
      s.dispose();
    }
  });

  it('scenario pack: hydp-masked / HYDP lines → equipped; no-hydp → NO_HYDP class',()=>{
    for(const cut of SCENARIO_PACK.cuts){
      if(cut.scenario==='no-hydp'){
        expect(NO_HYDP.has(cut.classId)).toBe(true);
        expect(getClass(cut.classId).hydp).toBeUndefined();
        continue;
      }
      if(teachesHydp(cut)){
        expect(NO_HYDP.has(cut.classId),cut.id).toBe(false);
        expect(getClass(cut.classId).hydp,cut.id).toBeTruthy();
      }
    }
  });

  it('masked starter cut is morrowcoil (russetwake replacement); catalog NO_HYDP includes russetwake',()=>{
    expect(NO_HYDP.has('green-russetwake')).toBe(true);
    expect(catalog.classes.find(c=>c.id==='green-russetwake')!.hydp).toBeUndefined();
    const masked=listCutSeeds().find(c=>c.id==='cut-morrowcoil-hydp-masked');
    expect(masked).toBeTruthy();
    expect(masked!.classId).toBe('green-morrowcoil');
    expect(masked!.hydpShape?.drownFundamental).toBe(true);
    expect(getClass('green-morrowcoil').hydp).toBeTruthy();
  });
});
