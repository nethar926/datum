import { behaviourWording } from './api'
import { useMemo, useState } from 'react'
import { catalogIdCards, type CatalogIdCard } from './catalogCards'
import { msrWorkback, type WorkbackType } from './msrWorkback'
import type { Confidence } from './types'
import { IcClose } from '../ui/icons'

const CONF: Confidence[] = ['low', 'med', 'high']

/** Touch-first class ID deck for CUT mode — cards from the live acoustics catalog only. */
export function IdDeck({
  selectedId, confidence, onSelect, onConfidence, onSubmit, onClose, canSubmit,
  markHz,
}: {
  selectedId: string | null
  confidence: Confidence
  onSelect: (id: string) => void
  onConfidence: (c: Confidence) => void
  onSubmit: () => void
  onClose: () => void
  canSubmit: boolean
  /** Optional current HARM/PROBE mark for the MSR work-back tool. */
  markHz?: number | null
}) {
  const cards = useMemo(() => catalogIdCards(), [])
  const [q, setQ] = useState('')
  const [wbN, setWbN] = useState(1)
  const [wbType, setWbType] = useState<WorkbackType>('shaft')
  const [wbHz, setWbHz] = useState('')
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return cards
    return cards.filter((c) =>
      c.name.toLowerCase().includes(s) || c.country.toLowerCase().includes(s) || c.id.includes(s)
      || c.force.toLowerCase().includes(s) || c.lines.some((l) => l.family.toLowerCase().includes(s) || l.label.toLowerCase().includes(s)))
  }, [cards, q])

  const mark = Number(wbHz) || markHz || 0
  const wb = useMemo(() => (mark > 0 ? msrWorkback({ markHz: mark, n: wbN, type: wbType }) : null), [mark, wbN, wbType])

  return (
    <div className="cut-deck" data-testid="cut-deck" role="dialog" aria-label="ID card deck">
      <div className="cut-deck-bar">
        <h2>ID DECK</h2>
        <input className="cut-deck-search" data-testid="cut-deck-search" placeholder="Filter class / nation / line" value={q} onChange={(e) => setQ(e.currentTarget.value)} />
        <div className="seg" role="group" aria-label="Confidence">
          {CONF.map((c) => (
            <button key={c} aria-pressed={confidence === c} data-testid={`cut-conf-${c}`} onClick={() => onConfidence(c)}>{c.toUpperCase()}</button>
          ))}
        </div>
        <button className="btn primary" data-testid="cut-submit" disabled={!canSubmit} onClick={onSubmit}>Submit</button>
        <button className="btn icon glass-btn" aria-label="Close deck" onClick={onClose}><IcClose /></button>
      </div>

      <div className="cut-workback" data-testid="cut-workback">
        <span className="seg-label">WORK-BACK</span>
        <label>Mark Hz
          <input inputMode="decimal" data-testid="cut-wb-hz" placeholder={markHz ? String(markHz.toFixed(2)) : 'Hz'}
            value={wbHz} onChange={(e) => setWbHz(e.currentTarget.value)} />
        </label>
        <label>n
          <select data-testid="cut-wb-n" value={wbN} onChange={(e) => setWbN(Number(e.currentTarget.value))}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <div className="seg" role="group" aria-label="Work-back type">
          <button aria-pressed={wbType === 'shaft'} data-testid="cut-wb-shaft" onClick={() => setWbType('shaft')}>Shaft</button>
          <button aria-pressed={wbType === 'blade'} data-testid="cut-wb-blade" onClick={() => setWbType('blade')}>Blade</button>
        </div>
        {wb && (
          <div className="cut-wb-hits" data-testid="cut-wb-hits">
            <span className="readout">F0≈{wb.impliedFundHz.toFixed(2)} Hz · {wb.hits.length} fit</span>
            <ul>
              {wb.hits.slice(0, 8).map((h) => (
                <li key={h.classId}>
                  <button type="button" className="cut-wb-hit" data-testid="cut-wb-hit" data-class-id={h.classId}
                    onClick={() => onSelect(h.classId)}>
                    {h.name} · {h.shafts}×{h.blades} · Δ{h.deltaHz.toFixed(1)} Hz
                    {h.impliedShaftHz != null ? ` · PSR≈${h.impliedShaftHz.toFixed(2)}` : ''}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="cut-deck-grid">
        {filtered.map((c) => <DeckCard key={c.id} c={c} selected={selectedId === c.id} onSelect={() => onSelect(c.id)} />)}
      </div>
    </div>
  )
}

function DeckCard({ c, selected, onSelect }: { c: CatalogIdCard; selected: boolean; onSelect: () => void }) {
  const keyLines = c.lines.filter((l) => l.classifying || l.family === 'HYDP' || l.family === 'EDA' || l.family === 'SSMA' || l.family === 'BR' || l.family === 'PSR' || l.family === 'MSR' || l.family === 'GRID').slice(0, 8)
  return (
    <button
      type="button"
      className={`cut-deck-card force-${c.force.toLowerCase()}${selected ? ' selected' : ''}`}
      data-testid="cut-deck-card"
      data-class-id={c.id}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <header>
        <h3>{c.name}</h3>
        <span className="cmp-tag">{c.country.toUpperCase()} · {c.force.toUpperCase()} · {c.gridHz} Hz</span>
      </header>
      <p className="cut-deck-plant">{c.drivetrain}{c.aip ? ` + ${c.aip}` : ''}</p>
      <p className="cut-deck-prop">{c.shafts} shaft{c.shafts > 1 ? 's' : ''} · {c.blades} blades{c.motorSlots ? ` · MSR ×${c.motorSlots}` : ''}</p>
      <ul className="cut-deck-keys">
        {keyLines.map((l) => (
          <li key={`${l.family}:${l.label}`}>
            <b>{l.family}</b> {l.label !== l.family ? l.label : ''}
            {l.fundamentalHz ? ` · ${l.fundamentalHz[0].toFixed(0)}–${l.fundamentalHz[1].toFixed(0)} Hz` : ''}
            {l.orders ? ` · H${l.orders[0]}–${l.orders[1]}` : ''}
            {' · '}{l.power}
            {l.behaviour.length ? ` · ${l.behaviour.map(behaviourWording).join(', ')}` : ''}
          </li>
        ))}
      </ul>
      {c.behaviourTags.length > 0 && (
        <p className="cut-deck-tags" data-testid="cut-card-tags">{c.behaviourTags.slice(0, 3).join(' · ')}</p>
      )}
    </button>
  )
}
