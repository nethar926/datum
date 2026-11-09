# Soak + non-Welch-frame reuse (2026-11-08)

Parent tip before this work: `4c9a526`. Feature/fix commits on tip: soak harness
`771c3c4`/`3fa1594`, tileAccumBytes accounting `9e0797e`. Lead: keep bounded-reuse
local; soak peak over 900 s with pan/seek/RES; investigate reuse that does not store
every Welch frame.

## Soak harness

- Bench: `bench/soakMemory.bench.ts` (900 s default; `on|off|both`)
- Test: `test/soakMemory.test.ts` (90 s pan/seek/RES mix, ON+OFF)
- Workload: provisional manifest v1, RES2×60 start, 32 buoys × 12 streams
- Ops: FULLBAND pan every 3 s; seekFwd (`skipToLatest`) / seekBack (rewind 4 streams by
  1 row, bounded drain + skipToLatest — full 32×8 history scrub is hours at RES2×60) on a
  20 s cadence; RES2↔RES5 every 30 s in res/mixed phases (60 s cycle: pan → seek → res → mixed)
- Samples: every 5 s + peak observe after special ops; growth from warm (t≥30 s)

Raw: `bench/results/soak-900-2026-11-08.{on,off,summary}.json`.

### 900 s results (acoustic retained = history+scratch+streams+demon+legacy)

| mode | peak MB | p99 MB | final MB | RES2 peak | warm→final growth | worst op | heap peak MB | wall s |
|---|---:|---:|---:|---:|---:|---|---:|---:|
| bounded ON | **47.00** | 47.00 | 32.90 | 47.00 | −13.9 (ends on RES5) | **resSwitch** @ t=150 | 338 | 2586 |
| bounded OFF | **44.50** | 44.50 | 32.90 | 44.50 | −11.4 (ends on RES5) | **resSwitch** @ t=150 | 341 | 2777 |

- Both peaks ≤ 50 MB (`underBudget: true`).
- RES2 plateau is flat after warm (ON ~46.83 → 47.00; OFF ~44.33 → 44.50): **no acoustic leak**.
- Negative warm→final growth is the RES5 end state (streams shrink), not a free. On RES2
  phases acoustic is constant within ~0.2 MB.
- Worst op is the first RES5→RES2 `resSwitch` (same peak level as later pan/seek on RES2).
- JS heap oscillates with GC (not a retained acoustic leak).
- Soak ON ran before `9e0797e`; `tileAccumBytes` read 0 after the first RES round-trip
  (counter bug only — `accumCount` stayed 160). Fixed in `9e0797e` with a round-trip test.

## Non-Welch-frame reuse — dead end (no flag shipped)

Welch spans are **Hann⁴-weighted** (peak-to-trough ~8.7×10⁵ on RES2). Sliding `RowAccum`
slots already do exact incremental updates without keeping per-frame spectra.

Harness: `bench/results/prefix-reuse-verdict.json`, `test/prefixReuse.test.ts`.

| step | uniform max dB | ≤0.01 dB? | 32×8 P-only MB |
|---:|---:|:---:|---:|
| 1 | 0 | yes | 648 |
| 2 | 0.008 | yes | 324 |
| 4 | 0.041 | no | 164 |
| 8 | 0.168 | no | 84 |
| 16–32 | 0.63–2.85 | no | 44–24 |

Only step≤2 clears 0.01 dB on a mild synth, and that stride cannot fit under ~3.5 MB
headroom. Hierarchical / unweighted prefix / edge-only incremental without stored P_j
fail the same accuracy-or-budget wall. **No new reuse flag**; bounded 1×P-only tile Welch
slots remain the in-budget option; `setAccumMaxTiles(8)` stays diagnostic.

## % realtime vs `4c9a526`

Unchanged — no new default-on kernel path. Prior bounded-ON medians still apply
(`docs/bounded-tile-results-2026-11-08.md`). No 3-rep re-bench (accounting-only fix).
