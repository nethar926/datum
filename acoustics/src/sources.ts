/**
 * About / citations for every public source the acoustics package actually uses.
 * `verified` is true only when the citation was checked against a public page or edition
 * during authoring of this list — not a claim about classified data.
 */

export interface SourceEntry {
  id:string;
  /** Full bibliographic citation. */
  citation:string;
  /** Public URL when freely available; omit if paywalled-only. */
  url?:string;
  /** Dataset licence if applicable. */
  licence?:string;
  /** What DATUM uses it for (teaching physics only). */
  usedFor:string;
  /** Module paths under acoustics/src that cite or implement it. */
  modules:readonly string[];
  /** True only when the citation was actually checked. */
  verified:boolean;
}

/**
 * Project Lead disclaimer (scopes Wilson's coincidence sentence so it does not disown
 * the public references we cite on purpose). Separate export from SOURCES.
 */
export const DISCLAIMER=
  'All vessels and acoustic signatures are fictional and procedurally generated. Any resemblance to actual vessels or measured acoustic signatures is unintended and coincidental. Ocean profiles (BT/SSP) are synthetic teaching shapes unless a SOURCES entry explicitly names a measured dataset.';

export const SOURCES:readonly SourceEntry[]=Object.freeze([
  Object.freeze({
    id:'mackenzie-1981',
    citation:'K. V. Mackenzie, “Nine-term equation for sound speed in the oceans,” J. Acoust. Soc. Am. 70(3), 807–812 (1981).',
    url:'https://doi.org/10.1121/1.386920',
    usedFor:'Seawater sound-speed equation and validity domain for BT/SSP waterColumn profiles.',
    modules:['units.ts','waterColumn.ts'],
    verified:true,
  }),
  Object.freeze({
    id:'npl-sound-seawater',
    citation:'National Physical Laboratory, “Technical Guides — Speed of Sound in Sea-Water” (public calculator / validity summary).',
    url:'http://resource.npl.co.uk/acoustics/techguides/soundseawater/',
    usedFor:'Cross-check of Mackenzie validity ranges cited in water-column docs.',
    modules:['units.ts','waterColumn.ts','docs/water-column-fe.md'],
    verified:false, // WebFetch previously returned 500; DOI/Mackenzie checked instead
  }),
  Object.freeze({
    id:'urick-pous',
    citation:'R. J. Urick, Principles of Underwater Sound, 3rd ed. (Peninsula / McGraw-Hill). Chapters on transmission loss, ambient noise, multipath/Lloyd mirror, convergence zones, and radiated ship noise (teaching citations).',
    usedFor:'TL spreading, Lloyd mirror image source, CZ teaching band (~30–35 nmi), ship/sub radiated-noise mechanisms, kinematics/Doppler CPA context.',
    modules:['transmissionLoss.ts','lloydsMirror.ts','lloydPass.ts','convergenceZone.ts','fitLloydsMirror.ts','fitCpaFromDoppler.ts','striationCurves.ts','kinematics.ts','ambientNoise.ts','catalog/surface.ts','catalog/schema.ts','catalog/drivetrain.ts','catalog/plantModel.ts','catalog/derive.ts','sourceModel.ts','demonStream.ts','lofar.ts','depthEnvelope.ts','spawnGeometry.ts'],
    verified:false, // edition/page pins not re-opened this session; chapter topics match prior Lead notes
  }),
  Object.freeze({
    id:'wenz-1962',
    citation:'G. M. Wenz, “Acoustic ambient noise in the ocean: Spectra and sources,” J. Acoust. Soc. Am. 34, 1936–1956 (1962).',
    url:'https://doi.org/10.1121/1.1909155',
    usedFor:'Illustrative ambient-noise component curves (turbulence/shipping/wave/thermal) in ambientLevel.',
    modules:['ambientNoise.ts','lofar.ts'],
    verified:true,
  }),
  Object.freeze({
    id:'knudsen-1948',
    citation:'V. O. Knudsen, R. S. Alford, and J. W. Emling, “Underwater ambient noise,” J. Mar. Res. 7, 410–429 (1948).',
    usedFor:'Cited alongside Wenz as historical ambient-noise context for the smooth teaching fit.',
    modules:['ambientNoise.ts'],
    verified:false,
  }),
  Object.freeze({
    id:'thorp-1967',
    citation:'W. H. Thorp, “Analytic description of the low-frequency attenuation coefficient,” J. Acoust. Soc. Am. 42, 270 (1967).',
    usedFor:'Empirical seawater absorption (dB/km) in transmissionLoss.thorp.',
    modules:['transmissionLoss.ts','lofar.ts','spawnGeometry.ts'],
    verified:false,
  }),
  Object.freeze({
    id:'ross-underwater-noise',
    citation:'D. Ross, Mechanics of Underwater Noise (Peninsula Publishing / Pergamon).',
    usedFor:'Machinery harmonic / propeller / flow-noise mechanism framing; fictional relative powers only.',
    modules:['catalog/schema.ts','catalog/drivetrain.ts','catalog/plantModel.ts','catalog/derive.ts','catalog/surface.ts'],
    verified:false,
  }),
  Object.freeze({
    id:'jensen-coa',
    citation:'F. B. Jensen, W. A. Kuperman, M. B. Porter, and H. Schmidt, Computational Ocean Acoustics (Springer).',
    usedFor:'Pressure-release image-source / Rayleigh roughness factor context for Lloyd mirror.',
    modules:['lloydsMirror.ts','fitLloydsMirror.ts','striationCurves.ts'],
    verified:false,
  }),
  Object.freeze({
    id:'buck-1981',
    citation:'A. L. Buck, “New equations for computing vapor pressure and enhancement factor,” J. Appl. Meteorol. 20, 1527–1532 (1981).',
    usedFor:'Saturation vapour pressure in cavitation-number inception (teaching).',
    modules:['units.ts'],
    verified:false,
  }),
  Object.freeze({
    id:'struzinski-lowe-1984',
    citation:'W. A. Struzinski and E. D. Lowe, “A split-window technique for estimating noise power,” J. Acoust. Soc. Am. 76, 1738–1742 (1984).',
    url:'https://doi.org/10.1121/1.391621',
    usedFor:'Two-pass split-window (TPSW) background model notes for RES NB.',
    modules:['res.ts'],
    verified:false,
  }),
  Object.freeze({
    id:'kinsler-frey',
    citation:'L. E. Kinsler, A. R. Frey, A. B. Coppens, and J. V. Sanders, Fundamentals of Acoustics.',
    usedFor:'dB power/amplitude conventions; DEMON incoherent envelope framing.',
    modules:['units.ts','demonStream.ts'],
    verified:false,
  }),
]);

/** Model assumptions & limits (teaching tool — not a prediction product). */
export const MODEL_ASSUMPTIONS:readonly string[]=Object.freeze([
  'All vessels, countries, hulls, and acoustic signatures are fictional and procedurally generated.',
  'Ocean BT/SSP profiles are synthetic mixed-layer/thermocline shapes; Mackenzie supplies only c(T,S,D).',
  'Relative tonal powers and broadband levels are invented teaching weights, not measured spectra.',
  'Transmission loss uses geometric spreading + Thorp absorption — no full PE/ray trace.',
  'Convergence-zone range is a parameterized Urick-band approximation from SSP critical depth + depth excess, not a ray solution.',
  'Lloyd mirror uses a pressure-release image source; coherent nulls are minima under unequal spreading.',
  'Ambient noise is a smooth Wenz/Knudsen-style fit, not site-calibrated.',
  'Surface and submarine event rates are teaching policies, not doctrine.',
]);

export function sourceById(id:string):SourceEntry|undefined {
  return SOURCES.find(s=>s.id===id);
}

/** Render docs/sources.md body from SOURCES (deterministic). */
export function renderSourcesMarkdown():string {
  const lines:string[]=[
    '# Acoustics public sources (About)',
    '',
    DISCLAIMER,
    '',
    '## Model assumptions & limits',
    '',
    ...MODEL_ASSUMPTIONS.map(a=>`- ${a}`),
    '',
    '## Sources',
    '',
  ];
  for(const s of SOURCES){
    lines.push(`### \`${s.id}\`${s.verified?' (verified)':''}`);
    lines.push('');
    lines.push(s.citation);
    if(s.url)lines.push('');
    if(s.url)lines.push(`[Link](${s.url})`);
    if(s.licence){lines.push('');lines.push(`Licence: ${s.licence}`);}
    lines.push('');
    lines.push(`**Used for:** ${s.usedFor}`);
    lines.push('');
    lines.push(`**Modules:** ${s.modules.map(m=>`\`${m}\``).join(', ')}`);
    lines.push('');
  }
  return lines.join('\n');
}
