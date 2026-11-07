import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {
  DISCLAIMER,SOURCES,MODEL_ASSUMPTIONS,sourceById,renderSourcesMarkdown,
} from '../src/sources.js';

const LEAD=
  'All vessels and acoustic signatures are fictional and procedurally generated. Any resemblance to actual vessels or measured acoustic signatures is unintended and coincidental.';

describe('DISCLAIMER + SOURCES (About)',()=>{
 it('exports DISCLAIMER separately from SOURCES with Lead wording + synthetic ocean profiles',()=>{
  expect(typeof DISCLAIMER).toBe('string');
  expect(DISCLAIMER.length).toBeGreaterThan(40);
  expect(DISCLAIMER.startsWith(LEAD)).toBe(true);
  expect(DISCLAIMER).toMatch(/ocean profiles/i);
  expect(DISCLAIMER).toMatch(/synthetic/i);
  expect(DISCLAIMER).toMatch(/SOURCES/i);
  // Must not be the same object/export as the citation list.
  expect(SOURCES).not.toBe(DISCLAIMER as unknown);
  expect(Array.isArray(SOURCES)).toBe(true);
  expect(SOURCES.length).toBeGreaterThanOrEqual(8);
 });

 it('every SOURCES entry has id, citation, usedFor, modules, verified',()=>{
  const ids=new Set<string>();
  for(const s of SOURCES){
   expect(s.id.length).toBeGreaterThan(2);
   expect(ids.has(s.id)).toBe(false);ids.add(s.id);
   expect(s.citation.length).toBeGreaterThan(20);
   expect(s.usedFor.length).toBeGreaterThan(10);
   expect(s.modules.length).toBeGreaterThan(0);
   expect(typeof s.verified).toBe('boolean');
   expect(sourceById(s.id)).toBe(s);
  }
  expect(sourceById('mackenzie-1981')?.verified).toBe(true);
  expect(sourceById('wenz-1962')?.verified).toBe(true);
 });

 it('modules that cite physics map back to SOURCES ids',()=>{
  // Spot-check: modules that implement cited physics appear in at least one entry.
  const all=new Set(SOURCES.flatMap(s=>s.modules));
  for(const need of ['units.ts','waterColumn.ts','transmissionLoss.ts','lloydsMirror.ts','ambientNoise.ts','convergenceZone.ts','res.ts']){
   expect(all.has(need),need).toBe(true);
  }
 });

 it('renderSourcesMarkdown embeds DISCLAIMER and matches docs/sources.md',()=>{
  const md=renderSourcesMarkdown();
  expect(md).toContain(DISCLAIMER);
  expect(md).toContain('## Sources');
  expect(MODEL_ASSUMPTIONS.length).toBeGreaterThan(3);
  const here=dirname(fileURLToPath(import.meta.url));
  const onDisk=readFileSync(join(here,'../docs/sources.md'),'utf8');
  expect(onDisk).toBe(md);
 });
});
