/**
 * Truth-side engine line families (CSR crank shaft rate, CFR cylinder firing rate, EFR engine firing rate, EDA) for
 * the debug truth panel and HARM cursor snapping. Shapes follow the acoustics m3-lines truth entry; every field is
 * optional so older engines still render. Pure functions.
 */
/** Engine families from m3-lines; the engine also tags PSR lines, so any family string is accepted. */
export type LineFamily = 'CSR' | 'CFR' | 'EDA' | 'EFR' | 'PSR' | (string & {})
export interface EngineTruth { id: string; stroke: number; cylinders: number; erpm: number; running: boolean; csrHz: number; cfrHz: number; efrHz: number }
export interface PropulsionTruthLite { kind: string; ratio: number; ratioLabel: string; engines: EngineTruth[]; shafts: { rpm: number; hz: number; coupled?: boolean }[]
  motor?: { rpm: number; shaftHz?: number; slots?: number; msrHz?: number }
  /** m3-lines fields, optional so older engines still render. */
  mode?: string; drivetrainLabel?: string; tpk?: number; tpkValid?: boolean; tpkMinKts?: number
  propulsor?: { shafts: number; blades: number; bladeType: string; brHz: number }
  emergencyPropulsor?: { active: boolean; rpm: number; hz: number; blades: number }; aip?: { kind: string; active: boolean } }
export interface TruthLineLite { lineFamily?: LineFamily; fundamentalHz?: number; engineId?: string; freqHz?: number; hz?: number; eda?: { name: string; cfrMultiple: number } }
export interface SpeedGatedLite { name: string; kind: 'SWATH' | 'SRC'; hz?: number; loHz?: number; hiHz?: number; active: boolean; gain?: number }
export interface TruthContactLite { speedGated?: SpeedGatedLite[]; classifiers?: SpeedGatedLite[]; mode?: string; id: number; label?: string; sourceId?: string; active?: boolean; depthM?: number; spdKts?: number; spdMps: number; crsDeg: number; propulsion?: PropulsionTruthLite; lines?: TruthLineLite[] }

export interface FamilyFundamental { family: LineFamily; hz: number; contactId: number; engineId?: string; engineNo?: number; erpm?: number }

const FAMS = ['CSR', 'CFR', 'EFR'] as const
/** Every family fundamental currently present (running engines, plus EDA from the line list). */
export function familyFundamentals(contacts: readonly TruthContactLite[] | undefined): FamilyFundamental[] {
  const out: FamilyFundamental[] = []
  if (!contacts) return out
  for (const c of contacts) {
    if (c.active === false) continue
    const engines = c.propulsion?.engines ?? []
    for (let n = 0; n < engines.length; n++) {
      const e = engines[n]
      if (!e.running) continue
      const hz = { CSR: e.csrHz, CFR: e.cfrHz, EFR: e.efrHz }
      for (const f of FAMS) if (hz[f] > 0) out.push({ family: f, hz: hz[f], contactId: c.id, engineId: e.id, engineNo: n + 1, erpm: e.erpm })
    }
    const seen = new Set<string>()
    for (const l of c.lines ?? []) {
      if (!l.lineFamily || !(l.fundamentalHz! > 0)) continue
      if ((l.lineFamily === 'CSR' || l.lineFamily === 'CFR' || l.lineFamily === 'EFR') && engines.length) continue // engines already gave these
      const key = `${l.lineFamily}:${l.engineId ?? ''}:${l.fundamentalHz!.toFixed(4)}`
      if (seen.has(key)) continue
      seen.add(key); out.push({ family: l.lineFamily, hz: l.fundamentalHz!, contactId: c.id, engineId: l.engineId })
    }
  }
  return out
}

/** Snap a clicked frequency to the family fundamental whose nth harmonic (n ≤ maxN) is nearest, within tolHz. */
export function snapToFamily(hz: number, cands: readonly FamilyFundamental[], tolHz: number, maxN = 8): { fund: FamilyFundamental; k: number } | null {
  let best: { fund: FamilyFundamental; k: number } | null = null, bestErr = tolHz
  for (const f of cands) {
    const k = Math.max(1, Math.min(maxN, Math.round(hz / f.hz)))
    const err = Math.abs(hz - k * f.hz)
    if (err <= bestErr) { bestErr = err; best = { fund: f, k } }
  }
  return best
}

export function familyLabel(f: FamilyFundamental): string {
  return `${f.family}${f.engineNo ? ' E' + f.engineNo : ''}${f.erpm ? ` ERPM ${f.erpm.toFixed(0)}` : ''}`
}

/** Diesel Direct: the propeller shaft is the crankshaft only while the engines drive it (surfaced/snorkel). */
export function psrCoupled(p: PropulsionTruthLite | undefined): boolean {
  if (!p || p.kind !== 'dieselDirect') return false
  if (p.shafts.some((s) => s.coupled !== undefined)) return p.shafts.some((s) => s.coupled === true)
  return p.engines.some((e) => e.running)
}

const KIND: Record<string, string> = { dieselDirect: 'DIESEL DIRECT', dieselGR: 'DIESEL GEARED', dieselElectric: 'DIESEL ELECTRIC', nuclearGR: 'NUCLEAR GEARED', nuclearElectric: 'NUCLEAR ELECTRIC' }

/** Text rows for one contact in the debug truth panel. */
const BLADE: Record<string, string> = { flat: 'FLAT', skewed: 'SKEWED', cpp: 'VARIABLE PITCH', variable: 'VARIABLE PITCH' }

export function truthRows(c: TruthContactLite): string[] {
  const kts = c.spdKts ?? c.spdMps * 1.943844
  const p = c.propulsion
  const mode = c.mode ?? p?.mode
  const rows = [`${(c.label ?? c.sourceId ?? 'C' + c.id).toUpperCase()}  CRS ${c.crsDeg.toFixed(0).padStart(3, '0')}  ${kts.toFixed(1)} KT${c.depthM !== undefined ? `  ${c.depthM.toFixed(0)} M` : ''}${mode ? `  MODE ${mode.toUpperCase()}` : ''}`]
  if (!p) return rows
  const plant = KIND[p.kind] ?? p.kind.toUpperCase()
  const label = p.drivetrainLabel ? p.drivetrainLabel.toUpperCase() : ''
  rows.push(`PLANT ${label && /DIESEL|NUCLEAR/.test(label) ? label : [plant, label].filter(Boolean).join(' ')}${p.aip ? `  AIP ${p.aip.kind.toUpperCase()}${p.aip.active ? ' ON' : ' OFF'}` : ''}  RATIO ${p.ratioLabel}`)
  const pr = p.propulsor
  if (pr) rows.push(`PROP ${pr.shafts} SHAFT${pr.shafts > 1 ? 'S' : ''}  ${pr.blades}-BLADE ${BLADE[pr.bladeType] ?? pr.bladeType.toUpperCase()}  BR ${pr.brHz.toFixed(2)} HZ = PSR × ${pr.blades}`)
  if (typeof p.tpk === 'number' && p.tpk > 0) rows.push(p.tpkValid === false
    ? `TPK ${p.tpk.toFixed(2)} RPM/KT  NOT VALID${p.tpkMinKts !== undefined ? ` BELOW ${p.tpkMinKts} KT` : ''} (PITCH CONTROL)`
    : `TPK ${p.tpk.toFixed(2)} RPM/KT  SPD = PSRPM ÷ TPK${p.tpkMinKts !== undefined ? `  (VALID ABOVE ${p.tpkMinKts} KT)` : ''}`)
  p.engines.forEach((e, n) => {
    rows.push(e.running
      ? `ENG E${n + 1} ${e.stroke}-STROKE ${e.cylinders} CYL  ERPM ${e.erpm.toFixed(0)}  CSR ${e.csrHz.toFixed(2)}  CFR ${e.cfrHz.toFixed(2)}  EFR ${e.efrHz.toFixed(2)} HZ`
      : `ENG E${n + 1} ${e.stroke}-STROKE ${e.cylinders} CYL  STOPPED`)
  })
  p.shafts.forEach((s, i) => rows.push(`SHAFT ${i + 1}  PSR ${s.hz.toFixed(2)} HZ  ${s.rpm.toFixed(0)} RPM${s.coupled === undefined ? '' : s.coupled ? '  COUPLED' : '  DECOUPLED'}`))
  if (p.motor) rows.push(`MOTOR ${p.motor.rpm.toFixed(0)} RPM${p.motor.msrHz !== undefined ? `  MSR ${p.motor.msrHz.toFixed(1)} HZ${p.motor.slots ? ` (${p.motor.slots} SLOTS)` : ''}` : ''}`)
  const ep = p.emergencyPropulsor
  if (ep?.active) rows.push(`EMERG PROPULSOR ON  ${ep.blades}-BLADE  ${ep.hz.toFixed(2)} HZ  ${ep.rpm.toFixed(0)} RPM`)
  const sg = c.speedGated ?? c.classifiers ?? []
  const on = sg.filter((g) => g.active).map((g) => `${g.kind} ${g.name} ${g.hz !== undefined ? g.hz.toFixed(1) : `${g.loHz?.toFixed(0)}–${g.hiHz?.toFixed(0)}`} HZ${g.gain !== undefined && g.gain < 0.99 ? ' (FADING)' : ''}`)
  if (sg.length) rows.push(on.length ? `ACTIVE ${on.join('  ')}` : 'SWATH/SRC NONE AT THIS SPEED')
  if (p.kind === 'dieselDirect') rows.push(psrCoupled(p) ? 'PSR = CSR (ENGINES COUPLED)' : 'PSR ≠ CSR (ENGINES DECOUPLED, ON MOTOR)')
  return rows
}

/** Truth-only: name of the EDA line under a ratio probe (e.g. "LOP ×27.75"), or null. Never call with Truth off. */
export function truthEdaName(contacts: readonly TruthContactLite[] | undefined, probeHz: number, tolHz: number): string | null {
  let best: string | null = null, bestD = tolHz
  for (const c of contacts ?? []) for (const l of c.lines ?? []) {
    if (l.lineFamily !== 'EDA' || !l.eda) continue
    const f = l.hz ?? l.freqHz
    if (typeof f !== 'number') continue
    const d = Math.abs(f - probeHz)
    if (d <= bestD) { bestD = d; best = `${l.eda.name} = CFR ×${l.eda.cfrMultiple}` }
  }
  return best
}
