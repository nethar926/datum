# Convergence zone (teaching approximation)

Public acoustics only (Urick, *Principles of Underwater Sound*; Jensen et al., *Computational Ocean Acoustics* overview). Fictional platforms; no navy CZ tables.

## What we compute

`estimateConvergenceZone({ profile, zsM, zrM, bottomDepthM? })` returns a `ConvergenceZoneEstimate`:

| Field | Meaning |
|-------|---------|
| `possible` | True only when depth excess ≥ `CZ_MIN_DEPTH_EXCESS_M` (200 m) |
| `criticalDepthM` | Deep conjugate depth where `c(z)` returns to `c(zs)` below the SOFAR axis |
| `depthExcessM` | `bottomDepth − criticalDepth` |
| `rangeM` / `rangeNmi` | First-CZ skip distance (~30–35 nmi teaching band) or null |
| `note` | Human-readable limit for FE chrome |

## Method (not a ray trace)

1. Sample sound speed at source depth `zs` from the BT/SSP water column (`buildWaterColumn` / Mackenzie `c(T,S,D)`).
2. Find the deep critical depth below the sound-channel axis where `c` rises back to `c(zs)`.
3. Depth excess = bottom − critical. CZ is flagged only when excess ≥ 200 m.
4. Range is a parameterized skip: default **32.5 nmi** (~60 km), weakly stretched for large excess. Band constants: `CZ_RANGE_NMI_BAND = [30, 35]`.

This is **not** a PE/ray solution. Limits: no multipath CZ annulus width, no bathymetric blockage beyond the single bottom depth, no frequency dependence beyond the teaching TL elsewhere.

## FE / live use

Live `AcousticEngine` / `CutSession` attach CZ next to Lloyd pass truth. Geometry uses live `zs`, `zr`; water column is the scenario profile (synthetic unless a `SOURCES` entry names a measured dataset).

## Related

- `src/convergenceZone.ts` — implementation
- `src/lloydPass.ts` — CPA Lloyd qualifier (separate from CZ)
- `docs/sources.md` — citations (`urick-pous`, `jensen-coa`, `mackenzie-1981`)
