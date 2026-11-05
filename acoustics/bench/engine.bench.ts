import {AcousticEngine,cpaScenario,fictionalSignature,generateScenario,presetToParams,type Scenario} from '../src/index.js';
function run(s:Scenario,label:string,demon=false):void {
 const e=new AcousticEngine(s),ids=new Int32Array(s.buoys.length),demonData=new Float32Array(s.buoys.length*512);
 if(demon)for(let i=0;i<ids.length;i++)ids[i]=e.subscribe({kind:'demon',buoyId:i+1});
 const step=()=>{e.step(.25);if(demon)for(let i=0;i<ids.length;i++)e.writeRow(ids[i],demonData,i*512);};
 for(let i=0;i<12;i++)step();const ms:number[]=[];for(let i=0;i<200;i++){const start=performance.now();step();ms.push(performance.now()-start);}
 ms.sort((a,b)=>a-b);console.log(`${label}: ${s.contacts.length} active contacts × 32 buoys, 1024 LOFAR bins${demon?' + 32 DEMON streams × 512 bins':''}, 200 steps: mean ${(ms.reduce((a,b)=>a+b,0)/ms.length).toFixed(2)} ms; p95 ${ms[Math.ceil(ms.length*.95)-1].toFixed(2)} ms`);
}
const s=cpaScenario();s.bins=1024;s.environment.seaState=4;
s.contacts=Array.from({length:60},(_,i)=>({...s.contacts[0],id:`fictional-${i}`,x:(i%10-5)*500,y:Math.floor(i/10)*650,params:{...fictionalSignature,tonalHz:60+i*2}}));
s.buoys=Array.from({length:32},(_,i)=>({...s.buoys[0],id:`buoy-${i+1}`,rfChannel:i,x:(i%8-4)*400,y:Math.floor(i/8)*500}));
run(s,'Legacy');const params=presetToParams('regular',91);params.subCount=51;params.surfaceTraffic=.5;const catalog=generateScenario(params);catalog.buoys=structuredClone(s.buoys);run(catalog,'Catalog (51 subs + 9 ships)');run(catalog,'Catalog + all-buoy DEMON',true);
