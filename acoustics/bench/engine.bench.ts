import {AcousticEngine,cpaScenario,fictionalSignature,generateScenario,presetToParams,type Scenario} from '../src/index.js';
function run(s:Scenario,label:string,demon=false):void {
 const e=new AcousticEngine(s),ids=new Int32Array(s.buoys.length),demonData=new Float32Array(s.buoys.length*512);
 if(demon)for(let i=0;i<ids.length;i++)ids[i]=e.subscribe({kind:'demon',buoyId:i+1});
 const step=()=>{e.step(.25);if(demon)for(let i=0;i<ids.length;i++)e.writeRow(ids[i],demonData,i*512);};
 for(let i=0;i<12;i++)step();const ms:number[]=[];for(let i=0;i<200;i++){const start=performance.now();step();ms.push(performance.now()-start);}
 ms.sort((a,b)=>a-b);console.log(`${label}: ${s.contacts.length} active contacts × 32 buoys, 1024 LOFAR bins${demon?' + 32 DEMON streams × 512 bins':''}, 200 steps: mean ${(ms.reduce((a,b)=>a+b,0)/ms.length).toFixed(2)} ms; p95 ${ms[Math.ceil(ms.length*.95)-1].toFixed(2)} ms`);
}
/** RES-mode subscriptions: one RES gram per buoy; e.advance(.25) per 0.25 s frame plus writeRow
 * (and bearing) for streams whose row is due (every P = 2 s at RES3+, 4 s RES2, 8 s RES1). */
function runRes(s:Scenario,label:string,res:1|2|3|4|5|6|7|8|9,filter:'NB'|'BB'='NB'):void {
 const e=new AcousticEngine(s),ids=s.buoys.map(b=>e.subscribe({channel:b.rfChannel,res,filter}).streamId),out=new Float32Array(s.buoys.length*1024),brg=new Float32Array(s.buoys.length*1024);
 const step=()=>{e.advance(.25);let rows=0;for(let i=0;i<ids.length;i++)if(e.rowsReady(ids[i])>0){e.writeRow(ids[i],out,i*1024);e.writeBearingRow(ids[i],brg,i*1024);rows++;}return rows;};
 for(let i=0;i<16;i++)step();const ms:number[]=[],rowMs:number[]=[];for(let i=0;i<200;i++){const start=performance.now(),rows=step(),dt=performance.now()-start;ms.push(dt);if(rows)rowMs.push(dt);}
 ms.sort((a,b)=>a-b);const mean=(a:number[])=>a.reduce((x,y)=>x+y,0)/a.length;
 console.log(`${label}: ${s.contacts.length} active contacts × ${s.buoys.length} buoys, RES${res} ${filter} 1024 bins, 200 × 0.25 s frames: mean ${mean(ms).toFixed(2)} ms/frame; p95 ${ms[Math.ceil(ms.length*.95)-1].toFixed(2)} ms; row frames (all buoys render) mean ${mean(rowMs).toFixed(2)} ms ×${rowMs.length}`);
}
const s=cpaScenario();s.bins=1024;s.environment.seaState=4;
s.contacts=Array.from({length:60},(_,i)=>({...s.contacts[0],id:`fictional-${i}`,x:(i%10-5)*500,y:Math.floor(i/10)*650,params:{...fictionalSignature,tonalHz:60+i*2}}));
s.buoys=Array.from({length:32},(_,i)=>({...s.buoys[0],id:`buoy-${i+1}`,rfChannel:i,x:(i%8-4)*400,y:Math.floor(i/8)*500}));
run(s,'Legacy');const params=presetToParams('regular',91);params.subCount=51;params.surfaceTraffic=.5;const catalog=generateScenario(params);catalog.buoys=structuredClone(s.buoys);run(catalog,'Catalog (51 subs + 9 ships)');run(catalog,'Catalog + all-buoy DEMON',true);
runRes(s,'Legacy contacts',5);runRes(catalog,'Catalog',5);runRes(catalog,'Catalog',5,'BB');runRes(catalog,'Catalog',1);runRes(catalog,'Catalog',9);
