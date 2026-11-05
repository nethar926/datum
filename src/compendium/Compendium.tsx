import { Fragment, useMemo, useState } from 'react'
import { catalog } from '@acoustics'
import { compendiumCards, filterCards, r2, type CardFilter, type CompendiumCard } from './cards'

const TIER: Record<string, string> = { gen1: 'GEN 1', gen2: 'GEN 2', gen3: 'GEN 3', gen4: 'GEN 4' }

function Card({ c }: { c: CompendiumCard }) {
  return (
    <article className={`cmp-card force-${c.force.toLowerCase()}`} data-testid="cmp-card">
      <header>
        <h3>{c.name}</h3>
        <span className="cmp-tag">{c.country.toUpperCase()} · {c.force.toUpperCase()} · {c.gridHz} HZ</span>
      </header>
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
  const shown = filterCards(cards, f)
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
        <button className="btn" onClick={() => window.print()}>Print</button>
        <button className="btn" onClick={onClose} aria-label="Close compendium">Close</button>
      </div>
      <div className="cmp-grid">{shown.map((c) => <Card key={c.id} c={c} />)}</div>
      <p className="cmp-foot">All classes, nations and signatures are fictional. Values shown are class ranges and ratios; each hull is seeded with its own jitter.</p>
    </div>
  )
}
