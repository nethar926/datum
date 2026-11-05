import { validateScenario, type Scenario, type Environment } from './scenario.js';
import { advance } from './kinematics.js';
import { isAlive, type ReceiverType, type Buoy } from './buoys.js';
import { LofarGenerator } from './lofar.js';
export interface BuoyRow { id:string; rfChannel:number; depth:number; type:ReceiverType; alive:boolean; bearing:number|null; row:Float32Array }
/** Deterministic mutable simulation; construction owns a JSON-safe copy. step has no allocations.
 * Callers may replace each result.row with an appropriately sized recycled buffer before step. */
export class AcousticEngine {
  readonly scenario:Scenario;readonly rows:BuoyRow[];readonly generators:LofarGenerator[];
  private readonly streams=new Map<number,number>();
  constructor(scenario:Scenario){validateScenario(scenario);this.scenario=structuredClone(scenario);const s=this.scenario;
    for(const c of s.contacts){for(const leg of c.motion)if(leg.at<=s.time){c.course=leg.course;c.speed=leg.speed;c.depth=leg.depth;}}
    this.generators=s.buoys.map(b=>new LofarGenerator(b,s.contacts,s.bins,s.fmax,s.seed,s.environment));
    s.buoys.forEach((_,i)=>this.streams.set(i+1,i));
    this.rows=s.buoys.map((b,i)=>({id:b.id,rfChannel:b.rfChannel,depth:b.depth,type:b.type,alive:false,bearing:null,row:this.generators[i].row}));
  }
  get time():number {return this.scenario.time;}
  setEnvironment(environment:Environment):void {
    const next={...this.scenario,environment};validateScenario(next);
    this.scenario.environment={...environment};for(const generator of this.generators)generator.setEnvironment(environment);
  }
  registerStream(id:number,channel:number):void {const i=this.scenario.buoys.findIndex(b=>b.rfChannel===channel);if(i<0)throw new Error('Unknown RF channel');this.streams.set(id,i);}
  addBuoy(b:Buoy):void {const next={...this.scenario,buoys:[...this.scenario.buoys,b]};validateScenario(next);if(this.scenario.buoys.some(x=>x.rfChannel===b.rfChannel))throw new Error('RF channel already used');this.scenario.buoys.push({...b});const owned=this.scenario.buoys[this.scenario.buoys.length-1];const g=new LofarGenerator(owned,this.scenario.contacts,this.scenario.bins,this.scenario.fmax,this.scenario.seed,this.scenario.environment);this.generators.push(g);this.rows.push({id:b.id,rfChannel:b.rfChannel,depth:b.depth,type:b.type,alive:false,bearing:null,row:g.row});}
  writeRow(streamId:number,out:Float32Array,offset=0):void {
    const i=this.streams.get(streamId);if(i===undefined)throw new Error('Unknown streamId');
    if(!Number.isInteger(offset)||offset<0||out.length<offset+this.scenario.bins)throw new Error('Row size mismatch');
    const b=this.scenario.buoys[i];if(!isAlive(b,this.time)){out.fill(NaN,offset,offset+this.scenario.bins);this.generators[i].lineCount=0;return;}this.generators[i].generate(out,offset);
  }
  advance(dt:number):void {
    if(!Number.isFinite(dt)||dt<0||dt>1e6||this.scenario.time+dt>1e9)throw new Error('Invalid step dt');
    const s=this.scenario,from=s.time;s.time+=dt;advance(s.ownship,dt);
    for(const c of s.contacts){let t=from;for(const leg of c.motion)if(leg.at>from&&leg.at<=s.time){advance(c,leg.at-t);c.course=leg.course;c.speed=leg.speed;c.depth=leg.depth;t=leg.at;}advance(c,s.time-t);}
    for(let i=0;i<s.buoys.length;i++){
      const b=s.buoys[i],r=this.rows[i];advance(b,dt);r.alive=isAlive(b,s.time);r.depth=b.depth;r.rfChannel=b.rfChannel;
      if(!r.alive){r.bearing=null;this.generators[i].lineCount=0;}
    }
  }
  step(dt:number):readonly BuoyRow[]{
    for(const r of this.rows)if(r.row.length!==this.scenario.bins)throw new Error('Missing row buffer');
    this.advance(dt);for(let i=0;i<this.rows.length;i++){const r=this.rows[i];if(r.alive){this.generators[i].generate(r.row);r.bearing=r.type==='difar'?this.generators[i].bearing:null;}else r.row.fill(NaN);}return this.rows;
  }
}
