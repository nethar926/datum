import type { CutSeed } from './types'
import { IcPause, IcPlay, IcRestart } from '../ui/icons'

const fmt = (s: number) => {
  const m = Math.floor(s / 60), r = Math.floor(s % 60)
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
}

/** Glass play / pause / restart + scrubber for the active cut (44 pt targets). */
export function CutBar({
  cut, simT, playing, onPlay, onPause, onRestart, onSeek,
}: {
  cut: CutSeed
  simT: number
  playing: boolean
  onPlay: () => void
  onPause: () => void
  onRestart: () => void
  onSeek: (tS: number) => void
}) {
  const dur = cut.durationS
  const t = Math.min(Math.max(0, simT), dur)
  return (
    <div className="cut-bar glass" data-testid="cut-bar" role="toolbar" aria-label="Cut player">
      <button type="button" className={`glass-btn cut-transport${playing ? '' : ' primary'}`} data-testid="cut-play"
        aria-label={playing ? 'Pause' : 'Play'} onClick={() => playing ? onPause() : onPlay()}>
        {playing ? <IcPause /> : <IcPlay />}
      </button>
      <button type="button" className="glass-btn cut-transport" data-testid="cut-restart" aria-label="Restart cut"
        title="Restart cut from T+00:00" onClick={onRestart}>
        <IcRestart />
      </button>
      <label className="cut-scrub" title="Scrub cut time (seeks to target)">
        <span className="readout" data-testid="cut-time">{fmt(t)} / {fmt(dur)}</span>
        <input
          type="range" min={0} max={dur} step={1} value={Math.floor(t)}
          aria-label="Cut scrubber"
          data-testid="cut-scrubber"
          onChange={(e) => onSeek(Number(e.currentTarget.value))}
        />
      </label>
    </div>
  )
}
