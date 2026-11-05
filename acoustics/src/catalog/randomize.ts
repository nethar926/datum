import {catalog} from './classes.js';
import {effectiveParams,type OperatingState,type SubmarineClass,type Propulsion} from './schema.js';
import {mulberry32,type Random} from '../prng.js';
/** AIP is a selection bucket for capable diesel classes in AIP MODE, never a propulsion type.
 * Teaching rarity weights: common 40, uncommon 15, rare 5, very rare 2. */
export type Rarity=Propulsion|'aip';
export type RarityWeights=Record<Rarity,number>;
export const rarityWeights:RarityWeights={dieselDirect:5,dieselGearReduction:15,dieselElectric:40,aip:2,nuclearGearReduction:40,nuclearElectric:2};
export const rarityOrder:Rarity[]=['dieselDirect','dieselGearReduction','dieselElectric','aip','nuclearGearReduction','nuclearElectric'];
export function drawRarity(rng:Random,weights:RarityWeights=rarityWeights):Rarity{
 let total=0;for(const k of rarityOrder){if(!Number.isFinite(weights[k])||weights[k]<0)throw new Error('Invalid rarity weight');total+=weights[k];}if(total<=0)throw new Error('Positive total rarity weight required');let n=rng()*total;for(const k of rarityOrder){n-=weights[k];if(n<0)return k;}return rarityOrder[rarityOrder.length-1];
}
export interface RandomSelection {rarity:Rarity;klass:SubmarineClass;classId:string;variantId:string;hullId:string;operatingState:OperatingState;course:number}
export function randomizeSelection(rng:Random,weights:RarityWeights=rarityWeights):RandomSelection {
 const rarity=drawRarity(rng,weights),classes=catalog.classes.filter(c=>rarity==='aip'?c.params.aipCapable:c.params.propulsion===rarity),klass=classes[Math.floor(rng()*classes.length)];if(!klass)throw new Error('No class in rarity bucket');
 const variantId=klass.variants[Math.floor(rng()*klass.variants.length)].id,hullId=klass.hulls[Math.floor(rng()*klass.hulls.length)].id,p=effectiveParams(klass,variantId);
 return {rarity,klass,classId:klass.id,variantId,hullId,operatingState:{speedKn:p.maxSpeedKn*(.15+.65*rng()),depthM:p.depthM[0]+(p.depthM[1]-p.depthM[0])*rng(),mode:rarity==='aip'?'aip':rarity==='dieselElectric'?'battery':'normal'},course:rng()*Math.PI*2};
}
export const randomize=(seed:number,weights:RarityWeights=rarityWeights):RandomSelection=>randomizeSelection(mulberry32(seed),weights);
