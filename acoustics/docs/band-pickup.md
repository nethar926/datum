# Per-band pickup timing (FE note)

All LOFAR bands share one sim time axis. There is **no** per-band time offset and no "VLF last" rule.

Each band stream now opens at the finest RES whose 1024-bin zoom covers the band:

| Band | RES | Δf (bin) | Zoom B | Integration T | Hop (75 % ovl) | Row period |
|---|---|---|---|---|---|---|
| ELF 0–50 | 2 | 0.0625 Hz | 64 Hz | 16 s | 4 s | 4 s |
| VLF 0–200 | 4 | 0.25 Hz | 256 Hz | 4 s | 1 s | 2 s |
| LF 0–500 | 5 | 0.5 Hz | 512 Hz | 2 s | 0.5 s | 2 s |
| MF 0–2000 | 7 | 2 Hz | 2048 Hz | 0.5 s | 0.125 s | 2 s |

(Previously every band used RES5, so the 8 streams were the same 512 Hz window at different centres; MF only showed 744–1256 Hz.)

## Row simT convention

Every RES row, vernier or FULLBAND tile, is stamped at the **end** of its analysis span, for every band. Row k is due at `start + (k+1)/rowRateHz` and averages `(tEnd − span, tEnd]`.

## Why spans differ from the nominal FFT windows

The nominal window is T = 1/Δf (16 / 4 / 2 / 0.5 s). Each row averages K Hann segments hopped by T/4 (75 % overlap), where K = row period ÷ hop. That gives span = T + (K−1)·T/4:

- **ELF:** 16 + 0 = 16 s (K=1)
- **VLF:** 4 + 1·1 = 5 s (K=2)
- **LF:** 2 + 3·0.5 = 3.5 s (K=4)
- **MF:** 0.5 + 15·0.125 = 2.375 s (K=16)

Each segment is Hann-tapered, so in power it weights time as Hann². The summed Σₘ Hann² weight peaks mid-span and tapers at both ends. That taper is why the 10–90 % rise is shorter than the span (about 0.37 of the span for ELF, about 0.67 for MF, where many segments overlap and the weight is flatter).

## What the integration is (and is not)

This is **time-averaging of modelled power spectra** with Welch-style Hann² weights (Welch 1967; Harris 1978). It is **not** a waveform FFT. No time series is synthesised.

Every 0.25 s the engine records one **source-state** frame, shared by all streams (`src/stateHistory.ts`). Per contact it records activity, position and velocity, source level, flow and cavitation, tonal frequencies and powers, and swath gains and edges. Per buoy it records kinematics. A row re-evaluates the modelled spectrum (ambient + contacts, plus DIFAR components) at each recorded frame in its span and averages them. Noise (χ²_ν / AR(1)) is then drawn on the averaged spectrum exactly as before.

That makes it an **approximation** of the STFT temporal response: right for onset/fade timing and sharpness, but it does not model phase effects within a window. Frequencies, bins and statistics are unchanged, and the output is deterministic.

FULLBAND tiles use the same averaging, with each tile's RES T and K. Any tile can be rendered from the shared state, so there is **no tile cap, no eviction and no warm-up**. Panning does not change timing or sharpness, and a tile you pan back to is filled immediately and bit-identical to one that was never left. FULLBAND defaults to **RES5** (span 3.5 s, the same as LF). ELF is RES2 / 16 s, VLF RES4 / 5 s, MF RES7 / 2.375 s.

## Startup, seek, history

- **Startup:** history starts when the first RES stream opens, at t0. For t < t0 the history is **back-extrapolated, not frozen**. This is a documented assumption (`stateHistory.ts`):
  - **Kinematics:** contact and buoy speed, heading and depth run back at their t0 rates, taken from the first two real frames t0 and t0 + 0.25 s. Position is stepped back by reverse Euler along the extrapolated track.
  - **Steady sources carried back:** tonal lines at their t0 frequency and power, flow and cavitation broadband, and source level re-evaluated at the extrapolated speed and depth. Ambient is always present.
  - **Events zeroed:** HYDP, INTERMITTENT, TRANSIENT and SWATH lines and every swath contribute **zero** before t0, because their pre-t0 state is unknown. A burst already on at t0 therefore shows no energy before its true onset.
  - **Rows before t0 + 0.25 s:** these fall back (rare; never on cut/live paths).
  - Streams opened after t0 see the real recorded past, up to 40 s.
  - Tests are in `test/startupPrefill.test.ts`. Rows whose span starts after the history start are bit-identical to d1acdc0.
- **Seek/replay:** seek replays from t=0 on the 0.25 s grid. Rows match continuous play bit-for-bit for frame-aligned seek targets. For an off-grid target (e.g. 17.6 s) the split kinematic step rounds differently in floating point; the worst measured difference is 1.2e-5 dB (one float32 ulp). The same split happens in continuous play with off-grid tick sizes.
- **Replay:** play → seek back → replay gives rows bit-identical to the first pass and to a fresh run seeked to the same time (`test/replayConsistency.test.ts`). Every buoy collects its full state history regardless of which FULLBAND pane is visible; rows are identical whatever the pan sequence.
- **Paused scroll-back:** rows that have already been emitted are FE-owned copies, and later engine history never touches them.
- **Bounded:** one engine-wide ring of `HISTORY_FRAMES` = ceil((32 s longest span + 8 s late margin)/0.25) + 2 = 162 frames. Its size depends on the number of contacts and lines, not on the number of streams or tiles. Render scratch is shared by all generators. Each stream retains only its band tables, its output and bearing row, and AR(1) state (FULLBAND RES1–3 only, per tile).
- **Fallback:** calling `generate()`/`renderTile()` directly with no history renders an instantaneous snapshot, sets `lastIntegrated=false` and increments `snapshotFallbacks`. Tests assert that every cut stream and every worker live/FULLBAND stream has 0 fallbacks.

## Memory (acoustics side only; FE row history is separate)

`engine.retainedBytes()` reports `{history, scratch, streams, total, perStream}`. Measured at 32 buoys (the supported field size, docs/data-contract.md) × (8 band streams + 1 FULLBAND panned every 3 s): over 900 s the total was flat at every 30 s sample, with 0 fallbacks and 0 unfilled tiles:

- **FULLBAND RES2 (8 tiles, panned):** 44.4 MB total = state history 3.56 MB + shared scratch 0.49 MB + streams 40.4 MB. Per stream that is 60 KB for a band stream and 752 KB for a FULLBAND stream (mostly per-tile AR(1) state).
- **FULLBAND RES5 (default):** 27.6 MB total.

The trade-off is compute: rows re-evaluate the spectrum for every frame in their span. With all 8 RES2 tiles backfilled at 32 buoys, 900 s of sim took 556 s in Node. `test/fullbandTileCap.test.ts` asserts that the total is flat and under 50 MB.

**FE budgeting (bytes per emitted row, data + bearing, Float32):**

| Stream | Bins | Bytes/row | Row period | Rows per 15 min | MB per 15 min |
|---|---|---|---|---|---|
| ELF NB/BB | 1024 | 8 192 | 4 s | 225 | 1.84 |
| VLF / LF / MF NB/BB | 1024 | 8 192 | 2 s | 450 | 3.69 |
| FULLBAND tile (RES5) | 4096 | 32 768 + 13 meta | 2 s per tile-row | 450 × tiles | 14.7 per tile |

## Measured edges (test/bandEdges.test.ts)

Setup (vernier band streams; FULLBAND at equal RES, static and panned, gives identical times to < 1e-6 s): one stationary contact, seed 777, swath 20–45 Hz and SRC 40 Hz with sharp on/off steps, edge phase swept over 16 frames. Times are seconds after the true edge. Swath and SRC give identical numbers, and fall mirrors rise.

| Band | Span | 10 % | 50 % | 90 % | 10–90 |
|---|---|---|---|---|---|
| ELF | 16 s | 5.03 | 8.00 | 10.97 | 5.94 |
| VLF | 5 s | 1.50 | 2.50 | 3.50 | 2.00 |
| LF | 3.5 s | 0.90 | 1.75 | 2.60 | 1.70 |
| MF | 2.375 s | 0.39 | 1.19 | 1.99 | 1.60 |

In every band, 50 % falls at span/2. There is no response before the edge and the step is complete within the span. Beyond the window, every band has the same edge timing.

Why low bands "lag": a row is stamped at the end of its averaged span (window plus overlapped segments), so a step at t reaches 50% at t + span/2 and full level at t + span. Spans are ELF 16 s, VLF 5 s, LF 3.5 s, MF 2.375 s (measured edges in the table below). That is the Δf·T≈1 time–frequency tradeoff (Urick, *Principles of Underwater Sound*, ch. 12; Lyons, *Understanding DSP*, zoom FFT; Harris 1978 for Hann/overlap). Narrow bins also gain SNR on tonals (+3 dB per halving of Δf), so a weak VLF line can appear *sooner* than in LF. Leading or lagging is a tendency, not a rule.

FE: draw each row at its `simT`, with no shift. Use `rowRateHz`/`fBin` from `gramConfig` (they now differ per band). Don't add display delays. `resForBand(id)` is exported for live subscribes so they match cuts.

## Fast row path (default) vs reference path

`setResRowPath('fast'|'reference')` (resGram.ts). The reference path is the original exact per-row re-evaluation; it is kept for tests. The fast path keeps the same model, frames and Hann² weights. Only the floating-point evaluation changes, so rows are **not** bit-identical to d1acdc0/2b56520 (allowed by the Lead/FE decision).

- **Sliding Welch accumulators:** vernier bands, and FULLBAND streams with ≤ 2 tiles (RES5 default = 1 tile). Each 0.25 s frame's modelled spectrum is evaluated **once per (buoy, band/tile)**, not once per row. It is added with its Hann² weight to every open row whose span contains it. Open rows = ceil(span / row period) + 1 (ELF 5, VLF 4, LF 3, MF 3). A row therefore costs O(bins × contacts) per new frame instead of O(bins × contacts × frames in span). The 0.25 s state frame is the model's time resolution, so one evaluation per frame is the minimum. NB and BB of the same band share one accumulator. Sums are Float32 (P, E, N; DIFAR S = P − ambient). Accumulators are allocated at subscribe/configure (the row path allocates nothing), counted in `retainedBytes().scratch` and released on unsubscribe.
- **FULLBAND with > 2 tiles (RES1–4):** to stay inside 50 MB, each tile-row is a direct sum over the frames in its span using the fast spectrum kernel. Accumulators for all 8 RES2 tiles at 32 buoys would need ≈ 63 MB. This is a static rule (by tile count), so it does not depend on what is visible.
- **Fast spectrum kernel:** the per-bin `exp` for absorption and Lloyd's-mirror coherence is replaced by a recurrence over 32-bin chunks. The exponent is the quadratic through each chunk's first, middle and last bins. That is exact for the f² coherence exponent; for the smooth Thorp absorption exponent the residual is its third difference. Band tables (ambient, shape, exponents, BB half-widths) depend on band and environment but not on the buoy, so they are shared (LRU, ≤ 64 entries, counted).
- **Determinism:** each row is the same frames, added in ascending frame order from the same per-frame spectra, whether the row was reached by continuous play, seek, replay or a reset. Runs, seek and replay are identical (`test/replayConsistency.test.ts`, `test/startupPrefill.test.ts`, the pane/pan tests).
- **Error vs reference** (`test/fastPath.test.ts`, noise-free expected spectrum of every emitted row, seaState 3 so coherence is exercised, DIFAR). The bound asserted is ≤ 0.01 dB max and ≤ 0.001 dB mean.

| Case | ELF max / mean dB | VLF | LF | MF | FULLBAND |
|---|---|---|---|---|---|
| 3 contacts, FULLBAND RES5 (accumulators) | 2.5e-6 / 4.5e-7 | 1.4e-6 / 2.6e-7 | 1.1e-6 / 2.2e-7 | 2.3e-6 / 3.5e-7 | 1.2e-6 / 2.2e-7 |
| 3 contacts, FULLBAND RES2 (direct) | same | same | same | same | 6.0e-11 / 7.9e-12 |
| 60 contacts, FULLBAND RES5 | 2.5e-6 / 4.6e-7 | 1.2e-6 / 2.6e-7 | 1.2e-6 / 2.5e-7 | 1.9e-5 / 3.2e-6 | 1.2e-6 / 2.3e-7 |

  Why 0.01 dB holds with margin:
  - **Float32 sums:** at most 64 positive Hann²-weighted adds per row, so the relative error is ≲ 64 · 2⁻²⁴ ≈ 4e-6 (≈ 2e-5 dB).
  - **Chunk recurrence:** exact for coherence; the absorption residual is < 1e-6 dB at 20 km. Recurrence rounding is ≤ 32 ulp.
  - **Measured worst:** 1.9e-5 dB.

  Seed-777 edge 10/50/90 % rise and fall times differ from the reference by ≤ 1.7e-6 s in every band; the test asserts at most one hop.

## CPU and memory (e835cfe, Node, single thread, 32 buoys × 8 band streams + 1 panned FULLBAND each; no DEMON, partial load)

| Run | Wall / 900 s | % real time | ms/tick mean / p95 / max | RSS start / mid / end (MB) | Heap start / mid / end (MB) | Acoustics retained |
|---|---|---|---|---|---|---|
| RES5, 1 contact | 79.7 s | 8.9 % | 22.1 / 27.3 / 59.8 | 127 / 152 / 154 | 20.9 / 22.5 / 30.7 | 27.7 MB |
| RES2, 1 contact | 404.9 s | 45 % | 112.5 / 120.5 / 6583* | 142 / 169 / 205 | 22.5 / 30.5 / 52.5 | 44.5 MB |
| RES5, 60 contacts (30 s run) | — | 201 % | 502 / 523 / 573 | 179 / 273 / 273 | 58 / 102 / 100 | 28.6 MB |
| RES2, 60 contacts (30 s run, contended) | — | 1531 % | 3827 / 3926 / 4165 | 195 / 292 / 292 | 59 / 95 / 96 | 45.4 MB |

\* A single stall while the test suite ran on the same machine; p95 is representative.

Targets: RES5 ≤ 10 % is met at 1 contact. RES2 ≤ 25 % is **not met** (45 %), and 60 contacts is far over at both RES. Each row re-evaluates the modelled spectrum for every snapshot in its span. That costs O(bins × active contacts × frames in span), and RES2 FULLBAND (8 tiles × 4096 bins × 64 frames per row) dominates. Exact per-snapshot caches or incremental Welch sums would need well over 50 MB at 32 buoys (≈ 6 MB per RES2 tile) or a changed summation order (not bit-identical). Only the bounded NB/BB row reuse (64 KB) is implemented.

## Fast-path validation and CPU/memory follow-up (2026-11-07, ET)

475 tests passed (62 files), and `npm run typecheck` passed. The expected-spectrum error table above was reproduced (spectrum seed 4242; edge seed 777). Maximum error was 1.8825e-5 dB, mean 3.2117e-6 dB (60-contact MF); both are below the 0.01/0.001 dB limits. Replay, seek, startup and off-screen collection checks remain enabled.

### Signed edge timing differences

Fast minus reference, **microseconds**, interpolated 10/50/90% crossings. No band offsets.

| Event | Band | Rise 10 / 50 / 90 | Fall 10 / 50 / 90 |
|---|---|---|---|
| swath | ELF | -0.753 / -0.193 / +0.479 | -1.392 / +0.064 / -0.297 |
| swath | VLF | -0.049 / -0.164 / +0.167 | +0.661 / +0.310 / +0.167 |
| swath | LF | -0.548 / -0.470 / -0.671 | +0.093 / -0.253 / +0.865 |
| swath | MF | -0.580 / -0.754 / -0.566 | -0.580 / -1.226 / -0.207 |
| src | ELF | +0.071 / -0.278 / -0.140 | +1.683 / -0.518 / -0.143 |
| src | VLF | +0.025 / +0.075 / +0.084 | -0.666 / +0.000 / +0.049 |
| src | LF | +0.020 / +0.000 / -0.066 | +0.050 / -0.020 / +0.026 |
| src | MF | -0.007 / +0.017 / -0.071 | -0.052 / +0.038 / +0.023 |

Worst absolute timing difference: 1.6834 microseconds (SRC ELF), far below one hop.

### Sequential benchmark matrix (8 band streams + FULLBAND NB, no DEMON)

Existing standalone pan harness (`/workspace/fastpath-logs/measure.ts`, copied from the prior measurement harness), fast path default, single process, seed 303. Each of 32 buoys has 8 NB/BB band streams plus its own FULLBAND stream; all tiles collect, including off-screen. FULLBAND pans every 3 s when multiple tiles exist. Every due row is drained. Thus this is **32 FULLBAND streams**, not a one-visible-pane computation shortcut. RES5 has one tile; RES2 has eight. No warm-up excluded. Each matrix case ran in a separate process, sequentially, after tests completed; no competing acoustics benchmark/test job ran.

**Host caveat:** the shared box was not literally idle: existing trading services and infrastructure remained running. They were not stopped or modified. These are shared-host observations, not an exclusive-machine certification. Process snapshot and all raw logs are in `/workspace/fastpath-logs/`.

All memory columns below are **MiB (2^20 bytes)**, not decimal MB. RSS/heap include the runtime; acoustic memory includes retained history, streams/render cache and scratch/accumulators/shared tables, but excludes FE display history and GPU buffers. Start/mid/end are samples, not a peak bound.

| Contacts | RES | Sim s | Wall s | % real time | Tick mean / p95 / max ms | RSS start / mid / end | Heap start / mid / end | Acoustic start / mid / end |
|---|---|---|---|---|---|---|---|---|
| 1 | 5 | 900 | 36.4 | 4 | 10.1 / 10.91 / 76.62 | 147.5 / 174.3 / 207.4 | 33.4 / 32.5 / 52.9 | 17.81 / 17.81 / 17.81 |
| 1 | 2 | 900 | 163.7 | 18.2 | 45.48 / 48.98 / 131.52 | 135.2 / 191.9 / 194.4 | 27.4 / 40 / 35.1 | 22.41 / 23.62 / 23.62 |
| 60 | 5 | 120 | 38.6 | 32.1 | 80.32 / 88 / 258.09 | 179 / 276.6 / 276.8 | 58.5 / 63.5 / 77.4 | 18.69 / 18.69 / 18.69 |
| 60 | 2 | 120 | 534.7 | 445.5 | 1113.85 / 1183.02 / 1439.7 | 188.2 / 287.5 / 287.9 | 52 / 71.4 / 61.7 | 23.29 / 24.49 / 24.49 |
| 60 | 5 | 900 | 287.5 | 31.9 | 79.85 / 86.29 / 269.77 | 190.1 / 301.3 / 302.3 | 54.7 / 99.3 / 108.1 | 18.69 / 18.69 / 18.69 |

**Targets:** 1-contact RES5 passes ≤10% (4.0%), and RES2 passes ≤25% (18.2%). 60 contacts still fail CPU at both resolutions: RES5 31.9% over 900 s and RES2 445.5% over 120 s. RES2 900 s was not run: the measured rate predicts about 4010 s (67 min), above the ~15-minute limit. RES5 900 s was feasible and completed in 287.5 s.

Accounted acoustic memory passes 50 MB even in decimal units: maximum sampled total 25,681,376 bytes (24.49 MiB, 60-contact RES2), flat from midpoint to end. This is **not** a total-process 50 MB pass: RSS/heap exceed that limit. FE's 15-minute display history and GPU allocation still need a combined budget/frame-cost review; these results do not clear the release hold. Retained history is not evicted, no visibility-dependent collection was introduced, and no workers/SIMD were added. Everything remains local, unpushed and held.

## Spectrum-kernel profile on 673183a (2026-11-07, ET; duplicated bands, no DEMON; proposals only)

**Harness correction:** the previous standalone harness actually had 4 bands × NB/BB = **8**, not 16 band subscriptions per buoy. The prior benchmark headings overstated that count; their numbers remain measurements of 8. For this profile, `profile-measure.ts` explicitly subscribes **16** (two identical subscriptions per band/filter) plus **one FULLBAND per buoy**, across 32 buoys. These are 16 actual streams but 8 unique band/filter configurations, sharing deterministic acoustic sums as designed. All tiles collect, with panning every 3 s; no one-visible-pane shortcut.

Six sequential detached `node --cpu-prof --import tsx ... 60 RES 60` runs: three at each RES, 60 simulated seconds each, 0.25 s ticks, seed 303, no excluded warm-up. Existing benchmark scenario has 60 fictional contacts with **one discrete motor line each**, not a rich harmonic catalog. No workers or optimization implemented. Raw profiles/logs and reproducible harnesses: `/workspace/fastpath-logs/profile-*`. The initial 8-stream profile attempt was stopped, archived under `initial-8-stream/`, and excluded.

All entries are **median [min–max] across three runs**, not confidence intervals. Shared-host contention can move results in either direction; narrow repeat spread does not certify uncontended performance. Profiling itself also adds overhead.

| Profile-enabled timing | RES5 | RES2 |
|---|---|---|
| Wall s | 21.20 [21.00–21.30] | 265.50 [263.70–265.80] |
| % real time | 35.30 [35.00–35.50] | 442.60 [439.50–443.10] |
| Tick mean ms | 88.15 [87.37–88.81] | 1106.44 [1098.75–1107.62] |
| Tick p95 ms | 113.92 [110.00–114.27] | 1157.08 [1155.59–1166.32] |
| Tick max ms | 251.67 [249.73–265.74] | 1300.75 [1283.32–1302.63] |

### Sampled top self-time functions

Percent of all sampled process time, weighted by profiler time deltas (including startup/runtime). Inlining can attribute callees to `coreFast`; these are not isolated function microbenchmarks. `gaussian` below is PRNG noise, **not** the diffuse-line deposit kernel.

| Function | RES5 self % | RES2 self % |
|---|---|---|
| coreFast [resGram.ts] | 78.302 [77.979–78.512] | 95.429 [95.301–95.502] |
| render [resGram.ts] | 4.403 [4.198–4.511] | 0.628 [0.612–0.644] |
| gaussian [prng.ts] | 3.973 [3.964–4.107] | 0.837 [0.823–0.848] |
| gammaUnit [res.ts] | 2.256 [2.198–2.292] | 0.132 [0.125–0.135] |
| integrateAccum [resGram.ts] | 2.236 [2.215–2.245] | 0.121 [0.120–0.130] |
| integrateHistory [resGram.ts] | 0.000 [0.000–0.000] | 0.493 [0.491–0.516] |
| geometry [kinematics.ts] | 1.151 [1.122–1.229] | 0.732 [0.717–0.808] |
| loadFrame [resGram.ts] | 0.943 [0.879–1.037] | 0.441 [0.409–0.452] |
| exactGain [lloydsMirror.ts] | 0.611 [0.594–0.617] | 0.088 [0.080–0.089] |
| depositHannLine [lineKernel.ts] | 0.377 [0.334–0.407] | 0.053 [0.051–0.059] |

### Component diagnostic (separate, instrumented)

Three additional **12 s** runs per RES on a copy of the source in `diagnostic-src/`, with per-contact/chunk probes, method-exclusive timers and exact loop counters. Production source was untouched. Timers/counters substantially perturb this hot loop: these **ms/tick are diagnostic costs, not production performance**, and their percentages must not be substituted into an exact speed-up prediction. Each row below combines FULLBAND and band streams unless stated otherwise.

| Diagnostic ms / 0.25 s tick | RES5 | RES2 |
|---|---|---|
| Per-contact geometry / level / scalar TL setup | 3.83 [3.81–3.90] | 25.37 [24.68–25.59] |
| Per-line check, Doppler, TL, gain and Hann deposit | 2.98 [2.96–3.06] | 9.20 [8.88–9.24] |
| Per-bin broadband + fused absorption/coherence / Lloyd gain | 190.99 [190.33–192.07] | 2495.03 [2484.94–2536.52] |
| Ambient initialization | 0.31 [0.30–0.31] | 3.74 [3.72–3.82] |
| Propagation recurrence setup (subset of broadband row) | 50.68 [50.21–50.74] | 651.19 [650.41–662.59] |
| Fused bin arithmetic (subset of broadband row) | 83.25 [82.65–83.74] | 1085.50 [1084.21–1119.93] |
| Per-stream Welch accumulation, exclusive | 2.67 [2.63–2.76] | 8.67 [8.48–8.79] |
| Frame loading, exclusive | 1.35 [1.31–1.46] | 7.70 [7.47–7.78] |
| FULLBAND rendering, inclusive | 91.70 [90.91–91.72] | 2461.46 [2452.61–2501.76] |
| Band rendering, inclusive | 125.53 [125.43–126.28] | 128.36 [127.60–131.91] |

TL is **not an independent additive category**: scalar spreading/geometry is in per-contact setup, Thorp/coherence recurrence is a broadband subset, Lloyd phase/gain is fused into bin arithmetic, and tonal TL is inside the line row. This avoids double-counting or claiming a source-level split that the fused kernel does not expose. Empty-swath-loop and probe overhead are residuals. FULLBAND share of inclusive rendering: RES5 42.07 [42.02–42.22]% / RES2 95.03 [94.99–95.07]%.

### Exact work counters (per tick, averaged over 12 s including startup)

Counters matched across all three repeats; min = median = max. “Dense line×bin” is the hypothetical Cartesian work, **not work the kernel executes**. Actual line evaluation/deposition visits are four-tap discrete Hann work; no Gaussian line calls occurred.

| Work per tick | RES5 FULLBAND | RES5 bands | RES2 FULLBAND | RES2 bands |
|---|---|---|---|---|
| Spectrum kernel calls | 36.00 | 173.33 | 1,024.00 | 173.33 |
| Contact / line checks | 2,160.00 | 10,400.00 | 61,440.00 | 10,400.00 |
| Accepted line checks | 2,160.00 | 8,105.42 | 7,680.00 | 8,105.42 |
| Broadband contact×bins | 8,642,160.00 | 10,603,600.00 | 245,767,680.00 | 10,603,600.00 |
| Hypothetical dense line×bins | 8,642,160.00 | 10,603,600.00 | 245,767,680.00 | 10,603,600.00 |
| Actual line-bin evaluations / deposits | 8,640.00 | 32,393.42 | 30,720.00 | 32,393.42 |
| Deposits outside approx −3 dB width | 5,713.48 | 20,415.69 | 19,954.96 | 20,415.69 |

Outside the **implemented significant support** (Hann |offset| < 2 bins), actual line-bin evaluations are **zero**. Within that support, RES5 63.68 [63.68–63.68]% / RES2 63.97 [63.97–63.97]% of deposited bins lie outside the approximate −3 dB core (Hann half-width 0.72 bins). These are intentional main-lobe skirts, not avoidable dense-loop waste. The finite-support line path already rejects out-of-band lines; further tonal bandwidth clipping is not the useful first target here.

### One proposed optimization, not implemented

**First choice: increase the fast broadband propagation recurrence chunk from 32 to 128 bins, with a conservative absorption-curvature error guard falling back to 32.** This targets the dominant broadband kernel without changing frames, time weights, event timing, collection policy, retained history or threading. It cuts chunk setup / exponent evaluations toward one quarter; coherence's quadratic exponent remains exact, while the Thorp absorption quadratic approximation needs the guard. Preserve the existing first-bin special case and per-bin phase recurrence. Estimated overall gain **1.1–1.3×** (rough hypothesis, not a measured result; no claim it meets either 60-contact CPU target). Instrumented recurrence work is material, but timer overhead prevents a reliable Amdahl estimate from those numbers alone.

Accuracy risk: the absorption interpolation residual grows roughly with chunk width cubed, and cancellation near interference minima can amplify relative errors. Require the existing max ≤0.01 dB / mean ≤0.001 dB reference limits plus long-range, low-frequency, rough-sea, tile-boundary and near-null coverage, all event-edge / seek / replay / startup tests, and fresh 3× timings. Determinism risk is low if chunk choice/guard depends only on frequency grid, environment and the same recorded geometry—not visibility, cache pressure or wall time. Repeated rows must remain deterministic; old summation bit identity is not required.

**Runner-up:** a bounded per-(history frame, buoy, contact, environment epoch) memo of geometry and scalar spreading/propagation setup, shared across bands/tiles. No spectra retained and no history evicted. Estimated **1.01–1.03×** overall because setup is small versus broadband arithmetic. Low numerical risk (reuse identical inputs/results), but stale-key/invalidation and extra retained-memory accounting need explicit tests; benchmark and FE combined-budget review before acceptance. Do not combine it with the first experiment.

Only this note changes the repository. No optimization, workers, push or release approval; held pending the Lead and FE review.

## Stream-set reconciliation and provisional manifest v1

FE's objection is correct: the two earlier harnesses did **not** exercise the same set, and neither included DEMON. Their timing/profile figures above are historical partial/duplicated-band loads, **not full-load acceptance results**.

| Per-buoy subscription | `measure.ts` (earlier timings) | `profile-measure.ts` (0e95d52 profiles) | `bench/fullLoad.bench.ts`, provisional manifest v1 |
|---|---|---|---|
| ELF NB / BB, RES2, vernier 25 Hz | 1 each | 2 each | 1 each |
| VLF NB / BB, RES4, vernier 100 Hz | 1 each | 2 each | 1 each |
| LF NB / BB, RES5, vernier 250 Hz | 1 each | 2 each | 1 each |
| MF NB / BB, RES7, vernier 1000 Hz | 1 each | 2 each | 1 each |
| FULLBAND NB, run-selected RES5 or RES2, pan every 3 s | 1 | 1 | 1 |
| FULLBAND BB, same RES/panning | 0 | 0 | 1 |
| DEMON, carrier 500–2000 Hz | 0 | 0 | 1 |
| DEMON, carrier 2000–6000 Hz | 0 | 0 | 1 |
| Total actual gram subscriptions | 9 | 17 | **12** |

Both DEMON streams have 512 bins on the 0–100 Hz modulation axis, at 4 Hz row rate. The old harnesses did not explicitly drain bearing rows or poll tactical truth / water-column outputs. The new harness drains each LOFAR row and its paired DIFAR bearing, drains both DEMON streams without skipping ready rows, reads tactical/truth each 0.25 s tick and supplies/checks the shared water-column profile. DIFAR does not need another LOFAR subscription. All 32 buoys keep collecting every required band and FULLBAND tile regardless of visibility.

**Repo versus provisional manifest:** `acoustics/src/streamSet.ts:19–30` defines 12 **logical** ids: the 8 `lofar/{ELF,VLF,LF,MF}/{NB,BB}` entries, `demon`, `difarBearing`, `waterColumn`, and `truth`. `liveSimStreamSet()` and `cutStreamSet()` return the same set. `cuts/render.ts` explicitly treats the last three as tool outputs requiring no gram subscribe. That set does not specify two DEMON carriers or FULLBAND NB/BB. `docs/data-contract.md` defines gram units/shapes (default DEMON carrier 1000–4000 Hz); current FE `src/engine/host.ts` subscribes an active LOFAR view per buoy (plus a temporary handoff set), with DEMON optional. None of those establishes 16 unique band subscriptions. The Lead's **provisional manifest v1** is the explicit benchmark load: **8 band + 2 DEMON + 2 FULLBAND = 12 actual gram streams per buoy, 384 at 32 buoys**, plus the shared logical tool outputs. It does not modify the production logical contract.

**DEMON carrier weighting (Lead, 2026-11-07):** spectrum-based envelope model (not waveform-derived DEMON). Per contact the carrier weight is the **linear** band integral ∫ S(f)·G(r,f) df over the carrier band (500–2000 Hz and 2000–6000 Hz), with S(f) the same fictional broadband shape 1/(1+(f/400)²) used by NB/BB and G carrying spreading × Thorp absorption(f) × Lloyd's-mirror `exactGain` × CZ — matching the NB/BB path. TL is **not** averaged in dB; a centre-frequency TL shortcut is no longer used. Absolute scale cancels in the incoherent envelope mix. Carriers remain labelled an **approximation** until source weighting is validated against teaching cuts.

**Cost (60 s manifest v1, RES5, after band-integral + Lloyd recurrence, 48–96 midpoint samples):** 1 contact 9.8 %RT / 24.4 ms tick (was 9.1 % / 22.8 ms centre-TL); 60 contacts 50.8 %RT / 127 ms tick (was 44.4 % / 111 ms). ≈ +7 % / +15 % wall — acceptable for the correct linear ∫S·G.

The single-DEMON/single-FULLBAND runs started before the Lead's steering were stopped and archived in `/workspace/fastpath-logs/superseded-single-demon-single-full/`; they are excluded from provisional-manifest results. The authoritative replacement harness is tracked under `acoustics/bench/fullLoad.bench.ts`. Old `measure.ts` and `profile-measure.ts` logs are preserved unchanged for audit.

## Coarse smooth-broadband prototype (APPROXIMATION; flag default OFF; not shipping)

Lead-approved for evaluation only. `setCoarseBroadband(true)` (resGram.ts) swaps the fast kernel's
per-contact broadband loop for `coreCoarse`; with the flag off the reference path and the existing
fast path are unchanged (test: flag-off rows bit-identical to a fresh fast run).

**What is approximated.** Only the smooth per-contact broadband envelope: source shape
1/(1+(f/400)²)·ENBW × Thorp absorption, flow noise, and the slowly varying Lloyd's-mirror
reflection amplitude c=q·exp(−2k²σ²sin²θ). These are evaluated at coarse nodes and interpolated
linearly in power to the output bins.

**What stays exact on the output-bin grid.** The Lloyd's-mirror phase factor cos(kΔ) (recurrence
at every bin), tonals (Hann/Gaussian deposits with exact `exactGain`), swaths (per-bin absorption),
ambient (already a per-bin table), and per-contact scalars (spreading, CZ gain, cavitation power,
level). The interference is split *exactly* as gain = (1−c)² + 2c(1−cos kΔ): the smooth part
b(1−c)²+flow, times the envelope, is summed over contacts on the nodes and interpolated once per
bin; the oscillatory part's amplitude 2bc·env is interpolated per contact and multiplied by the
fine-grid (1−cos kΔ). The combined spectrum is never treated as smooth, so null frequencies come
from the exact phase, and null depth = the interpolated (1−c)² floor (both terms are ≥0).

**Grid choice.** Nodes every 1/48 octave (relative step 2^(1/48)−1 ≈ 1.45 %), clamped to 1–32
output bins (32 matches the existing chunked-exp span). The envelope terms vary on octave scales;
the linear-interpolation bound h²|g''|/(8g) for the steepest term (shape ∝ f⁻² above 400 Hz,
g''/g = 6/f²) gives ≈1.6·10⁻⁴ relative ≈ 7·10⁻⁴ dB. Power-linear (not dB) interpolation keeps
the per-bin work to adds, preserves positivity and sums across contacts exactly; dB interpolation
would need an exp per bin, which is the cost being removed.

**Measured vs the reference path** (test/coarseBroadband.test.ts, a0f1d7c; noise-free expected
spectrum, max / mean |ΔdB|):

| Case | ELF | VLF | LF | MF | FULLBAND |
|---|---|---|---|---|---|
| 3 contacts, FULLBAND RES5 | 5.7e-6 / 1.0e-6 | 1.4e-5 / 4.2e-6 | 1.8e-4 / 2.8e-5 | 5.9e-4 / 1.7e-4 | 4.7e-4 / 1.4e-4 |
| 3 contacts, FULLBAND RES2 | same bands | | | | 1.5e-5 / 4.4e-6 |
| 60 contacts, FULLBAND RES5 | 6.4e-6 / 1.3e-6 | 1.5e-5 / 4.6e-6 | 2.3e-4 / 3.9e-5 | 8.6e-4 / 2.9e-4 | 6.7e-4 / 2.3e-4 |

- Lloyd's mirror, 16 cases (range 300/1000/3000/8000 m × zs 30/120 m × zr 20/90 m), FULLBAND RES5 +
  all bands: 9,011 fringe nulls (≥1 dB contrast); null bins identical, fringe spacing identical
  (0 bins), worst null-to-peak contrast |Δ| 0.0010 dB. Linear interpolation can add sub-0.01 dB
  wiggles on very flat fringe crests (worst spurious minimum 0.0016 dB deep); these are excluded
  by the 1 dB contrast rule and are far below the display quantum.
- CPA pass (CPA 1200 m, zs 60, zr 90, 10 m/s; LF/MF, 120 rows): every row's null bins identical,
  apex (turning-point) row identical; lloydCpaApex.test.ts (015366a) passes.
- Cavitation knee, depths 20/80/200 m × speeds 1–15 m/s: knee speed identical (5 m/s each), worst
  level |Δ| 3.8e-4 dB, spectral −3 dB knee bin identical (0 bins).
- Seed-777 10/50/90 % edge times: worst |Δ| 1.7 µs (swath and src), limit one hop.
- Flag on: deterministic; play→seek→replay and fresh-seek rows bit-identical.

Tolerances: max ≤0.02 dB / mean ≤0.002 dB (2× the fast-path budget, still ≪ the ~0.1 dB display
quantum); null bins and spacing exact; contrast ≤0.1 dB; knee speed exact, level ≤0.02 dB,
spectral knee ≤1 bin; edges ≤1 hop.


**Result: closed as an unsuccessful performance experiment (Lead, 2026-11-07).**

Sequential 60 s short screen on provisional manifest v1 (`5b83b3c`), 3 uncontended
reps per cell (including the contended RES2 c60 baseline, re-run clean). Raw rows:
`bench/results/coarse-broadband-seq-2026-11-07.jsonl`.

| Case | flag OFF median %RT [min–max] / tick ms | flag ON median %RT [min–max] / tick ms | wall speedup (off÷on) |
|---|---|---|---|
| RES5 × 1 contact | 9.1% [9.1–9.2] / 22.8 ms | 9.8% [9.5–9.8] / 24.4 ms | 0.94× (slower) |
| RES2 × 1 contact | 38.1% [37.8–38.5] / 95.3 ms | 43.0% [42.6–43.9] / 107.5 ms | 0.89× (slower) |
| RES5 × 60 contacts | 44.4% [44.4–45.0] / 110.9 ms | 48.9% [48.8–49.8] / 122.2 ms | 0.91× (slower) |
| RES2 × 60 contacts | 894.8% [862.6–920.4] / 2236.9 ms | 675.5% [640.4–781.0] / 1688.7 ms | **1.32×** |

Accuracy of the approximation was excellent (≤8.6e-4 dB; LM nulls, fringe spacing and
cavitation knees identical — see table above), but keeping the Lloyd's-mirror phase on the
fine output-bin grid retains a per-contact × per-bin loop; interpolation overhead outweighs
the saved `exp` work except at RES2 × 60 contacts (~1.3×). That single win does not clear
the RES2 full-load budget and regresses the other three cells.

The flag stays **default OFF**. Code (`coreCoarse`, `setCoarseBroadband`) is preserved for
the record and must not ship. No further coarse-grid tuning; next kernel proposal is shared
per-contact work across streams/buoys (buoy-independent vs buoy-dependent geometry), with
no new approximation and no workers yet.

**Sources & Methods wording (for FE):** "Prototype option: smooth broadband source and
transmission-loss envelopes are computed on a 1/48-octave grid and linearly interpolated; Lloyd's-
mirror interference, tonals and all rapidly varying terms are computed at every display bin.
Measured difference from the exact model ≤0.001 dB. Off by default."

## Shared per-contact calculations across streams and buoys (analysis only; Lead 2026-11-07)

No code change, no new approximation, no workers. Measured from the existing spectrum-kernel
profile / component timers on tip `0e95d52` / `673183a` (60 contacts, provisional-style load;
ratios below are the shareable fraction of that profile, scaled to the manifest-v1 short-screen
tick costs on `e2eaf1a` flag-off: RES5 ≈ 111 ms/tick, RES2 ≈ 2237 ms/tick).

### Buoy-independent (source-side) — already mostly shared

| Term | Where today | Share scope |
|---|---|---|
| Source spectrum shape `1/(1+(f/400)²)` | Per-stream band table | Table already per-stream; shape is frequency-only |
| Tonal / line levels (`fillTonals`, `sourceLevel`) | `loadFrame` → `stateHistory` | **Engine-wide** once per 0.25 s frame |
| Cavitation power, flow scalars | history slot | Engine-wide |
| Events / swaths / HYDP gains | history slot | Engine-wide |
| DEMON source envelope tables | `WeakMap<Signature,Envelope>` | Shared across all buoy DEMON streams |

Further source-side sharing has essentially **no remaining headroom** (~0 % of tick): the
history ring already computes these once per contact per frame for every buoy/stream.

### Buoy-dependent geometry — recomputed per stream today

| Term | Profile self-time (RES5 / RES2, 60c) | Notes |
|---|---|---|
| `geometry` (range, bearing, radials) | ~1.1 % / ~0.7 % | Identical for all streams on the **same** buoy+frame |
| `spreadingLoss` | ~0.06 % / ~0.06 % | Function of range only |
| `pathDifference` / Lloyd Δ | ~0.1 % / ~0.09 % | Buoy depth + contact depth + horizontal |
| `exactGain` (outside the hot bin loop) | ~0.6 % / ~0.09 % | Mostly inlined inside `coreFast` bin loop (dominant) |
| Doppler | ~n/a / ~0.09 % | Line path only |
| CZ estimate | in setup | Water-column × depths × range |

Component timers put explicit **setup** (per-contact scalars before the bin loop) at
~1.9 % of BANDS+FULLBAND work at RES5 and ~1.0 % at RES2. Broadband + Lloyd phase inside
`coreFast` is 95–99 % of that work and is **inherently** buoy-dependent × per-bin.

### Estimated savings if buoy-dependent scalars are computed once per buoy per frame and reused across that buoy's ~12 gram streams

| Case | Shareable setup fraction | After (11/12) reuse | Estimated tick save | Residual bottleneck |
|---|---|---|---|---|
| RES5 × 60, manifest v1 | ~2 % of kernel | ~1.8 % of tick | **~2 ms / ~111 ms ≈ 1.5–3 %** | `coreFast` bin loop |
| RES2 × 60, manifest v1 | ~1 % of kernel | ~0.9 % of tick | **~20 ms / ~2237 ms ≈ 0.5–1.5 %** | `coreFast` bin loop (FULLBAND) |

Cross-**buoy** sharing of geometry is not possible (each buoy has its own range/bearing/Δ).
Cross-stream sharing on one buoy is real but small. It does **not** replace a kernel change
for the RES2 full-load gap; it is the right next step only as a low-risk exact refactor
before any new approximation or workers.

## Exact per-grid spectrum reuse (Lead 2026-11-07; before WASM SIMD)

Measured under provisional manifest v1 (12 streams/buoy: 8 band + 2 DEMON + 2 FULLBAND) on tip
before this change. Instrumentation counted every `coreFast` call and its contact×bin work on the
last tick of a 12 s run (4 buoys; ratios are buoy-independent).

### What e835cfe's 2-entry ROW_CACHE actually covers

`ROW_CACHE` (2 × RES_BINS) is used only on the **reference** path (`integrateCached`). The
default **fast** path does not consult it. Vernier NB/BB of the same band already share work via
sliding Welch accumulators keyed by `(history, buoy, RES, f0, liveBins, difar)` — one `coreFast`
per new frame, folded once; the second filter hits `done` and skips. FULLBAND with
`tileCount ≤ ACCUM_MAX_TILES` (RES5 = 1 tile) uses the same accumulator sharing for NB/BB.

FULLBAND with `tileCount > ACCUM_MAX_TILES` (RES2 = 8 tiles) takes `integrateHistory(fast)` and
**did not** share: NB and BB each recomputed the identical pre-filter spectrum for every
`(buoy, RES, f0, L, tEnd)`.

Bin-centre overlap (same `f0`+`Δf`, different `L`): LF RES5 (L=1024) vs FULLBAND RES5 tile0
(L=4001), and ELF RES2 (L=1024) vs FULLBAND RES2 tile0 (L=4096). Accumulators key on `L`, so
these were not shared. With band-first drain order the longer grid is computed second and cannot
reuse a shorter prefix without computing `max L` up front — left as residual.

### Duplication counts (contact×bin / tick, 4 buoys; ×8 ≈ 32-buoy load)

| Case | coreFast calls | contact×bin evals | unique exact (grid,ts) | unique centre (f0+Δf,ts) | dup exact | dup centre | multi-filter exact keys |
|---|---|---|---|---|---|---|---|
| RES5 × 1 / 60 | 48 | 72,784 / 4,367,040 | = evals | 64,592 / 3,875,520 | **1.00** | 1.127 | 0 |
| RES2 × 1 / 60 (before) | 1,064 | 4,136,904 / 248,214,240 | ~½ of evals | ~½ | **1.980** | 1.996 | 512 |
| RES2 × 1 / 60 (after) | 552 | 2,088,840 / 125,330,400 | = evals | ≈ evals | **1.00** | 1.008 | 0 |

RES5 was already exact-deduped for NB/BB. RES2 FULLBAND NB/BB was almost a full extra pass
(~1.98×). Residual centre-grid overlap after the fix is ~0.8 % at RES2 (ELF↔tile0) and
~12.7 % at RES5 (LF↔FULLBAND); not addressed here (would need max-L fold into a shared
accumulator / frame cache with band-first drain).

### Implementation

`SPAN_CACHE` in `resGram.ts`: 16 entries × TILE_BINS float64 × (P,E,N,S) ≈ 2.0 MB fixed, counted
in `sharedScratchBytes()`. On the fast `integrateHistory` path the finished span average is
stored under
`(history, buoy, RES, f0, L, tEnd, envEpoch, difar, coarse, history.last)`. A second stream with
bit-identical inputs (FULLBAND BB after NB for the same tile) copies the cached arrays —
**bit-identical** to recomputing. Cleared on environment change / coarse-flag toggle.
`spanCacheStats()` / `resetSpanCacheStats()` expose hits/misses for tests. Default **ON** (exact
reuse, not an approximation; no flag). Accumulators and the reference `ROW_CACHE` are unchanged.

Tests: `test/spanCache.test.ts` (NB/BB bit-identical expected spectra + hit counts; fresh-run
identity; vernier still on accumulators). Full suite must stay green; rows match the previous
fast path bit-for-bit.

**501/501 tests passed** on tip `8fc41b8` (was 498; +3 span-cache tests).

### Short-screen bench (60 s, provisional manifest v1, 3 sequential uncontended reps)

Compared to the post-DEMON / coarse-OFF baseline on the same harness (`5b83b3c`):

| Case | before median %RT / tick ms | after (span reuse) median %RT [min–max] / tick ms | wall speedup |
|---|---|---|---|
| RES5 × 1 contact | 9.8% / 24.4 ms | 9.2% [9.2–9.5] / 23.0 ms | ~1.06× (noise) |
| RES5 × 60 contacts | 50.8% / 127 ms | 49.3% [48.9–50.2] / 123.3 ms | ~1.03× (noise) |
| RES2 × 1 contact | 38.1% / 95.3 ms | 27.2% [27.1–27.3] / 68.0 ms | **1.40×** |
| RES2 × 60 contacts | 894.8% / 2237 ms | 457.4% [455.8–461.7] / 1143 ms | **1.96×** |

Raw: `bench/results/span-reuse-seq-2026-11-07.jsonl`. Acoustics retained at end ≈ 35.5 MB
(RES5×1) / 52.95 MB (RES2×60), including the fixed ~2.0 MB `SPAN_CACHE`. RES5 unchanged in
exact-grid work (already deduped); RES2 matches the measured ~1.98× duplication removal.
Residual centre-grid overlap and the `coreFast` bin loop remain the bottleneck; **WASM SIMD
prototype is next** (Lead), with this reuse kept.

## SPAN_CACHE toggle, memory budget, and invalidation (Lead/FE 2026-11-07)

### Bench toggle
`setSpanCache(true|false)` / `spanCacheEnabled()` — default **ON**. Disabling clears entries so
ON vs OFF short screens isolate the exact-reuse speedup on the same tip (identical DEMON
weighting). Test/bench only; production stays ON.

### Memory (manifest v1, RES2 × 60 contacts, 32 buoys)
Acoustic total = `retainedBytes().total` + DEMON renderers + legacy LOFAR generators, with
`SPAN_CACHE` and shared FFT twiddles counted.

| Item | Before (ba6fada) | After |
|---|---|---|
| SPAN_CACHE | 16×4×TILE_BINS f64 ≈ 2.10 MB | **8×3×TILE_BINS f64 ≈ 0.79 MB** (drop S; recompute) |
| DEMON FFT twiddles | per-stream copies ≈ +5 MB dup | **shared** `fftTables(size)` ≈ 0.08 MB once |
| Acoustic total (subscribe) | ≈ 51.7 MB | **≈ 45.2 MB** |
| After ~10 s history fill | ≈ 53.0 MB | **≈ 46.5 MB** |

Under the ≤50 MB acoustic target. Breakdown exposed on the full-load bench `mem[].breakdown`.

### Invalidation / boundedness
- Fixed capacity `SPAN_CACHE_ENTRIES=8` with ring eviction; bytes never grow with run length.
- Key includes `spanEpoch` plus history uid, buoy, RES, f0, L, tEnd, envEpoch, difar, coarse, `history.last`.
- `invalidateSpanCache()` bumps epoch and clears: engine construct, `setEnvironment`, `addBuoy`,
  RES reconfigure (`applyRes` after first history), RES unsubscribe, coarse-flag toggle.
- Compute cache is independent of FE retained display rows; eviction does not mutate emitted copies.
- Tests: `test/spanCacheSafety.test.ts`.

