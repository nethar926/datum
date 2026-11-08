# Bounded tile accums — 3-rep results (2026-11-08)

Parent tip before this task: `6492afb`. Feature: `a8f1064`. Profile: `cf2aa89`.
Default: `BOUNDED_TILE_ACCUMS=true`, `TILE_ACCUM_PER_BUOY=1`, P-only q=1, budget ~3.2 MiB.
`setAccumMaxTiles(8)` remains diagnostic only.

## Profile (RES2×60, what extra tiles avoid)

See `docs/accum-tile-profile-2026-11-08.md`. Summary: history-path coreFast
40960→0 at ACCUM_MAX_TILES 2→8; call ratio
2.10×; +61.5 MB scratch
(breaks 50 MB). Bounded path keeps only 1 P-only tile/buoy (~2.62 MB).

## % realtime vs `6492afb` (median of 3 sequential 30 s reps)

| cell | 6492afb | bounded ON | bounded OFF | ON vs tip | ON vs OFF | acoustic MB (ON) |
|---|---:|---:|---:|---:|---:|---:|
| RES5×1 | 9.82% | 9.21% | 9.34% | 1.067× | 1.015× | 29.04 |
| RES5×60 | 48.53% | 47.16% | 47.87% | 1.029× | 1.015× | 30.95 |
| RES2×1 | 26.08% | 24.58% | 25.44% | 1.061× | 1.035× | 47.19 |
| RES2×60 | 379.09% | 346.83% | 383.80% | 1.093× | 1.107× | 49.1 |

Raw: `bench/results/bounded-tile-seq-2026-11-08.{jsonl,summary.json}`.

## Accuracy

`boundedTileAccum` ON vs OFF expected-spectrum max error **2.2e-6 dB** (≪ 0.01 dB) over 384k bins
(RES2 FULLBAND, 3 contacts). Existing fast-path / coarse / wasm checks unchanged in suite.

## Acoustic memory at RES2×60 (bounded ON)

Acoustic total **49.104 MB** (≤ 50). Component breakdown (MB):

| component | MB |
|---|---:|
| streams (RES retained) | 23.593 |
| scratch (sharedScratch) | 11.502 |
| — of which tileAccum (budgeted) | 2.624 |
| history | 4.482 |
| demon | 6.905 |
| legacy | 2.621 |
| spanCache / rowCache / fftShared | 0.786 / 0.066 / 0.082 |
| **acoustic total** | **49.104** |

`accumCount=160` (128 vernier + 32 tile-0). Off path: acoustic 46.48 MB, tileAccum 0.

## Honest notes — what did not pay off

- **Full 8-tile q=3** under 50 MB: impossible (~61 MB extra scratch alone).
- **q=3 × 1 tile/buoy**: ~7.9 MB tile accums → acoustic ~54 MB, over budget.
- **LRU over hot visible tile**: FE pans across tiles; thrash risk under uniform drain; fair
  tile-0 is stable and matches a parked view. Not implemented.
- **Capturing the full 2.1×**: needs either more headroom or a denser reuse than Float32 Welch
  slots. One hot tile recovers ~1.09× vs tip at RES2×60 (~1.11× vs bounded-off) — real but
  far from the diagnostic accum8 ceiling (~2.1× / ~192% RT).
- **RES5**: no FULLBAND tile overflow (`tileCount ≤ ACCUM_MAX_TILES`), so bounded path is idle;
  noise-level ±1–3% vs tip.
