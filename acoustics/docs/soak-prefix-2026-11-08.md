# Soak + non-Welch-frame reuse (2026-11-08)

Parent tip: `4c9a526`. Lead: keep bounded-reuse local; soak peak over 900 s with
pan/seek/RES; investigate reuse that does not store every Welch frame.

## Soak harness

- Bench: `bench/soakMemory.bench.ts` (900 s default; `on|off|both`)
- Test: `test/soakMemory.test.ts` (90 s pan/seek/RES mix, ON+OFF)
- Workload: provisional manifest v1, RES2×60, 32 buoys × 12 streams
- Ops: FULLBAND pan every 3 s; seekFwd (skipToLatest) / seekBack (rewind 4 streams by 1 row,
  bounded drain + skipToLatest — full 32×8 history scrub is hours at RES2×60) on a 20 s
  cadence; RES2↔RES5 every 30 s in the res/mixed phases (60 s cycle: pan → seek → res → mixed)
- Samples: after every special op + every 5 s; growth measured from warm (t≥30 s)

Raw 900 s results: `bench/results/soak-900-2026-11-08.{on,off}.json` (filled by nohup driver).

## Non-Welch-frame reuse — what was tried

Welch span averages are **Hann⁴-weighted** (translation-invariant in lag, but weights vary by
~8.7×10⁵ peak-to-trough over a RES2 16 s span). Sliding `RowAccum` slots already implement
exact incremental window updates without retaining per-frame spectra.

### Coarse block / prefix sums of frame power

Store unweighted block-sums of modelled P at stride `step`, reconstruct a span by
(uniform weight × block mean) or (centre-frame weight × block mean).

Harness: `/workspace/fastpath-logs/investigate-prefix-reuse.mts` → `prefix-reuse-verdict.json`.

| step | uniform max dB | centre max dB | ≤0.01 dB? | 32×8 P-only MB |
|---:|---:|---:|:---:|---:|
| 1 | 0 | 0 | yes | 648 |
| 2 | 0.008 | 0.125 | uniform only | 324 |
| 4 | 0.041 | 0.133 | no | 164 |
| 8 | 0.168 | 0.168 | no | 84 |
| 16 | 0.626 | 0.330 | no | 44 |
| 32 | 2.85 | 2.87 | no | 24 |

Under ~3.5 MB headroom (50 − ~46.5 baseline): step=2 fits **2** (buoy,tile) pairs;
step=32 fits ~37 → 32×1 tile only, at **2.85 dB** error.

### Other ideas (not shipped)

| idea | result |
|---|---|
| Exact per-frame prefix (step=1) then span = difference | Exact for **unweighted** sums only; Welch needs lag-dependent weights → still need P_j or open slots. 648 MB for 32×8. |
| Hierarchical / decimated pyramid | Same accuracy wall: step=2 uniform can stay ≤0.01 dB on a mild synth, but 32×8 still needs ~324 MB; coarser strides fail accuracy. Memory still ≫ headroom for 32×8. |
| Incremental integrateHistory without storing P_j | Middle-frame Hann weights **change** when tEnd slides → must re-weight or re-coreFast; without stored spectra equals a partial history walk, not a win over SPAN_CACHE + bounded tile-0. |
| Float16 Welch slots × 8 tiles | ~½ of Float32 (~10.5 MB q=1 ×8 ×32) still over headroom; null/knee fidelity risk. |
| Replace bounded 1-tile Welch with step=32 prefix | Fits 32×1 but fails accuracy (2.85 dB); slower than Float32 slots for the one hot tile. |

**Verdict:** no reuse that skips per-frame Welch storage clears both ≤0.01 dB and ≤50 MB peak
for the FULLBAND cold-tile set. Bounded 1×P-only tile Welch slots (`a8f1064`) remain the best
in-budget option; `setAccumMaxTiles(8)` stays diagnostic. **No new flag shipped** (would be off
and not better).

## % realtime vs `4c9a526`

Unchanged — no new default-on path. Prior bounded-ON medians still apply
(`docs/bounded-tile-results-2026-11-08.md`).
