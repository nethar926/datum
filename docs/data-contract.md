# Worker ⇄ Display data contract (v1, agreed)

Agreed 2026-11-05 by Display Frontend and Acoustics Physicist. Doc only; building waits on Wilson's plan approval.

## Principles
- The Worker owns sim time and all physics (`acoustics/`). The main thread only renders and sends commands.
- Hot-path payloads are transferable `ArrayBuffer`s from a fixed pool. The engine fills them in place with `engine.writeRow(streamId, out, offset)`; the display returns each buffer after upload (`release`). No per-row allocation or copy on either side. Lookup tables (window, twiddles, absorption, ambient per bin) are rebuilt only on config or environment change.
- Every message has `v` (contract version), `type`, and `simT` (sim seconds, float64).
- Units: frequency Hz; LOFAR level **dB re 1 µPa²/Hz** (received spectrum level); DEMON level dB relative to the stream's median; bearings degrees true 0–360 (float, modeled error, not quantized); positions metres in a local ENU frame (x east, y north); speed m/s; time s.

## 1. Stream config (Worker → Display, on start and on change)
```ts
type GramConfig = {
  v: 1; type: 'gramConfig'; streamId: number;
  kind: 'lofar' | 'demon' | 'bearing';   // 'bearing' = azigram (optional)
  channel: number;                        // buoy RF channel
  bins: number;                           // fixed for the stream's life; change = new streamId
  f0: number; fBin: number;               // bin k centre = f0 + k*fBin
  rowRateHz: number;                      // rows per sim second (1–4)
  dbFloor: number; dbCeil: number;        // default display range (display may auto-normalize)
  demodBandHz?: [number, number];         // DEMON only, default [1000, 4000]
};
```
Defaults:
| kind | bins | band | fBin | dbFloor / dbCeil |
|---|---|---|---|---|
| lofar (default) | 2048 | 0–1000 Hz, display zoomable | ≈0.488 Hz | 40 / 110 |
| lofar (wideband option) | 2048 | 0–2000 Hz | ≈0.977 Hz | 40 / 110 |
| demon | 512 | 0–100 Hz | ≈0.195 Hz | 0 / 30 |
| bearing (azigram) | same as its LOFAR stream | | | values are degrees, not dB |

## 2. Gram rows (Worker → Display, hot path)
Batched per tick across all live streams.
```ts
type GramRows = {
  v: 1; type: 'gramRows'; simT: number;
  streamIds: Int32Array;    // n entries
  rowIndex: Uint32Array;    // monotonic per stream; gaps = dropped rows
  data: Float32Array;       // n * bins, packed in streamIds order
};
// transfer list: [streamIds.buffer, rowIndex.buffer, data.buffer]
```
- `NaN` = no data (dead buoy, out of band, or azigram bin below threshold); drawn as a gap colour.
- Display uploads each row via `texSubImage2D` into a ring texture, then posts `{type:'release', buffers}`.

## 3. Tactical (Worker → Display, ~2–5 Hz plus on change; structured clone)
```ts
type BuoyKind = 'omni' | 'difar' | 'dicass' | 'vlad' | 'bt';
type Tactical = {
  v: 1; type: 'tactical'; simT: number;
  aircraft: { x: number; y: number; altM: number; hdgDeg: number; gsMps: number };
  buoys: { id: number; channel: number; kind: BuoyKind;
           x: number; y: number; hydrophoneDepthM: number;
           batteryFrac: number; lifeRemainingS: number;
           state: 'falling' | 'live' | 'dead' }[];
  bearings: { buoyId: number; freqHz: number; brgDeg: number; quality: number }[];
  // DIFAR: strongest K ≤ 8 lines per buoy per tick; quality = line SNR in dB
  truth?: { contacts: { id: number; x: number; y: number; crsDeg: number; spdMps: number }[] };
  // only when scenario/quiz allows; hidden in the UI by default
};
```

## 4. Sound-speed profile (Worker → Display, low rate, from `bt` buoys)
```ts
type Ssp = { v: 1; type: 'ssp'; simT: number; buoyId: number; depthM: Float32Array; cMps: Float32Array };
```

## 5. Commands (Display → Worker)
`init {seed, scenarioId}`, `play`, `pause`, `setRate {x}`, `seek {simT}`, `dropBuoy {...}`, `subscribe {channel, kind, bins?, band?, demodBandHz?}`, `unsubscribe {streamId}`, `release {buffers}`.

## 6. Scope now vs later
Built first (M1): omni and DIFAR, LOFAR 0–1 kHz default with 0–2 kHz wideband, tactical. Wideband LOFAR, DEMON, azigram, dicass, vlad, bt/ssp are in the contract so the format is stable, but wait for the approved plan.

## 7. Performance
Target 50+ contacts, 32 buoys, ≥60 fps UI (PLAN M3). 32 LOFAR streams × 2048 bins × 4 Hz ≈ 1 MB/s of Float32; fine to transfer.
