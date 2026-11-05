import {it,expect} from 'vitest';
import {AcousticEngine,cpaScenario} from '../src/index.js';
function make(count:number){const s=cpaScenario();s.contacts=Array.from({length:count},(_,i)=>({...s.contacts[0],id:`contact-${i}`,x:0,y:1000,depth:50,speed:0,motion:[{at:0,course:0,speed:0,depth:50}],params:{...s.contacts[0].params,shaftHz:i?3:2,blades:i?4:5,modulation:.6}}));const e=new AcousticEngine(s),id=e.subscribe({kind:'demon',buoyId:1}),config=e.configs()[0],row=new Float32Array(config.bins);e.advance(.25);e.writeRow(id,row);return {row,df:config.fBin};}
function line(row:Float32Array,df:number,f:number){const k=Math.round(f/df);let peak=k-2;for(let i=k-1;i<=k+2;i++)if(row[i]>row[peak])peak=i;expect(Math.abs(peak*df-f)).toBeLessThanOrEqual(df);expect(row[peak]).toBeGreaterThan(25);}
it('one contact has shaft/blade fundamentals and harmonics within one bin',()=>{const {row,df}=make(1);for(const f of [2,4,10,20,30])line(row,df,f);});
it('two contacts simultaneously produce both resolved blade-rate families',()=>{const {row,df}=make(2);for(const f of [2,3,10,12,20,24])line(row,df,f);});
