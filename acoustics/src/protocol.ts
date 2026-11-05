import type {TonalFamily,LineStability,LineWidth} from './sourceModel.js';
/** Exact v1 display contract: docs/data-contract.md. simT is simulation seconds on every message. */
export type GramKind='lofar'|'demon'|'bearing';
export type BuoyKind='omni'|'difar'|'dicass'|'vlad'|'bt';
export interface GramConfig {v:1;type:'gramConfig';simT:number;streamId:number;kind:GramKind;channel:number;bins:number;f0:number;fBin:number;rowRateHz:number;dbFloor:number;dbCeil:number;demodBandHz?:[number,number]}
export interface GramRows {v:1;type:'gramRows';simT:number;streamIds:Int32Array;rowIndex:Uint32Array;data:Float32Array}
export interface TruthLine {id:string;family:TonalFamily;f0Hz:number;freqHz:number;power:number;stability:LineStability;width:LineWidth;sigmaBins:number}
export interface TruthContact {id:number;sourceId:string;active:boolean;category:'surface'|'subsurface';classificationTarget:boolean;x:number;y:number;depthM:number;crsDeg:number;spdMps:number;lines:TruthLine[]}
export interface Tactical {v:1;type:'tactical';simT:number;aircraft:{x:number;y:number;altM:number;hdgDeg:number;gsMps:number};buoys:{id:number;channel:number;kind:BuoyKind;x:number;y:number;hydrophoneDepthM:number;batteryFrac:number;lifeRemainingS:number;state:'falling'|'live'|'dead'}[];bearings:{buoyId:number;freqHz:number;brgDeg:number;quality:number}[];truth?:{contacts:TruthContact[]}}
export interface Ssp {v:1;type:'ssp';simT:number;buoyId:number;depthM:Float32Array;cMps:Float32Array}
export interface DropBuoy {id?:number;channel:number;kind:BuoyKind;x:number;y:number;hydrophoneDepthM:number;lifeS?:number}
export type Command = {type:'init';seed:number;scenarioId:string}|{type:'play'}|{type:'pause'}|{type:'setRate';x:number}|{type:'setSurfaceTraffic';value:number}|{type:'seek'}|({type:'dropBuoy'}&DropBuoy)|{type:'subscribe';channel?:number;buoyId?:number;kind?:GramKind;bins?:number;band?:[number,number];demodBandHz?:[number,number]}|{type:'unsubscribe';streamId:number}|{type:'release';buffers:ArrayBuffer[]};
export type WorkerRequest=Command & {v:1;simT:number};
/** Error is a diagnostic extension; no future receiver or gram modes are implemented. */
export type WorkerResponse=GramConfig|GramRows|Tactical|Ssp|{v:1;type:'error';simT:number;message:string};
