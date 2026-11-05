import { useEffect, useState } from 'react'
import type { TruthContact } from '../engine/contract'
import { truthRowDim, truthRows } from './truthFamilies'

export type TruthDock = 'bl' | 'tl' | 'tr' | 'br'
export const TRUTH_DOCKS: readonly TruthDock[] = ['bl', 'tl', 'tr', 'br']
const DOCK_LABEL: Record<TruthDock, string> = { bl: '↙', tl: '↖', tr: '↗', br: '↘' }
const KEY = 'datum.truthPanel'

export interface TruthPanelPrefs { collapsed: boolean; dock: TruthDock; open: string[] }
export const DEFAULT_TRUTH_PREFS: TruthPanelPrefs = { collapsed: false, dock: 'bl', open: [] }
export function loadTruthPrefs(raw: string | null): TruthPanelPrefs {
  try {
    const v = raw ? JSON.parse(raw) : {}
    return { collapsed: v.collapsed === true, dock: TRUTH_DOCKS.includes(v.dock) ? v.dock : 'bl', open: [] }
  } catch { return DEFAULT_TRUTH_PREFS }
}
export const nextDock = (d: TruthDock): TruthDock => TRUTH_DOCKS[(TRUTH_DOCKS.indexOf(d) + 1) % TRUTH_DOCKS.length]

/** Truth overlay on the tactical plot. Collapsed shows one header line per contact; click a header to
 * expand just that contact. Dock cycles corners so it can be moved off the part of the plot in use. */
export function TruthPanel({ contacts }: { contacts: readonly TruthContact[] }) {
  const [p, setP] = useState<TruthPanelPrefs>(() => { try { return loadTruthPrefs(localStorage.getItem(KEY)) } catch { return DEFAULT_TRUTH_PREFS } })
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify({ collapsed: p.collapsed, dock: p.dock })) } catch { /* private mode */ } }, [p.collapsed, p.dock])
  const active = contacts.filter((c) => c.active !== false)
  const toggle = (id: string) => setP({ ...p, open: p.open.includes(id) ? p.open.filter((x) => x !== id) : [...p.open, id] })
  return (
    <div className={`truth-panel readout dock-${p.dock}${p.collapsed ? ' collapsed' : ''}`} data-testid="truth-panel">
      <div className="truth-bar">
        <span>TRUTH · {active.length}</span>
        <button onClick={() => setP({ ...p, dock: nextDock(p.dock) })} aria-label="Move truth panel" title="Move to next corner">{DOCK_LABEL[nextDock(p.dock)]}</button>
        <button onClick={() => setP({ ...p, collapsed: !p.collapsed, open: [] })} aria-label={p.collapsed ? 'Expand truth panel' : 'Collapse truth panel'} aria-expanded={!p.collapsed}>{p.collapsed ? '▸' : '▾'}</button>
      </div>
      {active.map((c) => {
        const rows = truthRows(c), show = !p.collapsed || p.open.includes(String(c.id))
        return <div key={c.id} className="truth-contact">
          <div className="truth-head" role={p.collapsed ? 'button' : undefined} onClick={p.collapsed ? () => toggle(String(c.id)) : undefined}>{rows[0]}</div>
          {show && rows.slice(1).map((r, i) => <div key={i} className={`truth-row${truthRowDim(r) ? ' dim' : ''}`}>{r}</div>)}
        </div>
      })}
    </div>
  )
}
