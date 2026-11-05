import {AcousticEngine,cpaScenario,fictionalSignature,generateScenario,presetToParams,type Scenario} from '../src/index.js';
function run(s:Scenario,label:string):void {
 const e=new AcousticEngine(s);for(let i=0;i<12;i++)e.step(1);const ms:number[]=[];
 for(let i=0;i<200;i++){const start=performance.now();e.step(1);ms.push(performance.now()-start);}
 ms.sort((a,b)=>a-b);console.log(`${label}: 60 contacts × 32 buoys × 1024 bins, 200 steps: mean ${(ms.reduce((a,b)=>a+b,0)/ms.length).toFixed(2)} ms; p95 ${ms[Math.ceil(ms.length*.95)-1].toFixed(2)} ms`);
}
const s=cpaScenario();s.bins=1024;s.environment.seaState=4;
s.contacts=Array.from({length:60},(_,i)=>({...s.contacts[0],id:`fictional-${i}`,x:(i%10-5)*500,y:Math.floor(i/10)*650,params:{...fictionalSignature,tonalHz:60+i*2}}));
s.buoys=Array.from({length:32},(_,i)=>({...s.buoys[0],id:`buoy-${i}`,rfChannel:i,x:(i%8-4)*400,y:Math.floor(i/8)*500}));
run(s,'Legacy');const params=presetToParams('regular',91);params.subCount=60;const catalog=generateScenario(params);catalog.buoys=structuredClone(s.buoys);run(catalog,'Catalog');
