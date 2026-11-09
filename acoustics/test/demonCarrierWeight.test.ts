import {it,expect,describe} from 'vitest';
import {
  AcousticEngine,cpaScenario,
  integrateCarrierSG,integrateCarrierDbAvgTL,carrierBandWeight,sourceShape,
  thorp,exactGain,C,
} from '../src/index.js';
const BANDS:[readonly [number,number],readonly [number,number]]=[[500,2000],[2000,6000]];

describe('DEMON carrier band weighting (spectrum-based envelope)',()=>{
 for(const [lo,hi] of BANDS){
  it(`closed-form: flat S + frequency-independent G → S·G·Δf (${lo}–${hi} Hz)`,()=>{
   const span=hi-lo;
   const got=integrateCarrierSG(lo,hi,5000,5000,60,40,C,0,{flatShape:true,noLloyd:true,noAbsorption:true,samples:256});
   expect(got).toBeCloseTo(span,10);
   const range=2000,km=(range-1)/1000,fMid=(lo+hi)/2,alpha=thorp(fMid);
   const fine=integrateCarrierSG(lo,hi,range,range,60,40,C,0,{flatShape:true,noLloyd:true,samples:4096});
   const coarse=integrateCarrierSG(lo,hi,range,range,60,40,C,0,{flatShape:true,noLloyd:true,samples:128});
   expect(Math.abs(fine-coarse)/fine).toBeLessThan(1e-3);
   const approx=span*Math.exp(-alpha*km*(Math.LN10/10));
   expect(Math.abs(fine-approx)/fine).toBeLessThan(0.15);
  });

  it(`linear ∫S·G differs measurably from dB-averaged TL; code matches linear (${lo}–${hi} Hz)`,()=>{
   const range=1200,horiz=1200,zs=80,zr=40,sigma=0;
   const linear=integrateCarrierSG(lo,hi,range,horiz,zs,zr,C,sigma,{flatShape:true,samples:2048});
   const dBavg=integrateCarrierDbAvgTL(lo,hi,range,horiz,zs,zr,C,sigma,{flatShape:true,samples:2048});
   const rel=Math.abs(linear-dBavg)/Math.max(linear,dBavg);
   expect(rel).toBeGreaterThan(0.02);
   const prod=integrateCarrierSG(lo,hi,range,horiz,zs,zr,C,sigma,{flatShape:true});
   expect(Math.abs(prod-linear)/linear).toBeLessThan(5e-3);
  });

  it(`shaped S with absorption+Lloyd is positive and finite (${lo}–${hi} Hz)`,()=>{
   const w=carrierBandWeight(lo,hi,140,.05,3000,3000,50,90,'hybrid',1000,1,C,0.12);
   expect(w).toBeGreaterThan(0);
   expect(Number.isFinite(w)).toBe(true);
   const shapeMid=sourceShape((lo+hi)/2);
   const span=hi-lo;
   const band=integrateCarrierSG(lo,hi,3000,3000,50,90,C,0);
   const centre=shapeMid*Math.exp(-thorp((lo+hi)/2)*((3000-1)/1000)*(Math.LN10/10))*exactGain((lo+hi)/2,3000,50,90,C,0)*span;
   expect(Math.abs(band-centre)/Math.max(band,centre)).toBeGreaterThan(1e-4);
  });
 }

 it('fresh engines produce bit-identical DEMON rows (determinism)',()=>{
  for(const band of BANDS){
   const run=()=>{
    const s=cpaScenario();s.contacts[0].params.modulation=.6;
    const e=new AcousticEngine(s),id=e.subscribe({kind:'demon',buoyId:1,band:band as [number,number]});
    const rows:Float32Array[]=[];
    for(let i=0;i<24;i++){
     e.advance(.25);
     while(e.rowsReady(id)>0){const row=new Float32Array(512);e.writeRow(id,row);rows.push(row);}
    }
    return rows;
   };
   const a=run(),b=run();
   expect(a.length).toBeGreaterThan(5);
   expect(a.length).toBe(b.length);
   for(let i=0;i<a.length;i++)expect([...a[i]!]).toEqual([...b[i]!]);
  }
 });

 it('continuous play is bit-identical across engines (seek-with-DEMON still engine-held)',()=>{
  // workerRuntime throws 'Seek with DEMON awaits analysis-window replay'; continuous
  // play + fresh-engine equivalence is the available determinism contract today.
  for(const band of BANDS){
   const run=()=>{
    const s=cpaScenario();s.contacts[0].params.modulation=.55;
    const e=new AcousticEngine(s,99),id=e.subscribe({kind:'demon',buoyId:1,band:band as [number,number]}),out:number[][]=[];
    for(let i=0;i<40;i++){e.advance(.25);while(e.rowsReady(id)>0){const row=new Float32Array(512);e.writeRow(id,row);out.push([...row]);}}
    return out;
   };
   const a=run(),b=run();
   expect(a.length).toBe(b.length);expect(a.length).toBeGreaterThan(10);
   for(let i=0;i<a.length;i++)expect(a[i]).toEqual(b[i]);
  }
 });

 it('existing multi-contact shaft/blade recovery still holds under band-integrated weights',()=>{
  const s=cpaScenario();
  s.contacts=Array.from({length:2},(_,i)=>({...s.contacts[0],id:`contact-${i}`,x:0,y:1000,depth:50,speed:0,motion:[{at:0,course:0,speed:0,depth:50}],params:{...s.contacts[0].params,shaftHz:i?3:2,blades:i?4:5,modulation:.6}}));
  for(const band of BANDS){
   const e=new AcousticEngine(s),id=e.subscribe({kind:'demon',buoyId:1,band:band as [number,number]}),row=new Float32Array(512);
   // Physical envelope-noise floor (demon-tune): average 120 rows (30 s) in power, as a DEMON display integrates.
   const acc=new Float64Array(512);for(let r=0;r<120;r++){e.advance(.25);expect(e.writeRow(id,row)).toBeGreaterThanOrEqual(0);for(let i=0;i<512;i++)acc[i]+=10**(row[i]/10)/120;}
   for(let i=0;i<512;i++)row[i]=10*Math.log10(acc[i]);
   const df=100/511;
   for(const f of [2,3,10,12,20,24]){
    const k=Math.round(f/df);let peak=k-2;for(let i=k-1;i<=k+2;i++)if(row[i]>row[peak])peak=i;
    expect(Math.abs(peak*df-f)).toBeLessThanOrEqual(df);
    expect(row[peak]).toBeGreaterThan(4); // BR2 of a half-weight contact on the narrowest band ≈5 dB (a²·B_eff physics)
   }
  }
 });
});
