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

Every RES vernier row is stamped at the **end** of its analysis span, for every band. Row k is due at `start + (k+1)/rowRateHz` and integrates `(tEnd − span, tEnd]`. Span = T + (K−1)·T/4, where K is the number of Hann segments averaged per row at 75 % overlap.

## Integration (real, fixed in this commit)

Before this commit, each row was an instantaneous snapshot of the source state at render time. RES changed only the bin width, ENBW and noise EDOF, so the band window was a relabel in time. Now each vernier RES stream snapshots its noise-free expected spectrum (ambient + contacts, DIFAR components too) on every 0.25 s frame. Each row averages those snapshots with Welch power weighting Σₘ Hann²(segment m). Noise (χ²_ν / AR(1)) is drawn on the integrated spectrum exactly as before, so frequencies, bins and statistics are unchanged and the output is deterministic. FULLBAND tiles still render instantaneously, and standalone `generate()` with no snapshots is unchanged.

## Measured edges (test/bandEdges.test.ts)

Setup: one stationary contact, seed 777, swath 20–45 Hz and SRC 40 Hz with sharp on/off steps, edge phase swept over 16 frames. Times are seconds after the true edge. Swath and SRC give identical numbers, and fall mirrors rise.

| Band | Span | 10 % | 50 % | 90 % | 10–90 |
|---|---|---|---|---|---|
| ELF | 16 s | 5.03 | 8.00 | 10.97 | 5.94 |
| VLF | 5 s | 1.50 | 2.50 | 3.50 | 2.00 |
| LF | 3.5 s | 0.90 | 1.75 | 2.60 | 1.70 |
| MF | 2.375 s | 0.39 | 1.19 | 1.99 | 1.60 |

In every band, 50 % falls at span/2. There is no response before the edge and the step is complete within the span. Beyond the window, every band has the same edge timing.

Why low bands "lag": a row is stamped at the end of its averaged span (window plus overlapped segments), so a step at t reaches 50% at t + span/2 and full level at t + span. Spans are ELF 16 s, VLF 5 s, LF 3.5 s, MF 2.375 s (measured edges in the table below). That is the Δf·T≈1 time–frequency tradeoff (Urick, *Principles of Underwater Sound*, ch. 12; Lyons, *Understanding DSP*, zoom FFT; Harris 1978 for Hann/overlap). Narrow bins also gain SNR on tonals (+3 dB per halving of Δf), so a weak VLF line can appear *sooner* than in LF. Leading or lagging is a tendency, not a rule.

FE: draw each row at its `simT`, with no shift. Use `rowRateHz`/`fBin` from `gramConfig` (they now differ per band). Don't add display delays. `resForBand(id)` is exported for live subscribes so they match cuts.
