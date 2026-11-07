# Optional HYDP — merge notes (c778013 / hydp-band)

On this taxonomy tip, **~⅓ of classes omit HYDP** (`NO_HYDP` in `plantIdentity.ts`).
Any cut or scenario that *teaches* HYDP (rich, masked/drowned fundamental, lookalike-on-HYDP)
**must** use an HYDP-equipped class.

## c778013 `cut-russetwake-hydp-masked`

Branch `c778013` (`m3-acoustics-hydp-band`) ships `cut-russetwake-hydp-masked` on
`green-russetwake`. That class is **NO_HYDP** here.

**Recommended replacement class:** `green-morrowcoil`

| | c778013 | this branch |
|--|---------|-------------|
| Cut id | `cut-russetwake-hydp-masked` | `cut-morrowcoil-hydp-masked` |
| Class | `green-russetwake` (NO_HYDP here) | `green-morrowcoil` (HYDP ~304 Hz) |
| Teaching truth | fund drowned, harmonics visible | same (`hydpShape.drownFundamental`) |
| Nation colour | Green diesel | Green diesel (comparable) |

When merging c778013, retarget that cut (and any rich review twin) to `green-morrowcoil`
(or another equipped class with similar HYDP character). Do **not** keep `green-russetwake`
for HYDP lessons.

## Review fixtures / scripts

`acoustics/scripts/hydp-lfmf-review.mjs` renders LF/MF readability PNGs for:

- masked: `cut-morrowcoil-hydp-masked`
- rich: `review-morrowcoil-hydp-rich` (same class, fundamental live)

FE should re-run its readability check against the new fixtures after regenerating
into `/workspace/hydp-lfmf-review/` (filenames keep a `morrowcoil-hydp-*` prefix).
