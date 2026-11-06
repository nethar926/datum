/**
 * React glue for ListenEngine: mute gate, row subscription, FOCUS / shift prefs, visibility.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SimClient } from '../engine/client'
import type { GramConfig } from '../engine/contract'
import { paintHealth, type BuoyHealth, type DetuneStore } from '../tactical/detune'
import { ListenEngine } from './listenEngine'
import { channelAllowsListen, gateListen } from './mute'
import {
  loadFocusHalf, loadListenOn, loadShiftMode, saveFocusHalf, saveListenOn, saveShiftMode,
} from './prefs'
import { focusHalfWidthHz, focusLabel, type FocusHalfWidth } from './focus'
import type { ShiftMode } from './shift'
import type { FreqView } from '../gram/axis'
import { fullView } from '../gram/res'

export interface UseListenArgs {
  client: SimClient
  cfg: GramConfig | undefined
  streamIndex: number
  configs: GramConfig[]
  cursorHz: number | null
  view: FreqView
  tabLive: boolean
  detune: DetuneStore
  buoyId: number | undefined
  buoyState: 'falling' | 'live' | 'dead' | undefined
}

export function useListen(a: UseListenArgs) {
  const engine = useMemo(() => new ListenEngine(), [])
  const [userOn, setUserOn] = useState<boolean>(() => loadListenOn())
  const [half, setHalf] = useState<FocusHalfWidth>(() => loadFocusHalf())
  const [shift, setShift] = useState<ShiftMode>(() => loadShiftMode())
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState === 'visible')
  const [running, setRunning] = useState(false)
  const [busy, setBusy] = useState(false)
  const engRef = useRef(engine)
  engRef.current = engine

  const health: BuoyHealth | null = a.buoyId !== undefined
    ? paintHealth(a.detune.get(a.buoyId), a.buoyState)
    : null
  const channelOk = channelAllowsListen(health)
  const gate = gateListen({ userOn, liveTab: a.tabLive, visible, channelOk })

  // Persist settings; on/off is saved but loadListenOn always returns false at boot.
  useEffect(() => { saveListenOn(userOn) }, [userOn])
  useEffect(() => { saveFocusHalf(half); engRef.current.setFocusHalf(half) }, [half])
  useEffect(() => { saveShiftMode(shift); engRef.current.setShift(shift) }, [shift])

  useEffect(() => {
    const on = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])

  useEffect(() => () => { engRef.current.dispose() }, [])

  // Gate → unmute / silence / mute teardown.
  useEffect(() => {
    const eng = engRef.current
    if (!userOn) {
      if (eng.isRunning) { eng.mute(); setRunning(false) }
      return
    }
    if (!gate.gated) {
      if (eng.isRunning) eng.silence()
      return
    }
    if (eng.isRunning) {
      eng.unsilence()
      return
    }
    // userOn && gated && not running — need an unmute gesture. The toggle click already called unmute.
  }, [userOn, gate.gated])

  // Cursor + zoom → FOCUS.
  useEffect(() => {
    const full = a.cfg ? fullView(a.cfg) : { lo: 0, hi: 1000 }
    engRef.current.setViewSpans(Math.max(1, a.view.hi - a.view.lo), Math.max(1, full.hi - full.lo))
    engRef.current.setFocusHz(a.cursorHz)
  }, [a.cursorHz, a.view.lo, a.view.hi, a.cfg])

  // Feed latest LOFAR row of the selected stream.
  useEffect(() => {
    const streamId = a.configs[a.streamIndex]?.streamId
    const cfg = a.cfg
    if (streamId === undefined || !cfg) return
    return a.client.onRows((rows) => {
      if (!engRef.current.isRunning) return
      const n = rows.streamIds.length
      if (!n || rows.data.length !== n * cfg.bins) return
      for (let k = 0; k < n; k++) {
        if (rows.streamIds[k] !== streamId) continue
        engRef.current.pushRow(rows.data, k * cfg.bins, {
          f0: cfg.f0, fBin: cfg.fBin, bins: cfg.bins, floorDb: cfg.dbFloor, ceilDb: cfg.dbCeil,
        })
        break
      }
    })
  }, [a.client, a.configs, a.streamIndex, a.cfg])

  const toggle = useCallback(async () => {
    if (busy) return
    if (userOn) {
      setUserOn(false)
      engRef.current.mute()
      setRunning(false)
      return
    }
    setBusy(true)
    try {
      // Gesture: create/resume context first, then flip userOn so the gate can pass.
      setUserOn(true)
      await engRef.current.unmute()
      setRunning(true)
      // If gated off (cuts / hidden / channel), stay running but silenced until allowed.
      if (!gateListen({ userOn: true, liveTab: a.tabLive, visible, channelOk }).gated) {
        engRef.current.silence()
      }
    } catch {
      setUserOn(false)
      engRef.current.mute()
      setRunning(false)
    } finally {
      setBusy(false)
    }
  }, [busy, userOn, a.tabLive, visible, channelOk])

  const effectiveHalf = focusHalfWidthHz(
    half,
    Math.max(1, a.view.hi - a.view.lo),
    a.cfg ? Math.max(1, fullView(a.cfg).hi - fullView(a.cfg).lo) : 1000,
  )
  const capsule = userOn && a.cursorHz !== null
    ? focusLabel(shift === 'octave' ? a.cursorHz * 2 : a.cursorHz, effectiveHalf)
    : null

  return {
    userOn, running, busy, half, setHalf, shift, setShift, toggle, capsule, effectiveHalf,
    gate, health, engine,
  }
}
