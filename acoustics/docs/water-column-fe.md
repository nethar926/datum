# FE handoff: `scenario.waterColumn` (BT / SSP)

Paired bathythermograph (BT) and sound-speed profile (SSP) arrays for graphing on a shared depth axis. Fictional mixed-layer / thermocline shape — training only.

## Citation

K. V. Mackenzie, “Nine-term equation for sound speed in the oceans,” *J. Acoust. Soc. Am.* **70**(3), 807–812 (1981). DOI: [10.1121/1.386920](https://doi.org/10.1121/1.386920).

Public summary / calculator (NPL Technical Guides — Speed of Sound in Sea-Water):  
http://resource.npl.co.uk/acoustics/techguides/soundseawater/

**Stated validity used here:** temperature **−2 to 30 °C**, salinity **25 to 40 ppt**, depth **0 to 8000 m**.

Note: the JASA abstract lists T −2…30 °C and S 30…40 ppt; the NPL guide table lists T 2…30 °C and S 25…40 ppt (same depth band). DATUM enforces the union Lead specified (−2…30 °C, 25…40 ppt, 0…8000 m). A formula self-check at T=0 °C (constant term 1448.96 m/s) only verifies the arithmetic of the nine-term equation — it does **not** establish the validity domain.

## Where it lives

- `Scenario.waterColumn?: WaterColumnProfile` (set by `generateScenario` / `attachWaterColumn`)
- `Scenario.environment.temperatureC` / `salinityPsu` / `soundSpeed` — scalars; `soundSpeed` is near-surface Mackenzie matching `waterColumn.soundSpeedMps[0]`

## Fields (units)

| Field | Unit | Notes |
|-------|------|--------|
| `depthM` | m | `Float64Array`, shallow → deep |
| `temperatureC` | °C | BT curve (clamped into Mackenzie T) |
| `soundSpeedMps` | m/s | SSP via Mackenzie |
| `mixedLayerDepthM` | m | isothermal mixed layer |
| `thermoclineBaseM` | m | base of thermocline |
| `salinityPsu` | ppt (PSU) | **constant with depth** |
| `salinityAssumption` | `'constant'` | no S(z) profile in M3 |
| `mackenzieValid` | ranges | echoed validity domain |
| `outOfRange` | flags | `{temperature,salinity,depth,any}` |

## Salinity assumption

- **Default:** `35` ppt (`DEFAULT_SALINITY_PSU`)
- **Profile:** constant with depth — one scalar applied at every sample (not a salinity profile)
- Generated scenarios seed ~34–35.5 ppt from the scenario seed

## Validity + clamping

| Quantity | Range |
|----------|-------|
| Temperature | **−2…30 °C** |
| Salinity | **25…40 ppt** |
| Depth | **0…8000 m** |

Out-of-range **request** inputs are clamped into this domain for the equation and flagged on `outOfRange.*` / `outOfRange.any`. Acoustics never silently extrapolates.

## FE graph tips (FE owns rendering)

1. Plot `temperatureC` vs `depthM` (BT) and `soundSpeedMps` vs `depthM` (SSP) on the shared axis.
2. Mark `mixedLayerDepthM` / `thermoclineBaseM` if useful.
3. **Clamped values must be visibly marked in the plots** (e.g. highlight, hatch, or annotation on samples / axes that were out of range before clamp). Use `outOfRange` to drive the cue; do not leave a clamped profile looking like an in-range measurement.
4. If `outOfRange.any`, also surface a warning in chrome.
5. BT buoy chrome / type picker remains FE-owned; acoustics only supplies the arrays.

## Exports

`buildWaterColumn`, `attachWaterColumn`, `DEFAULT_SALINITY_PSU`, `MACKENZIE_VALID`, `mackenzieOutOfRange`, `soundSpeed`.
