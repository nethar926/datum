import {catalog} from './classes.js';
import type {Catalog} from './schema.js';
/** Printable class-only view: ranged keys/ratios, no hull identities or current exact frequencies. */
export function buildCompendium(source:Catalog=catalog){return {catalogVersion:source.catalogVersion,classes:source.classes.map(c=>({id:c.id,name:c.name,operatorNationId:c.operatorNationId,force:c.force,plant:c.plant,idKeys:c.idKeys}))};}
