import {catalog} from '../catalog/classes.js';
import {CUT_MODEL_VERSION,type CutDemonLessonPack} from './types.js';

const hull=(id:string)=>{const c=catalog.classes.find(x=>x.id===id);if(!c)throw new Error(`Unknown class ${id}`);return c.hulls[0].id;};

/**
 * DEMON lesson pack. `cut-cinderlilt-cav` (STARTER_PACK) is the main DEMON lesson; the two extra
 * cuts are 15-min (900 s) static seeded cavitating diesels in physically valid states:
 *  - Surfaced (SURF, 0 m) diesel transit: prime mover on, speed under the class surfaced cap
 *    (maneuver.modeSpeedCap) and past the depth-0 cavitation inception speed.
 *  - Snorting cannot cavitate for either class inside its snorkel cap (inception at periscope depth
 *    is above the snorkel cap), and battery caps sit below surface inception, so SURF is the only
 *    honest cavitating diesel state. Gloamspiral does have a diesel plant (diesel-electric + AIP).
 * DEMON contrast: bench/demonContrast.ts (same 30 s method as db2de08). All classes fictional.
 */
export const DEMON_LESSON_PACK:CutDemonLessonPack={
 packVersion:1,
 modelVersion:CUT_MODEL_VERSION,
 mainLessonCutId:'cut-cinderlilt-cav',
 lessonCutIds:['cut-cinderlilt-cav','cut-brindleflux-cav','cut-gloamspiral-cav'],
 cuts:[
  {
   v:1,modelVersion:CUT_MODEL_VERSION,id:'cut-brindleflux-cav',seed:0xC0710010,durationS:900,richness:'moderate',
   classId:'blue-brindleflux',variantId:'base',hullId:hull('blue-brindleflux'),mode:'SURF',speedKn:13,depthM:0,
   gramLooks:['cavitation','engine-harmonics','compendium-truth'],
   lessonNote:'DEMON practice: surfaced diesel transit. Find shaft rate, blade rate and BR2 on DEMON; count blades.',
   classifyingLines:[
    {lineFamily:'BR',label:'5-blade rate on DEMON (cavitating screw); LOFAR shows cavitation broadband',n:1,harmonicOf:'PSR',behaviour:'broadband',giveaway:true},
    {lineFamily:'PSR',label:'Shaft rate (DEMON fundamental)',n:1,behaviour:'stable',giveaway:false},
    {lineFamily:'CFR',label:'Diesel firing rate (surfaced, prime mover on)',n:1,behaviour:'stable',giveaway:false},
   ],
  },
  {
   // Sparse: at 35 % past inception the 7-blade comb is weaker; moderate traffic masks BR (~6 dB).
   v:1,modelVersion:CUT_MODEL_VERSION,id:'cut-gloamspiral-cav',seed:0xC0710011,durationS:900,richness:'sparse',
   classId:'red-gloamspiral',variantId:'base',hullId:hull('red-gloamspiral'),mode:'SURF',speedKn:13.5,depthM:0,
   gramLooks:['cavitation','engine-harmonics','compendium-truth'],
   lessonNote:'DEMON practice: surfaced diesel at its surfaced cap. Dense low blade comb; blade count = BR / shaft.',
   classifyingLines:[
    {lineFamily:'BR',label:'7-blade rate on DEMON (cavitating screw)',n:1,harmonicOf:'PSR',behaviour:'broadband',giveaway:true},
    {lineFamily:'PSR',label:'Shaft rate (DEMON fundamental)',n:1,behaviour:'stable',giveaway:false},
    {lineFamily:'CFR',label:'Diesel firing rate (surfaced diesel-electric, prime mover on)',n:1,behaviour:'stable',giveaway:false},
   ],
  },
 ],
};

export const DEMON_CUTS=DEMON_LESSON_PACK.cuts;
export const DEMON_LESSON_CUT_IDS=DEMON_LESSON_PACK.lessonCutIds;
