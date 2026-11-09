# DEMON tune (m3-acoustics-demon-tune, 2026-11-09)

Goal: make propulsion lines (shaft, blade rate BR = shaft × blades, BR harmonics) stand out in
DEMON for Cuts and the live SIM without inventing lines. Public physics only; all classes fictional.

## What was wrong (BEFORE, d4156fb)

`DemonStream` had no envelope-noise floor: the only "noise" was a 1e-4 dither, so a modulated
contact sat ~90–100 dB above the row median and the Hann leakage skirts painted ~5 Hz-wide bars.
Every modulated contact saturated the FE 0–65 LUT, whether or not it was really cavitating, and
even if traffic masked it. The 24/3 split window wasn't the bottleneck. It changed
contrast only in the dense-traffic case (shaft 12 → 19 dB with a median window).

## Changes

1. **Envelope-noise continuum** (`demonStream.ts`). The square-law envelope of band-limited
   Gaussian noise has relative fluctuation PSD 2/B_eff, where B_eff = (∫S)²/∫S² is the statistical
   bandwidth of the carrier. A line with relative modulation a sits ≈ a²·B_eff/(4·Δf·ENBW) above it.
   This continuum is added per bin in the frequency domain as AR(1) noise across rows, matched to the
   Hann 95 % overlap, so the waterfall keeps a persistent texture with no row-to-row beating.
2. **Only cavitation noise is propeller-modulated**: `modulatedFraction = cav/(1e-4 + cav)`,
   which matches LOFAR's `.0001 + cavitationPower` broadband. Legacy hand-written params with no
   `cavitationPower` keep full modulation. This removes the jump at inception, where `modulation`
   went straight from 0 to 0.15 across the whole hull broadband.
3. **Class `reinforceBr1`** now applies to DEMON too (√1.6 amplitude, the same ×1.6 power as LOFAR).
4. **Shared carrier band** `DEMON_CARRIER_BAND = [1000, 4000]`. The engine default and
   `CutSession` both use it now. Before, Cuts used [1000, 2000] and live used [1000, 4000].
   B_eff goes from 877 to 1803 Hz, which adds +3.1 dB on every line.
5. **`DEMON_DISPLAY_DB` = 0–20 dB** is the recommended LUT; the FE should drop its 65 dB ceiling.
   `DEMON_NORM` (24/3, 0/30, clamp −5) stays the same. Mean 24/3, mean 64/6, median 24/48/96 and
   no whitening all landed within ±0.5 dB of each other once the floor became physical.

Ambient dilution of the carrier is **not** modelled. Under the current LOFAR broadband calibration,
catalog sub cavitation at 1–4 kHz sits about 29 dB below ambient at 2.5 km (17 kn, 15 m), so honest
ambient dilution would blank DEMON for every catalog sub. Fixing that needs the broadband to be
recalibrated first, which is a team decision.

## Before → after (30 s row-averaged display, contrast in dB above the ±25-bin median)

BEFORE uses the FE pipeline at d4156fb (whiten 24/3, clip 0–65). AFTER uses the shared settings.
"lit" is the share of 0–100 Hz bins above 6 dB, which measures the smear.

| case | shaft B→A | BR B→A | BR2 B→A | BR3 B→A | false B→A | lit B→A |
|---|---|---|---|---|---|---|
| cut-brindleflux-snork | 29.0 → 0.3 | 40.7 → 2.0 | 53.8 → 0.3 | 61.5 → 0.3 | 0 → 0 | 22% → 1% |
| cut-emberbraid-ssma | 51.5 → -0.0 | 63.0 → 0.3 | 64.2 → 0.9 | 65.0 → 0.0 | 0 → 0 | 26% → 0% |
| cut-gloamspiral-aip | 0.3 → 1.6 | 0.5 → -0.4 | 0.0 → 0.3 | 0.1 → 0.5 | 0 → 0 | 0% → 0% |
| cut-orbelune-msr | 0.2 → 1.6 | 0.1 → 1.2 | 0.3 → -0.2 | 0.2 → 0.8 | 0 → 0 | 0% → 0% |
| cut-mistacorn-batt | 0.3 → 0.3 | 0.2 → -0.0 | 0.0 → 0.2 | -0.0 → 0.7 | 0 → 0 | 0% → 0% |
| cut-cinderlilt-cav | 60.5 → 10.1 | 65.0 → 17.2 | 65.0 → 10.6 | 65.0 → 4.2 | 0 → 0 | 24% → 2% |
| cut-pebblewisp-demon | 0.1 → 1.0 | 0.1 → -0.9 | 0.3 → -0.1 | -0.1 → -0.1 | 0 → 0 | 0% → 0% |
| live-slow-batt | 0.1 → 0.2 | 0.3 → 1.6 | -0.2 → 0.9 | 0.2 → 0.2 | 0 → 0 | 0% → 0% |
| live-med-snork | 65.0 → -0.2 | 65.0 → 0.2 | 65.0 → 0.0 | 65.0 → 1.2 | 0 → 0 | 13% → 0% |
| live-fast-cav | 65.0 → 5.8 | 65.0 → 12.6 | 65.0 → 6.4 | n/a → n/a | 0 → 0 | 11% → 1% |
| live-gloam-surf | 65.0 → 5.7 | 65.0 → 13.7 | 65.0 → 7.4 | n/a → n/a | 0 → 0 | 12% → 1% |
| live-fast-traffic | 12.3 → 1.0 | 33.3 → 0.0 | 16.1 → -0.7 | n/a → n/a | 0 → 0 | 26% → 0% |

To reproduce, run `tsx bench/demonTune.bench.ts` for the variant sweep. Results go to
`bench/results/demon-tune.json` and `bench/results/demon-tune-before-after.json`. The gram PNGs come from
`tsx bench/demonGramPng.ts <case> <ceilDb> <out.png>`. The floors are locked in `test/demonTune.test.ts`.

**Cut consequence:** none of the five starter cuts (brindleflux, emberbraid, gloamspiral, orbelune,
mistacorn) has a cavitating target. Brindleflux and emberbraid are only 0–1 % past inception, so
after the change they show no target propulsion in DEMON. `cut-pebblewisp-demon` (the DEMON lesson)
was blank before and is still blank. `cut-cinderlilt-cav` (SURF 14 kn) is the cut where DEMON
teaches well.
