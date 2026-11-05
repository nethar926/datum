/** Recognition-guide cards built straight from the acoustics catalog, so the compendium can never drift
 * from what the sim plays. Reads fields defensively: the catalog schema is still growing (idKeys, tpk,
 * propeller type), and anything missing is derived from public kinematics or left out. Shows ID keys as
 * ranges and ratios only; every hull gets seeded jitter, so no exact hull frequencies appear here. */

type Any = Record<string, any>
export type PlantKind = 'diesel' | 'nuclear'
export type ModeCode = 'SURF' | 'SNORT' | 'D/E' | 'BATT' | 'AIP' | 'NUC'

export interface CardEngine { count: number; stroke: 2 | 4; cylinders: number; erpm: [number, number] }
export interface ClassifyingLine { name: string; cfrMultiple: number }
export interface ModeKeys { mode: ModeCode; lines: string[] }
export interface CompendiumCard {
  id: string; name: string; country: string; force: 'Red' | 'Blue' | 'Green'; gridHz: 50 | 60
  era?: number; tier?: string; archetype?: string
  plant: PlantKind; drivetrain: string; aip?: string
  engines: CardEngine[]; gear?: string; motorSlots?: number
  shafts: number; blades: number; propType?: string; tpk?: number; tpkMinKts?: number
  speeds: { label: string; kts: number }[]; quietKts?: [number, number]
  cavitationKts?: number; emergency?: string
  modes: ModeKeys[]; ratios: string[]; demon: string; hulls: number
  edas: ClassifyingLine[]; hydpHz?: number
}

const PROP_LABEL: Record<string, string> = { flat: 'FLAT', skewed: 'SKEWED', cpp: 'VARIABLE PITCH' }
const FORCE_ORDER = { Red: 0, Blue: 1, Green: 2 } as const
const r1 = (x: number) => Math.round(x * 10) / 10

function engineGroups(m: Any | undefined): CardEngine[] {
  const out: CardEngine[] = []
  for (const e of (m?.engines ?? []) as Any[]) {
    const er: [number, number] = [e.erpm?.obsMin ?? e.erpm?.normal ?? 0, e.erpm?.obsMax ?? e.erpm?.normal ?? 0]
    const g = out.find((o) => o.stroke === e.stroke && o.cylinders === e.cylinders && o.erpm[0] === er[0] && o.erpm[1] === er[1])
    if (g) g.count++; else out.push({ count: 1, stroke: e.stroke === 2 ? 2 : 4, cylinders: e.cylinders, erpm: er })
  }
  return out
}

function modesFor(plant: PlantKind, dt: string, hasMotor: boolean, slots: number | undefined, aip: boolean, eda: boolean): ModeKeys[] {
  const shaft = ['PSR', 'BR (DEMON)']
  const motor = hasMotor ? ['motor', ...(slots ? ['MSR'] : [])] : []
  if (plant === 'nuclear') {
    const nuc: ModeKeys[] = [{ mode: 'NUC', lines: [...shaft, 'reactor coolant pumps', 'turbine-generator', ...(dt === 'N/GR' ? ['gear mesh'] : motor), 'grid Hz family'] }]
    if (aip) nuc.push({ mode: 'AIP', lines: [...shaft, ...motor, 'AIP auxiliaries', 'no reactor lines'] })
    return nuc
  }
  const eng = ['CSR', 'CFR', 'EFR', ...(eda ? ['EDA'] : [])]
  const running = dt === 'DEL' ? [...eng, 'generator', ...shaft, ...motor] : [...eng, ...shaft, ...(dt === 'D/GR' ? ['gear mesh'] : [])]
  const out: ModeKeys[] = [
    { mode: 'SURF', lines: running },
    { mode: 'SNORT', lines: [...running, 'snorkel flow'] },
    { mode: 'D/E', lines: [...eng, 'generator (charging)', ...(dt === 'DEL' ? [...shaft, ...motor] : [])] },
    { mode: 'BATT', lines: [...shaft, ...motor, 'no engine lines'] },
  ]
  if (aip) out.push({ mode: 'AIP', lines: [...shaft, ...motor, 'AIP auxiliaries', 'no engine lines'] })
  return out
}

/** EDA multiples of CFR. Prefers idKeys, then catalog `eda {name, cfrMultiple}`, then converts the older
 * per-crank-revolution field using the first engine's firing order. */
function edasFor(x: Any, engines: CardEngine[]): ClassifyingLine[] {
  const src: Any[] = Array.isArray(x.idKeys?.edas) ? x.idKeys.edas : Array.isArray(x.edas) ? x.edas : []
  const e0 = engines[0], perRev = e0 ? e0.cylinders * (e0.stroke === 2 ? 1 : 0.5) : 0
  const out: ClassifyingLine[] = []
  for (const e of src) {
    const name = String(e.eda?.name ?? e.name ?? e.id ?? 'EDA').toUpperCase()
    const m = e.eda?.cfrMultiple ?? e.cfrMultiple ?? (perRev && typeof e.perCrankRev === 'number' ? e.perCrankRev / perRev : undefined)
    if (typeof m === 'number' && m > 0) out.push({ name, cfrMultiple: Math.round(m * 100) / 100 })
  }
  return out
}

function ratiosFor(c: CompendiumCard): string[] {
  const out: string[] = []
  for (const e of c.engines) {
    out.push(e.stroke === 2 ? `CFR = CSR × ${e.cylinders} (2-stroke, ${e.cylinders} cyl)` : `CFR = CSR × ${e.cylinders / 2} (4-stroke, ${e.cylinders} cyl)`)
    out.push(e.stroke === 2 ? 'EFR = CSR (2-stroke)' : 'EFR = CSR ÷ 2 (4-stroke)')
  }
  if (c.drivetrain === 'D/D') out.push('PSR = CSR when engines coupled')
  if (c.gear) out.push(`PSR = CSR ÷ ${c.gear}`)
  out.push(`BR = PSR × ${c.blades}`)
  if (c.motorSlots) out.push(`MSR = shaft rate × ${c.motorSlots} slots`)
  if (c.tpk) out.push(c.tpkMinKts ? `SPD = PSRPM ÷ ${c.tpk} (valid above ${c.tpkMinKts} kt)` : `SPD = PSRPM ÷ ${c.tpk}`)
  if (c.shafts > 1) out.push(`${c.shafts} shafts: shaft-line doublets`)
  return out
}

/** Builds one card per catalog class. Accepts the catalog object exported by `@acoustics`. */
export function compendiumCards(catalog: { classes: readonly unknown[] } | undefined): CompendiumCard[] {
  const cards: CompendiumCard[] = []
  for (const raw of catalog?.classes ?? []) {
    const x = raw as Any, p = (x.params ?? {}) as Any, m = x.machinery as Any | undefined
    const force = (x.force ?? 'Green') as CompendiumCard['force']
    const plant: PlantKind = x.plant ?? (String(p.propulsion ?? '').startsWith('nuclear') ? 'nuclear' : 'diesel')
    const dt: string = x.drivetrainLabel ?? x.drivetrainCode ?? p.propulsion ?? '?'
    const dtCode: string = x.drivetrainCode ?? dt
    const prop = (x.propeller ?? {}) as Any
    const shafts = prop.shafts ?? x.shafts ?? p.shafts ?? 1
    const blades = prop.blades ?? p.blades ?? 0
    const ratio = m?.drivetrain?.ratio ?? m?.mainTurbines?.drivetrain?.ratio
    const gearLabel = m?.drivetrain?.ratioLabel ?? m?.mainTurbines?.drivetrain?.ratioLabel
    const ms = x.maxSpeedKts as Any | undefined
    const speeds = ms
      ? (plant === 'diesel'
        ? [['SUB', ms.submerged], ['SURF', ms.surfaced], ['SNORT', ms.snorkel], ['BATT', ms.battery]]
        : [['SUB', ms.submerged], ['SURF', ms.surfaced]]).filter(([, v]) => typeof v === 'number').map(([l, v]) => ({ label: l as string, kts: r1(v as number) }))
      : typeof p.maxSpeedKn === 'number' ? [{ label: 'SUB', kts: p.maxSpeedKn }] : []
    if (x.aip?.maxSpeedKts) speeds.push({ label: 'AIP', kts: x.aip.maxSpeedKts })
    const ep = x.emergencyPropulsor as Any | undefined
    const card: CompendiumCard = {
      id: x.id, name: String(x.name ?? x.id).replace(/^Fictional /, ''), country: x.country ?? '?', force,
      gridHz: p.electricalHz ?? (force === 'Red' ? 50 : 60),
      era: x.era, tier: x.quietingTier, archetype: x.archetype,
      plant, drivetrain: dt,
      aip: x.aip ? `${String(x.aip.kind).toUpperCase()} BACKUP` : x.aipCapable ? 'AIP BACKUP' : undefined,
      engines: engineGroups(m),
      gear: ratio && ratio !== 1 ? (gearLabel ?? `${r1(ratio)}:1`) : undefined,
      motorSlots: x.motorSlots,
      shafts, blades, propType: PROP_LABEL[prop.type ?? x.propType ?? ''],
      tpk: x.tpk ?? p.tpk, tpkMinKts: x.tpkMinKts ?? p.tpkMinKts,
      speeds, quietKts: x.quietSpeedKts ? [r1(x.quietSpeedKts[0]), r1(x.quietSpeedKts[1])] : undefined,
      cavitationKts: p.cavitation?.surfaceInceptionKn,
      emergency: ep ? `${ep.blades}-blade emergency propulsor, ≤${ep.maxSpeedKts} kt (off unless ordered)` : undefined,
      edas: [], hydpHz: typeof x.idKeys?.hydpHz === 'number' ? x.idKeys.hydpHz : typeof x.idKeys?.hydp?.nominalHz === 'number' ? x.idKeys.hydp.nominalHz : typeof x.hydp?.nominalHz === 'number' ? x.hydp.nominalHz : undefined,
      modes: [], ratios: [], demon: '', hulls: Array.isArray(x.hulls) ? x.hulls.length : 0,
    }
    card.edas = edasFor(x, card.engines)
    card.modes = Array.isArray(x.idKeys?.modes) && x.idKeys.modes.every((m: Any) => typeof m?.mode === 'string' && Array.isArray(m.lines)) ? x.idKeys.modes
      : modesFor(plant, dtCode, !!m?.motor || dtCode === 'DEL' || dtCode === 'NEL', card.motorSlots, !!card.aip, Array.isArray(x.edas) && x.edas.length > 0)
    card.ratios = Array.isArray(x.idKeys?.ratios) && x.idKeys.ratios.every((r: unknown) => typeof r === 'string') ? x.idKeys.ratios : ratiosFor(card)
    card.demon = typeof x.idKeys?.demon === 'string' ? x.idKeys.demon : `Shaft ${shafts > 1 ? 'doublet' : 'line'} with ${blades}-blade BR harmonics${card.propType === 'SKEWED' ? ', weak BR modulation' : card.propType === 'FLAT' ? ', strong BR modulation' : ''}`
    cards.push(card)
  }
  return cards.sort((a, b) => FORCE_ORDER[a.force] - FORCE_ORDER[b.force] || a.country.localeCompare(b.country) || a.name.localeCompare(b.name))
}

export interface CardFilter { query: string; country: string; plant: '' | PlantKind }
export function filterCards(cards: readonly CompendiumCard[], f: CardFilter): CompendiumCard[] {
  const q = f.query.trim().toLowerCase()
  return cards.filter((c) => (!f.country || c.country === f.country) && (!f.plant || c.plant === f.plant)
    && (!q || [c.name, c.country, c.force, c.drivetrain, c.aip ?? '', c.propType ?? '', ...c.edas.map((e) => `${e.name} EDA ×${e.cfrMultiple}`), c.hydpHz ? 'HYDP' : '', ...c.ratios, ...c.modes.flatMap((m) => m.lines)].join(' ').toLowerCase().includes(q)))
}
