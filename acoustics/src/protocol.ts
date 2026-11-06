export type {LineFamily} from './sourceModel.js';
export type {PropulsionTruth,SpeedGated} from './catalog/drivetrain.js';
import type {PropulsionTruth,SpeedGated} from './catalog/drivetrain.js';
import type {TonalFamily,LineStability,LineWidth,EngineLineFamily} from './sourceModel.js';
/** Exact v1 display contract: docs/data-contract.md. simT is simulation seconds on every message. */
export type GramKind='lofar'|'demon'|'bearing';
export type BuoyKind='omni'|'difar'|'dicass'|'vlad'|'bt';
/** Engine buoy health for chrome: ok (white when feeding) or fault (yellow). Life cycle stays on state. */
export type BuoyHealth='ok'|'fault';
export type GramFilter='NB'|'BB';
export type ResLevel=1|2|3|4|5|6|7|8|9;
export type LofarBandPresetId='ELF'|'VLF'|'LF'|'MF';
/** RES-mode fields (res … liveBins) are present only on RES grams (subscribe with res/filter/vernierHz,
 * or after setGram). Legacy LOFAR and DEMON configs omit them. bin k is at f0+k·fBin; for vernier
 * grams fcHz=f0+512·fBin (actual centre after any slide); bins ≥ liveBins are NaN (bandLimited).
 * bandPreset is present on legacy LOFAR configs when subscribe used a named preset without an
 * overriding explicit band (explicit band wins when both are given). */
export interface GramConfig {v:1;type:'gramConfig';simT:number;streamId:number;kind:GramKind;channel:number;bins:number;f0:number;fBin:number;rowRateHz:number;dbFloor:number;dbCeil:number;demodBandHz?:[number,number];/** Named LOFAR training-band preset when subscribe resolved edges from bandPreset alone. */bandPreset?:LofarBandPresetId;res?:ResLevel;filter?:GramFilter;bandHz?:number;fcHz?:number;enbwHz?:number;bandLimited?:boolean;liveBins?:number;/** RES only: rows are due at t = k·(1/rowRateHz) + rowPhaseS (0 ≤ rowPhaseS < P). */rowPhaseS?:number;/** FULLBAND: RES-resolution full-axis tiled stream (additive). */fullAxis?:boolean;tileBins?:number;tileCount?:number;visibleTileIndex?:number;/** FULLBAND view window from setViewWindow (Hz). */viewFLo?:number;viewFHi?:number}
export interface GramRows {v:1;type:'gramRows';simT:number;streamIds:Int32Array;rowIndex:Uint32Array;data:Float32Array;/** Per-bin bearing degrees true (0..360), same packed layout/length as data; NaN for omni/DEMON/non-DIFAR. */bearingDeg?:Float32Array;/** FULLBAND: per packed row (parallel to streamIds). */tileIndex?:Int32Array;tileBins?:Int32Array;tileF0?:Float32Array;/** 1 = real render (signal+noise); 0 = unfilled dark stub (no noise). Missing tiles are unfilled. */filled?:Uint8Array}
export interface TruthLine {eda?:{name:string;cfrMultiple:number};reactorId?:string;lineFamily?:EngineLineFamily;fundamentalHz?:number;harmonic?:number;engineId?:string;shaftIndex?:number;id:string;family:TonalFamily;f0Hz:number;freqHz:number;power:number;stability:LineStability;width:LineWidth;sigmaBins:number}
export interface TruthContact {/** m3-events seeded training behaviour, when generated. */behaviour?:import('./behaviours.js').BehaviourKind;speedGated:SpeedGated[];label:string;propulsion:PropulsionTruth;spdKts:number;id:number;sourceId:string;active:boolean;category:'surface'|'subsurface';classificationTarget:boolean;x:number;y:number;depthM:number;crsDeg:number;spdMps:number;lines:TruthLine[]}
export interface Tactical {v:1;type:'tactical';simT:number;aircraft:{x:number;y:number;altM:number;hdgDeg:number;gsMps:number};buoys:{id:number;channel:number;kind:BuoyKind;x:number;y:number;hydrophoneDepthM:number;batteryFrac:number;lifeRemainingS:number;state:'falling'|'live'|'dead';/** ok=feeding chrome path; fault=yellow error (engine-truth). */health:'ok'|'fault'}[];bearings:{buoyId:number;freqHz:number;brgDeg:number;quality:number}[];truth?:{contacts:TruthContact[]}}
export interface Ssp {v:1;type:'ssp';simT:number;buoyId:number;depthM:Float32Array;cMps:Float32Array}
export interface DropBuoy {id?:number;channel:number;kind:BuoyKind;x:number;y:number;hydrophoneDepthM:number;lifeS?:number}
export type Command = {type:'init';seed:number;scenarioId:string}|{type:'play'}|{type:'pause'}|{type:'setRate';x:number}|{type:'setSurfaceTraffic';value:number}|{type:'seek'}|({type:'dropBuoy'}&DropBuoy)|{type:'detuneBuoy';buoyId:number}|{type:'tuneBuoy';buoyId:number;channel?:number}|{type:'setBuoyFault';buoyId:number;fault:boolean}|{type:'subscribe';channel?:number;buoyId?:number;kind?:GramKind;bins?:number;band?:[number,number];bandPreset?:LofarBandPresetId;demodBandHz?:[number,number];res?:ResLevel;filter?:GramFilter;vernierHz?:number;fullAxis?:boolean;visibleTileIndex?:number}|{type:'setGram';streamId:number;res?:ResLevel;filter?:GramFilter;vernierHz?:number|null;fullAxis?:boolean|null;visibleTileIndex?:number}|{type:'setViewWindow';streamId:number;fLo:number;fHi:number}|{type:'unsubscribe';streamId:number}|{type:'skipToLatest';streamId:number}|{type:'release';buffers:ArrayBuffer[]};
export type WorkerRequest=Command & {v:1;simT:number};
/** Error is a diagnostic extension; no future receiver or gram modes are implemented. */
export type WorkerResponse=GramConfig|GramRows|Tactical|Ssp|{v:1;type:'error';simT:number;message:string};
