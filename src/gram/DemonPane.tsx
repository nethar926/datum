import { useMemo, useState } from 'react'
import type { GramConfig } from '../engine/contract'
import type { SimClient } from '../engine/client'
import type { PaletteId } from '../gl/colormap'
import { Gram } from './Gram'
import { clampView, freqToX, type FreqView } from './axis'
import { bladeReadout, harmonicSeries } from './harmonics'

interface Props { client: SimClient; configs: GramConfig[]; streamIndex: number; palette: PaletteId }
type Pick = 'shaft' | 'blade'

/**
 * DEMON waterfall with a harmonic cursor: click to set the shaft line (its harmonics are marked),
 * switch to Blade and click the blade-rate line; the readout gives shaft rate, RPM and blade count.
 */
export function DemonPane({ client, configs, streamIndex, palette }: Props) {
  const cfg = configs[streamIndex] ?? configs[0]
  const fMax = cfg ? cfg.f0 + (cfg.bins - 1) * cfg.fBin : 100
  const [view, setView] = useState<FreqView>({ lo: 0, hi: fMax })
  const [pick, setPick] = useState<Pick>('shaft')
  const [shaft, setShaft] = useState<number | null>(null)
  const [blade, setBlade] = useState<number | null>(null)
  const rd = shaft !== null ? bladeReadout(shaft, blade) : null
  const shaftH = useMemo(() => (shaft !== null ? harmonicSeries(shaft, fMax) : []), [shaft, fMax])
  const bladeH = useMemo(() => (blade !== null ? harmonicSeries(blade, fMax, 6) : []), [blade, fMax])

  const onPick = (hz: number) => {
    if (pick === 'shaft') { setShaft(hz); setPick('blade') } else setBlade(hz)
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>DEMON</h2>
        <div className="seg" role="group" aria-label="Harmonic cursor">
          <button aria-pressed={pick === 'shaft'} disabled={!cfg} onClick={() => setPick('shaft')} title="Click the shaft-rate line">Shaft</button>
          <button aria-pressed={pick === 'blade'} disabled={!cfg} onClick={() => setPick('blade')} title="Click the blade-rate line">Blade</button>
          <button onClick={() => { setShaft(null); setBlade(null); setPick('shaft') }} disabled={shaft === null && blade === null}>Clear</button>
        </div>
        <span className="readout" data-testid="demon-readout">
          {!cfg ? 'NO DEMON FEED' : rd ? `SHAFT ${rd.shaftHz.toFixed(2)} HZ  ${rd.rpm.toFixed(0)} RPM` : 'PICK SHAFT LINE'}
          {rd?.bladeHz != null ? `  BLADE ${rd.bladeHz.toFixed(2)} HZ  ${rd.blades !== null ? `${rd.blades} BLADES` : 'NOT A HARMONIC'}` : ''}
        </span>
      </div>
      <div className="panel-body">
        {cfg ? (
          <Gram client={client} configs={configs} streamIndex={streamIndex} view={view} palette={palette}
            onView={(v) => setView(clampView(v, fMax, 2))} normalized={false} historyRows={300}
            label="DEMON waterfall" testId="demon" onSelectHz={onPick}
            overlay={({ view: v, width }) => (
              <>
                {shaftH.map((f, i) => f >= v.lo && f <= v.hi && (
                  <div key={`s${i}`} className="harm-marker shaft" style={{ left: freqToX(f, v, width) }}><span>{i === 0 ? 'S' : i + 1}</span></div>))}
                {bladeH.map((f, i) => f >= v.lo && f <= v.hi && (
                  <div key={`b${i}`} className="harm-marker blade" style={{ left: freqToX(f, v, width) }}><span>{i === 0 ? 'B' : `B${i + 1}`}</span></div>))}
              </>
            )} />
        ) : (
          <div className="empty-note">DEMON rows aren't coming from the engine yet. This pane fills in automatically once they do.</div>
        )}
      </div>
    </section>
  )
}
