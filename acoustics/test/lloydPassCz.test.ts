import {describe,it,expect} from 'vitest';
import {
  LloydPassTracker,lloydPassQualifier,nullSpacing,pathDifference,
  buildWaterColumn,estimateConvergenceZone,criticalDepthM,CZ_MIN_DEPTH_EXCESS_M,
} from '../src/index.js';

describe("Lloyd pass qualifier (live geometry)",()=>{
  it('symmetric constant-depth pass keeps symmetricPass; null spacing matches closed form',()=>{
    const t=new LloydPassTracker({depthM:60,courseRad:0,speedMps:5});
    t.observe({depthM:60,courseRad:0,speedMps:5});
    const r=1200,zs=60,zr=90,q=t.truth(zs,zr,r);
    expect(q.symmetricPass).toBe(true);
    expect(q.reasons).toEqual([]);
    expect(q.nullSpacingHz).toBeCloseTo(nullSpacing(r,zs,zr),12);
    expect(q.pathDifferenceM).toBeCloseTo(pathDifference(r,zs,zr),12);
  });

  it('depth change mid-pass breaks symmetry; closed-form null spacing still tracks live zs',()=>{
    const start={depthM:40,courseRad:Math.PI/2,speedMps:6};
    const mid={depthM:80,courseRad:Math.PI/2,speedMps:6}; // dived 40 m
    const r=1500,zr=60;
    const q=lloydPassQualifier(start,mid,mid.depthM,zr,r);
    expect(q.symmetricPass).toBe(false);
    expect(q.reasons).toContain('depthChange');
    expect(q.reasons).not.toContain('courseChange');
    // Instantaneous Δf uses the NEW zs, not the start depth.
    expect(q.zsM).toBe(80);
    expect(q.nullSpacingHz).toBeCloseTo(nullSpacing(r,80,zr),12);
    expect(q.nullSpacingHz).not.toBeCloseTo(nullSpacing(r,40,zr),3);
  });

  it('course or speed change also flags asymmetry',()=>{
    const a=lloydPassQualifier(
      {depthM:50,courseRad:0,speedMps:5},
      {depthM:50,courseRad:1,speedMps:5},50,60,1000);
    expect(a.reasons).toContain('courseChange');
    const b=lloydPassQualifier(
      {depthM:50,courseRad:0,speedMps:5},
      {depthM:50,courseRad:0,speedMps:8},50,60,1000);
    expect(b.reasons).toContain('speedChange');
  });

  it('tracker accumulates reasons without resetting (continuous FE history)',()=>{
    const t=new LloydPassTracker({depthM:50,courseRad:0,speedMps:5});
    t.observe({depthM:70,courseRad:0,speedMps:5});
    t.observe({depthM:70,courseRad:.5,speedMps:5});
    expect(t.asymmetryReasons).toEqual(expect.arrayContaining(['depthChange','courseChange']));
    // Further observe does not clear
    t.observe({depthM:70,courseRad:.5,speedMps:5});
    expect(t.asymmetryReasons.length).toBe(2);
  });
});

describe('Convergence zone from SSP',()=>{
  it('deep profile with depth excess predicts CZ in 30–35 nmi band; shallow does not',()=>{
    // Deep ocean-like column to 5000 m with cold deep water → c rises with depth.
    const deep=buildWaterColumn({surfaceTempC:20,deepTempC:2,salinityPsu:35,maxDepthM:5000,mixedLayerDepthM:50,thermoclineThicknessM:800,samples:128});
    const cz=estimateConvergenceZone({profile:deep,zsM:50,zrM:100,bottomDepthM:5000});
    expect(cz.criticalDepthM).not.toBeNull();
    expect(cz.depthExcessM).toBeGreaterThan(CZ_MIN_DEPTH_EXCESS_M);
    expect(cz.possible).toBe(true);
    expect(cz.rangeNmi!).toBeGreaterThanOrEqual(30);
    expect(cz.rangeNmi!).toBeLessThanOrEqual(36);
    // Same zs but bottom above critical → no CZ
    const zc=criticalDepthM(deep,cz.soundSpeedAtSourceMps)!;
    const shallowBottom=estimateConvergenceZone({profile:deep,zsM:50,zrM:100,bottomDepthM:zc+50});
    expect(shallowBottom.possible).toBe(false);
  });

  it('CZ depends on SSP shape + zs, not depth alone',()=>{
    const a=buildWaterColumn({surfaceTempC:18,deepTempC:3,salinityPsu:35,maxDepthM:4500,samples:96});
    const b=buildWaterColumn({surfaceTempC:10,deepTempC:9,salinityPsu:35,maxDepthM:4500,samples:96}); // almost isothermal
    const za=estimateConvergenceZone({profile:a,zsM:80,zrM:90,bottomDepthM:4500});
    const zb=estimateConvergenceZone({profile:b,zsM:80,zrM:90,bottomDepthM:4500});
    // Different SSPs at identical geometry → different critical depth / possibility
    expect(za.soundSpeedAtSourceMps).not.toBeCloseTo(zb.soundSpeedAtSourceMps,0);
    // At least one of critical depths differs or possibility differs
    expect(za.criticalDepthM!==zb.criticalDepthM||za.possible!==zb.possible).toBe(true);
  });
});
