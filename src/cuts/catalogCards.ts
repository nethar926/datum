/**
 * ID / recognition cards built only from the live acoustics catalog entry.
 * No hard-coded class data — fundamentals, harmonics, blade/shaft, EDA/SSMA,
 * AC vs DC and behaviour tags are derived from idKeys + plant aux/edas/profiles.
 */
import { catalog, buildCompendium } from '@acoustics'
import { behaviourWording } from './api'
import type { LineBehaviour } from './types'

type Any = Record<string, any>

export type PowerKind = 'AC' | 'DC' | 'mixed' | 'unknown'

export interface CardLine {
  family: string
  label: string
  /** Teaching envelope for the fundamental (Hz), from idKeys when present. */
  fundamentalHz?: [number, number]
  /** Harmonic orders typically visible (from idKeys.harmonicFamilies). */
  orders?: [number, number]
  power: PowerKind
  behaviour: LineBehaviour[]
  /** True for EDA / SSMA classifying aux. */
  classifying?: boolean
}

export interface CatalogIdCard {
  id: string
  name: string
  country: string
  force: 'Red' | 'Blue' | 'Green'
  gridHz: 50 | 60
  plant: 'diesel' | 'nuclear'
  drivetrain: string
  shafts: number
  blades: number
  motorSlots?: number
  aip?: string
  hydpHz?: number
  hydpHzRange?: [number, number]
  lines: CardLine[]
  behaviourTags: string[]
  giveaways: string[]
}

const AC_KINDS = new Set(['electrical', 'acvr', 'acPump'])
const DC_KINDS = new Set(['dcvr', 'ssma'])

/** Map catalog stability/width/kind → behaviour tags + AC/DC. */
export function deriveBehaviour(opts: {
  family?: string
  kind?: string
  stability?: string
  width?: string
  eda?: boolean
  ramp?: boolean
}): { power: PowerKind; behaviour: LineBehaviour[] } {
  const b: LineBehaviour[] = []
  let power: PowerKind = 'unknown'
  const kind = opts.kind ?? ''
  if (AC_KINDS.has(kind) || (opts.stability === 'stable' && opts.width === 'discrete' && (opts.family === 'GRID' || kind === 'electrical'))) {
    power = 'AC'
    b.push('stable')
  } else if (DC_KINDS.has(kind) || opts.stability === 'unstable') {
    power = 'DC'
    b.push('unstable')
  } else if (opts.stability === 'stable' && opts.width === 'discrete') {
    power = 'AC'
    b.push('stable')
  }
  // EDA engine-tracking: harmonicOf CFR (plant mode) — no slip tag.
  if (opts.eda) {
    b.push('tracks-engine')
    b.push('on-with-engine')
  }
  if (opts.ramp) b.push('ramping')
  if (opts.family === 'BR' || opts.family === 'PSR' || opts.family === 'MSR') {
    if (!b.includes('unstable') && !b.includes('stable')) b.push('stable')
  }
  return { power, behaviour: [...new Set(b)] }
}

function rangeMid(r: unknown): number | undefined {
  if (Array.isArray(r) && typeof r[0] === 'number' && typeof r[1] === 'number') return (r[0] + r[1]) / 2
  if (typeof r === 'number') return r
  return undefined
}

function asRange(r: unknown): [number, number] | undefined {
  if (Array.isArray(r) && typeof r[0] === 'number' && typeof r[1] === 'number') return [r[0], r[1]]
  if (typeof r === 'number') return [r, r]
  return undefined
}

/** Build one ID card from a single catalog class object (defensive reads). */
export function catalogIdCard(raw: unknown): CatalogIdCard {
  const x = raw as Any
  const p = (x.params ?? {}) as Any
  const keys = (x.idKeys ?? {}) as Any
  const plant: 'diesel' | 'nuclear' = x.plant ?? (String(p.propulsion ?? '').startsWith('nuclear') ? 'nuclear' : 'diesel')
  const shafts = x.propeller?.shafts ?? x.shafts ?? p.shafts ?? 1
  const blades = x.propeller?.blades ?? p.blades ?? 0
  const force = (x.force ?? 'Green') as CatalogIdCard['force']
  const gridHz = (keys.gridHz ?? p.electricalHz ?? (force === 'Red' ? 50 : 60)) as 50 | 60

  const lines: CardLine[] = []
  const pushLine = (line: CardLine) => {
    if (!lines.some((l) => l.family === line.family && l.label === line.label)) lines.push(line)
  }

  // Harmonic families from idKeys (fundamentals + orders).
  for (const f of keys.harmonicFamilies ?? []) {
    const family = String(f.lineFamily ?? '')
    if (!family) continue
    const profile = p.lineProfiles?.[family === 'BR' ? 'blade' : family === 'PSR' ? 'shaft' : family === 'GRID' ? 'electrical' : family === 'SRC' ? 'src' : 'pump']
    const { power, behaviour } = deriveBehaviour({
      family,
      stability: profile?.stability,
      width: profile?.width,
    })
    pushLine({
      family,
      label: family,
      fundamentalHz: asRange(f.fundamentalHz),
      orders: asRange(f.orders),
      power: family === 'GRID' ? 'AC' : power,
      behaviour: family === 'GRID' ? ['stable'] : behaviour,
    })
  }

  // EDA classifying lines.
  const edas: Any[] = Array.isArray(x.edas) ? x.edas : Array.isArray(keys.edas) ? keys.edas : []
  for (const e of edas) {
    const name = String(e.name ?? e.eda?.name ?? 'EDA').toUpperCase()
    const { power, behaviour } = deriveBehaviour({ family: 'EDA', eda: true, ramp: !!e.ramp })
    pushLine({ family: 'EDA', label: name, power, behaviour, classifying: true })
  }

  // Aux: SSMA / AC / DC / HYDP.
  for (const a of (x.aux ?? []) as Any[]) {
    const kind = String(a.kind ?? '')
    if (kind === 'hydp') continue
    const fam = kind === 'ssma' ? 'SSMA' : kind === 'electrical' ? 'GRID' : kind.toUpperCase()
    const { power, behaviour } = deriveBehaviour({ kind, stability: a.stability, width: a.width })
    pushLine({
      family: fam,
      label: String(a.id ?? fam).replace(/^fictional-/, ''),
      power,
      behaviour,
      classifying: kind === 'ssma',
    })
  }

  const hydpRange = asRange(keys.hydp?.nominalHz) ?? (typeof x.hydp?.nominalHz === 'number' ? [x.hydp.nominalHz, x.hydp.nominalHz] as [number, number] : undefined)
  if (hydpRange || x.hydp) {
    const { power, behaviour } = deriveBehaviour({ kind: 'hydp', stability: 'unstable', width: 'discrete' })
    pushLine({ family: 'HYDP', label: 'HYDP pair', fundamentalHz: hydpRange, power, behaviour, classifying: true })
  }

  const behaviourTags: string[] = [...new Set(lines.flatMap((l) => l.behaviour.map(behaviourWording)))]
  // Harmonics-only tip when BR/PSR present.
  if (lines.some((l) => l.family === 'BR' || l.family === 'PSR')) {
    behaviourTags.push('harmonics-only')
  }

  return {
    id: String(x.id),
    name: String(x.name ?? x.id).replace(/^Fictional /, ''),
    country: String(x.country ?? '?'),
    force,
    gridHz,
    plant,
    drivetrain: String(x.drivetrainLabel ?? x.drivetrainCode ?? p.propulsion ?? '?'),
    shafts, blades,
    motorSlots: typeof x.motorSlots === 'number' ? x.motorSlots : undefined,
    aip: x.aip ? `${String(x.aip.kind).toUpperCase()} BACKUP` : x.aipCapable ? 'AIP BACKUP' : undefined,
    hydpHz: rangeMid(hydpRange) ?? (typeof x.hydp?.nominalHz === 'number' ? x.hydp.nominalHz : undefined),
    hydpHzRange: hydpRange,
    lines,
    behaviourTags,
    giveaways: Array.isArray(keys.giveaways) ? keys.giveaways.map(String) : [],
  }
}

/** One card per catalog class, catalog order preserved then force-sorted like the compendium. */
export function catalogIdCards(source: { classes: readonly unknown[] } = catalog): CatalogIdCard[] {
  const FORCE = { Red: 0, Blue: 1, Green: 2 } as const
  return source.classes.map(catalogIdCard).sort((a, b) => FORCE[a.force] - FORCE[b.force] || a.country.localeCompare(b.country) || a.name.localeCompare(b.name))
}

/** Compendium export used when matching — same source of truth. */
export function catalogForMatch() {
  return buildCompendium().classes
}
