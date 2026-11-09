import { Fragment, useMemo, useState } from 'react'
import { NarrowDown } from './NarrowDown'
import { EMPTY_NARROW, constraintCount, keyLabel, rankIds, toObservations, type NarrowForm } from './narrow'
import { catalog, matchClasses, type ClassMatch } from '@acoustics'
import { compendiumCards, filterCards, r2, type CardFilter, type CompendiumCard } from './cards'
import { COMING_SOON_LABEL, isNuclearPlant } from '../cuts/comingSoon'

const TIER: Record<string, string> = { gen1: 'GEN 1', gen2: 'GEN 2', gen3: 'GEN 3', gen4: 'GEN 4' }

function MatchBadge({ m }: { m: ClassMatch }) {
  const n = m.matched.length + m.ruledOutBy.length
  return (
    <div className={`cmp-match${m.ruledOutBy.length ? ' out' : ''}`} data-testid="cmp-match">
      <b>{m.matched.length}/{n} KEYS AGREE</b>
      {m.ruledOutBy.length > 0 && <span> · RULED OUT BY {m.ruledOutBy.map(keyLabel).join(', ')}</span>}
    </div>
  )
}

function ComingSoonBadge() {
  return <span className="cmp-coming-soon" data-testid="cmp-coming-soon">{COMING_SOON_LABEL}</span>
}

function Card({ c, m }: { c: CompendiumCard; m?: ClassMatch }) {
  const comingSoon = isNuclearPlant(c.plant)
  return (
    <article
      className={`cmp-card force-${c.force.toLowerCase()}${m?.ruledOutBy.length ? ' ruled-out' : ''}${comingSoon ? ' coming-soon' : ''}`}
      data-testid="cmp-card"
      data-class-id={c.id}
      data-plant={c.plant}
      data-coming-soon={comingSoon ? '1' : undefined}
    >
      {m && <MatchBadge m={m} />}
      <header>
        <h3>
          {c.name}
          {comingSoon && <ComingSoonBadge />}
        </h3>
        <span className="cmp-tag">{c.country.toUpperCase()} · {c.force.toUpperCase()} · {c.gridHz} HZ</span>
      </header>
      {comingSoon && (
        <p className="cmp-coming-soon-note" data-testid="cmp-coming-soon-note">
          Nuclear propulsion — {COMING_SOON_LABEL}. Basic class sheet only; practice cuts for this plant are not playable yet.
        </p>
      )}
      <dl>
        <dt>Plant</dt><dd>{/DIESEL|NUCLEAR/.test(c.drivetrain) ? c.drivetrain : `${c.plant === 'nuclear' ? 'NUCLEAR' : 'DIESEL'} ${c.drivetrain}`}{c.aip ? ` + ${c.aip}` : ''}</dd>
        {(c.era || c.tier) && <><dt>Era</dt><dd>{c.era ?? '—'}{c.tier ? ` · ${TIER[c.tier] ?? c.tier.toUpperCase()}` : ''}</dd></>}
        {c.engines.map((e, i) => <Fragment key={i}><dt>{i ? '' : 'Engines'}</dt><dd>{e.count}× {e.stroke}-stroke {e.cylinders} cyl, {e.erpm[0]}–{e.erpm[1]} ERPM</dd></Fragment>)}
        {c.gear && <><dt>Gearing</dt><dd>{c.gear}</dd></>}
        {c.motorSlots && <><dt>Motor</dt><dd>{c.motorSlots} slots</dd></>}
        <dt>Propulsor</dt><dd>{c.shafts} shaft{c.shafts > 1 ? 's' : ''} · {c.blades} blades{c.propType ? ` · ${c.propType}` : ''}</dd>
        {c.emergency && <><dt>Backup</dt><dd>{c.emergency}</dd></>}
        <dt>TPK</dt><dd>{c.tpk ? `${r2(c.tpk)}${c.tpkMinKts ? ` (valid above ${r2(c.tpkMinKts)} kt)` : ''}` : 'pending catalog'}</dd>
        <dt>Max speed</dt><dd>{c.speeds.map((s) => `${s.label} ${s.kts} kt`).join(' · ')}</dd>
        {c.quietKts && <><dt>Quiet</dt><dd>{c.quietKts[0]}–{c.quietKts[1]} kt</dd></>}
        {c.cavitationKts && <><dt>Cavitation</dt><dd>onset ≈ {c.cavitationKts} kt at surface, later with depth</dd></>}
      </dl>
      {(c.edas.length > 0 || c.hydpHz || c.speedFeatures.length > 0) && <>
        <h4>Classifying lines</h4>
        <ul className="cmp-classify">
          {c.edas.map((e) => <li key={e.name}>{e.name} (EDA) = CFR × {e.cfrMultiple}, engine running only</li>)}
          {c.speedFeatures.map((f, i) => <li key={`sf${i}`}>{f.kind}{f.name ? ` ${f.name}` : ''}: {f.kts[0]}–{f.kts[1]} kt only{f.band ? `, ${f.band}` : ''}</li>)}
          {c.hydpHz && <li>HYDP ≈ {c.hydpHz.toFixed(2)} Hz, fixed; short pair curving down onto it on a planes or rudder move</li>}
        </ul>
      </>}
      <h4>Lines by mode</h4>
      <table className="cmp-modes"><tbody>
        {c.modes.map((m) => <tr key={m.mode}><th>{m.mode}</th><td>{m.lines.join(', ')}</td></tr>)}
      </tbody></table>
      <h4>ID keys</h4>
      <ul>{c.ratios.map((r) => <li key={r}>{r}</li>)}<li>DEMON: {c.demon}</li></ul>
    </article>
  )
}

/** Recognition guide. Reads only the static catalog, never the live scenario, so it is safe to keep open
 * in practice mode without giving away which class the trainee is hearing. */
export function Compendium({ onClose }: { onClose: () => void }) {
  const cards = useMemo(() => compendiumCards(catalog), [])
  const countries = useMemo(() => [...new Set(cards.map((c) => c.country))], [cards])
  const [f, setF] = useState<CardFilter>({ query: '', country: '', plant: '' })
  const [narrowOpen, setNarrowOpen] = useState(false)
  const [nf, setNf] = useState<NarrowForm>(EMPTY_NARROW)
  const [hide, setHide] = useState(false)
  const obs = useMemo(() => toObservations(nf), [nf])
  const keys = constraintCount(obs)
  const matches = useMemo(() => (narrowOpen && keys ? matchClasses(obs) : undefined), [narrowOpen, keys, obs])
  const filtered = filterCards(cards, f)
  const byId = new Map(filtered.map((c) => [c.id, c]))
  const ranked = rankIds(filtered.map((c) => c.id), matches, hide)
  const shown = ranked.map((r) => byId.get(r.id)!)
  return (
    <div className="compendium" role="dialog" aria-label="Compendium" data-testid="compendium">
      <div className="cmp-bar">
        <h2>COMPENDIUM</h2>
        <input type="search" placeholder="Search class, line, ratio…" value={f.query} onChange={(e) => setF({ ...f, query: e.target.value })} aria-label="Search compendium" />
        <select value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })} aria-label="Nation">
          <option value="">All nations</option>
          {countries.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <div className="seg" role="group" aria-label="Plant">
          {(['', 'diesel', 'nuclear'] as const).map((p) => <button key={p} aria-pressed={f.plant === p} onClick={() => setF({ ...f, plant: p })}>{p ? p.toUpperCase() : 'ALL'}</button>)}
        </div>
        <span className="readout">{shown.length}/{cards.length} CLASSES</span>
        <button className="btn" aria-pressed={narrowOpen} onClick={() => setNarrowOpen(!narrowOpen)}>Narrow down</button>
        <button className="btn" onClick={() => window.print()}>Print</button>
        <button className="btn" onClick={onClose} aria-label="Close compendium">Close</button>
      </div>
      <div className="cmp-body">
        {narrowOpen && <NarrowDown f={nf} set={setNf} hide={hide} setHide={setHide} count={keys} onClear={() => setNf(EMPTY_NARROW)} />}
        <div className="cmp-grid">
          {ranked.map((r) => <Card key={r.id} c={byId.get(r.id)!} m={r.match} />)}
          {!ranked.length && <p className="cmp-empty" data-testid="cmp-empty">{hide && matches ? 'No class agrees with every key. Untick HIDE RULED-OUT to see the closest, or recheck a value.' : 'No classes match the filter.'}</p>}
        </div>
      </div>
      <p className="cmp-foot">All classes, nations and signatures are fictional. Values shown are class ranges and ratios; each hull is seeded with its own jitter.</p>
    </div>
  )
}
