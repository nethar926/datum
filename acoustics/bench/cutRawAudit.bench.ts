// Raw (pre-normalization) audit of every starter cut: are rows non-empty and do classifying lines
// stand above the local background at native cut resolution (CUT_BINS over 0..CUT_FMAX)?
import {writeFileSync} from 'node:fs';
import {STARTER_CUTS,renderCut,CUT_BINS,CUT_FMAX} from '../src/cuts/index.js';
const df=CUT_FMAX/(CUT_BINS-1),ROWS=+(process.env.ROWS??120);
const med=(a:number[])=>{const s=[...a].sort((x,y)=>x-y);return s[s.length>>1];};
const out=[] as any[];
for(const cut of STARTER_CUTS){
 const s=renderCut(cut),buf=new Float32Array(CUT_BINS),acc=new Float64Array(CUT_BINS);let n=0,nonFinite=0,allFlat=0,mn=Infinity,mx=-Infinity;
 while(n<ROWS&&s.writeLofarRow(buf)>=0){let rmn=Infinity,rmx=-Infinity;for(let i=0;i<CUT_BINS;i++){const v=buf[i];if(!Number.isFinite(v)){nonFinite++;continue;}acc[i]+=v;rmn=Math.min(rmn,v);rmx=Math.max(rmx,v);}if(rmx-rmn<1e-6)allFlat++;mn=Math.min(mn,rmn);mx=Math.max(mx,rmx);n++;}
 s.dispose();
 const mean=Array.from(acc,v=>v/Math.max(1,n));
 const lines=cut.classifyingLines.filter(l=>l.nominalHz).map(l=>{const b=Math.round(l.nominalHz!/df);let pk=-Infinity,pb=b;for(let k=b-3;k<=b+3;k++)if(mean[k]>pk){pk=mean[k];pb=k;}
  const bg=med([...mean.slice(Math.max(0,pb-40),pb-5),...mean.slice(pb+6,pb+41)]);return {label:l.label,family:l.lineFamily,hz:l.nominalHz,peakBinHz:+(pb*df).toFixed(2),contrast:+(pk-bg).toFixed(2)};});
 out.push({id:cut.id,rows:n,nonFinite,flatRows:allFlat,rowMin:+mn.toFixed(2),rowMax:+mx.toFixed(2),lines});
}
writeFileSync('bench/results/cut-raw-audit.json',JSON.stringify({df,rows:ROWS,note:'contrast = mean raw row value at line peak minus local median (same units as engine rows)',cuts:out},null,1));
for(const c of out)console.log(c.id,c.rows,'nf',c.nonFinite,'flat',c.flatRows,'range',c.rowMin,c.rowMax,c.lines.map((l:any)=>l.label+':'+l.contrast).join(' '));
