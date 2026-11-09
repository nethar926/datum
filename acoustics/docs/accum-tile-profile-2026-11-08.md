# Accum tile reuse profile — RES2 × 60 contacts (2026-11-08)

Steady-state window after 2 s warmup; 10 s measured (40 ticks). Full provisional-ish load
(32 buoys, vernier LOFAR + FULLBAND NB/BB + DEMON). Tip parent: `6492afb`. Script:
`/workspace/fastpath-logs/profile-accum-reuse.mts`. Raw: `bench/results/accum-profile-2026-11-08.*`.

## Headline

| metric | ACCUM_MAX_TILES=2 (default) | ACCUM_MAX_TILES=8 | delta |
|---|---:|---:|---:|
| wall / % realtime | 40.70 s / 407.0% | 19.25 s / 192.5% | 2.12× faster at 8 |
| coreFast calls | 46848 | 22272 | ratio 2.103 |
| coreFast ms / tick | 893.0 | 374.6 | −518.4 ms |
| contact×bins total | 13,247,909,376 | 5,579,957,760 | −7,667,951,616 |
| scratch MB | 8.88 | 70.34 | +61.46 |
| acoustic retained total MB | 36.95 | 98.42 | (8 over 50 MiB) |
| accumCount | 128 | 384 | +256 |

`setAccumMaxTiles(8)` stays a **diagnostic flag only** (default 2). Full 8-tile q=3 Float32
accums need ~61 MB extra scratch and break the 50 MB acoustic budget.

## What the extra tiles avoid recomputing

`coreFast` is the per-frame modelled spectrum (per-contact broadband + tonals × liveBins). Path
tag from stack: `integrateAccum` vs `integrateHistory`.

### Path mix (steady 10 s)

| path | tiles=2 calls | tiles=8 calls | avoided at 8 |
|---|---:|---:|---:|
| integrateAccum | 5888 | 22272 | (accum absorbs the work) |
| integrateHistory | 40960 | 0 | **40960** |
| other | 0 | 0 | 0 |

With default `ACCUM_MAX_TILES=2`, RES2 FULLBAND (`tileCount=8 > 2`) never gets sliding Welch
accums, so **every FULLBAND tile row** walks `integrateHistory`: for each frame in the analysis
span, `loadFrame` + `coreFast` (all contacts × all liveBins). SPAN_CACHE only dedups NB↔BB of
the same `(buoy, tile, tEnd)` — hits=640, misses=640
(exactly 50% hit rate: BB after NB).

With `ACCUM_MAX_TILES=8`, every FULLBAND tile uses `integrateAccum`: each 0.25 s frame's
`coreFast` runs **once per (buoy, tile)** and is Hann²-folded into every open row slot. History
path drops to zero; span cache is unused (hits=0).

### Category accounting (per 10 s window, tiles=2 → tiles=8)

1. **Per-span frame walks (history path)**  
   - Calls avoided: **40960** `coreFast` invocations tagged `integrateHistory`.  
   - Per tick: 1024 history calls. Matches 32 buoys × 8 tiles × ~4 Welch frames /
     span, with SPAN_CACHE collapsing NB+BB → one unique compute per `(buoy,tile,tEnd)`.  
   - This is the dominant reuse: the same mid-span frames are re-evaluated for every successive
     row whose analysis window still covers them. Accums fold each frame once into R open slots.

2. **Per-contact × per-bin work**  
   - contact×bins avoided: **7,667,951,616** over 10 s (191,698,790 / tick).  
   - Mean liveBins×contacts per call ≈ 282785 (tiles=2) vs
     250537 (tiles=8) — same kernel width; volume drops with call count.  
   - Time: coreFast 35721 ms → 14985 ms (**−20736 ms**, ≈58% of
     coreFast time). Wall speedup ≈ 2.12× tracks this closely
     (coreFast is ~8776% of wall at tiles=2).

3. **Per-tile / per-buoy structure**  
   - Vernier bands already use accums under both configs (accumCount baseline 128 at tiles=2 =
     32 buoys × 4 vernier bands sharing NB/BB).  
   - tiles=8 adds 256 FULLBAND tile accums (32 × 8) → accumCount 384.  
   - Extra scratch ≈ 256 × RowAccum(q=3, L=TILE_BINS, slots≈R+1) ≈ **61.5 MB**.

4. **What is NOT avoided / not free**  
   - Accums still run `coreFast` once per new frame per held `(buoy,tile)` (accum calls rise
     5888→22272).  
   - DIFAR E/N under a P-only (q=1) budgeted accum still needs a latest-frame `coreFast` for
     bearings — that is a separate bounded-reuse design, not this diagnostic.  
   - SPAN_CACHE already salvages the NB/BB twin on the history path; raising tile accums makes
     that cache idle for FULLBAND.

## Implication for a ≤50 MB design

Headroom under 50 MB acoustic (demon+legacy included) at RES2×60 after kernel-opts is ~3.5 MB.
One P-only (q=1) tile accum per buoy × 32 ≈ 2.62 MB — fits. Full 8-tile q=3 does not.
Capturing the whole 2.1× needs either more budget or a much
denser encoding than Float32 Welch slots; a single hot tile per buoy recovers only the fraction
of history traffic that belongs to tile 0 (roughly 1/8 of FULLBAND history calls when the view
is uniform, more when the FE parks on tile 0).
