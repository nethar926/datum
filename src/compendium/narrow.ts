import { OPERATING_MODES, type ClassMatch, type ClassObservations, type LineFamily, type OperatingMode } from '@acoustics'

/** Raw form state for the Narrow-down panel. Strings so half-typed numbers never throw. */
export interface NarrowForm {
  gridHz: '' | '50' | '60'
  mode: '' | OperatingMode
  lineFamilies: LineFamily[]
  csrHz: string; cfrHz: string; psrHz: string
  blades: string; efrToCsr: string; gearRatio: string; msrToMotorShaft: string; tpk: string
  turbineRateHz: string; vaneRateHz: string; vaneCount: string; reductionRatio: string; gearMeshHz: string; turboGenHz: string; hydpHz: string
  edaCfrMultiples: string
  srcHz: string; srcKts: string; swathLoHz: string; swathHiHz: string; swathKts: string
}

export const EMPTY_NARROW: NarrowForm = {
  gridHz: '', mode: '', lineFamilies: [], csrHz: '', cfrHz: '', psrHz: '',
  blades: '', efrToCsr: '', gearRatio: '', msrToMotorShaft: '', tpk: '',
  turbineRateHz: '', vaneRateHz: '', vaneCount: '', reductionRatio: '', gearMeshHz: '', turboGenHz: '', hydpHz: '', edaCfrMultiples: '',
  srcHz: '', srcKts: '', swathLoHz: '', swathHiHz: '', swathKts: '',
}

export const NARROW_MODES = OPERATING_MODES
/** Families a trainee can tick as "seen on the gram". */
export const NARROW_FAMILIES: readonly LineFamily[] = ['CSR', 'CFR', 'EFR', 'EDA', 'PSR', 'BR', 'MSR', 'TG', 'MESH', 'TURBINE', 'VANE', 'COOLANT', 'HYDP', 'SRC', 'AUX']

const num = (s: string): number | undefined => {
  const t = s.trim()
  if (!t) return undefined
  const v = Number(t)
  return Number.isFinite(v) && v > 0 ? v : undefined
}

/** Form to observations. Only fields the trainee filled in become constraints; nothing reads truth. */
export function toObservations(f: NarrowForm): ClassObservations {
  const o: { -readonly [K in keyof ClassObservations]: ClassObservations[K] } = {}
  if (f.gridHz) o.gridHz = Number(f.gridHz)
  if (f.mode) o.mode = f.mode
  if (f.lineFamilies.length) o.lineFamilies = [...f.lineFamilies]
  const fund: Partial<Record<LineFamily, number>> = {}
  const csr = num(f.csrHz), cfr = num(f.cfrHz), psr = num(f.psrHz)
  if (csr) fund.CSR = csr
  if (cfr) fund.CFR = cfr
  if (psr) fund.PSR = psr
  if (Object.keys(fund).length) o.familyFundamentalsHz = fund
  const set = <K extends keyof ClassObservations>(k: K, s: string) => { const v = num(s); if (v !== undefined) (o as Record<string, unknown>)[k] = v }
  set('brToPsr', f.blades); set('efrToCsr', f.efrToCsr); set('gearRatio', f.gearRatio); set('msrToMotorShaft', f.msrToMotorShaft)
  set('tpk', f.tpk); set('turbineRateHz', f.turbineRateHz); set('vaneRateHz', f.vaneRateHz); set('vaneCount', f.vaneCount); set('reductionRatio', f.reductionRatio)
  set('gearMeshHz', f.gearMeshHz); set('turboGenHz', f.turboGenHz); set('hydpHz', f.hydpHz)
  const edas = f.edaCfrMultiples.split(/[\s,;]+/).map(num).filter((v): v is number => v !== undefined)
  if (edas.length) o.edaCfrMultiples = edas
  type SW = NonNullable<ClassObservations['speedWindows']>[number]
  const windows: SW[] = []
  const srcHz = num(f.srcHz), srcKts = num(f.srcKts)
  if (srcHz) windows.push(srcKts ? { kind: 'SRC', hz: srcHz, speedKts: srcKts } : { kind: 'SRC', hz: srcHz })
  const a = num(f.swathLoHz), b = num(f.swathHiHz), swKts = num(f.swathKts)
  if (a && b && a !== b) {
    const sw: SW = { kind: 'SWATH', loHz: Math.min(a, b), hiHz: Math.max(a, b) }
    windows.push(swKts ? { ...sw, speedKts: swKts } : sw)
  }
  if (windows.length) o.speedWindows = windows
  return o
}

export const constraintCount = (o: ClassObservations): number => {
  let n = 0
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined) continue
    n += k === 'lineFamilies' || k === 'edaCfrMultiples' || k === 'speedWindows' ? (v as unknown[]).length : k === 'familyFundamentalsHz' ? Object.keys(v as object).length : 1
  }
  return n
}

const KEY_LABEL: Record<string, string> = {
  gridHz: 'GRID', mode: 'MODE', brToPsr: 'BLADES (BR÷PSR)', msrToMotorShaft: 'MOTOR SLOTS', msrToPsr: 'MSR÷PSR',
  gearRatio: 'GEAR', efrToCsr: 'EFR÷CSR', tpk: 'TPK', turbineRateHz: 'TURBINE', vaneRateHz: 'VANE', vaneCount: 'VANES', reductionRatio: 'REDUCTION',
  gearMeshHz: 'MESH', turboGenHz: 'TG', hydpHz: 'HYDP', SRC: 'SRC WINDOW', SWATH: 'SWATH WINDOW',
}
/** Operator-style label for a matchClasses key such as `lineFamily:MSR` or `edaCfrMultiple:10.5`. */
export function keyLabel(k: string): string {
  const [a, b] = k.split(':')
  if (b === undefined) return KEY_LABEL[a] ?? a.toUpperCase()
  if (a === 'lineFamily') return `${b} SEEN`
  if (a === 'fundamental') return `${b} HZ`
  if (a === 'edaCfrMultiple') return `EDA ×${b}`
  return k.toUpperCase()
}

export interface Ranked { id: string; match?: ClassMatch }
/** Order class ids by match score (best first). With no constraints the catalog order is kept. */
export function rankIds(ids: readonly string[], matches: readonly ClassMatch[] | undefined, hideRuledOut: boolean): Ranked[] {
  if (!matches) return ids.map((id) => ({ id }))
  const byId = new Map(matches.map((m) => [m.id, m]))
  const out: Ranked[] = []
  for (const m of matches) if (ids.includes(m.id) && !(hideRuledOut && m.ruledOutBy.length)) out.push({ id: m.id, match: m })
  for (const id of ids) if (!byId.has(id)) out.push({ id })
  return out
}
