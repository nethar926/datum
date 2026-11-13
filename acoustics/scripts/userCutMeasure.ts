/** Measure UserCut JSON sizes and pre-roll times. Box-only; fictional data. */
import {writeFileSync} from 'node:fs';
import {
  AcousticEngine,clampParams,presetToParams,generateScenario,makeUserCut,userCutJsonBytes,userCutSizeBytes,prerollRecipe,
  applyCrewAction,USER_CUT_WINDOW_S,type CrewAction,type ResLevel,type UserCut,
} from '../src/index.js';

const SEED=7;
const params=clampParams(presetToParams('regular',SEED));

function dropActions(nBuoys:number):CrewAction[]{
  const actions:CrewAction[]=[];
  for(let i=2;i<=nBuoys;i++){
    actions.push({seq:i-1,simT:0,operatorId:'host',kind:'dropBuoy',payload:{
      channel:i,kind:'difar',x:(i-1)*400,y:0,hydrophoneDepthM:60,dropAltitudeM:0,integrationTimeS:5,
    }});
  }
  return actions;
}

function prepare(nBuoys:number,tEnd:number){
  const actions=dropActions(nBuoys);
  const e=new AcousticEngine(generateScenario(params,SEED),SEED);
  for(const a of actions)applyCrewAction(e,a);
  const t0=performance.now();
  // Step only as needed for the engine clock; makeUserCut re-renders with history itself.
  if(tEnd>e.time)e.advance(tEnd-e.time);
  return {e,actions,advanceMs:performance.now()-t0};
}

type Row={buoys:number;res:string;windowS:number;fallback:boolean;startSnapshot:string;jsonBytes:number;streams:number;encoding?:string;makeMs:number;fallbackBuoyIds?:number[];fallbackRes?:number;sizeBytes?:number};
const rows:Row[]=[];

async function measure(nBuoys:number,viewRes:ResLevel,windowS:number,visible?:number[]){
  const {e,actions}=prepare(nBuoys,windowS);
  const ids=e.scenario.buoys.map((b,i)=>Number(String(b.id).replace(/\D/g,''))||i+1);
  const visibleBuoyIds=visible??ids;
  const label=`${nBuoys} buoy, viewRes ${viewRes}, visible ${visibleBuoyIds.length}, ${windowS}s`;
  console.error(`makeUserCut ${label} ...`);
  const t0=performance.now();
  const cut:UserCut=makeUserCut(e,windowS,`User cut ${nBuoys}x${viewRes}`,{
    params,actions,viewRes,visibleBuoyIds,includeDemon:true,preset:'regular',id:`meas-${nBuoys}-${viewRes}-${windowS}`,
    createdAt:'2026-11-12T00:00:00.000Z',
  });
  const makeMs=performance.now()-t0;
  const withFb=userCutSizeBytes(cut);
  const noFb=userCutJsonBytes(cut,{includeFallback:false});
  console.error(`  ${label}: sizeBytes ${withFb} (${cut.fallbackRows?.encoding}), recipe only ${noFb} bytes, make ${makeMs.toFixed(0)} ms, durationS=${cut.durationS}, streams=${cut.fallbackRows?.streams.length??0}, fallbackBuoyIds=${cut.fallbackBuoyIds?.join(',')}, fallbackRes=${cut.fallbackRes}`);
  rows.push({buoys:nBuoys,res:String(viewRes),windowS,fallback:true,startSnapshot:'omitted (unsupported)',jsonBytes:withFb,streams:cut.fallbackRows?.streams.length??0,encoding:cut.fallbackRows?.encoding,makeMs,fallbackBuoyIds:cut.fallbackBuoyIds,fallbackRes:cut.fallbackRes,sizeBytes:cut.sizeBytes});
  rows.push({buoys:nBuoys,res:String(viewRes),windowS,fallback:false,startSnapshot:'omitted (unsupported)',jsonBytes:noFb,streams:0,makeMs});
}

const preroll:{minutes:number;buoys:number;ms:number}[]=[];
function measurePreroll(minutes:number,nBuoys:number){
  const actions=dropActions(nBuoys);
  console.error(`pre-roll ${minutes} min, ${nBuoys} buoy ...`);
  const {ms}=prerollRecipe(params,SEED,actions,minutes*60);
  console.error(`  ${minutes} min, ${nBuoys} buoy: ${ms.toFixed(1)} ms`);
  preroll.push({minutes,buoys:nBuoys,ms});
}

const windowS=Number(process.env.USER_CUT_WINDOW_S??USER_CUT_WINDOW_S);
await measure(1,5,windowS);
await measure(16,5,windowS);
measurePreroll(60,1);
measurePreroll(240,1);
measurePreroll(60,16);
measurePreroll(240,16);

const out={when:new Date().toISOString(),windowS,note:'startSnapshot omitted: no engine snapshot/restore skips a pre-roll. fallbackRows cap: at most 4 on-screen buoys and 1 viewRes, zlib deflate + base64 of the 8-bit 0.5 dB warm-ring encoding (quantizeDb). DEMON included for those buoys. Times are box wall-clock.',rows,preroll};
const path=process.env.USER_CUT_MEASURE_OUT??'/tmp/userCut-measure.json';
writeFileSync(path,JSON.stringify(out,null,2));
console.log(JSON.stringify(out,null,2));
console.error('wrote',path);
