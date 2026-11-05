import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { AcousticEngine, cpaScenario, busyScenario, doppler, dopplerApprox, geometry, createGeometry, exactGain, interferenceGain, pathDifference, farFieldGain, nullRange, nullSpacing, transmissionLoss, spreadingLoss, thorp, ambientLevel, fictionalSignature, bladeRate, Demon, ContactSynth, FFT, difarBearing, mulberry32, deriveSeed, gaussian, isAlive, soundSpeed, knotsToMps, mpsToKnots, validateScenario, dbToPower, powerToDb, inceptionSpeed } from '../src/index.js';
const minimize=(fn:(x:number)=>number,lo:number,hi:number):number=>{for(let i=0;i<100;i++){const a=lo+(hi-lo)/3,b=hi-(hi-lo)/3;if(fn(a)<fn(b))hi=b;else lo=a;}return (lo+hi)/2;};
const bytes=(a:Float32Array)=>Buffer.from(a.buffer,a.byteOffset,a.byteLength);
describe('Doppler and relative geometry',()=>{
  it('approach closed form',()=>expect(doppler(100,10)).toBeCloseTo(100*1500/1490,12));
  it('recede closed form',()=>expect(doppler(100,-10)).toBeCloseTo(100*1500/1510,12));
  it('moving receiver and approximation',()=>{expect(doppler(100,10,5)).toBeCloseTo(100*1505/1490,12);expect(Math.abs(doppler(100,1,1)-dopplerApprox(100,1,1))).toBeLessThan(.001);});
  it('CPA unshifted; radial S-curve symmetric',()=>{
    const s=cpaScenario(),c=s.contacts[0],b=s.buoys[0],g=createGeometry();c.x=0;
    geometry(c,b,g);expect(doppler(100,g.sourceRadial)).toBe(100);expect(g.cpaTime).toBeCloseTo(0);
    c.x=-1000;geometry(c,b,g);const approach=g.sourceRadial;const f1=doppler(100,approach);c.x=1000;geometry(c,b,g);
    expect(g.sourceRadial).toBeCloseTo(-approach,12);expect(f1).toBeGreaterThan(100);expect(doppler(100,g.sourceRadial)).toBeLessThan(100);
    // Exact Doppler is symmetric in inverse frequency, not in frequency itself.
    expect(1/f1+1/doppler(100,g.sourceRadial)).toBeCloseTo(2/100,14);
  });
  it('zero speed/range CPA is finite',()=>{const s=cpaScenario(),g=geometry(s.ownship,s.ownship,createGeometry());expect(g.range).toBe(0);expect(g.cpaTime).toBe(0);expect(Object.values(g).every(Number.isFinite)).toBe(true);});
});
describe('Lloyd mirror exact and asymptotic conditions',()=>{
  it('numerically located exact-field frequency minima obey path difference',()=>{
    const r=150,zs=20,zr=30,c=1500,delta=pathDifference(r,zs,zr),spacing=c/delta;
    for(let n=1;n<=3;n++){const f=minimize(f=>exactGain(f,r,zs,zr,c),(n-.25)*spacing,(n+.25)*spacing);expect(Math.abs(f*delta/c-n)).toBeLessThan(1e-8);}
  });
  it('numerical range minimum matches exact path condition, converges to far field',()=>{
    const f=3000,zs=30,zr=40,c=1500,L=c/f;
    const exact=Math.sqrt(((4*zs*zr/L-L)/2)**2-(zs-zr)**2);
    const r=minimize(r=>exactGain(f,r,zs,zr,c),exact*.99,exact*1.01);
    expect(Math.abs(pathDifference(r,zs,zr)/L-1)).toBeLessThan(1e-7);
    expect(r/Math.max(zs,zr)).toBeGreaterThan(50);expect(Math.abs(r/nullRange(f,zs,zr)-1)).toBeLessThan(.01);
    expect(interferenceGain(f,exact,zs,zr)).toBeLessThan(1e-20);
  });
  it('frequency null spacing converges and exact gain max is 6.0206 dB',()=>{
    const r=6000,zs=30,zr=40,delta=pathDifference(r,zs,zr),df=1500/delta;
    const a=minimize(f=>exactGain(f,r,zs,zr),df*.8,df*1.2),b=minimize(f=>exactGain(f,r,zs,zr),df*1.8,df*2.2);
    expect(Math.abs((b-a)/nullSpacing(r,zs,zr)-1)).toBeLessThan(.01);
    expect(exactGain(df/2,r,zs,zr)).toBeLessThanOrEqual(4);
    expect(powerToDb(farFieldGain(1500,r,zs,zr))).toBeLessThanOrEqual(10*Math.log10(4));
    expect(powerToDb(exactGain(df/2,r,zs,zr))).toBeCloseTo(6.0206,3);
  });
  it('surface cancellation and co-located paths guarded',()=>{expect(exactGain(100,100,0,40)).toBe(0);expect(Number.isFinite(exactGain(100,0,0,0))).toBe(true);});
});
describe('TL ambient and units',()=>{
  it('spherical geometric reference',()=>{expect(transmissionLoss(1,1000)).toBe(0);expect(spreadingLoss(1000)).toBe(60);});
  it('cylindrical slope and hybrid continuity',()=>{expect(spreadingLoss(1000,'cylindrical')-spreadingLoss(100,'cylindrical')).toBe(10);expect(spreadingLoss(1000,'hybrid')).toBe(60);expect(spreadingLoss(10000,'hybrid')).toBe(70);});
  it('Thorp 1 kHz reference',()=>expect(thorp(1000)).toBeCloseTo(.06900409,7));
  it('sea state raises ambient',()=>expect(ambientLevel(1000,4)).toBeGreaterThan(ambientLevel(1000,0)));
  it('ambient decreases above 1 kHz in wind-dominated band',()=>{expect(ambientLevel(3000,4)).toBeLessThan(ambientLevel(1000,4));expect(ambientLevel(10000,4)).toBeLessThan(ambientLevel(3000,4));});
  it('shipping raises low frequency level',()=>expect(ambientLevel(50,0,'heavy')).toBeGreaterThan(ambientLevel(50,0,'light')));
  it('Mackenzie and unit roundtrip',()=>{expect(soundSpeed(10,35,0)).toBeCloseTo(1489.8034,4);expect(Number.isFinite(soundSpeed(-100,100,1e9))).toBe(true);expect(mpsToKnots(knotsToMps(13))).toBeCloseTo(13);expect(powerToDb(dbToPower(100))).toBe(100);});
});
describe('source DEMON FFT DIFAR',()=>{
  it('shaft times blades and depth inception',()=>{expect(bladeRate(fictionalSignature)).toBe(10);expect(inceptionSpeed(200)).toBeGreaterThan(inceptionSpeed(10));});
  it('FFT impulse is unit spectrum',()=>{const fft=new FFT(16),input=new Float32Array(16);input[0]=1;fft.transform(input,false);expect([...fft.real]).toEqual(Array(16).fill(1));expect([...fft.imag]).toEqual(Array(16).fill(0));});
  it('DEMON recovers shaft and blade from actual AM acoustic samples within one bin',()=>{
    const fs=4096,n=32768,signal=new Float32Array(n),d=new Demon(n,fs),synth=new ContactSynth(fictionalSignature,fs,123);
    synth.fill(signal);const ps=d.process(signal),df=fs/n;
    for(const f of [fictionalSignature.shaftHz,bladeRate(fictionalSignature)]){const expected=Math.round(f/df);let peak=expected-3;for(let i=expected-2;i<=expected+3;i++)if(ps[i]>ps[peak])peak=i;expect(Math.abs(peak*df-f)).toBeLessThanOrEqual(df);expect(ps[peak]).toBeGreaterThan(ps[expected+8]*30);}
    expect(d.process(signal)).toBe(ps);
  });
  it('DIFAR signed cross terms bearing within 2 degrees at good SNR',()=>{
    const n=4096,o=new Float32Array(n),e=new Float32Array(n),north=new Float32Array(n),rng=mulberry32(3),bearing=2.1;
    for(let i=0;i<n;i++){const v=Math.sin(i*.17);o[i]=v+.02*gaussian(rng);e[i]=v*Math.sin(bearing)+.02*gaussian(rng);north[i]=v*Math.cos(bearing)+.02*gaussian(rng);}
    expect(Math.abs(difarBearing(o,e,north)-bearing)*180/Math.PI).toBeLessThan(2);
  });
});
describe('buoys engine determinism robustness',()=>{
  it('alive timer, depth RF and receiver type carried',()=>{const s=cpaScenario(),b=s.buoys[0];b.deployedAt=10;b.life=20;b.depth=123;b.rfChannel=17;expect(isAlive(b,9)).toBe(false);expect(isAlive(b,29.99)).toBe(true);expect(isAlive(b,30)).toBe(false);const e=new AcousticEngine(s),r=e.step(11)[0];expect(r.alive).toBe(true);expect(r.depth).toBe(123);expect(r.rfChannel).toBe(17);expect(r.type).toBe('difar');expect(e.step(20)[0].alive).toBe(false);});
  it('same seed identical byte streams across several steps',()=>{const a=new AcousticEngine(busyScenario()),b=new AcousticEngine(busyScenario());for(let i=0;i<4;i++){a.step(1);b.step(1);for(let j=0;j<a.rows.length;j++)expect(bytes(a.rows[j].row).equals(bytes(b.rows[j].row))).toBe(true);}});
  it('different seed differs and independent identity-keyed streams',()=>{const s=cpaScenario(),a=new AcousticEngine(s);s.seed++;const b=new AcousticEngine(s);expect(bytes(a.step(1)[0].row).equals(bytes(b.step(1)[0].row))).toBe(false);expect(deriveSeed(42,'a')).not.toBe(deriveSeed(42,'b'));});
  it('no Math.random in browser src (grep equivalent)',()=>{for(const f of readdirSync(new URL('../src/',import.meta.url),{recursive:true,encoding:'utf8'}))if(f.endsWith('.ts'))expect(readFileSync(new URL('../src/'+f,import.meta.url),'utf8')).not.toMatch(/Math\s*\.\s*random/);});
  it('250 zero range/speed extreme-depth contacts finite',()=>{const s=cpaScenario();s.bins=64;s.buoys[0].x=0;s.buoys[0].y=0;s.buoys[0].depth=1e6;s.contacts=Array.from({length:250},(_,i)=>({...s.contacts[0],id:`f-${i}`,x:0,y:0,depth:i%2?1e6:0,speed:0,motion:[{at:0,depth:i%2?1e6:0,speed:0,course:0}]}));const e=new AcousticEngine(s);expect([...e.step(0)[0].row].every(Number.isFinite)).toBe(true);});
  it('small seeded fuzz over accepted scenarios',()=>{const rng=mulberry32(99);for(let k=0;k<12;k++){const s=busyScenario();s.bins=32;s.seed=Math.floor(rng()*4294967296);for(const c of s.contacts){c.x=(rng()-.5)*1e6;c.y=(rng()-.5)*1e6;c.depth=rng()*1e6;c.speed=rng()*500;c.motion=[{at:0,course:c.course,speed:c.speed,depth:c.depth}];}const e=new AcousticEngine(s);for(const r of e.step(rng()*100))expect([...r.row].every(Number.isFinite)).toBe(true);}});
  it('no allocation sanity: output row and descriptor identities reused',()=>{const e=new AcousticEngine(cpaScenario()),rows=e.step(0),row=rows[0].row,r=rows[0];for(let i=0;i<20;i++){expect(e.step(1)).toBe(rows);expect(e.rows[0]).toBe(r);expect(e.rows[0].row).toBe(row);expect(e.generators[0].generate()).toBe(row);}});
  it('caller-provided row and cached environment update',()=>{const e=new AcousticEngine(cpaScenario()),g=e.generators[0],row=new Float32Array(e.scenario.bins),before=g.ambient[100];expect(g.generate(row)).toBe(row);e.setEnvironment({...e.scenario.environment,seaState:6});expect(g.ambient[100]).toBeGreaterThan(before);});
  it('JSON roundtrip and validation rejects NaN, pending types and malformed input',()=>{const s=JSON.parse(JSON.stringify(busyScenario()));expect(()=>validateScenario(s)).not.toThrow();s.contacts[0].speed=NaN;expect(()=>validateScenario(s)).toThrow();const b=cpaScenario();(b.buoys[0].type as string)='dicass';expect(()=>validateScenario(b)).toThrow();expect(()=>validateScenario(null)).toThrow();});
  it('invalid dt leaves engine time unchanged',()=>{const e=new AcousticEngine(cpaScenario());expect(()=>e.step(NaN)).toThrow();expect(()=>e.step(-1)).toThrow();expect(e.time).toBe(0);});
});

it('writeRow writes in place at offset, preserving surrounding storage',()=>{const e=new AcousticEngine(cpaScenario()),out=new Float32Array(1030);out.fill(-999);e.advance(.25);e.writeRow(1,out,3);expect(out[0]).toBe(-999);expect(out[1029]).toBe(-999);expect([...out.subarray(3,1027)].every(Number.isFinite)).toBe(true);});
it('versioned params and timed motion legs apply changes at boundaries',()=>{const s=cpaScenario();expect(s.v).toBe(1);s.contacts[0].motion=[{at:0,course:0,speed:0,depth:50},{at:2,course:Math.PI/2,speed:4,depth:100}];const e=new AcousticEngine(s),x=e.scenario.contacts[0].x;e.advance(3);expect(e.scenario.contacts[0].x).toBeCloseTo(x+4);expect(e.scenario.contacts[0].depth).toBe(100);});
it('ambient cache is PSD, independent of bin width',()=>{const a=cpaScenario(),b=cpaScenario();b.bins=512;const ga=new AcousticEngine(a).generators[0],gb=new AcousticEngine(b).generators[0];expect(ga.ambient[0]).toBeCloseTo(dbToPower(ambientLevel(500/1023/2,1,'light')),4);expect(ga.ambient[1023]).toBe(gb.ambient[511]);});
