import {chooseOperatingState} from './operations.js';
import {catalog} from './classes.js';
import {effectiveParams,type OperatingState,type SubmarineClass,type Propulsion} from './schema.js';
import {mulberry32,type Random} from '../prng.js';
/** AIP is a selection bucket for capable diesel classes in AIP MODE, never a propulsion type.
 * Teaching rarity weights: common 40, uncommon 15, rare 5, very rare 2. */
export type Rarity=Propulsion|'aip';
export type RarityWeights=Record<Rarity,number>;
export const rarityWeights:RarityWeights={dieselDirect:5,dieselGearReduction:15,dieselElectric:40,aip:2,nuclearGearReduction:40,nuclearElectric:2};
export const rarityOrder:Rarity[]=['dieselDirect','dieselGearReduction','dieselElectric','aip','nuclearGearReduction','nuclearElectric'];
/** Nuclear plant classes are catalogued for the Compendium but marked coming-soon for training. */
export function isNuclearClass(c:{plant:string}):boolean{return c.plant==='nuclear';}
/** Predicate the FE can reuse for Compendium "Coming soon" badges. Currently identical to isNuclearClass. */
export function isComingSoonClass(c:{plant:string}):boolean{return isNuclearClass(c);}
/** Zero nuclear rarity buckets for procedural scenario draws; repair an all-zero pool to diesel defaults. */
export function scenarioPoolWeights(weights:RarityWeights=rarityWeights):RarityWeights{
 const w={...weights,nuclearGearReduction:0,nuclearElectric:0};
 if(!rarityOrder.some(k=>Number.isFinite(w[k])&&w[k]>0)){
  const fallback={...rarityWeights,nuclearGearReduction:0,nuclearElectric:0};
  return fallback;
 }
 return w;
}
export function drawRarity(rng:Random,weights:RarityWeights=rarityWeights):Rarity{
 let total=0;for(const k of rarityOrder){if(!Number.isFinite(weights[k])||weights[k]<0)throw new Error('Invalid rarity weight');total+=weights[k];}if(total<=0)throw new Error('Positive total rarity weight required');let n=rng()*total;for(const k of rarityOrder){n-=weights[k];if(n<0)return k;}return rarityOrder[rarityOrder.length-1];
}
export interface RandomSelection {rarity:Rarity;klass:SubmarineClass;classId:string;variantId:string;hullId:string;operatingState:OperatingState;course:number}
export function randomizeSelection(rng:Random,weights:RarityWeights=rarityWeights):RandomSelection {
 // Coming-soon (nuclear) classes stay in the catalog but are excluded from procedural scenario draws.
 const pool=scenarioPoolWeights(weights);
 const rarity=drawRarity(rng,pool),classes=catalog.classes.filter(c=>!isComingSoonClass(c)&&(rarity==='aip'?c.plant==='diesel'&&c.aipCapable:c.params.propulsion===rarity&&!((rarity==='dieselElectric')&&c.aipCapable))),klass=classes[Math.floor(rng()*classes.length)];if(!klass)throw new Error('No class in rarity bucket');
 const variantId=klass.variants[Math.floor(rng()*klass.variants.length)].id,hullId=klass.hulls[Math.floor(rng()*klass.hulls.length)].id,p=effectiveParams(klass,variantId);
 return {rarity,klass,classId:klass.id,variantId,hullId,operatingState:chooseOperatingState(klass,p.maxSpeedKn*(.15+.65*rng()),p.depthM[0]+(p.depthM[1]-p.depthM[0])*rng(),false,rng),course:rng()*Math.PI*2};
}
export const randomize=(seed:number,weights:RarityWeights=rarityWeights):RandomSelection=>randomizeSelection(mulberry32(seed),weights);
