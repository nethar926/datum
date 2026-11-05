import type {Force} from './schema.js';
export interface Nation {id:string;name:string;force:Force;electricalHz:50|60}
/** Fictional operator allowlist. Every unlisted operator, including every ISO country code, is rejected. */
export const NATIONS:readonly Nation[]=[
 {id:'varkeshna-federation',name:'Varkeshna Federation',force:'Red',electricalHz:50},
 {id:'kaelun-republic',name:'Kaelun Republic',force:'Red',electricalHz:50},
 {id:'zahrestan',name:'Zahrestan',force:'Red',electricalHz:50},
 {id:'dorhan-commonwealth',name:'Dorhan Commonwealth',force:'Red',electricalHz:50},
 {id:'norrland-union',name:'Norrland Union',force:'Blue',electricalHz:60},
 {id:'ostmark-league',name:'Ostmark League',force:'Blue',electricalHz:60},
 {id:'tarsian-republic',name:'Tarsian Republic',force:'Green',electricalHz:60},
 {id:'meridia',name:'Meridia',force:'Green',electricalHz:60},
];
export const REAL_OPERATOR_DENYLIST:readonly string[]=['USA','CAN','ENG','ICL','GER','FRA','SWE','JAP','AUS','RUS','CHN','IRN','PAK','IND','NKO','PRK','KP','DPRK','NORTH KOREA',"DEMOCRATIC PEOPLE'S REPUBLIC OF KOREA",'KOR','ROK','KR','SOUTH KOREA','REPUBLIC OF KOREA'];
export function isDeniedOperator(value:string):boolean{return REAL_OPERATOR_DENYLIST.includes(value.trim().toUpperCase());}
