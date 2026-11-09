# Cut lesson-line plausibility (2026-11-08)

Diesel/AIP starter cuts after the tonalRefDb / effective-depth / SNORK fix.
Public / invented teaching ranges only — not measured platform spectra.

## Kept loud (Lead: do not reduce if plausible)

### cut-orbelune-msr — MSR ~907 Hz ≈ 43.7 dB local contrast

- Class: fictional diesel-electric Orbelune, **124 motor slots**, BATT @ 5 kn / 80 m, CPA 900 m.
- Absolute narrowband path: `tonalRefDb ≈ 157` (gen3 + BATT offset) × MSR relative power 0.05 → SL ≈ 144 dB re 1 µPa @1 m in ~1 Hz.
- Spherical TL @ 900 m ≈ 59 dB; Wenz ambient @ 900 Hz (sea 0 / light) ≈ 45 dB → **theory SNR ≈ 40 dB**.
- Gram local contrast (shared window) **43.7 dB** matches an ambient-limited discrete tonal peak (median side-bins ≈ ambient).
- Teaching intent: MSR-dominant giveaway on a D/E boat. Loud is expected; not a derivation error.

### cut-emberbraid-ssma — SSMA h2 / nearby AUX ≈ 48.7 dB; MESH ≈ 52 dB

- Class: fictional geared diesel Emberbraid, **SNORK @ 14 kn / 14 m**, CPA 900 m.
- SNORK raises broadband `levelDb` by +18 and tonal offset by +6 → `tonalRefDb ≈ 186`. Public radiated-noise chapters (Urick / Ross) place snorting diesels tens of dB above battery — invented magnitudes, same direction.
- Theory SNR for MESH / SSMA teaching lines at 900 m is **~45–52 dB**; gram contrasts **48–55 dB** sit in that band.
- Compared with the procedural pool (`cut-visibility-sweep.json` poolSummary): easy/regular scenarios already count many “approx loud at 1 km” tonals (avg ≈ 25–33). Starter SNORK/MSR cuts at the high end of that invented teaching distribution are **plausible**, not bugs.
- Lead decision: keep; do not dial down for “too easy.”

## Raised to ~10 dB (geometry + plant property, not gain)

### cut-gloamspiral-aip — Stirling generator shaft 14 Hz ≈ 9.75 dB (was 6.4)

- Quiet gen4 Stirling AIP: generator at 28 Hz electrical / **840 rpm**; shaft rotation **14 Hz** (= rpm/60) and h2 @ 28 Hz.
- Tones are **stable+discrete** (fixed-speed plant), not DC AUX — previously they inherited Wilson ±1.5 Hz absolute AUX wander, which smeared the VLF peak on the 120-row mean window.
- CPA 300→200 m adds spherical TL headroom. Combined: lesson line **9.75 dB** on the shared window (≥9.5 target). 6 dB bar unchanged.
- Fuel-cell AIP classes do **not** emit shaft-rate tones (pumps / blower / inverter instead).
