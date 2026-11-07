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

`engine.retainedBytes()` reports `{history, scratch, streams, total, perStream}`. Measured at 32 buoys (the supported field size, docs/data-contract.md) × (16 band streams + 1 FULLBAND panned every 3 s): over 900 s the total was flat at every 30 s sample, with 0 fallbacks and 0 unfilled tiles:

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

## CPU and memory (e835cfe, Node, single thread, 32 buoys × 16 band streams + 1 panned FULLBAND each)

| Run | Wall / 900 s | % real time | ms/tick mean / p95 / max | RSS start / mid / end (MB) | Heap start / mid / end (MB) | Acoustics retained |
|---|---|---|---|---|---|---|
| RES5, 1 contact | 79.7 s | 8.9 % | 22.1 / 27.3 / 59.8 | 127 / 152 / 154 | 20.9 / 22.5 / 30.7 | 27.7 MB |
| RES2, 1 contact | 404.9 s | 45 % | 112.5 / 120.5 / 6583* | 142 / 169 / 205 | 22.5 / 30.5 / 52.5 | 44.5 MB |
| RES5, 60 contacts (30 s run) | — | 201 % | 502 / 523 / 573 | 179 / 273 / 273 | 58 / 102 / 100 | 28.6 MB |
| RES2, 60 contacts (30 s run, contended) | — | 1531 % | 3827 / 3926 / 4165 | 195 / 292 / 292 | 59 / 95 / 96 | 45.4 MB |

\* A single stall while the test suite ran on the same machine; p95 is representative.

Targets: RES5 ≤ 10 % is met at 1 contact. RES2 ≤ 25 % is **not met** (45 %), and 60 contacts is far over at both RES. Each row re-evaluates the modelled spectrum for every snapshot in its span. That costs O(bins × active contacts × frames in span), and RES2 FULLBAND (8 tiles × 4096 bins × 64 frames per row) dominates. Exact per-snapshot caches or incremental Welch sums would need well over 50 MB at 32 buoys (≈ 6 MB per RES2 tile) or a changed summation order (not bit-identical). Only the bounded NB/BB row reuse (64 KB) is implemented.
