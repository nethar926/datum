# @sonar-sim/acoustics

Owner: Wilson Nicklaus. Private browser-safe TS/ESM training core. **Every platform,
source signature, frequency and performance curve is fictional**, not real sensor/vessel data.
Default operator: generic fictional maritime patrol aircraft laying passive buoy patterns.

```sh
npm install
npm test
npm run typecheck
npm run build
npm run bench
```

No runtime dependencies. Build emits ignored `dist/` ESM/declarations. 40 tests;
benchmark: 12 warmup + 200 full 60-contact × 32-buoy × 1024-bin steps, mean/p95,
no timing assertion. `busyScenario()` is a test/benchmark fixture only. No PNG preview.

## API

`src/index.ts` exports PRNG/Gaussian/seed derivation, units/Mackenzie, kinematics/CPA,
Doppler, Lloyd/TL/ambient/source models, buoy lifecycle/DIFAR, `LofarGenerator`,
`FFT`, `Demon`, `ContactSynth`, scenarios/validation, `AcousticEngine`, `WorkerRuntime`,
`AcousticClient` and protocol types. Sources use no Node APIs.

```ts
const engine = new AcousticEngine(cpaScenario());
const out = new Float32Array(1024); // allocate once
engine.advance(0.25);
engine.writeRow(1, out, 0);         // streamId, destination, offset; no copy/allocation
const rows = engine.step(0.25);    // convenience; reuses array/descriptors/row buffers
```

Engine owns a cloned scenario. `registerStream(id,channel)`, `addBuoy`, `setEnvironment`
allocate/rebuild only at config time. Initial stream IDs are buoy index+1. Live LOFAR
outputs **dB re 1 µPa²/Hz**; tone power is divided by bin width. Dead/not-yet-deployed
buoys yield **NaN** per contract (the only intentional no-data exception to finite spectra).

## Worker v1

Implements M1 of `../docs/data-contract.md`. Every message has `v:1,type,simT`.
When consuming TS through Vite, pass an explicit worker to the client:
`new Worker(new URL('./path/to/acoustics/src/worker.ts',import.meta.url),{type:'module'})`.
The default client worker URL targets built ESM `dist/worker.js`.

- `init {seed,scenarioId:'cpa-pass'}` emits `gramConfig` and `tactical`, initially paused.
  Defaults: LOFAR 1024 bins, 0..500 Hz inclusive, fBin=500/1023, 4 rows/s, 40..110 dB.
- `play`, `pause`, `setRate {x}` (0.1..64), `seek {simT}`. Clock ticks every 250 ms wall
  time; rows stay spaced at 0.25 sim seconds. Seek pauses/replays the seed, 0..3600 s;
  after buoy drops seek explicitly errors pending a future scenario event log.
- `dropBuoy {id?,channel,kind:'omni'|'difar',x,y,hydrophoneDepthM,lifeS?}` (life default
  7200 s). RF channels unique. Then `subscribe {channel,kind:'lofar',bins?:1024,
  band?:[0,500]}`; `unsubscribe {streamId}`. Drops do not auto-subscribe.
- `gramRows` transfers `[streamIds.buffer,rowIndex.buffer,data.buffer]`: Int32 stream IDs,
  Uint32 per-stream indexes starting at 0, packed N×1024 Float32 data. Three full batches
  pooled. After upload, `client.release(batch)` sends `release {buffers}` in that order;
  views detach. Starvation advances time/seeded fluctuations but drops rows with index gaps.
  Config changes allocate; hot ticks allocate no sample arrays. Release rewraps returned
  buffers in typed views. Late old-config buffers may be discarded.
- `tactical` at each clock tick/change: aircraft ENU/heading/groundspeed (illustrative altitude
  300 m); buoy RF/depth/battery/state; strongest K≤8 DIFAR lines per buoy:
  `{buoyId,freqHz,brgDeg,quality}` (quality=SNR dB). Numeric IDs map `buoy-N`. Truth omitted.
- `error {message}` is a diagnostic extension. Wideband, worker DEMON, azigram, DICASS,
  VLAD, BT/SSP are reserved/rejected, not implemented. Standalone DEMON DSP is tested only.

## Scenario v1

JSON-safe `v:1`, seed, environment, aircraft/contacts/buoys. Each contact has acoustic
`params` ready for a later catalog adapter, initial position, and ordered `motion` legs
`{at,course,speed,depth}` starting at 0. Initial leg sets motion; later changes apply at
exact boundaries. ENU metres, depth down, m/s, course radians clockwise from north.
Waypoint targets/nonempty transients are typed/reserved but reject until implemented.
No M2 catalog. Validation caps 250 contacts, 128 buoys, depths 0..1e6 m (stress-test bound,
not physically valid), bins 2..16384. Worker M1 is fixed to 1024 bins.

## Models, equations, limitations

- Relative motion is constant within legs; zero range/speed CPA guarded. Doppler:
  `f'=f(c+vr)/(c-vs)`, toward-positive radial speeds; approximation `f(1+(vr+vs)/c)`.
  Exact shifts are symmetric in inverse frequency, not frequency, around CPA.
- Lloyd image source: `R1=hypot(r,zs-zr)`, `R2=hypot(r,zs+zr)`, normalized field
  `1-(R1/R2)exp(i2πf(R2-R1)/c)`. Unequal spreading leaves residual at phase minima
  `R2-R1=n c/f`. Far-field gain `4sin²(2πf zs zr/(cr))`, null range `≈2f zs zr/(nc)`,
  spacing `≈cr/(2zs zr)`; max ≤6.0206 dB. Tests separate exact minima/asymptotic convergence.
- Spherical `20logR`, cylindrical `10logR`, or continuous hybrid spreading, range floor 1 m.
  Thorp dB/km (f in kHz): `.11f²/(1+f²)+44f²/(4100+f²)+2.75e-4f²+.003`;
  absorption multiplies `(R-1)/1000` to preserve exactly zero loss at 1 m.
- Ambient: illustrative Wenz/Knudsen turbulence/shipping/wind/thermal power sum, not calibration.
  Wind-dominated spectrum decreases 1..10 kHz; thermal noise eventually rises.
- Fictional source: shaft/blade/machinery harmonics, speed/depth-dependent cavitation/level.
  Tonals apply Doppler/absorption/Lloyd; smooth broadband excludes Doppler/mirror fringes.
  Incoherent contacts; two-bin tone deposition; independent exponential/chi-square 2-DOF
  fluctuations, not sampled FFT leakage or correlated ocean noise.
- DIFAR primitive: atan2 of omni×east/north cross terms; worker lines approximate geometric
  bearing plus seeded SNR-dependent Gaussian error, not multi-source localization.
- Standalone DEMON: square-law, four low-pass poles, DC removal, Hann/radix-2 FFT; actual
  acoustic AM synth. Independent blocks, linear power output; future stream adapter must
  convert to median-relative dB. Mackenzie clamps to published validity bounds. Constant
  c (default 1500); no bottom paths/refraction/bathymetry/ducting/SSP.
- Same seed/scenario/call schedule gives identical bytes within a JS runtime, not a promise
  of cross-runtime transcendental bit equality. Source frequencies/gains are entirely invented.

## Public sources (also cited in module comments)

Urick, *Principles of Underwater Sound*, 3e (1983); Kinsler/Frey et al., *Fundamentals of
Acoustics*, 4e (2000); Jensen et al., *Computational Ocean Acoustics*, 2e (2011).
Wenz, JASA 34 (1962), 1936–1956; Knudsen/Alford/Emling, J. Marine Research 7 (1948),
410–429; Thorp, JASA 42 (1967), 270; Mackenzie, JASA 70 (1981), 807–812.
Public Mulberry32, Box–Muller (1958), Cooley–Tukey (1965) numerical algorithms.
