# FE handoff: maneuver state, depth envelope, Lloyd qualifier, CZ, cut stream parity

Fictional teaching platforms only. Public physics (Urick; Mackenzie SSP already in `waterColumn`).

## Depth envelope (`depthEnvelopeFor(class)`)

| Field | Unit | Notes |
|-------|------|--------|
| `testDepthM` | m | = `params.depthM[1]` — never exceed |
| `maxOperatingDepthM` | m | ~85% of test |
| `typicalPatrolDepthM` | [m,m] | teaching patrol band |
| `periscopeDepthM` | m | diesel: `snorkelDepthM`; nuclear: 18 m |
| `surfacedKeelDepthM` | m | 0 |
| `diveRateMps` / `riseRateMps` | m/s | rate limits |
| `accelKnPerS` / `decelKnPerS` | kn/s | speed ramp |
| `turnRateRadPerS` | rad/s | rudder limit at `turnRateRefKn` |

Derived from existing catalog fields — **no `classes.ts` edit** (merge-safe vs c778013).

## Maneuver state machine (`ManeuverState`)

Commands: `setMode`, `setSpeedKn`, `setCourseRad`, `setDepthM`, `setClutch`.
Impossible commands → `commandStatus:'rejected'` + `rejectReason` (same pattern as drivetrain `commandStatus`). Live state held. `step(dt)` rate-limits toward orders. Edge events feed SWATH/TRANSIENT flashes via `edgeTransients`.

## Source gating (`sourceGateFor`)

| Mode | diesel/EDA | motor | reactor | indep aux | snort BB | wave-slap | cav depth suppress |
|------|------------|-------|---------|-----------|----------|-----------|--------------------|
| SURF (depth 0) | yes | if declutched | — | yes | — | yes | no |
| SNORK (≤ peri) | yes | if declutched | — | yes | yes | — | yes |
| BATT | — | yes | — | yes | — | — | yes |
| AIP | — | yes | — | yes | — | — | yes |
| NUC | — | — | yes | yes | — | — | yes |
| D/E | yes | yes | — | yes | — | — | yes |

EDAs follow engine (declutch keeps charging — see `d69a5c3`). Independent aux always on.

## Lloyd pass qualifier (`LloydPassTracker` / `lloydPassQualifier`)

Physical interference **always** uses live `zs`, `zr`, `r` (`nullSpacing` / `pathDifference`).
Truth flag:

```ts
lloyd: { symmetricPass: boolean; reasons: ('depthChange'|'courseChange'|'speedChange')[]; nullSpacingHz; ... }
```

When `symmetricPass===false`, FE must qualify CPA/range estimates (bat-wing no longer symmetric). State changes never reset FE history — tracker only accumulates reasons; caller starts a new tracker for a new pass.

## Convergence zone (`estimateConvergenceZone`)

Depends on **SSP + zs/zr + bottom**, not depth alone:

1. `c(zs)` from waterColumn SSP  
2. Critical depth = deep conjugate where `c` returns to `c(zs)` below the SOFAR axis  
3. Depth excess = bottom − critical; need ≥ 200 m teaching threshold  
4. Range ≈ 32.5 nmi (± stretch), Urick 30–35 nmi band  

**Limits:** not a ray/PE trace; no bathymetry refraction; parameterized skip distance. TODO: Munk/bilinear closed-form from live SSP curvature.

## Cut ↔ live stream parity (`SIM_STREAM_SET`)

Wilson: cuts offer the same tools as live sims (not continuous). Canonical set:

- `lofar/{ELF,VLF,LF,MF}/{NB,BB}` (8)
- `demon`
- `difarBearing`
- `waterColumn`
- `truth` (tactical + Lloyd + CZ for Doppler/Lloyd/CPA tools)

`liveSimStreamSet()` === `cutStreamSet()` === `SIM_STREAM_SET` (pinned by test).
`CutSession` attaches BT/SSP, exposes `tactical()`, `lloydTruth()`, `convergenceZone()`, `openStream(id)`, and a bounded `truthHistory` ring for synchronized 900 s tool history.
