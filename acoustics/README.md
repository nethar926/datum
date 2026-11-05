# Fictional acoustic training core

Owner: Wilson Nicklaus. Standalone, private browser-safe TypeScript/ESM package. All platforms,
labels, source levels, frequencies and performance curves are **invented training data**;
none represents a real vessel or sensor. Default operator is in a generic fictional maritime
patrol aircraft laying passive buoy patterns.

## Run

```sh
cd acoustics
npm install
npm test
npm run typecheck
npm run build
npm run bench
```

No runtime dependencies. Build emits ESM and declarations into ignored `dist/`.
31 original physics tests expanded to 39 tests covering the agreed M1 contract. The benchmark
warms 12 steps then measures 200 full 60-contact × 32-buoy × 1024-bin steps, mean/p95;
no timing assertion. Multi-contact `busyScenario()` is a test/benchmark fixture, not another
worker scenario or a platform catalog. No preview PNG is generated.

## API

`src/index.ts` exports the compact modules: seeded `mulberry32`, `gaussian`, `deriveSeed`;
unit/dB helpers and `soundSpeed`; `geometry`, `advance`; exact/approximate Doppler;
Lloyd image-source gains/null helpers; geometric/absorptive loss; ambient/source models;
buoy lifecycle and `difarBearing`; `LofarGenerator`; `FFT`, `Demon`, `ContactSynth`;
versioned scenarios/validation; `AcousticEngine`, `WorkerRuntime`, `AcousticClient` and
contract types. No DOM is touched until a client/worker is instantiated.

```ts
import { AcousticEngine, cpaScenario } from './src/index.js';
const engine = new AcousticEngine(cpaScenario());
const packed = new Float32Array(1024); // caller allocates once
engine.advance(0.25);
engine.writeRow(1, packed, 0);         // no copy or row allocation
// Alternative test/benchmark convenience:
const rows = engine.step(0.25);       // same array/descriptors/buffers each call
```

`writeRow(streamId, out, offset)` fills exactly `bins` values. Initial streams map buoy order
to IDs 1..N; `registerStream(id, channel)` binds subscriptions. `addBuoy` validates/creates
receivers at command time. `setEnvironment` rebuilds ambient/absorption tables. The engine
owns a cloned scenario; `advance` mutates only that copy. LOFAR levels are **dB re 1 µPa²/Hz**;
tonals deposit integrated power divided by bin width. Frequencies include endpoints
(1024 bins, 0..500 Hz, spacing 500/1023). Rows from dead/not-yet-deployed buoys are **NaN**,
as required by the display contract; modeled live spectra remain finite. This overrides the
original blanket no-NaN requirement only for explicit no-data values.

## Worker contract v1 / integration

Matches `../docs/data-contract.md` M1. Every message has `v:1`, `type`, `simT` in seconds.
For Vite source integration, pass a worker explicitly (the default client URL targets built ESM):

```ts
import { AcousticClient } from './acoustics/src/client';
const worker = new Worker(new URL('./acoustics/src/worker.ts', import.meta.url), { type: 'module' });
const client = new AcousticClient(worker, message => {
  if (message.type === 'gramRows') {
    // Upload packed rows before releasing; subarray views are optional, no copy required.
    client.release(message); // transfers all three ArrayBuffers back; views are detached
  }
});
client.init(42, 'cpa-pass');
client.play();
```

Paths above are illustrative from repo root; adjust relative URLs to the importing file.

- `init {seed,scenarioId:'cpa-pass'}` emits `gramConfig` for default buoy subscriptions and
  `tactical`; does not start the clock. LOFAR: 1024 bins, 0..500 Hz, 4 rows/s, display 40..110 dB.
- `play`, `pause`, `setRate {x}` (0.1..64), `seek {simT}`. Clock ticks every 250 ms wall time,
  rows remain spaced at 0.25 sim seconds at every rate. Seek pauses and replays the seeded
  default scenario, 0..3600 s; seek after buoy drops explicitly errors (future event log needed).
- `dropBuoy {id?,channel,kind:'omni'|'difar',x,y,hydrophoneDepthM,lifeS?}` (default life 7200 s).
  `subscribe {channel,kind:'lofar',bins?:1024,band?:[0,500]}` then emits stream config;
  `unsubscribe {streamId}` removes it. RF channels are unique. A drop does not auto-subscribe.
- `gramRows {streamIds:Int32Array,rowIndex:Uint32Array,data:Float32Array}` packs N×1024 floats
  in stream order, transferring `[streamIds.buffer,rowIndex.buffer,data.buffer]`. Indexes start
  at 0, increase monotonically per stream; buffer starvation drops rows with index gaps, while
  still advancing time and seeded fluctuations. Three full batches are pooled. Release with
  `{v:1,type:'release',simT,buffers:[idsBuffer,indexBuffer,dataBuffer]}` after upload. Return whole
  batches in this order; stale-size/config returns are discarded. Config changes may allocate;
  row generation/ticks do not allocate sample arrays. Releasing rewraps returned buffers in views.
- `tactical` emits aircraft ENU position/heading/groundspeed (fixed illustrative altitude 300 m),
  buoy position/channel/depth/battery/state and strongest K≤8 DIFAR lines per buoy:
  `{buoyId,freqHz,brgDeg,quality}`; quality is modeled line SNR dB. Buoy numeric IDs map
  `buoy-N` scenario IDs. Truth is omitted. Tactical updates at each clock tick and changes.
- `error {message}` is a diagnostic extension. Pending kinds (`dicass`, `vlad`, `bt`), SSP,
  wideband, azigram and worker DEMON subscriptions explicitly reject/are not implemented.
  DEMON DSP is an isolated tested primitive only, not an M1 stream feature.

## Scenario v1

`Scenario.v=1`; JSON-safe seed, environment, track/aircraft, contacts and buoys. Each contact
has `params` (fictional acoustic knobs, ready for a later catalog adapter) and a nonempty
ordered `motion` list `{at,course,speed,depth}` starting at time zero. The first leg initializes
motion; later legs change course/speed/depth at exact boundaries. Position is in the contact's
initial track. Courses radians clockwise from north; x east/y north and depth metres down;
speed m/s. Timed legs extend naturally to later waypoints. `waypoint` and `transients` are
reserved typed fields: waypoint entries/nonempty transients reject until implemented.
No M2 catalog or real signatures are included. Validation bounds contact count 250,
buoy count 128, depths 0..1e6 m (stress testing, not physical validity), bins 2..16384;
malformed/nonfinite numeric inputs reject. Worker M1 subscriptions remain fixed 1024 bins.

## Physics and limitations

- Relative motion/CPA is straight-line constant velocity within each leg, with zero-range and
  zero-relative-speed guards. CPA can be in the past. Exact Doppler uses
  `f' = f (c+v_receiver)/(c-v_source)` with both radial velocities positive toward the other
  endpoint; `f(1+(v_receiver+v_source)/c)` is the low-speed approximation. Exact frequency
  shifts are not perfectly symmetric about f; inverse frequency and radial velocity are symmetric.
- Lloyd: `R1=hypot(r,zs-zr)`, `R2=hypot(r,zs+zr)`, field normalized to direct path is
  `1-(R1/R2)exp(i 2πf(R2-R1)/c)` (surface reflection -1). Unequal path spreading leaves a
  small residual at destructive phase; exact phase minima satisfy `R2-R1=n c/f`. Far field:
  gain `4 sin²(2πf zs zr/(c r))`, `r_n≈2f zs zr/(nc)`, `df≈c r/(2zs zr)`.
  Tests locate exact minima numerically and separately check far-field convergence (<1%).
  Max gain ≤4 (6.0206 dB). No bottom reflections, refraction/rays, bathymetry or ducting.
- Spreading is spherical `20log10(max(R,1))`, cylindrical `10log10(max(R,1))`, or hybrid
  spherical to a chosen transition then cylindrical. Thorp absorption adds dB/km × (R−1)/1000,
  keeping the received/source reference exactly 0 dB loss at 1 m. The Thorp fit uses f in kHz:
  `0.11f²/(1+f²)+44f²/(4100+f²)+2.75e-4f²+0.003`.
- Wenz/Knudsen-style ambient is a smooth illustrative power sum of turbulence, shipping,
  wind/sea-state and thermal components. It decreases across the ordinary 1..10 kHz wind band;
  thermal noise eventually rises at high frequency. Not an empirical calibration.
- Invented source curves contain shaft/blade lines, four machinery harmonics, smooth broadband,
  speed-dependent level and pressure-inspired depth-dependent cavitation inception. Per-contact
  seeded gain is fixed. Tonals apply Doppler, absorption and exact Lloyd gain; broadband applies
  spreading/absorption but not coherent mirror fringes or Doppler warping. Tone deposition uses
  two adjacent bins, not a full sampled FFT leakage model. Contacts sum incoherently. Independent
  exponential/chi-square (2 DOF) fluctuations model periodogram power, not correlated ocean noise.
- DIFAR primitive computes atan2 of omni×east and omni×north cross terms. Per-line worker
  bearings use true geometry plus seeded SNR-dependent Gaussian angular error, not full sampled
  dipole propagation or ambiguous multi-source localization. Strongest lines only, no classifier.
- DEMON standalone: square-law detection, four one-pole low-pass sections, DC removal, Hann,
  radix-2 FFT; test synth uses square-root AM of an acoustic carrier plus seeded noise. Block
  envelope processing is independent (not a streaming filter-bank). Its spectrum is linear power;
  future stream adapter must normalize to median-relative dB per contract.
- Mackenzie temperature/salinity/depth clamps to published validity bounds. Default c=1500 m/s;
  configured environment uses constant c, not an SSP. Seed+scenario+call schedule yields identical
  row bytes within the same JS runtime; cross-engine transcendental bit equality is not promised.

## Public references

Doc comments cite public/unclassified textbook physics only:
Urick, *Principles of Underwater Sound*, 3rd ed. (1983);
Kinsler, Frey et al., *Fundamentals of Acoustics*, 4th ed. (2000);
Jensen et al., *Computational Ocean Acoustics*, 2nd ed. (2011);
Wenz, “Acoustic Ambient Noise in the Ocean: Spectra and Sources,” JASA 34 (1962), 1936–1956;
Knudsen, Alford & Emling, “Underwater Ambient Noise,” J. Marine Research 7 (1948), 410–429;
Thorp, “Analytic Description of the Low-Frequency Attenuation Coefficient,” JASA 42 (1967), 270;
Mackenzie, “Nine-term equation for sound speed in the oceans,” JASA 70 (1981), 807–812.
PRNG: public Mulberry32; Gaussian: Box–Muller (1958); FFT: Cooley–Tukey (1965).
