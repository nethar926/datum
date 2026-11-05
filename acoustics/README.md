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

No runtime dependencies. Build emits ignored `dist/` ESM/declarations. 88 tests;
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

### Additive frontend facade

`loadScenario(unknown)` validates and throws `ScenarioError` with a JSONPath-style `path`.
`exampleScenarios` exposes `m1-cpa-pass` and separate `benchmark-busy-field` fixtures.
`new AcousticEngine(scenario, seed?)` optionally overrides the seed; `simT` aliases `time`.
`subscribe({channel,kind:'lofar',bins?,band?})`, `unsubscribe`, `configs`, `rowsReady`,
`writeRow`, `tactical` and `dropBuoy` form the display facade. Subscriptions become ready
at 4 Hz; `writeRow` returns the zero-based row index or -1 without writing when none is due.
Drain after each 0.25-second advance for time-correct rows: accumulated pending rows use
current geometry, not historical snapshots. Legacy `registerStream` IDs remain immediate
pull streams. `tactical()` reuses its object/records; `dropBuoy(spec)` returns a numeric ID.
`contract.ts` re-exports v1 types and additive v1.1 `LogEvent`/confidence/event-kind types
only, without logging behavior. Broadband attenuation uses cached natural-log coefficients
and `Math.exp` (same equation, no approximation) instead of per-bin base-10 exponentiation.

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
- `error {message}` is a diagnostic extension. Wideband, azigram, DICASS,
  VLAD, BT/SSP are reserved/rejected, not implemented. DEMON streams are enabled as described below.

## Scenario v1

JSON-safe `v:1`, seed, environment, aircraft/contacts/buoys. Each contact has acoustic
`params` ready for a later catalog adapter, initial position, and ordered `motion` legs
`{at,course,speed,depth}` starting at 0. Initial leg sets motion; later changes apply at
exact boundaries. ENU metres, depth down, m/s, course radians clockwise from north.
Waypoint targets/nonempty transients are typed/reserved but reject until implemented.
Catalog references are an additive v1 extension; legacy raw params still work. Validation caps 250 contacts, 128 buoys, depths 0..1e6 m (stress-test bound,
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
  Tonals apply Doppler/absorption/Lloyd; broadband includes coherent Lloyd fringes and excludes Doppler warping.
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

## Catalog (M2)

`catalog/schema.ts` defines `catalogVersion:1`, forces, hulls, variants and fixed parameter
sheets. `catalog/classes.ts` contains 12 entirely fictional classes (four per force), spanning
five propulsion types. Blue/Green electrical buses use 60 Hz; Red uses 50 Hz. AIP is a flag
on capable diesel classes and an operating mode, never a propulsion class. Country/hull names,
RPMs, levels and tonals are invented. Variants override a fixed subset of class params;
randomization never rewrites those sheets. Transients/emitters remain data-only placeholders.

`deriveSignature(klass, variantIdOrObject, {speedKn,depthM,mode})` returns existing source params
plus typed tonal families and broadband/flow state. Shaft RPM scales with speed/max speed;
blade harmonics, speed-related components and geared mesh/reduction lines follow it. Bus and
nuclear pump frequencies stay fixed. Battery/AIP omit diesel firing lines; snorkel enables
firing on diesel-electric. Validation rejects incompatible operating modes/envelopes.
Urick/Ross static-pressure scaling: `V_i(d)=V_i0*sqrt(1+d/10.06)`; cavitation power is exactly
zero below inception, then grows with excess speed and adds blade/shaft DEMON modulation.
Flow self-noise uses `L=Lref+55 log10(v/vref)`; a fixed invented 1% power fraction radiates
remotely, while the full self-noise is applied only at a colocated receiver. No empirical curves.

A `ScenarioInput` contact may supply `catalogRef:{classId,variantId?,hullId?}` instead of
`params`, with `operatingMode`. `loadScenario` returns resolved params without modifying the
input. Engine signatures refresh in place on timed speed/depth legs. Scenario v remains 1
(additive fields); raw-param M1 scenarios stay valid. Modes are fixed per contact for now.

`randomize(seed)` or `randomizeSelection(rng,weights)` selects rarity, class, hull, variant and
operational state only. Default weights: dieselDirect=5, dieselGearReduction=15,
dieselElectric/battery=40, AIP mode=2, nuclearGearReduction=40, nuclearElectric=2 (total 104).
Common=40, uncommon=15, rare=5, very rare=2; AIP is a selection bucket, not a sixth propulsion.

## Data-contract v1.1: ScenarioParams

Exported from `scenario/presets.ts`, `contract.ts` and the package entry. Serializable fields:
`{subCount, rarityWeights, opState:{speedKn:[min,max], depthM:[min,max], quietProb,
cavitationAllowed}, seaState, surfaceTraffic, cpaRangeKm:[min,max], buoyLifeMin, seed}`.
Speeds knots, depth metres, range km, life minutes; probabilities/traffic are 0..1. This is a
local generation input, not a changed worker command. Root contract docs remain untouched.
`presetToParams('easy'|'regular'|'difficult',seed)` uses a dedicated PRNG substream; frontend
sliders edit the resulting plain object. `clampParams(unknown)` repairs NaN/nonfinite/range
edits, bounds counts to 1..250 and restores positive rarity totals. `generateScenario(params,
seed?)` respects edits, intersects operating ranges with class envelopes, applies quiet-speed
caps, and holds cavitation-disabled speeds below inception. surfaceTraffic activates a seeded prefix of fictional ships and continuously scales ambient shipping. No hidden difficulty settings remain after
preset expansion. Easy: one shallow/fast contact, light traffic/noise, short range, 8 h buoys.
Regular: 1–2 contacts, default weights/noise, mid ranges, 4 h. Difficult: 1–3, rare weights ×3,
deep/slow/quiet without cavitation, high traffic/noise, long range, 1–2 h buoy life.

## DEMON stream extension

Pinned API: `engine.subscribe({kind:'demon',buoyId,band?:[1000,4000]})` returns a numeric
streamId. Its config appears in `configs()` with kind='demon', channel, bins=512, f0=0,
fBin=100/511 Hz, 4 rows/s. `rowsReady` and `writeRow` work unchanged. LOFAR subscriptions
still return their config and permit omitted kind (defaults to 'lofar'). The worker accepts
DEMON subscriptions with buoyId, and sends separately pooled gramRows for each distinct
bin count (1024 LOFAR, 512 DEMON); return each batch's three buffers through release.
All live contacts contribute TL-weighted, modulated broadband power envelopes, including ships.
The square-law envelopes are summed directly, then DC removal/Hann/FFT yields median-relative
dB. Shared source tables contain shaft and blade harmonics; only state changes rebuild them.
4096 envelope samples span 5.11 s; no ultrasonic carrier waveform or overlapping-block phase
continuity is modeled. Buffers, weights and FFT tables are preallocated; no row allocation.
Seek with DEMON currently errors pending window replay; LOFAR-only seek is unchanged.

`fitLloydsMirror(samples, {zrM,cMps?,basis?})` fits measured null spacing samples
`{simT,spacingHz}` to the public far-field CPA spacing curve. rangeSource (or basis alias)
is `{kind:'cpaFit'|'manual',rCPA,speed,tCPA?}` (accepts the CPA result directly). Without it, basis='none', zs=NaN and
only the explicitly relative `depthRatio=rCpa/zs` is identifiable; a good ratio fit still has
ok=true. No hidden range/truth is injected. This small analysis helper is not a classifier.

Additional public source: D. Ross, *Mechanics of Underwater Noise* (1976; reprint 1987).
All cavitation, machinery and flow strengths remain invented illustrative training curves.

### Pinned frontend names and defaults (v1.1)

`fitCpaFromDoppler([{tS,fHz}], opts?:{c?,maxSpeed?})` returns
`{ok,f0,speed,tCPA,rCPA,residualRms}` in Hz, m/s, sim seconds, metres and Hz RMS.
Straight-line constant-speed moving-source/stationary-receiver CPA Doppler only; whole-pass
coverage improves identifiability. `fitLloydsMirror` returns
`{ok,basis,zs,depthRatio,rCPA,speed,tCPA,residualRms}`; basis can be
`{kind:'cpaFit',...cpaResult}` or `{kind:'manual',rCPA,speed,tCPA?}`. Without basis,
`zs/rCPA/speed` are NaN and only the relative depth ratio is meaningful. Samples may be
`{simT,spacingHz}` or `{tS,fHz}` (fHz interpreted as null spacing, not an arbitrary tonal).
Receiver depth opts.zr / opts.zrM defaults to 40 m; c / cMps defaults to 1500 m/s.

`generateScenario(params,seed?)` returns constructor-ready v1 data including `fMax=500`,
`bins=1024`, `fBin=500/1023`, `band=[0,500]`; legacy `fmax` remains for compatibility.
fBin is derived metadata. `subscribe({channel,kind?:'lofar',band?:[f0,fMax],bins?})`
uses these defaults; an explicit band overrides them. Bins remain fixed to the scenario.
Configs always name bin width **fBin**, and include f0. A nondefault band gets its own cached
renderer; custom/default 1024-bin rows can share a packed batch. Nondefault-band seek,
like DEMON seek, is deferred to future window/config replay.
`engine.setSurfaceTraffic(value)` clamps to 0..1 (nonfinite -> 0.5), updates shipping ambient;
worker command `{v:1,type:'setSurfaceTraffic',simT,value}` does the same. ScenarioParams and
all these additions are documented here rather than modifying out-of-scope root docs.

## Completed M2: surface traffic, all-contact DEMON and Lloyd visibility

`catalog/surface.ts` fixes six invented templates. Source offsets are relative to a fictional
120 dB reference sub (not measured signatures):

| Type | Shafts drawn | Blades | Max RPM | Source offset | Electrical |
|---|---:|---:|---:|---:|---|
| fishing-trawler | 1–2 | 3 or 4 | 220 | +12 dB | seeded 50/60 Hz |
| coastal-freighter | 1–2 | 3 or 4 | 180 | +18 dB | seeded 50/60 Hz |
| ferry | 2–3 | 3 or 4 | 240 | +20 dB | seeded 50/60 Hz |
| tug | 1–3 | 3 or 4 | 210 | +16 dB | seeded 50/60 Hz |
| bulk-carrier | 1–2 | 3 or 4 | 150 | +26 dB | seeded 50/60 Hz |
| tanker | 1–2 | 3 or 4 | 160 | +28 dB | seeded 50/60 Hz |

Every ship has shaft/blade/electrical/diesel harmonics, modulated cavitation/machinery
broadband, and a straight seeded track. An independent per-rank PRNG substream fixes an
18-ship maximum pool (reduced only when the 250-contact limit requires it). Low-rank types
favor trawlers/tugs/ferries; high ranks favor bulk/tanker traffic. Count is round(traffic×pool).
Traffic changes cannot alter sub draws. Inactive ships continue moving; live toggles only
change active flags/prefix visibility, not seeds or tracks. Legacy scenarios start at zero
ships but have an inactive pool ready. Per-buoy row-keyed noise preserves equivalence to a
fresh scenario at the same tick history. Ambient shipping power also scales continuously.
`Contact.category` is surface/subsurface; `classificationTargets` and `getClassificationTargets`
exclude ships, while additive `LogEvent.category` lets the operator log them as surface contacts.

`m2-lloyds-cpa` (also `lloydsCpaScenario(seed)`) is an invented loud cavitating subsurface
training pass at 2.5 km horizontal CPA, 40 m source depth and a 60 m buoy. Calm sea; 4096 bins
0..6000 Hz place hundreds of bins between predicted interference minima. Both tones and
broadband use the pressure-release image path. Urick/Jensen Rayleigh coherent image amplitude
factor is exp(-2 k² sigma² sin²(theta)), theta the image-path grazing angle. Illustrative sea-state
0..6 RMS elevations sigma=[0,.04,.12,.25,.5,.9,1.5] m; not a weather forecast. Cached frequency
coefficients and a phase recurrence avoid per-bin trigonometric calls. High seas reduce
coherent fringe contrast as well as increasing ambient noise.

Requirement coverage: `surface.test.ts` (ship constraints/determinism/prefixes/targets/live
LOFAR+DEMON toggles); `multiDemon.test.ts` (two simultaneous blade families and shaft/blade
harmonics within one bin); `lloydVisibility.test.ts` (power-averaged row correlation >0.9 with
predicted gain, >12 dB null contrast, rough-sea contrast reduction); `catalog.test.ts`
(cavitation formula/monotonicity/zero below threshold, shallow-fast vs deep-slow, 50/60 Hz,
20,000 weighted draws, real-name denylist). `demonStream.test.ts` covers separate worker
batch packing; `pinnedApi.test.ts` covers pinned fits/defaults/traffic/bands.
`npm run bench` measures 60-contact/32-buoy legacy and catalog fields plus all 32 DEMON
streams on the catalog case (51 subs + 9 ships), 200 steps after warmup, at 4 rows/s sim time.
