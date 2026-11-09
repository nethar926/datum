# Bounded FULLBAND tile Welch accums (≤50 MB)

## Problem

At RES2×60, `ACCUM_MAX_TILES=2` forces FULLBAND tiles onto `integrateHistory`. Raising the
cap to 8 removes all history-path `coreFast` (~2.1×) but adds ~61 MB scratch — over the
50 MB acoustic budget. See `accum-tile-profile-2026-11-08.md`.

## Design (default ON)

Flag: `BOUNDED_TILE_ACCUMS` (`setBoundedTileAccums` / `boundedTileAccums`), default **true**.

Budget: `TILE_ACCUM_BUDGET ≈ 3.2 MiB` soft cap on FULLBAND tile `RowAccum` bytes only
(vernier untouched). Fair share: `TILE_ACCUM_PER_BUOY = 1` (tiles 0..cap−1, stable order —
no LRU thrash under uniform drain).

Encoding: budgeted tiles use **q=1 (P only)** Float32 Welch slots — same math as vernier /
RES5 power path; Float32 relative error ≪ 0.01 dB over ≤128 adds. DIFAR E/N for a budgeted
tile come from one latest-frame `coreFast` (bearings); `S = max(0, P−amb)` as usual. Cold
tiles (index ≥ cap, or budget exhausted) keep `integrateHistory` + SPAN_CACHE.

`setAccumMaxTiles` stays diagnostic (default 2). Bounded path activates only when
`fullAxisTiles > ACCUM_MAX_TILES`.

## Why not more aggressive

| idea | result |
|---|---|
| 8-tile q=3 under 50 MB | Impossible (~61 MB extra scratch alone) |
| q=3 × 1 tile/buoy | ~7.9 MB tile accums → acoustic ~54 MB over budget |
| LRU over hot visible tile | FE pans; thrash risk; fair tile-0 is stable and matches parked view |
| Reorder history frames for locality | Secondary; span cache already covers NB/BB twin |

Headroom after kernel-opts at RES2×60 is ~3.5 MB acoustic; 32 × 1 × P-only ≈ 2.62 MB fits
with margin. Larger wins need more budget or a different (non-Welch-slot) reuse.

## Tests

`test/boundedTileAccum.test.ts`: defaults; retainedBytes.total ≤ 50 MiB at RES2 32×60;
expected spectrum ON vs OFF ≤ 0.01 dB; budget 0 → history only.
