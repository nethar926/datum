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

Why low bands "lag": a row is stamped at the end of its window, so a line that starts at t first reaches full level after about one integration T. ELF smears onsets and fades over ~16 s, VLF over ~4 s, LF over ~2 s, MF within one row. That is the Δf·T≈1 time–frequency tradeoff (Urick, *Principles of Underwater Sound*, ch. 12; Lyons, *Understanding DSP*, zoom FFT; Harris 1978 for Hann/overlap). Narrow bins also gain SNR on tonals (+3 dB per halving of Δf), so a weak VLF line can appear *sooner* than in LF. Leading or lagging is a tendency, not a rule.

FE: draw each row at its `simT`, with no shift. Use `rowRateHz`/`fBin` from `gramConfig` (they now differ per band). Don't add display delays. `resForBand(id)` is exported for live subscribes so they match cuts.
