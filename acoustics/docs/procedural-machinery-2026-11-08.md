# Procedural machinery audit (fictional training policy)

## Why Regular/Difficult excluded running diesels

Their depth ranges were 20–100 m and 120–300 m, respectively. The operating-state chooser correctly selected BATT/AIP below snorkel depth, so 24 seeds per difficulty produced zero running diesels. This is encounter-selection bias, not missing engine-family code. Easy produced 13 running diesels among 24 subs.

## Held change

`opState.shallowDieselProb` is an explicit, serialized, optional training-mixture parameter. Omitted/zero retains the existing patrol-depth draw, subject to class limits. Regular uses 0.35, Difficult 0.20; these are invented training probabilities, NOT operational statistics. On an eligible diesel draw, a separate random stream selects a shallow encounter, including a 25% surface branch when its coupled speed window allows it. The existing mode chooser remains authoritative: not all shallow diesels run engines. Quiet/cavitation policies and class speed limits remain; nuclear selection and surface-traffic randomness are not changed. No source powers, spectral widths or normalization settings change.

Integration caveat: the opt-in shallow branch intentionally sits outside the deep patrol-depth range. A setup editor must expose/preserve this field, or set it to zero when the operator requests strictly deep-only scenarios. Do not silently override a user depth restriction.

Same 24 seeds after change: Easy 13/24, Regular 8/35, Difficult 7/45 running diesels. Other contacts retain engine-off diesel or nuclear states. VLF engine-driven auxiliary content exists on 10, 7 and 7 contacts respectively.

## Both processing paths, not a claim of readability clearance

Run `npx tsx bench/proceduralMachinery.bench.ts`. Results are committed under `bench/results/procedural-machinery-2026-11-08.json`.

At simulation t=150 s, source-family ablation uses unchanged geometry/ambient and mutes only EDA powers. Band mode compares noise-free expected spectra before and after the actual 24/3 dB normalizer. RES2/RES5 compare expected powers and 64 stochastic native NB/TPSW rows, without history. The example is the first seed with positive VLF EDA power, not a hand-picked bright case.

| Example | Band expected normalized EDA peak dB | RES2 native NB median dB | RES5 native NB median dB |
|---|---:|---:|---:|
| Easy seed 2 | 3.249 | 6.681 | 0.803 |
| Regular seed 3 | 0.619 | 0.677 | -0.666 |
| Difficult seed 0 | 0.042 | -0.691 | -0.903 |

These checks establish that valid sources are generated and processed; they do NOT establish that all are readable. Coarse RES and harder ambient/range conditions still bury examples. No global brightness fix is warranted from these three snapshots. Browser, touch, temporal coherence on a retained gram and broader seed/SNR coverage are unverified.

## Tests

37 targeted tests pass across proceduralMachinery, presets, events, dieselDyn and taxonomyAuxGate. These include engine/aux fractional RPM lock, independent auxiliaries on battery, mixture determinism, traffic independence, disable semantics and physically legal surfaced/snorkelling states. Full-suite results will be reported separately. `tsc --noEmit` currently reports errors in wasm/kernel.ts and test/demonCarrierWeight.test.ts; no typecheck clearance is claimed.

## Depth-constraint enforcement (follow-up)
`opState.allowedDepthM` is the hard depth envelope for every procedural placement, shallow encounters included. When it is omitted the envelope is `depthM`, so a custom deep-only range (e.g. `[120,300]`) can never be overridden by the shallow mixture, even with `shallowDieselProb: 1`. Surfacing is only possible when the envelope starts at 0 m. Regular and Difficult presets declare `[0,100]` and `[0,300]` explicitly. A setup editor that changes the depth range must drop or narrow `allowedDepthM` with it. Regression tests cover a deep-only request without envelope, an explicit deep envelope and a submerged-only envelope; all four new tests fail on 960b67d and pass here.
