# FE handoff: `scenario.waterColumn` (BT / SSP)

Paired bathythermograph (BT) and sound-speed profile (SSP) arrays for graphing on a shared depth axis. Physics: Mackenzie (1981) nine-term equation (`soundSpeed` in `units.ts`). Fictional mixed-layer / thermocline shape — training only.

## Where it lives

- `Scenario.waterColumn?: WaterColumnProfile` (set by `generateScenario` / `attachWaterColumn`)
- `Scenario.environment.temperatureC` / `salinityPsu` / `soundSpeed` — scalars; `soundSpeed` is near-surface Mackenzie matching `waterColumn.soundSpeedMps[0]`

## Fields (units)

| Field | Unit | Notes |
|-------|------|--------|
| `depthM` | m | `Float64Array`, shallow → deep |
| `temperatureC` | °C | BT curve |
| `soundSpeedMps` | m/s | SSP via Mackenzie |
| `mixedLayerDepthM` | m | isothermal mixed layer |
| `thermoclineBaseM` | m | base of thermocline |
| `salinityPsu` | ppt (PSU) | **constant with depth** |
| `salinityAssumption` | `'constant'` | no S(z) profile in M3 |
| `mackenzieValid` | ranges | echoed published domain |
| `outOfRange` | flags | `{temperature,salinity,depth,any}` |

## Salinity assumption

- **Default:** `35` ppt (`DEFAULT_SALINITY_PSU`)
- **Profile:** constant with depth — one scalar applied at every sample (not a salinity profile)
- Generated scenarios seed ~34–35.5 ppt from the scenario seed

## Mackenzie (1981) validity (enforced)

| Quantity | Range |
|----------|-------|
| Temperature | **−2…30 °C** (published JASA; Lead note said 2–30 — we keep −2 so the T=0 self-check holds) |
| Salinity | **25…40 ppt** |
| Depth | **0…8000 m** |

Out-of-range request inputs are **clamped** into this domain for the equation and flagged on `outOfRange.*` / `outOfRange.any`. Do not extrapolate in the UI; prefer showing the flag or clamping the cursor.

## FE graph tips

1. Plot `temperatureC` vs `depthM` (BT) and `soundSpeedMps` vs `depthM` (SSP) on the shared axis.
2. Mark `mixedLayerDepthM` / `thermoclineBaseM` if useful.
3. If `outOfRange.any`, surface a warning (inputs were outside Mackenzie before clamp).
4. BT buoy chrome / type picker remains FE-owned; acoustics only supplies the arrays.

## Exports

`buildWaterColumn`, `attachWaterColumn`, `DEFAULT_SALINITY_PSU`, `MACKENZIE_VALID`, `mackenzieOutOfRange`, `soundSpeed`.
