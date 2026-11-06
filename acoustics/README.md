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

No runtime dependencies. Build emits ignored `dist/` ESM/declarations. 152+ tests;
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
`subscribe({channel,kind:'lofar',bins?,band?,bandPreset?})`, `unsubscribe`, `configs`, `rowsReady`,
`skipToLatest`, `writeRow`, `tactical` and `dropBuoy` form the display facade. Subscriptions become ready
at 4 Hz; `writeRow` returns the zero-based row index or -1 without writing when none is due.
`skipToLatest(streamId, out?, offset?)` advances one subscription's read cursor to the latest
due row without generating intermediates (band-handoff catch-up): with `out` it emits only that
newest row; without `out` it discards the backlog. Drain after each 0.25-second advance for
time-correct rows: accumulated pending rows use current geometry, not historical snapshots. Legacy `registerStream` IDs remain immediate
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
- `play`, `pause`, `setRate {x}` (0.1..64), `seek {simT}`, `skipToLatest {streamId}` (per-stream
  catch-up: discard that subscription's pending backlog without emitting intermediate gramRows;
  host loops that need the newest sample call `engine.skipToLatest(id, out)` directly). Clock ticks every 250 ms wall
  time; rows stay spaced at 0.25 sim seconds. Seek pauses/replays the seed, 0..3600 s;
  after buoy drops seek explicitly errors pending a future scenario event log.
- `dropBuoy {id?,channel,kind:'omni'|'difar',x,y,hydrophoneDepthM,lifeS?}` (life default
  7200 s). RF channels unique. Then `subscribe {channel,kind:'lofar',bins?:1024,
  band?:[0,500]}`; `unsubscribe {streamId}`. Drops do not auto-subscribe.
- `gramRows` transfers `[streamIds.buffer,rowIndex.buffer,data.buffer,bearingDeg.buffer]`:
  Int32 stream IDs, Uint32 per-stream indexes starting at 0, packed N×bins Float32 LOFAR/DEMON
  `data`, and packed N×bins Float32 `bearingDeg` (degrees true 0..360 for DIFAR LOFAR bins;
  NaN for omni, DEMON, or dead). Three full batches pooled. After upload, `client.release(batch)`
  sends `release {buffers}` in that order; views detach. Starvation advances time/seeded
  fluctuations but drops rows with index gaps. Config changes allocate; hot ticks allocate no
  sample arrays. Release rewraps returned buffers in typed views. Late old-config buffers may
  be discarded.
- `tactical` at each clock tick/change: aircraft ENU/heading/groundspeed (illustrative altitude
  300 m); buoy RF/depth/battery/state; strongest K≤8 DIFAR lines per buoy:
  `{buoyId,freqHz,brgDeg,quality}` (quality=SNR dB). Numeric IDs map `buoy-N`. Fixed-length truth contacts include active flags and source-line tags (see M3 below).
- `error {message}` is a diagnostic extension. Wideband, azigram, DICASS,
  VLAD, BT/SSP are reserved/rejected, not implemented. DEMON streams are enabled as described below.

## Scenario v1

JSON-safe `v:1`, seed, environment, aircraft/contacts/buoys. Each contact has acoustic
`params` ready for a later catalog adapter, initial position, and ordered `motion` legs
`{at,course,speed,depth}` starting at 0. Initial leg sets motion; later changes apply at
exact boundaries. ENU metres, depth down, m/s, course radians clockwise from north.
Waypoint targets are typed/reserved and reject. Transients accept only `kind:'hydp'` (m3-events,
see below); other kinds stay reserved and reject.
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
  Incoherent contacts; normalized Hann/Gaussian tone kernels; independent exponential/chi-square 2-DOF
  fluctuations, not sampled FFT leakage or correlated ocean noise.
- DIFAR primitive: atan2 of omni×east/north cross terms; worker lines approximate geometric
  bearing plus seeded SNR-dependent Gaussian error, not multi-source localization.
  Per-bin `bearingRow`/`GramRows.bearingDeg` accumulate the same signal power as the LOFAR
  PSD (broadband/cavitation with Lloyd gain, flow, swaths, tonal kernels) into east/north
  resultants, then `atan2` plus Gaussian noise `σ°=min(90, 20/√SNR)` with SNR=signal/ambient
  (linear). Below 0 dB SNR the bin draws a uniform bearing (isotropic ambient). Bearing noise
  uses an independent `deriveSeed(seed,'bearing:'+buoy.id)` stream so LOFAR power bytes stay
  unchanged. Omni fills NaN and skips the accumulators.
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
sheets. `catalog/classes.ts` contains 22 entirely fictional classes across eight approved fictional nations, spanning
five propulsion types. Blue/Green electrical buses use 60 Hz; Red uses 50 Hz. AIP is optional backup machinery and an operating mode, never a primary propulsion class.
One Kaelun diesel and one Varkeshna nuclear class have it (nuclear requires reactorOffline). Country/hull names,
RPMs, levels and tonals are invented. Variants override a fixed subset of class params;
randomization never rewrites those sheets. Transients/emitters remain data-only placeholders.

`deriveSignature(klass, variantIdOrObject, {speedKn,depthM,mode})` returns existing source params
plus typed tonal families and broadband/flow state. Shaft RPM scales with speed/max speed;
blade harmonics, speed-related components and geared mesh/reduction lines follow it. Bus and
nuclear pump frequencies stay fixed. BATT/AIP omit diesel firing lines; SNORK and D/E charging enable
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

## v1.1 API shapes

All functions below are exported by `src/index.ts`. Units: sim time seconds, lengths metres,
speed m/s unless a field ends in `Kn` or `Kts`, frequencies Hz, LOFAR PSD dB re 1 µPa²/Hz,
DEMON dB relative to that row's median. Inputs are not mutated by the fitting helpers.

### Doppler CPA fit

```ts
interface DopplerSample { tS: number; fHz: number }
interface CpaFit {
  ok: boolean; f0: number; speed: number; tCPA: number;
  rCPA: number; residualRms: number;
}
function fitCpaFromDoppler(
  samples: readonly DopplerSample[],
  opts?: { c?: number; maxSpeed?: number }
): CpaFit;
```

Input fHz is a tracked **tonal frequency**, tS is sim seconds. Output f0 Hz, speed m/s,
tCPA sim seconds, rCPA metres, residualRms Hz. Defaults c=1500 m/s, maxSpeed=100 m/s.
The model assumes a straight constant-speed pass and stationary receiver. Failure gives
ok=false with NaN estimates; a flat tone does not provide an identifiable CPA fit.

### Lloyd spacing fit — not a tonal-frequency fit

**Input fHz means STRIATION SPACING: null-to-null Δf measured at tS. Do not pass the
frequency of an arbitrary tonal or a single higher-order null as though it were Δf.**

```ts
interface LloydSpacingSample { simT: number; spacingHz: number } // legacy alias
interface LloydRangeSource {
  kind: 'cpaFit' | 'manual'; rCPA: number; speed: number; tCPA?: number;
}
interface LegacyLloydRangeSource {
  kind: 'cpaFit' | 'manual'; rCpaM: number; speedMps: number; tCpa?: number;
}
interface LloydFitOptions {
  zrM?: number; zr?: number; cMps?: number; c?: number;
  rangeSource?: LloydRangeSource | LegacyLloydRangeSource | 'none' | null;
  basis?: LloydRangeSource | LegacyLloydRangeSource | 'none' | null;
}
interface LloydFit {
  ok: boolean; basis: 'cpaFit' | 'manual' | 'none'; zs: number;
  depthRatio: number; rCPA: number; speed: number; tCPA: number; residualRms: number;
}
function fitLloydsMirror(
  samples: readonly (LloydSpacingSample | { tS: number; fHz: number })[],
  opts: LloydFitOptions
): LloydFit;
```

zrM/zr is buoy hydrophone depth (default 40 m); cMps/c is sound speed (default 1500 m/s).
basis takes precedence over rangeSource. A CPA result can be passed as
`basis:{kind:'cpaFit',...cpaFit}`; manual uses the same rCPA/speed/tCPA units as CpaFit.
Output zs and rCPA are metres, speed m/s, tCPA sim seconds, residualRms spacing Hz.
With no basis, zs/rCPA/speed are NaN; depthRatio=rCPA/zs is explicitly **relative and
unitless**, not an estimated source depth. Here **depthRatio = R/zs** (horizontal range
over source depth), evaluated at the fitted CPA; **zs/R is its reciprocal**. In basis
none, the far-field spacing relation is R/zs = 2*zr*Δf/c. A good relative ratio fit
may have ok=true.

### Striation curve overlay

```ts
interface StriationParams {
  rCPA: number; speed: number; tCPA: number; zs: number; zr: number; c?: number;
}
function striationCurves(
  p: StriationParams, nMax: number,
  tS: Float64Array | Float32Array | readonly number[], out: Float32Array
): Float32Array;
interface RelativeStriationParams {
  basis: 'none'; depthRatio: number; speedOverRange: number;
  tCPA: number; zr: number; c?: number;
}
function striationCurves(
  p: RelativeStriationParams, nMax: number,
  tS: Float64Array | Float32Array | readonly number[], out: Float32Array
): Float32Array;
```

Absolute parameters use metres, m/s and sim seconds; c defaults to 1500 m/s. Relative
mode uses depthRatio=rCPA/zs and speedOverRange=speed/rCPA in s⁻¹, without inventing
an absolute source depth. Both draw the far-field curves, not an exact shallow-range model.
For N=tS.length, out is row-major `[n-1][i]`: `out[(n-1)*N+i]` is null-order n frequency
`n*c*sqrt(rCPA²+speed²*(tS[i]-tCPA)²)/(2*zs*zr)` Hz, for n=1..nMax.
Relative mode substitutes `r(t)/zs=depthRatio*sqrt(1+(speedOverRange*(t-tCPA))²)`.
No allocation: the identical out buffer is returned. Only its first nMax*N values are
written; excess storage stays untouched. Invalid physics/time or nonrepresentable Float32
frequencies yield NaN. Too-short output or invalid nMax dimensions throw RangeError.

### Editable scenario generation

```ts
type Difficulty = 'easy' | 'regular' | 'difficult';
type RarityWeights = Record<
  'dieselDirect' | 'dieselGearReduction' | 'dieselElectric' |
  'nuclearGearReduction' | 'nuclearElectric' | 'aip', number
>;
interface ScenarioParams {
  subCount: number;
  rarityWeights: RarityWeights;
  opState: {
    speedKn: [number, number]; depthM: [number, number];
    quietProb: number; cavitationAllowed: boolean;
  };
  seaState: number; surfaceTraffic: number;
  cpaRangeKm: [number, number]; buoyLifeMin: number; seed: number;
}
function presetToParams(difficulty: Difficulty, seed: number): ScenarioParams;
function clampParams(value: unknown): ScenarioParams;
function generateScenario(params: ScenarioParams, seed?: number): Scenario;
```

Ranges are inclusive operator inputs: knots, metres, horizontal CPA km, buoy life minutes;
quietProb/surfaceTraffic are 0..1, seaState 0..6. subCount counts subs/classification targets,
not the additional active surface pool. 'aip' is a rarity bucket/mode, not a propulsion type.
The plain object round-trips through JSON. clampParams repairs nonfinite/out-of-bound edits;
generateScenario uses params.seed unless overridden. The returned Scenario is accepted by
`new AcousticEngine(scenario)` and includes default fMax=500, bins=1024, fBin=500/1023,
band=[0,500], plus legacy fmax. Explicit LOFAR subscribe band overrides defaults; fBin is
computed metadata. Surface ships never change the independently seeded sub draws.

### Live traffic and DEMON host loop

```ts
// AcousticEngine methods:
setSurfaceTraffic(v: number): void;
advance(dt: number): void;
subscribe(req: { kind: 'demon'; buoyId: number; band?: [number, number] }): number;
configs(): GramConfig[];
rowsReady(streamId: number): number;
skipToLatest(streamId: number, out?: Float32Array, offset?: number): number;
writeRow(streamId: number, out: Float32Array, offset?: number): number;
interface GramConfig {
  v: 1; type: 'gramConfig'; simT: number; streamId: number;
  kind: 'lofar' | 'demon' | 'bearing'; channel: number; bins: number;
  f0: number; fBin: number; rowRateHz: number; dbFloor: number; dbCeil: number;
  demodBandHz?: [number, number];
}
```

Traffic clamps to 0..1 (nonfinite -> 0.5), toggles a preseeded ship prefix without resetting
tracks/seeds, and scales ambient shipping. Matching worker command is
`{v:1,type:'setSurfaceTraffic',simT,value}`. DEMON buoyId is the numeric buoy ID; its band is
the acoustic demodulation band (default [1000,4000] Hz), not the envelope frequency axis.
DEMON configs use kind='demon', the buoy channel, bins=512, f0=0, fBin=100/511 Hz,
rowRateHz=4 and demodBandHz. Returned samples are median-relative dB, not linear power.
writeRow writes bins samples starting at offset, returning zero-based rowIndex, or -1
without writing when no row is ready. Output buffers belong to the caller; no row allocation.
Drain after each 0.25 sim-second advance for time-correct geometry. The exact host loop
below is covered by `test/striationCurves.test.ts`:

```ts
engine.subscribe({ kind: 'demon', buoyId: 1 });
const config = engine.configs().find(c => c.kind === 'demon')!;
const packed = new Float32Array(config.bins + 4); // once, outside frame loop
// Each host tick:
engine.advance(0.25);
if (engine.rowsReady(config.streamId) > 0)
  engine.writeRow(config.streamId, packed, 4);
```

Worker gramRows have `streamIds:Int32Array`, `rowIndex:Uint32Array`, packed Float32Array
data `[stream][bin]`, and optional packed `bearingDeg?:Float32Array` of the same length
(NaN where the stream is not DIFAR LOFAR). Different bin counts use separate messages/pools,
never a mixed 1024-bin LOFAR/512-bin DEMON batch. Return each batch's four ArrayBuffers in
IDs/indexes/data/bearingDeg order using release after upload; transfer detaches views.

### Additive log category

```ts
type Confidence = 'possible' | 'probable' | 'certain';
type LogEventType = 'contact' | 'classification' | 'buoyDrop' |
  'buoyLive' | 'buoyDead' | 'bearing' | 'note';
interface LogEvent {
  v: 1.1 | 1; type: 'log'; simT: number; kind: LogEventType;
  category?: 'surface' | 'subsurface'; contactId?: number; buoyId?: number;
  class?: string; confidence?: Confidence; data?: Record<string, unknown>;
}
```

simT is simulation seconds. category is optional for v1 compatibility; surface contacts
can be logged without becoming classification targets. These are data types, not automatic
message-sending or logging behavior.


## M3 lines and fixed-capacity truth (additive v1.1)

```ts
type LineStability = 'stable' | 'unstable';
type LineWidth = 'discrete' | 'diffuse';
interface LineProfile {
  stability: LineStability; width: LineWidth; sigmaBins?: number;
}
type LineProfiles = Partial<Record<TonalFamily, LineProfile>>;
interface TonalLine {
  family: TonalFamily; hz: number; power: number;
  id?: string; stability?: LineStability; width?: LineWidth;
  sigmaBins?: number; frequencyHz?: number;
}
interface TruthLine {
  id: string; family: TonalFamily; f0Hz: number; freqHz: number; power: number;
  stability: LineStability; width: LineWidth; sigmaBins: number;
}
interface TruthContact {
  id: number; sourceId: string; label: string; active: boolean;
  spdKts: number; propulsion: PropulsionTruth;
  category: 'surface' | 'subsurface'; classificationTarget: boolean;
  x: number; y: number; depthM: number; crsDeg: number; spdMps: number;
  lines: TruthLine[];
}
// Existing optional Tactical.truth now contains these extended records:
// truth?: { contacts: TruthContact[] }
```

Signature and catalog ClassParams accept optional `lineProfiles`, keyed by tonal family;
auxiliary entries may override stability/width/sigmaBins. Explicit per-line tags win.
Omitted IDs become family:index. Plant/electrical lines default stable/discrete; selected
auxiliaries unstable; blade/SRC lines unstable/diffuse. These are fictional oscillator
characteristics, not calibrated platform observations. Runtime `Contact.lines` exposes the
resolved lines. `hz`/truth `f0Hz` are nominal Hz; `frequencyHz`/truth `freqHz` are actual
source-frame Hz **before receiver Doppler**. Power is relative linear tonal power.

Seed/contact/line-ID substreams drive a stationary Gaussian OU process (20 s time constant).
Stable drift is bounded below 0.009% of nominal; unstable drift has stationary standard
deviation 0.2% plus uniform ±0.015% row jitter. The engine updates once per advance,
including inactive contacts: subscribing another buoy cannot change source wander.
Standalone users can construct `new LineWander(signature,seed,contactId)` and call
`advance(dt)` on the source clock before rendering; generators alone do not advance time.
Same seed/scenario/advance schedule gives identical rows; arbitrary time subdivisions
are not promised to give identical stochastic histories.

`LineKernel(width?,sigmaBins?)` and cached `lineKernel(width?,sigmaBins?)` precompute 128
fractional-bin phases. `deposit(out,bin,power):void` adds into caller Float32/Float64 storage
without allocation. Discrete lines use squared Hann Fourier response (sampled bin-centred
-3 dB width 1.33 bins; continuous width about 1.44). Diffuse Gaussian **power** kernels use
sigmaBins 0.75..16, default 2.5; FWHM = 2*sqrt(2*ln(2))*sigmaBins. Finite kernels and
clipped band edges are normalized, preserving integrated tonal energy to within 1% versus
discrete deposition. LOFAR divides this integrated power by fBin to retain PSD units.
Independent chi-square fluctuations can obscure a single row's measured width/energy.
Kernel caches and oscillator state allocate only during configuration.

`engine.tactical().truth.contacts` and worker tactical truth have **constant scenario
capacity**, base contacts plus the maximum seeded surface pool, not only live contacts.
Ordering/IDs and engine-side array/record/line-array identities stay fixed; hosts must filter
`active`, never infer activity from membership. Existing truth id/x/y/crsDeg/spdMps fields
remain; sourceId is the scenario contact string ID, id is its stable numeric truth ID.
Positions/depth are metres, heading degrees clockwise from north. Display speed is spdKts
(**knots**); legacy spdMps remains m/s for v1 compatibility, never silently reinterpreted.
Changing traffic toggles flags without resizing truth; inactive tracks/wander continue.
`scenario.contacts` retains its legacy active-surface view and is not the truth list.
`tactical()` reuses records; clone only if a historical snapshot is needed.

DEMON removes envelope DC and Hann-windows before FFT in both standalone and all-contact
streams. Additive `FFT.transform(input,window=true,removeDc=false):void` supports
window-weighted DC removal, ensuring a pedestal does not leak into the low bins.
`lines.test.ts` covers width, energy, stochastic bounds, row determinism, tags and fixed
truth identities; `demonDc.test.ts` covers pedestal rejection and preserved modulation;
`worker.test.ts` verifies fixed truth capacity through actual worker messages.


## Static engine/drivetrain catalog (M3 follow-on)

All machinery dimensions, powers, line strengths and frequencies below are invented.
Public machine kinematics only: Urick/Ross rotating orders, cylinder event counts, hunting-tooth
gearing and electrical pole-pair relations. This is not a real-vessel identification catalog.

`SubmarineClass.plant` is **'diesel' | 'nuclear'**; detailed machinery is the separate
`machinery: DieselPlant | NuclearPlant` object. `params.propulsion` retains its five legacy
primary types, never AIP. `drivetrainCode` is 'D/D', 'D/GR', 'DEL', 'N/GR' or 'NEL'.
DEL's `drivetrainLabel` is **DIESEL ELECTRIC**. **D/E is a mode, never a drivetrain label.**
Legacy reductionRatio/gearTeeth fields remain readable; authoritative ratios come from
machinery drivetrain teeth, not those old illustrative fields.

```ts
interface EngineSpec {
  id: string; stroke: 2 | 4; cylinders: number;
  erpm: { obsMin: number; obsMax: number; normal: number }; // RPM
}
interface GearStage { pinionTeeth: number; bullTeeth: number }
interface Drivetrain {
  kind: 'direct' | 'gr1' | 'gr2'; stages: GearStage[];
  ratio: number; ratioLabel: string; // e.g. 71/20 = 3.55, '3.55:1'
}
interface MotorSpec { maxRpm: number; drivetrain: Drivetrain }
interface DieselPlant {
  kind: 'dieselDirect' | 'dieselGR' | 'dieselElectric';
  engines: EngineSpec[]; drivetrain?: Drivetrain;
  generator?: { polePairs: number }; motor?: MotorSpec;
}
interface ReactorSet {
  id: string; coolantPumpHz: number;
  turboGenerator: { rpm: number; polePairs: number };
}
interface NuclearPlant {
  kind: 'nuclearGR' | 'nuclearElectric'; reactors: number; reactorSets: ReactorSet[];
  mainTurbines: { count: number; maxRpm: number; drivetrain: Drivetrain };
  turbineGenerators: { count: number; rpm: number; polePairs: number };
  motor?: MotorSpec;
}
interface EdaSpec {
  id: string; name: string; cfrMultiple: number; harmonics: number[];
  perCrankRev?: number; // deprecated compatibility alias, not authoritative
  ramp?: { riseS: number; fallS: number }; modes?: OperatingMode[];
}
interface AuxSpec {
  id: string; kind: 'electrical' | 'acvr' | 'dcvr' | 'ssma' | 'hydp' | 'acPump';
  fHz: number; harmonics: number[]; stability: LineStability; width: LineWidth;
  sigmaBins?: number; duty: 'continuous' | 'intermittent';
  dutyOnS?: [number,number]; dutyOffS?: [number,number]; // seconds; required when intermittent
}
interface AipSpec {
  kind: 'stirling' | 'fuelcell' | 'closed-cycle';
  powerKw: number; maxSpeedKts: number; enduranceDays: number;
}
// Additional class fields (all speeds knots):
// maxPsrpm, shafts, shaftMismatchPct:[min,max], edas:EdaSpec[], aux:AuxSpec[],
// operatorNationId, snorkelDepthM, motorSlots?, aipCapable:boolean, aip?:AipSpec,
// maxSpeedKts:{surfaced,submerged,snorkel,battery}, quietSpeedKts:[min,max],
// era:number, quietingTier:'gen2'|'gen3'|'gen4', archetype?:string,
// emergencyPropulsor?:{maxRpm:number,blades:number,maxSpeedKts:number}.
```

Two-stroke engines always have six cylinders. Four-stroke engines use 6/8/10/12/16.
D/D is strictly two-stroke/six-cylinder/direct 1:1, with a clutched electric motor for
submerged battery propulsion. Reduction stages use coprime teeth; ratio is their product,
formatted to two decimals. Mesh Hz is pinionHz*pinionTeeth = bullHz*bullTeeth at each stage.
Nominal max shaft RPM closes within 2% against engine/ratio or motor/ratio. Multi-engine
selection is seeded at configuration; D/D's engine-per-shaft arrangement runs every coupled
engine. Shaft mismatch is independently seeded per contact/shaft; primary shaft is nominal.
Nth blade doublet spacing is n*blades*abs(dRPM)/60. Both LOFAR and shared DEMON envelope
tables include the installed shafts. No time-series allocation occurs per row.

### Canonical operating modes and speed policy

```ts
type OperatingMode = 'SURF' | 'SNORK' | 'D/E' | 'BATT' | 'AIP' | 'NUC';
```

SURF is surfaced diesel operation. SNORK is snorkel-depth transit. D/E is engine-on battery
charging while surfaced/snorkeling (louder, generators on), with no mechanical engine/shaft
clutch. BATT uses the electric propulsion motor with diesels stopped. NUC is normal nuclear
operation, independent of depth. D/D PSR = CSR exactly when coupled in SURF/SNORK; in BATT
PSR follows motor RPM independently of ERPM. Per-shaft `coupled` flags distinguish these paths.
V1 lowercase mode strings remain accepted at the input boundary and normalize to these codes;
new generated scenarios and truth always emit canonical modes.

Generated diesel contacts: depth 0 -> SURF; 0<depth<=snorkelDepthM -> seeded ~85% SNORK,
otherwise BATT; deeper -> BATT or eligible AIP. Surfaced/snorkel/battery maxima clamp speed.
~85% of over-patrol battery draws are lowered into quietSpeedKts, never over battery max.
Quiet-band maximum is below inception at 100 m and below submerged maximum. Nucleus-driven
contacts use surfaced/submerged speed caps. Operator ranges still obey these physical/mode
caps, even when an edited lower bound is infeasible. Class identity draws remain independent
of traffic and static-mode substreams. Modes do not change automatically during timed legs;
mode transitions and duty/ramp scheduling belong to m3-events.

AIP is **backup**, never a sixth primary kind. `aipCapable === !!aip` is validated. A slow,
submerged, eligible diesel draw chooses AIP ~10% of the time (seeded). Exactly two classes
are equipped: Kaelun's Gloamspiral diesel and Varkeshna's Frostwhorl nuclear backup.
Nuclear AIP requires `reactorOffline:true` in OperatingState or a scenario/contact flag.
`ScenarioParams.reactorOffline?:boolean` defaults false and enables the eligible nuclear
backup; non-equipped nuclear contacts remain normally powered. AIP speed is capped by its
own low maximum. No diesel, main-turbine or reactor-pump families run in AIP; motor and
invented backup-generator/aux lines remain (illustrative 28/42/34 Hz for the three AIP kinds).
Normal 50/60-Hz buses derive from synchronous generator/TG RPM and pole pairs; battery
inverter lines remain when physical generators stop. Direct/GR diesels have independent
service electrical sets; their main engine ERPM is not forced to bus frequency.

### Pinned display truth and operator line families

```ts
interface PropulsionTruth {
  kind: 'dieselDirect' | 'dieselGR' | 'dieselElectric' |
        'nuclearGR' | 'nuclearElectric' | 'unspecified';
  mode: OperatingMode;
  tpk: number; tpkValid: boolean; tpkMinKts?: number;
  propulsor: { shafts: number; blades: number; bladeType: 'flat'|'skewed'|'cpp'; brHz: number };
  drivetrainCode: 'D/D' | 'D/GR' | 'DEL' | 'N/GR' | 'NEL' | 'unspecified';
  drivetrainLabel: string; ratio: number; ratioLabel: string;
  engines: { id: string; stroke: 2|4; cylinders: number; erpm: number;
    running: boolean; csrHz: number; cfrHz: number; efrHz: number }[];
  stages: { pinionTeeth: number; bullTeeth: number; ratio: number; meshHz: number }[];
  shafts: { rpm: number; hz: number; coupled: boolean }[];
  motor?: { rpm: number; shaftHz: number; slots: number; msrHz: number };
  generators?: { rpm: number; hz: number }[];
  aip?: { kind: AipSpec['kind']; active: boolean };
  emergencyPropulsor?: { active: boolean; rpm: number; hz: number; blades: number };
}
type LineFamily = 'CSR' | 'CFR' | 'EFR' | 'EDA' | 'PSR' | 'MSR' | 'COOLANT' | 'TG' |
  'BR' | 'GRID' | 'SRC' | 'MESH' | 'AUX' | 'TURBINE' | 'VANE';
// Additional TonalLine/TruthLine metadata:
// lineFamily?:LineFamily, fundamentalHz?:number, harmonic?:number,
// engineId?:string, shaftIndex?:number, reactorId?:string, eda?:{name:string,cfrMultiple:number}.
```

Every truth contact adds `label:string` (fictional class + hull suffix, else sourceId) and
`spdKts:number`. Existing spdMps stays m/s for v1 compatibility. Machinery records and rate
values are preallocated, updated in place only on state changes, and reused by tactical().
All listed Hz are nominal source-frame rates; per-line freqHz still includes seeded wander,
not receiver Doppler. Motor `shaftHz` is RPM/60 and equals PSR for direct coupling. The existing MSR slot-pass
family is `motor.msrHz = motor.shaftHz * motor.slots`; all values are precomputed for display.
Each primary reduction stage's mesh rate is supplied directly; secondary-shaft mesh lines
carry the same seeded mismatch as their shaft. Stopped generators expose zero Hz/RPM.
Raw M1 sources without a machinery sheet report kind/code 'unspecified', preserving their
old spectra rather than inventing a class/engine identity.

Operator labels/formulas: CSR=ERPM/60; CFR=CSR for 2-stroke, CSR/2 for 4-stroke;
EFR=CFR*cylinders; ERPM=CSR*60. Four-stroke CFR is the half-order line. CSR/CFR/EFR/EDA
and PSR/MSR are separately tagged harmonic families at n*fundamentalHz. EDA fundamental
is CFR*cfrMultiple (not necessarily an integer cylinder harmonic). These fields let harmonic cursors snap without deriving a fundamental.
Aux duty and EDA ramp/mode fields are typed, validated placeholders only, not timed behavior.

### Approved fictional operators and roster

NATIONS is an allowlist; every unlisted operator (including every ISO country code) is
rejected. Explicit deny aliases also include North Korea NKO/PRK/KP and South Korea KOR/ROK/KR.
No class belongs to a real country. The primary rarity weights remain 5/15/40/40/2 for
D/D, D/GR, DEL, nuclear GR, nuclear electric, plus 2 for the legacy **AIP-equipped diesel
selection bucket**, not an AIP primary type. Ordinary DEL draws exclude that equipped class.

| Nation | Force / Hz | Nuclear | Diesel |
|---|---|---:|---:|
| Varkeshna Federation | Red / 50 | 3 | 1 |
| Kaelun Republic | Red / 50 | 2 | 2 |
| Zahrestan | Red / 50 | 0 | 2 |
| Dorhan Commonwealth | Red / 50 | 0 | 2 |
| Norrland Union | Blue / 60 | 2 | 0 |
| Ostmark League | Blue / 60 | 1 | 2 |
| Tarsian Republic | Green / 60 | 1 | 2 |
| Meridia | Green / 60 | 0 | 2 |

Dorhan's Pebblewisp and Mistacorn are small coastal/littoral DEL classes. Varkeshna's
Ivorycoil is our own very-large, older guided-missile nuclear archetype (era 1980, gen2):
two independently offset shafts, two reactors with separate coolant-pump/TG tonal sets,
and an invented low-speed emergency propulsor, off by default. Its source reference level
is intentionally >8 dB above newer Varkeshna nukes at matched speed, not empirical data.
Emergency-propulsor activation, transient events and time-varying plant modes are reserved
for m3-events. Every dimension/blade count/frequency is invented, not taken from a real class.
Surface templates preserve legacy shaft-count ranges and add a full plantSpec; seeded ships
instantiate their actual 1–3-shaft machinery, direct/GR meshes and SURF-mode truth.

Coverage: drivetrain.test.ts (orders, teeth, meshes, EDA scaling, doublets, cylinder/ratio
validation, deterministic engine selection, D/D clutch/motor, record reuse); nationsModes.test.ts
(roster/operator denylist, shallow/deep mode policy, AIP seeded rate/reactor-off, MSR, older
reactor sets and loudness); pinnedApi.test.ts (exact nested truth fields and both Lloyd inputs).


## Recovered M3 follow-up: class-only identification keys

Canonical `OPERATING_MODES` is the exported readonly tuple
`['SURF','SNORK','D/E','BATT','AIP','NUC']`. Legacy lowercase inputs remain accepted; generated
modes, truth and `idKeys.linesVisiblePerMode` use only these six codes.

Every submarine class supplies `tpk` (propeller RPM per knot), and
`propeller:{shafts:number,blades:number,type:'flat'|'skewed'|'cpp'}`; blades are integers 3..9.
The existing `propellerType` and params fields remain compatibility aliases. Truth adds
`propulsion.tpk`, `propulsion.tpkValid`, and `propulsion.tpkMinKts` on CPP boats. CPP holds a
shaft-RPM floor below this speed, so its TPK speed inference is invalid there. Fixed-pitch
TPK remains valid across its linear envelope. Unclassified legacy raw sources expose 0/false
rather than inventing TPK. `propulsion.propulsor:{shafts,blades,bladeType,brHz}` is filled
in place; `brHz` is the primary shaft's nominal blade rate in Hz. Per-shaft rates remain in
`propulsion.shafts[]`. **BR = blades * PSR**, encoded by `idKeys.ratios.brToPsr` and the
`bladeRateHz` envelope. `idKeys.tpk` encloses installed shaft mismatch and illustrative wander.

Each diesel class has 1–3 EDA definitions with `{id,name,cfrMultiple,harmonics,...}`.
EDA lines carry `lineFamily:'EDA'`, `eda:{name,cfrMultiple}`, `fundamentalHz` and `harmonic`;
source `hz` (truth `f0Hz`) is `CFR*cfrMultiple*harmonic`. Truth `freqHz` additionally wanders.
EDA metadata and line records are reused on refresh. LOP is a fictional fractional-order
example: CFR 2.5 Hz * 27.75 = 69.375 Hz, strictly between cylinder harmonics H27 and H28.
`perCrankRev?` is retained only as a deprecated compatibility alias; CFR multiples govern.

Optional class `hydp:{nominalHz:number,pairSpacingHz:number,durationS:number}` is data only,
including the invented 367.77-Hz case. Since m3-events the pair is rendered only as a scheduled
manoeuvre transient (below); aux duty cycles are still not rendered.
`idKeys.hydp` has the same field names as ranged `[min,max]` values (Hz, Hz, seconds).
Aux metadata uses `duty:'continuous'|'intermittent'`; intermittent entries require ordered
`dutyOnS:[min,max]` and `dutyOffS:[min,max]` seconds. These validated tags do not toggle audio.
Timed duty, EDA ramps, mode transitions and emergency-propulsor activation remain m3-events.

The exported `catalog.classes[].idKeys` and `buildCompendium().classes[].idKeys` are class-only
ranges/ratios, never current exact hull signatures. The compendium includes id/name/operator/
force/plant and keys, without params or hull lists; there is deliberately no Markdown renderer.
Keys span the operating envelope, installed mismatch and a conservative 2% wander allowance.
Oscillator Gaussian tails are unbounded in principle; this is an illustrative envelope, not a
statistical guarantee for arbitrarily long histories. Frequencies are source-frame Hz; Doppler
correction is the caller's responsibility.

Nuclear keys additionally expose `turbineRateHz:[min,max]`, `reductionRatio:[min,max]`,
`gearMeshHz:Array<[min,max]>` (one per main-turbine reduction stage) and
`turboGenHz:Array<[min,max]>` (one rotor-rate range per reactor TG set). TG rotor Hz is
RPM/60; electrical bus Hz is separately `gridHz = RPM/60 * polePairs`. Nuclear-electric
main turbines can be direct generator drives; motor gearing remains in `gearing`/`ratios.gear`.
`harmonicFamilies` includes the speed-related BR/PSR/MESH and independent TG/COOLANT families.

Turbine vane-pass: each nuclear `mainTurbines` sheet carries an invented `vaneCount`
(deterministic per catalog index, 20..80; not a real platform figure). The plant emits a
dedicated `lineFamily:'VANE'` (TonalFamily `'turbine'`) at `rotorHz × vaneCount × h`, h=1..3,
alongside the unchanged rotor `TURBINE` lines, so Narrow-down can key it separately.
Nuclear keys add `vaneRateHz:[min,max]` (= `turbineRateHz × vaneCount`) and `vaneCount:[n,n]`;
diesel classes have neither. `ClassObservations` accepts `vaneRateHz` and `vaneCount`.

`idKeys.speedWindows` uses `{name,kind:'SWATH'|'SRC',speedKts:[min,max],loHz,hiHz}`;
the latter pair is a frequency envelope for tracking SRCs or the swath bounds.
Truth `speedGated` uses `{name,kind:'SRC',hz,active,gain}` or
`{name,kind:'SWATH',loHz,hiHz,active,gain}`. Speed is knots, frequency Hz, gain linear 0..1.
Each edge fades over one knot; records update in place. No broad schema/runtime refactor.

```ts
interface ClassObservations {
  gridHz?: number; mode?: OperatingMode; lineFamilies?: readonly LineFamily[];
  familyFundamentalsHz?: Partial<Record<LineFamily,number>>;
  brToPsr?: number; msrToMotorShaft?: number; msrToPsr?: number;
  gearRatio?: number; efrToCsr?: number; tpk?: number;
  turbineRateHz?: number; vaneRateHz?: number; vaneCount?: number;
  reductionRatio?: number; gearMeshHz?: number;
  turboGenHz?: number; hydpHz?: number; edaCfrMultiples?: readonly number[];
  speedWindows?: readonly {
    kind: 'SWATH' | 'SRC'; hz?: number; loHz?: number; hiHz?: number; speedKts?: number;
  }[];
}
interface ClassMatch { id:string; score:number; matched:string[]; ruledOutBy:string[] }
matchClasses(observations: ClassObservations,
  source?: readonly {id:string;idKeys:IdKeys}[]): ClassMatch[];
```

`matchClasses` reads **idKeys only** (defaulting to the compendium), not engine/truth/params.
It ranks by fraction of supplied constraints agreeing, then ASCII class ID; score is 0..1,
not a probability. Empty observations score zero; nonfinite numeric observations contradict.
`matched` lists supporting constraint names; `ruledOutBy` lists contradictions, which callers
can filter explicitly. Overlapping fictional envelopes intentionally leave ambiguous matches.

Optional `speedWindows` observations classify against `idKeys.speedWindows`. An observed SRC
`hz` matches if it falls in any class SRC `[loHz,hiHz]` (same inclusive range check as other
Hz keys); a SWATH `{loHz,hiHz}` matches if it overlaps a class SWATH band by ≥50% of the
observed width. When `speedKts` is supplied it must also lie in that window's `speedKts` with
the same one-knot edge fade used by truth gain. Matched / ruled-out key names are `SRC` and
`SWATH`. A class with no window of that kind is ruled out by that key. SRC idKeys envelopes
keep the usual ±2% wander pad across the design speed span; SWATH bands stay exact (hash-
spaced teaching intervals with no per-hull jitter).

Coverage: `m3Followup.test.ts` pins all six modes, TPK/CPP/propulsor shape and record reuse,
CFR-order EDA/LOP arithmetic and truth metadata, data-only HYDP/duty, one-knot fades, 50 seeded
nuclear envelopes, and idKeys-only matching. `pinnedApi.test.ts` also pins nested truth.
Existing `compendium.test.ts` covers deterministic class coverage, JSON, 50 seeded hulls per
class, BR/TPK/motor/firing ranges and speed-window truth; earlier M3 tests remain unchanged.


### Class-discriminating static identities (m3-lines-ids)

Public signatures and field names are unchanged. Static machinery variation is keyed by
fictional class ID using independent seeded feature substreams, never the scenario/hull seed.
Diesels have 1–3 named EDA orders in quarter increments (fraction .25/.5/.75), not a universal
list; Brindleflux retains LOP x27.75. Hunting-tooth gearing, auxiliary frequencies, SRC rates
and speed-window settings vary deterministically as well. Mandated direct 1:1 drives and
force-wide 50/60-Hz electrical buses deliberately remain invariant.

Only selected diesel classes specify the optional coherent `motorSlots` signature (48–200).
Orbelune has 124: motor shaft 2.5 Hz gives MSR 310 Hz. Without that feature, catalog
`motorSlots` is absent, existing truth `motor.slots`/`motor.msrHz` are zero and no MSR family
is advertised/emitted; ordinary motor rotation harmonics remain as AUX lines. Motor power,
shaft rates and the existing truth shape are unchanged. No artificial 48-slot fallback.

Every sub has distinct HYDP metadata, with Brindleflux retaining 367.77 Hz; ship hydraulic
metadata likewise varies per fictional ship type. HYDP renders only as the m3-events manoeuvre transient (see below).
A seeded hash ordering of the fixed 22-class roster spaces HYDP design ranges and SWATH
bands so every pair has two non-overlapping keys; SWATH bands all fit below 500 Hz. This
assignment ignores input-list order and is configuration work only. All values are invented
teaching signatures, not real-vessel data or calibrated identification probabilities.

`classIds.test.ts` checks all 231 pairs, uniquely first-ranked midpoint observations through
the unchanged `matchClasses`, optional slots and the 310-Hz example, ship hydraulics,
class-specific auxiliary/gearing/SRC data, and independent-process determinism. Existing
physics/seed/row/worker tests continue to apply; no per-row allocation was introduced.

Window display labels are `SRC-1`, `SWATH-1` (numbered within each kind). The closed-form
truth regression covers all 22 classes x 12 seeded hull/variant draws x four speeds (1056
states), checking nominal CSR/CFR/EFR and every shaft's BR harmonics to absolute 1e-9.
Wandered `freqHz` is deliberately not substituted for nominal machinery rates in this test.

## RES 1–9 zoom-FFT LOFAR, vernier, NB/BB filters (m3-res)

Additive v1 extension. Public DSP/physics only (Harris 1978; Welch 1967; Struzinski & Lowe 1984;
Marsaglia & Tsang 2000; Lyons zoom-FFT); all platforms fictional, no real system modelled.
Modules: `src/res.ts` (table, band placement, EDOF, gamma draw, TPSW bias), `src/resGram.ts`
(`ResLofarGenerator`), Hann kernels in `src/lineKernel.ts` (`hannAmplitude`, `depositHannLine`,
`depositGaussianLine`).

| RES | Δf (Hz) | Band B=1024Δf (Hz) | T=1/Δf (s) | Row period P=max(2,T/4) (s) | K=P/(T/4) | Decimation 16384/(1.25B) | Welch EDOF ν | Noise model |
|---|---|---|---|---|---|---|---|---|
| 1 | 0.03125 | 32 | 32 | 8 | 1 | 409.6 | 2.000 | AR(1) Exp, ρ=0.4345 |
| 2 | 0.0625 | 64 | 16 | 4 | 1 | 204.8 | 2.000 | AR(1) Exp, ρ=0.4345 |
| 3 | 0.125 | 128 | 8 | 2 | 1 | 102.4 | 2.000 | AR(1) Exp, ρ=0.4345 |
| 4 | 0.25 | 256 | 4 | 2 | 2 | 51.2 | 2.788 | χ²_ν gamma |
| 5 (default) | 0.5 | 512 | 2 | 2 | 4 | 25.6 | 4.763 | χ²_ν gamma |
| 6 | 1 | 1024 | 1 | 2 | 8 | 12.8 | 8.879 | χ²_ν gamma |
| 7 | 2 | 2048 | 0.5 | 2 | 16 | 6.4 | 17.173 | χ²_ν gamma |
| 8 | 4 | 4096 | 0.25 | 2 | 32 | 3.2 | 33.791 | χ²_ν gamma |
| 9 | 8 | 8192 | 0.125 | 2 | 64 | 1.6 | 67.040 | χ²_ν gamma |

**Modeled chain.** 16384 Hz source → complex mix to the centre fc → lowpass → decimate to 1.25·B →
1280-pt Hann FFT → keep the centre 1024 bins. Bin k is at `fc + (k − 512)·Δf`, so fc is bin 512.
Rows are rendered analytically (no time series): ambient/broadband/swath PSD × ENBW (1.5·Δf Hz) per
bin; tonals deposit `v·|W(x)|²` with the peak-normalized Hann main lobe (|x|<2 bins,
`W(x)=sin πx / (πx(1−x²))`, scallop 1.42 dB, Σ|W|²=1.5) on the current Δf grid, so a tonal peaks
within ½ bin of its (Doppler-shifted) frequency. Diffuse lines use a Gaussian of σ = sigmaBins × 0.5 Hz
(reference bin), broadened by the Hann main lobe and normalized to the same 1.5 ENBW sum. A
test-only time-domain zoom-FFT (synthesize, mix, lowpass, decimate, Hann, DFT) agrees with the
analytic peak to <0.001 bin at every RES. Rows are rendered at the row instant (no intra-row sweep
smearing); adjacent-bin Hann noise correlation is not modelled.

**Noise statistics.** Harris amplitude overlap correlation `c(m)=Σw[n]w[n+mD]/Σw²` for hop D=N/4:
c(1)=0.659 (75 %), c(2)=0.167 (50 %), c(3)=0.0075, 0 beyond; power correlation ρ(m)=c(m)².
Welch (1967) EDOF for K averaged segments: `ν = 2K / (1 + 2 Σ_{m=1}^{K−1} (1 − m/K) ρ(m))`.
Bin power = expected × X, X ~ Gamma(ν/2, scale 2/ν) (unit-mean χ²_ν/ν, Marsaglia–Tsang, seeded,
allocation-free). When K=1 (RES1–3: P = T/4, consecutive rows are single 75 %-overlapped FFTs) rows
are **correlated**: complex bin amplitudes follow `z ← c·z + √(1−c²)·e`, e ~ CN(0,1), c = 0.659, so
|z|² stays Exp(1) and consecutive-row power correlation is c² = 0.4345 (the spec named RES1–2; RES3
also has K=1 by the same formula). K≥2 rows are drawn independently; their residual Welch row
correlation (0.17 at RES4, 0.07 at RES5, `welchRowCorrelation`) is neglected.

**Vernier / band limit.** No vernier → f0 = 0. With `vernierHz` (caller snaps it to the Δf grid):
f0 = fc − 512Δf; if the band would exceed the simulated fmax it slides down (Δf kept), if it would go
below 0 Hz it slides up; the actual `f0`/`fcHz` are reported (fcHz is always bin 512). A band wider
than fmax (e.g. RES9, or RES5 on the 500 Hz M1 scenario) clamps at f0 = 0: bins at/after `liveBins`
(`f0 + k·Δf > fmax`) are NaN in both `data` and `bearingDeg`, and `bandLimited:true`. fmax is never
raised (`scenario.fMax ?? scenario.fmax`).

**NB (default).** Per row, two-pass split-window mean (TPSW, Struzinski & Lowe 1984) over live bins:
window ±32 bins, centre gap ±3 bins (Hann main lobe ±2 + guard), pass-1 cells above 2.5 × pass-1 mean
are replaced by that mean, pass-2 mean divided by the analytic clip bias for χ²_ν noise
`b = P(ν/2+1, να/2) + 1 − P(ν/2, να/2)` (0.795 at ν=2 … 1.000 at RES8–9). Output
`10·log10(power / background)`; display `dbFloor 0, dbCeil 30`. A line 10 dB over background reads
≈9.5–9.7 dB (the line slightly raises its neighbours' pass-1 means; classic TPSW behaviour).
DIFAR: per-bin bearing exactly as fb2318b (σ = 20°/√SNR, uniform below 0 dB SNR).

**BB.** No normalization: absolute spectrum level `10·log10(mean power / (1.5Δf))` dB re 1 µPa²/Hz,
averaged over a 1/24-octave window centred on each bin (half-width round(f·(2^{1/48}−2^{−1/48})/(2Δf))
bins, prefix sums, allocation-free); display `dbFloor 40, dbCeil 110`. DIFAR: east/north/signal and
ambient powers are summed over the same window before atan2, and the same σ = 20°/√SNR model is
applied to the smoothed SNR.

### Contract (additive)

```ts
// subscribe: any of res/filter/vernierHz selects a RES gram (defaults res 5, 'NB', full band).
{type:'subscribe'; channel:number; kind?:'lofar'; res?:1|2|3|4|5|6|7|8|9; filter?:'NB'|'BB'; vernierHz?:number}
// change an existing LOFAR stream (legacy or RES); omitted fields keep current settings
// (legacy streams start from res 5/NB/full band); vernierHz:null → full band. Re-emits gramConfig.
{type:'setGram'; streamId:number; res?:ResLevel; filter?:'NB'|'BB'; vernierHz?:number|null}
// gramConfig for RES grams (legacy/DEMON configs omit the RES fields):
{v:1; type:'gramConfig'; simT; streamId; kind:'lofar'; channel; bins:1024; f0; fBin; rowRateHz /* 1/P */;
 dbFloor; dbCeil; res; filter; bandHz; fcHz? /* vernier only */; enbwHz; bandLimited; liveBins;
 rowPhaseS /* rows at k·P + rowPhaseS */}
```

`GramRows` layout is unchanged (`data` + `bearingDeg`, 1024 per stream).

**Row phase (`rowPhaseS`, additive).** To avoid every buoy's RES row falling on the same frame, each
RES stream's grid is shifted: rows are due at `t = k·P + rowPhaseS`. For the stream's buoy at index
i of N buoys (scenario order, so independent of subscribe order; N = buoy count when the stream is
subscribed or `setGram`'d), `rowPhaseS = floor(i·F/N)·0.25 s` with F = P/0.25 frames per period, i.e.
(i/N)·P quantized down to the 0.25 s worker frame (always 0 ≤ rowPhaseS < P). With N streams this
gives at most ceil(N·0.25/P)+1 RES rows per frame (32 buoys: 4 per frame at RES3+, 1 at RES1).
`setGram` re-phases the stream on its new P. The worker packs RES streams in one batch group per
(P, rowPhaseS). The phase only changes *when* a stream's generator runs, not its row sequence
(per-row seeded draws, AR(1) state carried row to row), so rows stay deterministic and seek replay
reproduces them (it re-applies settings at t=0 and counts the phased rows). Single-buoy scenarios
get rowPhaseS 0, i.e. the m3-res grid. The frontend places row n of a stream at
`rowPhaseS + k·P` (the `simT` of the batch that carries it). Engine API: `subscribe({channel,res?,filter?,vernierHz?})`, `setGram(streamId,patch)`,
`gramSettings(streamId)`; client: `subscribe(channel,opts)`, `setGram(streamId,opts)`. `setGram`
restarts the stream's row clock on the new P grid (engine row counter restarts; worker rowIndex stays
monotonic). Worker `seek` replays RES streams as if their settings were applied at t=0.

**Backward compatibility.** A plain `subscribe({channel})` and the worker's auto-subscribed init
streams keep the legacy 4 Hz analytic gram (`rowRateHz 4`, `fBin = fmax/(bins−1)`, 40–110 dB) that
existing tests and the frontend rely on; RES mode is opt-in per stream. No existing default changed.

**Benchmark** (`npm run bench`, 60 contacts × 32 buoys, catalog field, phased rows): legacy path
unchanged (≈34 ms/step legacy contacts, ≈46 ms catalog). Per 0.25 s frame, all 32 buoys subscribed:
RES5 NB mean 5.8–5.9 ms, worst 6.3–12.5 ms; RES5 BB mean 5.8–6.2 ms, worst 7.6–11.8 ms; RES1 NB mean
2.1–2.2 ms, worst 3.0–7.7 ms (ranges over two runs; worst-frame outliers are GC/JIT, p95 ≤ 8.7 ms).
Before phasing (b4dee75) the frame on which all 32 rows fell due cost ≈46 ms (RES5) / ≈72 ms (RES1).

## Seeded buoy-pattern planner (M3)

`planPattern(opts: PatternOptions): PatternPlan`, `PatternOptions`, `PatternPlan` and
`PatternKind` are exported from `src/index.ts`. Pure browser-safe geometry for preplanned,
AUTO and organized manual drops; no state changes or worker protocol additions.

```ts
const plan = planPattern({ kind: 'barrier', center: { x: 0, y: 0 }, axisDeg: 90,
  scatter: true, seed: 'training-field' });
// plan = { points: {x,y}[], types: ReceiverType[], channels: number[],
//          spacingM: number, detectionRangeM: number, kind: PatternKind }
// Host maps each entry to dropBuoy/addBuoy, supplying depth/life/IDs as usual.
// Worker dropBuoy uses kind='omni' for ReceiverType='passive-omni'.
```

Options: `kind: 'barrier'|'ring'|'grid'|'wedge'|'single'|'auto'`, `center:{x,y}` metres,
`axisDeg` degrees clockwise from north (+Y; x east), optional `count`, `spacingM`,
`scatter` (false), `seed:number|string`, `slDb`, `nlDb`, `diDb`, `dtDb`, `fHz`, `spreading`.
Resolved kind excludes auto; a finite threat axis gives **auto → barrier across axisDeg**.
A nonfinite auto axis falls back to a north-oriented ring; other kinds require finite axes.

Fictional training defaults (not real platform performance): **SL=140 dB re 1 µPa @ 1 m,
NL=60 dB in-band, DI=0 dB for every pattern (including DIFAR), DT=10 dB, f=200 Hz**.
DT is an illustrative conservative threshold. Callers may explicitly supply DIFAR DI
(e.g. 7.8 dB); receiver type alone does not silently change the range budget.
Solve `TL(R)=SL-NL+DI-DT` by 48 binary-search iterations in **1–30 km**, using the existing
`transmissionLoss` (including `thorp`) with planner-default **hybrid** spreading; spherical
and cylindrical may be selected explicitly. The underlying `transmissionLoss` function
still defaults to spherical; only the planner default changes. Hybrid transitions at the
existing 1000 m default: `20log10(1000)+10log10(R/1000)` beyond 1 km, plus absorption.
Out-of-budget ranges clamp to the endpoints, where equality cannot hold. These defaults
give FOM=**70 dB** and measured **R=9827.922764 m (about 9.83 km)** at 200 Hz, with
`TL(R)=70 dB`, rather than the estimated 8.5 km. The TL model and 1–30 km bounds are unchanged.

Spacing S defaults to 1.5R, except grid's specified √2R. Overrides clamp to
`[max(500,0.5R),3R]` (at least 500 m). Ring radius is always R, independent of S;
its returned spacingM is the planning/jitter scale, not its neighbor arc/chord distance.

- Barrier: five equally spaced sites centered perpendicular to the axis, DIFAR.
  At S=1.5R the ideal disk-overlap depth of field is about 1.3R.
- Ring: **six circumference sites only**, beginning on axisDeg, then clockwise every 60°;
  omni. Count overrides below five promote to five so neighbor arcs never exceed 1.5R.
  Larger overrides are honored; no center buoy is ever added.
- Grid: 3×3 with one axis along threat and the other perpendicular, √2R spacing (2R diagonals),
  omni. Other counts fill a near-square `ceil(sqrt(count))`-column grid row-major and
  recenter the occupied sites' centroid; explicit spacing overrides the √2R default.
- Wedge: **five total = one shared apex + two more per leg**. Apex is center +2R along
  threat axis. Legs extend **forward** from apex at axisDeg ±30°, with along-leg spacing S.
  Ordering is apex, +30° distance S, −30° distance S, +30° distance 2S, −30° distance 2S.
  Count overrides retain one apex then alternate legs (even counts leave one extra +30° site).
  DIFAR throughout.
- Single: exactly center, DIFAR; count must be one.

Counts must be integers in 1..9999. Scatter requires an explicit seed; independent Mulberry32
x/y draws add at most ±5% of S to each coordinate. This is a nominal spacing clamp, not a
post-jitter pairwise separation guarantee; arbitrary ring counts likewise control angular
spacing independently of S. Number seeds use uint32 conversion; strings use deriveSeed/FNV.
RF channels are unique **within this pattern**: sequential integers from a seed-derived
base in 1..9999 with wraparound, independent of the scatter stream. Omitted seed means zero
when scatter is off. Hosts must resolve conflicts with already-deployed channels themselves.
Invalid nonfinite inputs (except auto's absent axis), negative frequency, invalid count or
unknown kind/spreading throw RangeError. Inputs are not mutated; each result owns its arrays.

## m3-events behaviours v1 (dynamic SIM contacts)

**Training patterns only.** Every behaviour here is an invented, generic geometry (straight
legs, boxes, racetracks, reciprocals, zig-zags, sprint/drift) built to make traces move. None
describes or cites any real navy, platform, class, doctrine or measured signature; all
platforms and nations remain fictional.

```ts
type SurfaceBehaviour='shipping'|'fishing';
type SubBehaviour='transit'|'patrol'|'avoidance'|'combat';
planBehaviour({kind,seed,durationS,holdS?,start:{course,speed,depth,x?,y?},
  limits:{maxSpeedKn,quietSpeedKn?,minSpeedKn?,depthM:[lo,hi]}}): MotionLeg[]
maneuverTransients(legs,{courseDeg=10,depthM=5}?): {at,kind:'hydp',params:{}}[]
pickSubBehaviour(rng,weights=subBehaviourWeights); pickSurfaceBehaviour(rng,typeId)
checkBehaviourLegs(legs,limits,durationS?)   // throws on the first bad leg
subBehaviourLimits(klass,classParams,opState,scenarioParams,quiet): BehaviourLimits
refreshSurfaceSignature(params,typeId,speedKn)  // in-place ship signature for a new speed
```

Units match `MotionLeg`: course radians, `start.speed` m/s, depth m; limits are knots. Plans
are deterministic per `(kind, seed)`; leg 0 is the start at `at:0`, later `at` are strictly
increasing whole seconds `< durationS`, speeds in `[0,maxSpeedKn]`, depths in `depthM`
(`[d,d]` pins depth). No manoeuvre before `holdS`. After the last leg the contact holds it.

| kind | shape (invented) |
| --- | --- |
| shipping | 600–1500 s legs; 60 % alter 10–40°, else 1–4° trim; speed within ±0.5 kn |
| fishing | box / racetrack / loiter; 90–720 s legs; tow 2.5–4.5 kn, haul/drift 0.5–1.5 kn |
| transit | 900–2100 s legs; ≤25° alterations; 30 % depth change 10–40 m |
| patrol | box (≈90° same-hand) or reciprocal (≈180°); moderate speed near quiet; 60 % depth change |
| avoidance | steady run, then abrupt 70–150° turn + depth change (≥30 m where the band allows) at quiet speed (40 %: short sprint first), then quiet opening legs |
| combat | sprint (75–95 % max, 180–420 s) / drift (≤ quiet, 120–300 s) alternation with alternating 30–70° swings |

Generation: `BEHAVIOUR_HORIZON_S=3600` (60 min of legs).
- `generateScenario`: each classification-target sub draws a kind from its own seeded stream
  (`behaviour:i`, so traffic/class draws are unchanged) with `subBehaviourWeights`
  `{transit:30,patrol:35,avoidance:15,combat:20}` or optional `ScenarioParams.behaviourWeights`.
  `holdS:600` keeps the original CPA geometry exactly (CPA at 600 s), then legs diverge. Limits
  respect the class/mode caps (SURF/SNORK and surfaced boats keep their depth, AIP speed cap),
  the opState speed/depth bands, quiet draws and `cavitationAllowed:false`; every leg passes
  `validateOperatingState`. Contacts carry `behaviour` and `transients` from `maneuverTransients`.
- `createSurfacePool`: shipping vs fishing by seeded draw (`surface-behaviour:rank`) with
  fishing probability per type (trawler .85, tug .4, coastal freighter .1, ferry .05, bulk /
  tanker 0). Fishing ships start at tow speed. Ships keep their depth. The engine refreshes a
  ship's fictional signature in place when a leg changes its speed.
- Truth contacts expose optional `behaviour`.

### HYDP manoeuvre transient

A leg that turns ≥10° or changes depth ≥5 m schedules `{at,kind:'hydp',params:{}}` (optional
`durationS` 0.01..3600, `startOffsetPct` 0..20). When a contact's plant has `hydp` metadata,
the engine reserves two fixed tonal slots (`lineFamily:'HYDP'`, nominal and nominal +
pairSpacingHz), so the line topology never changes. During a transient the pair is
speed-independent and follows f = F·(1+δ·e^(−3τ/D)), with δ = 1.5 % by default and D = the
class `durationS`. Gain ramps up over 0.5 s and down over the final 1 s; otherwise the slots
carry zero power. The latest-started transient wins. `HYDP_POWER=.05` is an invented level,
about 2× an aux line. Contacts without scheduled transients have no HYDP slots.

Deferred: an event-scheme editor and Save-as-cut; waypoint legs; intermittent auxiliary
duty rendering; mode transitions (SNORK↔BATT etc.) within a run; HYDP on surface ships;
smooth turn and depth rates (legs still change instantly at `at`).

## Named LOFAR band presets (m3-bands)

Frozen training-band presets for the legacy 4 Hz analytic LOFAR path (fictional product labels;
not classified sonar band tables). Nested 0–fMax views keep bin 0 at DC:

| id | label | [f0, fMax] Hz | why |
| --- | --- | --- | --- |
| ELF | ELF | [0, 50] | very-low machinery / shaft training window |
| VLF | VLF | [0, 200] | shaft/blade + low plant region |
| LF | LF | [0, 500] | classic LOFAR; matches M1 scenario default |
| MF | MF | [0, 2000] | wider machinery/electrical training view |

```ts
import {LOFAR_BAND_PRESETS, resolveLofarBand, AcousticEngine} from '@sonar-sim/acoustics';
resolveLofarBand('ELF');                 // [0, 50]
resolveLofarBand([100, 300]);            // explicit edges
engine.subscribe({channel:1, bandPreset:'VLF'});
// Precedence: explicit `band` wins over `bandPreset` when both are given; bandPreset is
// stamped on gramConfig only when it alone supplied the edges.
engine.subscribe({channel:1, bandPreset:'ELF', band:[100,300]}); // f0=100, no bandPreset on config
```

Non-default buoy×band pairs share a refcounted `LofarGenerator` cache; unused combinations are
never constructed or rendered. `writeRow` still generates a row only for the drained stream.
`lofarBandPairs()` / `lofarBandCacheSize()` expose the active set for FE/tests. RES/NB/BB
(m3-res) is unchanged: `band`/`bandPreset` remain exclusive with `res`/`filter`/`vernierHz`.
Baseline (busy 60×32 legacy LOFAR, pre-change): ~33 ms mean/step; hot path not regressed.
