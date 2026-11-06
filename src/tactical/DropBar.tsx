import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { SimClient } from '../engine/client'
import type { BuoysDropped, DropSpec, Tactical } from '../engine/contract'
import type { OperatorLog } from '../log/operatorLog'
import { crossFixes } from './fix'
import { DEFAULT_COUNT, DROP_PATTERNS, PATTERN_LABEL, autoPlacement, planDrop, planReadout, type DropPattern, type DropPlan, type Pt } from './drop'
import type { DropController } from './dropController'
import { FIELD_MODES, FIELD_MODE_LABEL, MAX_BUOYS, autoShouldLay, dropHint, dropHintShort, type AutoMemo } from './fieldMode'

interface Props {
  client: SimClient; drop: DropController; tactical?: Tactical; log: OperatorLog
  /** Buoy life for new drops (s); undefined = the host default. */
  buoyLifeS?: number
}

const TOAST_MS = 2600
const FIELD_MODE_SHORT = { preplan: 'PRE', auto: 'AUTO', manual: 'MAN' } as const
const specs = (p: DropPlan, n: number, lifeS?: number): DropSpec[] => {
  const out: DropSpec[] = []
  for (let i = 0; i < Math.min(n, p.n); i++) out.push({ kind: p.kinds[i], x: p.xy[2 * i], y: p.xy[2 * i + 1], channel: p.channels[i], ...(lifeS ? { lifeS } : {}) })
  return out
}
/** Strongest current cross-fix (most buoys, then smallest residual), or null. */
function bestFix(t: Tactical): Pt | null {
  let best: { x: number; y: number; buoys: number; residualM: number } | null = null
  for (const f of crossFixes(t.bearings, t.buoys)) if (!best || f.buoys > best.buoys || (f.buoys === best.buoys && f.residualM < best.residualM)) best = f
  return best && { x: best.x, y: best.y }
}

/**
 * Drop bar on the tactical plot: field mode (PREPLAN / AUTO / MANUAL), the pattern palette, the live hint and,
 * once a ghost is placed, the confirm bar (readout, buoy count, Cancel, Drop). Also runs the AUTO lay.
 */
export function DropBar({ client, drop, tactical, log, buoyLifeS }: Props) {
  const s = useSyncExternalStore(drop.subscribe, drop.getState)
  const ghost = drop.ghost
  const count = tactical?.buoys.length ?? 0, free = Math.max(0, MAX_BUOYS - count), full = !!tactical && free === 0
  const ready = !!tactical

  // Drop replies → toast + operator log. seq → what was dropped (pattern, source).
  const sent = useRef(new Map<number, string>())
  const [toast, setToast] = useState<string | null>(null)
  const lastDrop = useSyncExternalStore(client.subscribe, () => client.status.lastDrop)
  const seen = useRef<BuoysDropped | undefined>(undefined)
  useEffect(() => {
    const d = lastDrop
    if (!d || d === seen.current) return
    seen.current = d
    const what = sent.current.get(d.seq) ?? 'DROP'; sent.current.delete(d.seq)
    for (const ch of d.channels) log.add({ simT: client.status.simT, kind: 'buoyDrop', buoyId: ch, data: { source: d.source, pattern: what.toLowerCase() } })
    const chs = d.channels.length > 4 ? `${d.channels.slice(0, 3).join(', ')} … ${d.channels.at(-1)}` : d.channels.join(', ')
    setToast(d.channels.length ? `${d.source === 'auto' ? 'AUTO ' : ''}${what} laid · ${d.channels.length} · CH ${chs}${d.error ? ` · ${d.error}` : ''}` : `Not laid · ${d.error ?? 'no buoys'}`)
    const id = window.setTimeout(() => setToast(null), TOAST_MS)
    return () => clearTimeout(id)
  }, [lastDrop, client, log])

  const send = (p: DropPlan, source: 'manual' | 'auto') => {
    const seq = client.dropBuoys(specs(p, free, buoyLifeS), source)
    sent.current.set(seq, PATTERN_LABEL[p.pattern].toUpperCase())
    drop.committed()
  }
  const confirm = () => {
    const g = drop.ghost
    if (drop.state.phase !== 'preview' || !g || g.n > free) return
    send(g, 'manual'); drop.dispatch({ type: 'confirm' })
  }

  // AUTO: lay the planner's AUTO pattern on entry, then on a fix outside the field (cooldown).
  const memo = useRef<AutoMemo>({ lastLayS: null }), entering = useRef(false)
  useEffect(() => { entering.current = s.mode === 'auto'; if (s.mode !== 'auto') memo.current.lastLayS = null }, [s.mode])
  // A restart (no picture yet) re-enters AUTO on the new field.
  useEffect(() => { if (!tactical && s.mode === 'auto') { entering.current = true; memo.current.lastLayS = null } }, [tactical, s.mode])
  useEffect(() => {
    if (s.mode !== 'auto' || !tactical) return
    const live: Pt[] = []
    for (const b of tactical.buoys) if (b.state !== 'dead') live.push(b)
    const fix = bestFix(tactical), first = entering.current
    if (!autoShouldLay(memo.current, tactical.simT, fix, live, tactical.buoys.length, first)) { entering.current = false; return }
    entering.current = false; memo.current.lastLayS = tactical.simT
    const pl = autoPlacement(fix, live)
    send(planDrop(pl, DEFAULT_COUNT[pl.pattern], tactical.simT | 0), 'auto')
  }, [tactical, s.mode]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard: Enter drops the previewed pattern, Escape steps back.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return
      if (e.key === 'Escape' && drop.state.phase !== 'idle') { drop.dispatch({ type: 'cancel' }); e.preventDefault() }
      else if (e.key === 'Enter' && drop.state.phase === 'preview' && el?.tagName !== 'BUTTON') { confirm(); e.preventDefault() }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  })

  // Phones: the plot grows while the drop tool is out (see .layout-phonePortrait in index.css).
  useEffect(() => { document.documentElement.dataset.drop = s.phase; return () => { delete document.documentElement.dataset.drop } }, [s.phase])
  const hint = toast ?? (ready ? dropHint(s, full) : 'Starting…')
  const hintShort = toast ?? (ready ? dropHintShort(s, full) : 'Starting…')
  return (
    <div className="drop-bar" data-testid="drop-bar" data-mode={s.mode} data-phase={s.phase} data-pattern={s.pattern ?? ''}>
      {s.phase === 'preview' && ghost ? (
        <div className="drop-confirm" data-testid="drop-confirm" role="group" aria-label="Confirm drop">
          <span className="drop-readout" data-testid="drop-readout">{planReadout(ghost)}{ghost.n > free ? ` · only ${free} free` : ''}</span>
          <div className="drop-actions">
            {s.pattern !== 'single' && (
              <div className="seg drop-step" role="group" aria-label="Buoys in pattern">
                <button className="icon" aria-label="Fewer buoys" onClick={() => drop.dispatch({ type: 'count', delta: -1 })}>−</button>
                <span className="drop-n" data-testid="drop-n" aria-live="polite">{ghost.n}</span>
                <button className="icon" aria-label="More buoys" onClick={() => drop.dispatch({ type: 'count', delta: 1 })}>+</button>
              </div>
            )}
            <button className="btn drop-cancel" data-testid="drop-cancel" onClick={() => drop.dispatch({ type: 'cancel' })}>Cancel</button>
            <button className="btn primary drop-go" data-testid="drop-go" disabled={ghost.n > free} onClick={confirm}>Drop {ghost.n}</button>
          </div>
        </div>
      ) : (
        <div key={hint} className={`drop-hint${toast ? ' toast' : ''}`} data-testid="drop-hint" aria-live="polite"><span className="drop-hint-count">{count}/{MAX_BUOYS}<span className="drop-hint-sep"> · </span></span><span className="lbl-full">{hint}</span><span className="lbl-short">{hintShort}</span></div>
      )}
      <div className="drop-tools">
        <div className="seg field-mode" role="group" aria-label="Field mode" data-testid="field-mode">
          {FIELD_MODES.map((m) => (
            <button key={m} data-mode={m} aria-pressed={s.mode === m} aria-label={`${FIELD_MODE_LABEL[m]} field mode`} onClick={() => drop.dispatch({ type: 'mode', mode: m })}
              title={m === 'preplan' ? 'Preplanned field: nothing laid automatically' : m === 'auto' ? 'AUTO: the trainer lays the planner’s AUTO pattern now and on new fixes outside the field' : 'MANUAL: you lay the field; the pattern stays armed after each drop'}>
              <span className="lbl-full">{FIELD_MODE_LABEL[m]}</span><span className="lbl-short" aria-hidden>{FIELD_MODE_SHORT[m]}</span>
            </button>
          ))}
        </div>
        <span className={`readout drop-buoys${full ? ' full' : ''}`} data-testid="buoy-count" title="Buoys in the field / field cap">{count}/{MAX_BUOYS}</span>
        <div className="seg drop-palette" role="group" aria-label="Drop pattern" data-testid="drop-palette">
          {DROP_PATTERNS.map((p) => (
            <button key={p} data-pattern={p} aria-pressed={s.pattern === p} aria-label={`${PATTERN_LABEL[p]} pattern`} disabled={!ready || full}
              title={`${PATTERN_LABEL[p]}: tap the plot to place${p === 'single' ? ' one buoy' : ', or drag to orient and size'}`}
              onClick={() => drop.dispatch({ type: 'arm', pattern: p })}>
              <PatternIcon p={p} /><span className="drop-label">{PATTERN_LABEL[p]}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/** 20 px glyphs: buoys as dots in each pattern's shape. */
function PatternIcon({ p }: { p: DropPattern }) {
  const dots: [number, number][] = p === 'line' ? [[3, 10], [7.5, 10], [12, 10], [16.5, 10]]
    : p === 'circle' ? Array.from({ length: 6 }, (_, i) => [10 + 6.5 * Math.sin((i * Math.PI) / 3), 10 - 6.5 * Math.cos((i * Math.PI) / 3)] as [number, number])
    : p === 'field' ? [[4, 4], [10, 4], [16, 4], [4, 10], [10, 10], [16, 10], [4, 16], [10, 16], [16, 16]]
    : p === 'wedge' ? [[10, 16], [6.5, 10], [13.5, 10], [3, 4], [17, 4]] : [[10, 10]]
  return (
    <svg className="drop-icon" width="20" height="20" viewBox="0 0 20 20" aria-hidden>
      {p === 'line' && <line x1="2" y1="10" x2="18" y2="10" />}
      {p === 'circle' && <circle cx="10" cy="10" r="6.5" fill="none" />}
      {p === 'wedge' && <polyline points="3,4 10,16 17,4" fill="none" />}
      {p === 'single' ? <path d="M10 4 L16 15 L4 15 Z" /> : dots.map(([x, y], i) => <circle key={i} className="dot" cx={x} cy={y} r={p === 'field' ? 1.7 : 2} />)}
    </svg>
  )
}
