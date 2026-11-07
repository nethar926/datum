/**
 * HYDP LF/MF visual review (Acoustics only). Writes PNGs + SNR JSON under /workspace/hydp-lfmf-review/.
 * Scratch helper — not part of the published package API.
 */
import {deflateSync} from 'node:zlib';
import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {
  getCutSeed,renderCut,CUT_FMAX,CUT_BINS,CUT_MODEL_VERSION,
  catalog,scenarioFromCut,
} from '../src/index.ts';
/** LF crop edge for review PNGs (Hz) — same teaching window as hydp-band CUT_LF_FMAX. */
const CUT_LF_FMAX=500;

const OUT='/workspace/hydp-lfmf-review';
mkdirSync(OUT,{recursive:true});

function crc32(buf){
  let c=~0;
  for(let i=0;i<buf.length;i++){
    c^=buf[i];
    for(let k=0;k<8;k++)c=(c>>>1)^(0xedb88320&-(c&1));
  }
  return ~c>>>0;
}
function chunk(type,data){
  const len=Buffer.alloc(4);len.writeUInt32BE(data.length);
  const t=Buffer.from(type,'ascii');
  const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(Buffer.concat([t,data])));
  return Buffer.concat([len,t,data,crc]);
}
/** 8-bit grayscale PNG. pixels: row-major Uint8Array length w*h. */
function writePng(path,w,h,pixels){
  const raw=Buffer.alloc((w+1)*h);
  for(let y=0;y<h;y++){raw[y*(w+1)]=0;pixels.copy(raw,y*(w+1)+1,y*w,(y+1)*w);}
  const ihdr=Buffer.alloc(13);
  ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=0;ihdr[10]=0;ihdr[11]=0;ihdr[12]=0;
  const png=Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    chunk('IHDR',ihdr),
    chunk('IDAT',deflateSync(raw,{level:9})),
    chunk('IEND',Buffer.alloc(0)),
  ]);
  writeFileSync(path,png);
}

function localMedianSnr(row,bin,window=24,guard=3,peakPick=true){
  const n=row.length,G=guard,W=window,side=[];
  for(let i=Math.max(0,bin-G-W);i<Math.max(0,bin-G);i++)if(row[i]===row[i])side.push(row[i]);
  for(let i=Math.min(n,bin+G+1);i<Math.min(n,bin+G+1+W);i++)if(row[i]===row[i])side.push(row[i]);
  side.sort((a,b)=>a-b);
  const med=side.length?side[side.length>>1]:0;
  let peak=row[bin],pb=bin;
  if(peakPick){for(let i=Math.max(0,bin-2);i<=Math.min(n-1,bin+2);i++)if(row[i]>peak){peak=row[i];pb=i;}}
  return {snr:peak-med,peak,bin:pb,med};
}

function collectWindow(cut){
  const s=renderCut(cut);
  const contact=s.engine.scenario.contacts.find(c=>c.category!=='surface');
  const hydpAt=contact.transients.find(t=>t.kind==='hydp').at;
  const dur=Number(contact.transients.find(t=>t.kind==='hydp').params.durationS);
  const t0=Math.max(0,hydpAt-2), t1=hydpAt+dur+2;
  const rows=[];
  const row=new Float32Array(s.lofar.bins);
  const pre=new Float64Array(s.lofar.bins),burst=new Float64Array(s.lofar.bins);
  let np=0,nb=0;
  while(s.simT<t1){
    if(s.writeLofarRow(row)<0)break;
    if(s.simT>=t0)rows.push(Float32Array.from(row));
    if(s.simT>=hydpAt-6&&s.simT<hydpAt-.5){for(let i=0;i<row.length;i++)pre[i]+=row[i];np++;}
    if(s.simT>=hydpAt+.25&&s.simT<=hydpAt+dur*.85){for(let i=0;i<row.length;i++)burst[i]+=row[i];nb++;}
  }
  for(let i=0;i<pre.length;i++){pre[i]/=Math.max(1,np);burst[i]/=Math.max(1,nb);}
  const fund=catalog.classes.find(k=>k.id===cut.classId).hydp.nominalHz;
  const shape=contact.params.hydpTransient.shape;
  const fBin=s.lofar.fBin, f0=s.lofar.f0, bins=s.lofar.bins;
  s.dispose();
  return {rows,pre,burst,fund,shape,fBin,f0,bins,hydpAt,dur,frames:['mf'],streamFmax:f0+fBin*(bins-1)};
}

/** Map dB row to 0..255 grayscale; mark harmonic ticks as white 1px columns near top. */
function renderGram(rows,fBin,f0,fMaxDisplay,harmonicsHz,label){
  const dispBins=Math.min(rows[0].length, Math.round((fMaxDisplay-f0)/fBin)+1);
  const h=rows.length, w=dispBins;
  // Autoscale display from percentiles of this crop.
  let vals=[];
  for(const r of rows){for(let i=0;i<dispBins;i+=4){const v=r[i];if(v===v)vals.push(v);}}
  vals.sort((a,b)=>a-b);
  const lo=vals[Math.floor(vals.length*.05)]??0, hi=vals[Math.floor(vals.length*.98)]??1;
  const span=Math.max(1e-3,hi-lo);
  const pixels=Buffer.alloc(w*h);
  for(let y=0;y<h;y++){
    const r=rows[y];
    for(let x=0;x<w;x++){
      const v=r[x];
      const u=v===v?Math.max(0,Math.min(1,(v-lo)/span)):0;
      pixels[y*w+x]=Math.round(u*255);
    }
  }
  // Light tick marks for harmonics (top 6 rows).
  for(const hz of harmonicsHz){
    const x=Math.round((hz-f0)/fBin);
    if(x<0||x>=w)continue;
    for(let y=0;y<Math.min(6,h);y++)pixels[y*w+x]=255;
    for(let y=0;y<Math.min(3,h);y++)if(x+1<w)pixels[y*w+x+1]=200;
  }
  return {pixels,w,h,lo,hi,label};
}

function sideBySide(a,b){
  const gap=4, w=a.w+gap+b.w, h=Math.max(a.h,b.h);
  const pixels=Buffer.alloc(w*h);
  for(let y=0;y<h;y++){
    for(let x=0;x<w;x++)pixels[y*w+x]=20;
    if(y<a.h)a.pixels.copy(pixels,y*w,y*a.w,(y+1)*a.w);
    if(y<b.h)b.pixels.copy(pixels,y*w+a.w+gap,y*b.w,(y+1)*b.w);
  }
  return {pixels,w,h};
}

function harmonicTable(fund,shape,pre,burst,fBin){
  const out=[];
  for(let n=1;n<=shape.orders;n++){
    const hz=fund*n;
    if(hz>CUT_FMAX)break;
    const drowned=n===1?shape.drownFundamental:(shape.drownOrders??[]).includes(n);
    const bin=Math.round(hz/fBin);
    const delta=new Float32Array(pre.length);
    for(let i=0;i<pre.length;i++)delta[i]=burst[i]-pre[i];
    const snr=localMedianSnr(delta,bin,24,3,n!==1||!shape.drownFundamental);
    out.push({n,hz:+hz.toFixed(2),drowned,snrDb:+snr.snr.toFixed(2),live:!drowned&&(shape.powerScale?true:true)&&n<=shape.orders});
  }
  return out;
}

const masked=getCutSeed('cut-morrowcoil-hydp-masked');
if(!masked)throw new Error('missing masked cut');

// Rich-stack review cut: same class, pinned rich shape, fundamental live.
const rich={
  ...structuredClone(masked),
  id:'review-morrowcoil-hydp-rich',
  seed:0xC07100C1,
  hydpShape:{orders:14,drownFundamental:false,drownOrders:[],fadeS:.05,powerScale:3},
  classifyingLines:[
    {lineFamily:'HYDP',label:'HYDP rich harmonic stack',nominalHz:masked.classifyingLines.find(l=>l.n===1).nominalHz,n:1,behaviour:'stable',giveaway:true},
    {lineFamily:'BR',label:'Blade rate',n:1,harmonicOf:'PSR',behaviour:'stable',giveaway:false},
  ],
};

for(const cut of [masked, rich]){
  const tag=cut.id.replace(/^cut-/,'').replace(/^review-/,'');
  console.log('rendering', cut.id);
  const data=collectWindow(cut);
  const harmonics=harmonicTable(data.fund,data.shape,data.pre,data.burst,data.fBin);
  const liveHz=harmonics.filter(h=>!h.drowned).map(h=>h.hz);
  const lf=renderGram(data.rows,data.fBin,data.f0,CUT_LF_FMAX,liveHz,'LF 0–500 Hz');
  const mf=renderGram(data.rows,data.fBin,data.f0,CUT_FMAX,liveHz,'MF 0–2000 Hz');
  const combo=sideBySide(lf,mf);
  const lfPath=join(OUT,`${tag}-lf.png`);
  const mfPath=join(OUT,`${tag}-mf.png`);
  const bothPath=join(OUT,`${tag}-lfmf.png`);
  writePng(lfPath,lf.w,lf.h,lf.pixels);
  writePng(mfPath,mf.w,mf.h,mf.pixels);
  writePng(bothPath,combo.w,combo.h,combo.pixels);
  const json={
    cutId:cut.id,
    classId:cut.classId,
    fundHz:data.fund,
    hydpShape:data.shape,
    hydpAt:data.hydpAt,
    durationS:data.dur,
    lofarFrames:data.frames,
    streamFmax:data.streamFmax,
    framingNote:'LF is default display; MF available when pinned HYDP stack extends above 500 Hz. Both views crop the same MF stream rows (identical simT/seed).',
    harmonics,
    paths:{lf:lfPath,mf:mfPath,sideBySide:bothPath},
  };
  writeFileSync(join(OUT,`${tag}-snr.json`), JSON.stringify(json,null,2));
  console.log('  wrote', lfPath, mfPath, bothPath);
}

writeFileSync(join(OUT,'README.txt'),
`HYDP LF/MF visual review
=======================
Generated by acoustics/scripts/hydp-lfmf-review.mjs

Masked: cut-morrowcoil-hydp-masked (green-morrowcoil, fund ~304 Hz, drownFundamental)
Rich:   review-morrowcoil-hydp-rich (same class, orders=14, fundamental live)

Each cut has:
  *-lf.png      LF crop 0–500 Hz of the shared MF stream
  *-mf.png      MF 0–2000 Hz
  *-lfmf.png    side-by-side LF | MF
  *-snr.json    per-harmonic Hz + burst−pre local-median SNR

White ticks near the top of each gram mark live harmonic frequencies.
`);
console.log('done →', OUT);
