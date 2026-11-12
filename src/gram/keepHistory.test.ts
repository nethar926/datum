import { describe, expect, it } from 'vitest'

/**
 * App-side keep-history audit for RES / NB-BB / vernier switches.
 *
 * These tests pin the contract “a view switch must not cut off or reload data.”
 * Today `SimClient.setGram` starts a handoff: `subscribeGram` mints new stream
 * ids alongside the displayed set, the old gram stays up until promote
 * (“never a blank gram”), then `promoteGram` unsubscribes the old set. The
 * new ring is a short fill from subscribe-time (or a timeout promote that
 * still shows the previous RES at the wrong Δf). Filling every RES in the
 * background is forbidden. Un-skip when Sonya's `setViewRes(streamId,res)`
 * and `drainHistory(streamId,res,rows)` land; do not invent a second
 * subscribe path, and do not add hand-ported engine code in acoustics/.
 *
 * ## Call sites that will move to `setViewRes` + `drainHistory`
 * (RES-only and NB-BB / vernier on the same running streams. RES ↔ DEMON
 * and RES ↔ band-preset stay a family handoff.)
 *
 * Web:
 * - `SimClient.setGram` (`src/engine/client.ts`) → `subscribeGram` /
 *   `promoteGram`. App.tsx callers: `stepRes`, `setFilter`, `centerVernier`,
 *   `vernierOff`, start-of-run `client.setGram(loadGram())`, training-plan
 *   `plan.gram`. `pickBand` and the DEMON pane stay a handoff / display
 *   toggle. `setBand` (0–1 / 0–2 kHz) is a full engine restart until the
 *   fmax audit.
 *
 * Native (same contract; tests live in `GramKeepHistoryTests.swift`):
 * - `AppModel.setGram` → `LiveEngine.reconfigure` (new `subscribeRes` ids).
 *   Callers: `stepRes`, `setFilter`, LiveScreen DEMON/LOFAR menu (family
 *   change), `replay` / `startGenerated` re-apply after a restart (fresh
 *   subscribe is correct there).
 * - `AppModel.setVernier` → `reconfigure(kind, vernierHz:)`. Callers:
 *   `vernierButton`, `gramTouch` while `vernierPick`, RootView launch hook.
 */
describe('keep-history on a RES / filter / vernier switch', () => {
  /** Flip when the worker exposes setViewRes / drainHistory. */
  const setViewResAvailable = false
  const pending = 'pending setViewRes/drainHistory: a RES/NB-BB/vernier switch must keep already-emitted rows at the destination RES and preserve scroll-back, without extra subscriptions. Today handoff mints new ids and the promoted gram is a short subscribe-time fill (or the previous RES at the wrong Δf).'

  it.skipIf(!setViewResAvailable)('RES switch keeps destination history, scroll-back, and stream ids', () => {
    // Intended pin, un-skipped once setViewRes + drainHistory are callable
    // from SimClient.setGram for RES-only changes:
    //   1. Fill a running RES 5 gram with known rows; set scroll-back.
    //   2. client.setGram({ res: 3 }) → setViewRes + drainHistory, same ids.
    //   3. Ring has historically correct RES 3 rows (more than the
    //      subscribe-time tail); scroll-back is unchanged; subscription
    //      count is flat.
    expect(setViewResAvailable).toBe(true)
  })

  it.skipIf(!setViewResAvailable)('switching back to a RES restores its already-emitted rows', () => {
    // RES 5 → RES 3 → RES 5: hashes of the original RES 5 rows are
    // unchanged (Sonya's golden: setViewRes must not change hashes of
    // rows already emitted at that RES). Same stream ids throughout.
    expect(setViewResAvailable).toBe(true)
  })

  it.skipIf(!setViewResAvailable)('NB ↔ BB filter switch keeps history and stream ids', () => {
    expect(setViewResAvailable).toBe(true)
  })

  it.skipIf(!setViewResAvailable)('vernier on/off keeps history and stream ids', () => {
    expect(setViewResAvailable).toBe(true)
  })

  it('documents why the keep-history pins are pending', () => {
    expect(setViewResAvailable, pending).toBe(false)
  })
})
