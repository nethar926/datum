/** Ridgeline seed-7 buoy 11 bearing-energy contrast (bundled training scenario).
 *  Regression for the 3σ split-window guard: the 5° minimum sat inside the
 *  merchant's own deposit (peak σ ≈ 6.6°), which capped dB-above-background
 *  at 6.9–8.8 dB. These peaks are the engine's deterministic output, not a
 *  contrast target. */
import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {
  AcousticEngine, loadScenario, BEARING_ENERGY_TAU_S,
  compassBiasDeg, wrapDeg, geometry, createGeometry,
} from '../src/index.js';

const FILE=new URL('../src/scenario/frozen/ridgeline-field-7.json',import.meta.url);

function rowStats(energy:Uint8Array){
  let pk=0; for(let i=1;i<energy.length;i++) if(energy[i]!>energy[pk]!) pk=i;
  const sorted=[...energy].sort((a,b)=>a-b);
  return {peakU8:energy[pk]!,argmax:pk,p99U8:sorted[Math.floor(0.99*(sorted.length-1))]!,medianU8:0.5*(sorted[179]!+sorted[180]!)};
}

describe('Ridgeline seed 7 buoy 11 bearing-energy (τ = 8 s, 10–1000 Hz)',()=>{
  it('peaks on merchant k2 and matches the pinned 0–300 s contrast',()=>{
    const scen=loadScenario(JSON.parse(readFileSync(FILE,'utf8')));
    const e=new AcousticEngine(scen,7);
    expect(e.getBearingEnergyIntegration()).toBe(BEARING_ENERGY_TAU_S);
    expect(e.getBearingEnergyBand()).toEqual([10,1000]);
    e.advance(300);
    const rows=e.bearingEnergyHistory(11,0,300);
    expect(rows).toHaveLength(301);

    const b11=e.scenario.buoys.find(b=>b.id==='buoy-11')!;
    const g=createGeometry();
    const bias=compassBiasDeg(7,11);
    const pinned:{t:number;peakU8:number;argmax:number}[]=[
      {t:0,peakU8:201,argmax:126},
      {t:60,peakU8:206,argmax:127},
      {t:120,peakU8:206,argmax:128},
      {t:180,peakU8:209,argmax:128},
      {t:240,peakU8:170,argmax:127},
      {t:300,peakU8:85,argmax:127},
    ];
    const peaks:number[]=[], p99s:number[]=[];
    for(const r of rows){
      const s=rowStats(r.energy);
      peaks.push(s.peakU8); p99s.push(s.p99U8);
      expect(s.medianU8).toBe(0);
      if(r.t<=180){
        const k2=e.posedContactsAt(r.t).find(c=>c.id==='k2')!;
        geometry(k2,b11,g);
        const truth=wrapDeg(g.bearing*180/Math.PI+bias);
        const err=Math.abs(((s.argmax-truth+540)%360)-180);
        expect(err,`t=${r.t} argmax ${s.argmax} vs k2+bias ${truth.toFixed(2)}`).toBeLessThanOrEqual(2);
      }
    }
    for(const p of pinned){
      const s=rowStats(rows[p.t]!.energy);
      expect(s.peakU8,`t=${p.t} peak`).toBe(p.peakU8);
      expect(s.argmax,`t=${p.t} argmax`).toBe(p.argmax);
    }
    expect(Math.min(...peaks)).toBe(85);
    expect(Math.max(...peaks)).toBe(210);
    expect(Math.min(...p99s)).toBe(82);
    expect(Math.max(...p99s)).toBe(201);
  },120_000);
});
