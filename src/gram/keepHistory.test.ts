import { describe, expect, it } from 'vitest'

/**
 * App-side keep-history audit for RES, NB-BB, vernier, and LOFAR ↔ DEMON switches.
 *
 * These tests pin the contract “a view switch must not cut off or reload data.”
 * Today `SimClient.setGram` starts a handoff: `subscribeGram` mints new stream
 * ids alongside the displayed set, the old gram stays up until promote
 * (“never a blank gram”), then `promoteGram` unsubscribes the old set. The
 * new ring is a short fill from subscribe-time (or a timeout promote that
 * still shows the previous view at the wrong Δf). Filling every RES / DEMON
 * in the background is forbidden. Un-skip when Sonya's switch API lands;
 * do not invent a second subscribe path, and do not add hand-ported engine
 * code in acoustics/.
 *
 * ## Sonya's switch API (approved shape)
 *
 * There are no separate NB/BB or vernier calls. Everything goes through:
 *
 *     setViewRes(streamId, res, { filter?: 'NB'|'BB', vernierHz?: number | null })
 *
 * which returns the updated stream config (`res`, `filter`, `f0`, `fBin`,
 * `rowRateHz`, `rowPhaseS`, `integrationMode`, `integrationSpanS`), keeps
 * the same stream id, and does not restart the row clock. Then
 * `drainHistory(streamId, res, rows)` returns the retained rows in that
 * view. A vernier move may still rebuild the stream until her golden test
 * lands — the vernier pin stays behind `vernierGoldenAvailable`, not just
 * `setViewResAvailable`, and inspects the returned config. DEMON's exact
 * call is not specified yet; the LOFAR ↔ DEMON tests use the same
 * `drainHistory` contract and stay pending her confirmation of the call.
 *
 * ## Call sites that will move to `setViewRes` + `drainHistory`
 * (RES, NB-BB, vernier, and LOFAR ↔ DEMON. `pickBand` and the 0–1 / 0–2 kHz
 * `setBand` change stay full restarts for now.)
 *
 * Web:
 * - `SimClient.setGram` (`src/engine/client.ts`) → `subscribeGram` /
 *   `promoteGram`. App.tsx callers: `stepRes`, `setFilter` (becomes
 *   `setViewRes(id, res, { filter })`), `centerVernier` / `vernierOff`
 *   (`setViewRes(id, res, { vernierHz })`), start-of-run
 *   `client.setGram(loadGram())`, training-plan `plan.gram`, and the
 *   DEMON pane (LOFAR ↔ DEMON moves to the warm API, no longer an
 *   intended handoff). `pickBand` and `setBand` (0–1 / 0–2 kHz) stay
 *   full restarts for now.
 *
 * Native (same contract; tests live in `GramKeepHistoryTests.swift`):
 * - `AppModel.setGram` → `LiveEngine.reconfigure`. Callers: `stepRes`,
 *   `setFilter`, LiveScreen DEMON/LOFAR menu (warm API), `replay` /
 *   `startGenerated` re-apply after a restart (fresh subscribe is correct
 *   there).
 * - `AppModel.setVernier` → `reconfigure(kind, vernierHz:)`. Callers:
 *   `vernierButton`, `gramTouch` while `vernierPick`, RootView launch hook.
 */
describe('keep-history on a RES / filter / vernier / DEMON switch', () => {
  /** Flip when the worker exposes setViewRes / drainHistory. */
  const setViewResAvailable = false
  /** Flip when Sonya's vernier golden test is posted (a move may still rebuild the stream). */
  const vernierGoldenAvailable = false
  const pending = 'pending setViewRes/drainHistory: a RES/NB-BB/LOFAR↔DEMON switch must keep already-emitted rows and preserve scroll-back, without extra subscriptions. Today handoff mints new ids and the promoted gram is a short subscribe-time fill. NB/BB and vernier have no separate calls — they are options on setViewRes(streamId, res, { filter?, vernierHz? }), which returns the updated config, keeps the same id, and does not restart the clock; drainHistory then returns retained rows.'

  it.skipIf(!setViewResAvailable)('RES switch keeps destination history, scroll-back, and stream ids', () => {
    // client.setGram({ res: 3 }) → setViewRes(id, 3) + drainHistory; same id;
    // clock not restarted; historically correct RES 3 rows; scroll-back held.
    expect(setViewResAvailable).toBe(true)
  })

  it.skipIf(!setViewResAvailable)('switching back to a RES restores its already-emitted rows', () => {
    // RES 5 → RES 3 → RES 5: hashes of the original RES 5 rows unchanged.
    expect(setViewResAvailable).toBe(true)
  })

  it.skipIf(!setViewResAvailable)('NB ↔ BB via setViewRes({ filter }) restores exact original rows', () => {
    // setViewRes(id, res, { filter: 'BB' }) then back to 'NB': exact rows,
    // same id, no separate filter call.
    expect(setViewResAvailable).toBe(true)
  })

  it.skipIf(!setViewResAvailable || !vernierGoldenAvailable)(
    'vernier via setViewRes({ vernierHz }) inspects the returned config and keeps history',
    () => {
      // Behind vernierGoldenAvailable until Sonya's golden test lands — a
      // vernier move may still rebuild the stream. When un-skipped, inspect
      // the returned config: res, filter, f0, fBin, rowRateHz, rowPhaseS,
      // integrationMode, integrationSpanS; same id; clock not restarted.
      expect(setViewResAvailable && vernierGoldenAvailable).toBe(true)
    },
  )

  it.skipIf(!setViewResAvailable)(
    'LOFAR ↔ DEMON keeps rows and switching back restores original hashes',
    () => {
      // Moves to the warm API (no longer an intended handoff). Exact DEMON
      // call pending Sonya's confirmation; written against the same
      // drainHistory contract: rows kept in each view, LOFAR → DEMON →
      // LOFAR restores original hashes exactly, same ids, no extra
      // subscriptions, scroll-back preserved.
      expect(setViewResAvailable).toBe(true)
    },
  )

  it('documents why the keep-history pins are pending', () => {
    expect(setViewResAvailable, pending).toBe(false)
    expect(vernierGoldenAvailable, 'vernier golden test not yet posted').toBe(false)
  })
})
