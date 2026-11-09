import {writeFileSync} from 'node:fs';
import {buildClassProfiles,buildEngineProducts} from '../src/catalog/profiles.js';
const out={note:'All fictional. Acoustic figures are ranges/maximums from the generator catalog; no fixed per-contact values.',engineProducts:buildEngineProducts(),classes:buildClassProfiles()};
writeFileSync('bench/results/class-profiles.json',JSON.stringify(out,null,1));
console.log(out.classes.length,'classes',out.engineProducts.length,'engine products');
console.log(JSON.stringify(out.classes.find(c=>c.id==="red-gloamspiral"),null,1));
console.log(out.engineProducts.filter(p=>p.usedByClassIds.length>1).map(p=>`${p.productName}: ${p.usedByClassIds.join(', ')}`).join('\n'));
