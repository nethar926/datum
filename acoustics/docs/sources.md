# Acoustics public sources (About)

All vessels and acoustic signatures are fictional and procedurally generated. Any resemblance to actual vessels or measured acoustic signatures is unintended and coincidental. Ocean profiles (BT/SSP) are synthetic teaching shapes unless a SOURCES entry explicitly names a measured dataset.

## Model assumptions & limits

- All vessels, countries, hulls, and acoustic signatures are fictional and procedurally generated.
- Ocean BT/SSP profiles are synthetic mixed-layer/thermocline shapes; Mackenzie supplies only c(T,S,D).
- Relative tonal powers and broadband levels are invented teaching weights, not measured spectra.
- Transmission loss uses geometric spreading + Thorp absorption — no full PE/ray trace.
- Convergence-zone range is a parameterized Urick-band approximation from SSP critical depth + depth excess, not a ray solution.
- Lloyd mirror uses a pressure-release image source; coherent nulls are minima under unequal spreading.
- Ambient noise is a smooth Wenz/Knudsen-style fit, not site-calibrated.
- LOFAR rows time-average modelled power spectra (recorded every 0.25 s) with Welch/Hann² weights over each RES span; this approximates the STFT temporal response and is not a waveform FFT. History before a stream starts is assumed stationary at the start state.
- Surface and submarine event rates are teaching policies, not doctrine.

## Sources

### `mackenzie-1981` (verified)

K. V. Mackenzie, “Nine-term equation for sound speed in the oceans,” J. Acoust. Soc. Am. 70(3), 807–812 (1981).

[Link](https://doi.org/10.1121/1.386920)

**Used for:** Seawater sound-speed equation and validity domain for BT/SSP waterColumn profiles.

**Modules:** `units.ts`, `waterColumn.ts`

### `npl-sound-seawater`

National Physical Laboratory, “Technical Guides — Speed of Sound in Sea-Water” (public calculator / validity summary).

[Link](http://resource.npl.co.uk/acoustics/techguides/soundseawater/)

**Used for:** Cross-check of Mackenzie validity ranges cited in water-column docs.

**Modules:** `units.ts`, `waterColumn.ts`, `docs/water-column-fe.md`

### `urick-pous`

R. J. Urick, Principles of Underwater Sound, 3rd ed. (Peninsula / McGraw-Hill). Chapters on transmission loss, ambient noise, multipath/Lloyd mirror, convergence zones, and radiated ship noise (teaching citations).

**Used for:** TL spreading, Lloyd mirror image source, CZ teaching band (~30–35 nmi), ship/sub radiated-noise mechanisms, kinematics/Doppler CPA context.

**Modules:** `transmissionLoss.ts`, `lloydsMirror.ts`, `lloydPass.ts`, `convergenceZone.ts`, `fitLloydsMirror.ts`, `fitCpaFromDoppler.ts`, `striationCurves.ts`, `kinematics.ts`, `ambientNoise.ts`, `catalog/surface.ts`, `catalog/schema.ts`, `catalog/drivetrain.ts`, `catalog/plantModel.ts`, `catalog/derive.ts`, `sourceModel.ts`, `demonStream.ts`, `lofar.ts`, `depthEnvelope.ts`, `spawnGeometry.ts`

### `wenz-1962` (verified)

G. M. Wenz, “Acoustic ambient noise in the ocean: Spectra and sources,” J. Acoust. Soc. Am. 34, 1936–1956 (1962).

[Link](https://doi.org/10.1121/1.1909155)

**Used for:** Illustrative ambient-noise component curves (turbulence/shipping/wave/thermal) in ambientLevel.

**Modules:** `ambientNoise.ts`, `lofar.ts`

### `knudsen-1948`

V. O. Knudsen, R. S. Alford, and J. W. Emling, “Underwater ambient noise,” J. Mar. Res. 7, 410–429 (1948).

**Used for:** Cited alongside Wenz as historical ambient-noise context for the smooth teaching fit.

**Modules:** `ambientNoise.ts`

### `thorp-1967`

W. H. Thorp, “Analytic description of the low-frequency attenuation coefficient,” J. Acoust. Soc. Am. 42, 270 (1967).

**Used for:** Empirical seawater absorption (dB/km) in transmissionLoss.thorp.

**Modules:** `transmissionLoss.ts`, `lofar.ts`, `spawnGeometry.ts`

### `ross-underwater-noise`

D. Ross, Mechanics of Underwater Noise (Peninsula Publishing / Pergamon).

**Used for:** Machinery harmonic / propeller / flow-noise mechanism framing; fictional relative powers only.

**Modules:** `catalog/schema.ts`, `catalog/drivetrain.ts`, `catalog/plantModel.ts`, `catalog/derive.ts`, `catalog/surface.ts`

### `jensen-coa`

F. B. Jensen, W. A. Kuperman, M. B. Porter, and H. Schmidt, Computational Ocean Acoustics (Springer).

**Used for:** Pressure-release image-source / Rayleigh roughness factor context for Lloyd mirror.

**Modules:** `lloydsMirror.ts`, `fitLloydsMirror.ts`, `striationCurves.ts`

### `buck-1981`

A. L. Buck, “New equations for computing vapor pressure and enhancement factor,” J. Appl. Meteorol. 20, 1527–1532 (1981).

**Used for:** Saturation vapour pressure in cavitation-number inception (teaching).

**Modules:** `units.ts`

### `struzinski-lowe-1984`

W. A. Struzinski and E. D. Lowe, “A split-window technique for estimating noise power,” J. Acoust. Soc. Am. 76, 1738–1742 (1984).

[Link](https://doi.org/10.1121/1.391621)

**Used for:** Two-pass split-window (TPSW) background model notes for RES NB.

**Modules:** `res.ts`

### `welch-1967`

P. D. Welch, “The use of fast Fourier transform for the estimation of power spectra: a method based on time averaging over short, modified periodograms,” IEEE Trans. Audio Electroacoust. AU-15, 70–73 (1967).

[Link](https://doi.org/10.1109/TAU.1967.1161901)

**Used for:** RES row temporal response: time-averaging of MODELLED power spectra with Welch-style Hann² weights over K overlapped segments (span T+(K−1)·T/4), and EDOF of averaged bins. Not a waveform FFT; an approximation of the STFT temporal response.

**Modules:** `res.ts`, `resGram.ts`

### `harris-1978`

F. J. Harris, “On the use of windows for harmonic analysis with the discrete Fourier transform,” Proc. IEEE 66(1), 51–83 (1978).

[Link](https://doi.org/10.1109/PROC.1978.10837)

**Used for:** Hann ENBW, scallop loss and 75 % overlap correlation; Hann² taper shapes the 10–90 % edge response.

**Modules:** `res.ts`, `resGram.ts`

### `kinsler-frey`

L. E. Kinsler, A. R. Frey, A. B. Coppens, and J. V. Sanders, Fundamentals of Acoustics.

**Used for:** dB power/amplitude conventions; DEMON incoherent envelope framing.

**Modules:** `units.ts`, `demonStream.ts`
