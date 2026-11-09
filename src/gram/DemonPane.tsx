import { useMemo, useState } from 'react'
import type { GramConfig } from '../engine/contract'
import type { SimClient } from '../engine/client'
import type { PaletteId } from '../gl/colormap'
import { Gram } from './Gram'
import { clampView, freqToX, type FreqView } from './axis'
import { bladeReadout, harmonicSeries } from './harmonics'
import {
  DEMON_DISPLAY, DEMON_GRAM, DEMON_HISTORY_ROWS, makeDemonRowNormalizer,
  liveDemonHint,
} from '../cuts/cutNorm'

export type DemonPaneContext = 'live' | 'cuts'

interface Props {
  client: SimClient
  configs: GramConfig[]
  streamIndex: number
  palette: PaletteId
  /** When false, pane stays mounted and fed but is not shown (live LOFAR/DEMON toggle). */
  visible?: boolean
  /** Live = fixed cavitation hint; cuts = optional note from parent (cuts answer-key UI). */
  context?: DemonPaneContext
  /**
   * Cuts/reveal only: precomputed hint string from `cutsDemonHintForCut` /
   * `cutsDemonHintFromExpectation`. Live context ignores this (always uses liveDemonHint).
   */
  cutsHint?: string | null
}

/**
 * DEMON waterfall with a harmonic cursor: click to set the shaft line (its harmonics are marked),
 * switch to Blade and click the blade-rate line; the readout gives shaft rate, RPM and blade count.
 * Labels use DEMON units (shaft Hz / blade Hz, harmonic n of the blade rate).
 */
export function DemonPane({
  client, configs, streamIndex, palette, visible = true,
  context = 'live', cutsHint = null,
}: Props) {
  const cfg = configs[streamIndex] ?? configs[0]
  const fMax = cfg ? cfg.f0 + (cfg.bins - 1) * cfg.fBin : 100
  const bins = cfg?.bins ?? 512
  const demonNz = useMemo(() => makeDemonRowNormalizer(bins), [bins])
  const preprocessRow = useMemo(
    () => (src: Float32Array, srcOff: number, dst: Float32Array, dstOff: number) => demonNz.apply(src, srcOff, dst, dstOff),
    [demonNz],
  )
  const displayConfigs = useMemo(
    () => configs.map((c) => (
      c.dbFloor === DEMON_DISPLAY.floorDb && c.dbCeil === DEMON_DISPLAY.ceilDb
        ? c
        : { ...c, dbFloor: DEMON_DISPLAY.floorDb, dbCeil: DEMON_DISPLAY.ceilDb }
    )),
    [configs],
  )
  const [view, setView] = useState<FreqView>({ lo: 0, hi: fMax })
  const [pick, setPick] = useState<'shaft' | 'blade'>('shaft')
  const [shaft, setShaft] = useState<number | null>(null)
  const [blade, setBlade] = useState<number | null>(null)
  const rd = shaft !== null ? bladeReadout(shaft, blade) : null
  const shaftH = useMemo(() => (shaft !== null ? harmonicSeries(shaft, fMax) : []), [shaft, fMax])
  const bladeH = useMemo(() => (blade !== null ? harmonicSeries(blade, fMax, 6) : []), [blade, fMax])

  const onPick = (hz: number) => {
    if (pick === 'shaft') { setShaft(hz); setPick('blade') } else setBlade(hz)
  }

  // Live: fixed always-on copy (never reads contacts / answer-key expectation). Cuts: parent-supplied.
  const hint = context === 'live' ? liveDemonHint() : (cutsHint ?? null)

  return (
    <section
      className="panel gram-panel demon-panel"
      data-testid="demon-panel"
      data-context={context}
      data-visible={visible ? '1' : '0'}
      hidden={!visible}
      style={visible ? undefined : { display: 'none' }}
    >
      <div className="panel-head">
        <h2>DEMON</h2>
        <div className="seg" role="group" aria-label="Harmonic cursor">
          <button type="button" aria-pressed={pick === 'shaft'} disabled={!cfg} onClick={() => setPick('shaft')} title="Click the shaft-rate line">Shaft</button>
          <button type="button" aria-pressed={pick === 'blade'} disabled={!cfg} onClick={() => setPick('blade')} title="Click the blade-rate line">Blade</button>
          <button type="button" onClick={() => { setShaft(null); setBlade(null); setPick('shaft') }} disabled={shaft === null && blade === null}>Clear</button>
        </div>
        <span className="readout" data-testid="demon-readout">
          {!cfg ? 'NO DEMON FEED' : rd ? `SHAFT ${rd.shaftHz.toFixed(2)} HZ  ${rd.rpm.toFixed(0)} RPM` : 'PICK SHAFT LINE'}
          {rd?.bladeHz != null ? `  BLADE ${rd.bladeHz.toFixed(2)} HZ  ${rd.blades !== null ? `${rd.blades} BLADES` : 'NOT A HARMONIC'}` : ''}
        </span>
      </div>
      {hint && (
        <p className="demon-hint readout" data-testid="demon-hint" data-hint-kind={context === 'live' ? 'live' : 'cuts'}>
          {hint}
        </p>
      )}
      <div className="panel-body">
        {cfg ? (
          <Gram client={client} configs={displayConfigs} streamIndex={streamIndex} view={view}
            onView={(v) => setView(clampView(v, fMax, 2))}
            palette={palette}
            normalized={DEMON_GRAM.normalized} auto={DEMON_GRAM.auto}
            preprocessRow={preprocessRow} normKey={`demon-${bins}-${DEMON_DISPLAY.window}-${DEMON_DISPLAY.guard}-${DEMON_DISPLAY.ceilDb}`}
            historyRows={DEMON_HISTORY_ROWS}
            mode="lofar"
            label="DEMON waterfall" testId="demon" onSelectHz={onPick}
            overlay={({ view: v, width }) => (
              <>
                {shaftH.map((f, i) => f >= v.lo && f <= v.hi && (
                  <div key={`s${i}`} className="harm-marker shaft" data-testid={i === 0 ? 'demon-mark-shaft' : `demon-mark-shaft-h${i + 1}`}
                    style={{ left: freqToX(f, v, width) }}>
                    <span>{i === 0 ? 'S' : `S×${i + 1}`}</span>
                  </div>))}
                {bladeH.map((f, i) => f >= v.lo && f <= v.hi && (
                  <div key={`b${i}`} className="harm-marker blade" data-testid={i === 0 ? 'demon-mark-blade' : `demon-mark-blade-h${i + 1}`}
                    style={{ left: freqToX(f, v, width) }}>
                    <span>{i === 0 ? 'B' : `B×${i + 1}`}</span>
                  </div>))}
              </>
            )} />
        ) : (
          <div className="empty-note">DEMON rows aren't coming from the engine yet. This pane fills in automatically once they do.</div>
        )}
      </div>
    </section>
  )
}
