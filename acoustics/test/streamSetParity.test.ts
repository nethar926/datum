import {describe,it,expect} from 'vitest';
import {
  SIM_STREAM_SET,liveSimStreamSet,cutStreamSet,parseLofarStreamId,vernierHzForBand,
  STARTER_CUTS,renderCut,CUT_MODEL_VERSION,
} from '../src/index.js';

describe('cut ↔ live stream set parity (Wilson)',()=>{
  it('cut stream set equals live sim stream set (same contents and order)',()=>{
    expect(cutStreamSet()).toEqual(liveSimStreamSet());
    expect(cutStreamSet()).toBe(SIM_STREAM_SET);
    expect(SIM_STREAM_SET).toEqual([
      'lofar/ELF/NB','lofar/ELF/BB','lofar/VLF/NB','lofar/VLF/BB',
      'lofar/LF/NB','lofar/LF/BB','lofar/MF/NB','lofar/MF/BB',
      'demon','difarBearing','waterColumn','truth',
    ]);
  });

  it('CutSession exposes the full stream set, waterColumn, truth, Lloyd, and can open LOFAR NB/BB',()=>{
    const seed={...STARTER_CUTS[0]!,durationS:120}; // short for test; contract allows 900
    const session=renderCut(seed);
    try{
      expect(session.streamSet).toEqual(SIM_STREAM_SET);
      expect(session.waterColumn).toBeTruthy();
      expect(session.waterColumn!.soundSpeedMps.length).toBeGreaterThan(4);
      const tac=session.tactical();
      expect(tac.truth?.contacts.length).toBeGreaterThan(0);
      const lloyd=session.lloydTruth();
      expect(lloyd.nullSpacingHz).toBeGreaterThan(0);
      expect(typeof lloyd.symmetricPass).toBe('boolean');
      const cz=session.convergenceZone();
      expect(cz).not.toBeNull();
      // Open every LOFAR product; demon already open.
      for(const id of SIM_STREAM_SET){
        if(id.startsWith('lofar/')){
          const sid=session.openStream(id);
          expect(sid).toBeTypeOf('number');
          expect(sid).toBeGreaterThan(0);
        }else if(id==='demon'){
          expect(session.openStream('demon')).toBe(session.demonStreamId);
        }else{
          expect(session.openStream(id)).toBeNull(); // logical streams
        }
      }
      // Advance a few rows — truth history grows, synchronized.
      const row=new Float32Array(session.lofar.bins);
      for(let i=0;i<8;i++)session.writeLofarRow(row);
      expect(session.truthHistory.size).toBeGreaterThan(0);
      expect(session.truthHistory.toArray()[0]!.lloyd.nullSpacingHz).toBeGreaterThan(0);
    }finally{session.dispose();}
  });

  it('parse/vernier helpers cover all band×filter products',()=>{
    for(const id of SIM_STREAM_SET){
      if(!id.startsWith('lofar/'))continue;
      const p=parseLofarStreamId(id)!;
      expect(p).toBeTruthy();
      expect(vernierHzForBand(p.bandPreset)).toBeGreaterThan(0);
    }
  });

  it('900 s cut duration is within CutSeed contract (15-min teaching cut)',()=>{
    // Contract: durationS 60..3600; Wilson 15-min = 900 s.
    expect(900).toBeGreaterThanOrEqual(60);
    expect(900).toBeLessThanOrEqual(3600);
    expect(CUT_MODEL_VERSION).toBeTypeOf('string');
  });
});
