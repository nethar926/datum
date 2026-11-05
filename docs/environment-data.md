# Environment & map data sources (public / free)

Research for a static GitHub Pages app (browser CORS or pre-baked assets). Platforms/forces stay fictional; ocean/weather/map are real public data. Not for navigation.

| Layer | Recommended source | Licence | Commercial OK? | CORS / browser | Attribution | Approach + size |
|-------|-------------------|---------|----------------|----------------|-------------|-----------------|
| **Basemap / coastlines** | **OpenFreeMap** + MapLibre GL JS (`https://tiles.openfreemap.org/styles/dark` or liberty); alt: self-host Natural Earth vector tiles / PMTiles on Pages | OSM **ODbL**; OpenFreeMap MIT; Natural Earth public domain | Yes (OSM ODbL + attr) | Yes (public tiles, no key) | Required: OpenStreetMap (+ OpenFreeMap / OpenMapTiles). Natural Earth: optional “Made with Natural Earth” | **Live tiles** via OpenFreeMap (no key). Offline/fallback: bake Natural Earth z0–6 PMTiles (~4–20 MB) — note Pages can break HTTP Range; prefer same-origin small z/x/y set or CDN with Range. |
| **Bathymetry** | **GEBCO** grid (public domain); optional ETOPO 2022 (NOAA, free) | GEBCO: public domain + **must acknowledge**; not for nav. ETOPO: free private/academic/commercial + cite | Yes | WMS exists (`https://wms.gebco.net/mapserv?`) — CORS to browser **unreliable**; full grid too large to fetch live | Yes (GEBCO / NOAA ETOPO per product docs) | **Pre-bake** coarse depth grid (e.g. 0.25°–1° Float32 global ≈ **1–8 MB** gzipped) into `public/env/`. Optional GEBCO WMS as visual overlay only when CORS works. Full 15″ GEBCO = multi‑GB — do not ship. |
| **T/S → SSP** | **WOA23** (NOAA NCEI) T & S climatology; compute sound speed in-app with **UNESCO / Mackenzie** (textbook) or TEOS‑10 if we vendor a tiny pure‑TS port | WOA: NOAA open data (treat as free/public; cite NOAA/NCEI). Equations: public domain textbooks | Yes | Direct NetCDF from NCEI is **not** CORS-friendly for browsers | Cite NOAA WOA23 | **Pre-bake** monthly (or seasonal) SSP or T+S at 1° (or 5° fallback) × standard depths → JSON/binary in `public/env/` (~**5–40 MB** depending on resolution/months; start with 1° seasonal ≈ **5–15 MB**). No live fetch. Copernicus Marine: richer but **account + token** — avoid for Pages MVP. |
| **Marine weather** | **Open-Meteo** Weather + Marine APIs (wind, waves, precip → sea state / rain for Wenz ambient) | Data **CC BY 4.0**; free tier **non-commercial** only | Free tier **No**; paid plan **Yes** (+ key) | **Yes** (CORS, no key on free tier) | Required (“Weather data by Open-Meteo.com” + model credits) | **Live fetch** when online for training demos. **Fallback:** pre-baked Wenz sea-state table + seeded synthetic weather. **Blocker if product is commercial:** need Open-Meteo subscription or drop live weather. |

## SSP equations (public)

- Mackenzie (1981) empirical: \(c = f(T, S, D)\) — simple, fine for training.
- UNESCO / Chen–Millero (or TEOS-10 `gsw_sound_speed`) — more accurate; prefer if Acoustics vendors a small tested implementation.
- Optional reference product: NCEI Accession 0290599 (WOA23-derived acoustic params) — cite if used.

## Offline fallback (required)

If live tiles/API fail: Natural Earth (or cached) basemap + pre-baked GEBCO-coarse bathymetry + pre-baked WOA climatology SSP + **seeded synthetic** wind/sea-state/rain. Randomized/planner scenarios remain reproducible via seed even offline.

## Blockers / watch-outs

| Item | Risk | Mitigation |
|------|------|------------|
| Open-Meteo free = non-commercial | Commercial hosting/ads need paid plan + API key | Document; use climatology/synthetic until decided |
| Copernicus Marine | Free account + token; not ideal for keyless Pages | Skip for MVP; WOA pre-bake instead |
| GEBCO/ETOPO WMS CORS | May fail from browser | Pre-bake numeric grid; WMS optional |
| PMTiles on GitHub Pages | Range-request issues on some CDNs | Prefer OpenFreeMap live or discrete z/x/y tiles |
| MapTiler / Stadia free tiers | API keys, quotas | Avoid; OpenFreeMap has no key |
| Attribution UI | OSM + GEBCO + NOAA + Open-Meteo | Single Apple-clean credits strip on tactical plot |

## URLs (quick)

- OpenFreeMap: https://openfreemap.org/ · styles e.g. `https://tiles.openfreemap.org/styles/dark`
- MapLibre GL JS: https://maplibre.org/
- Natural Earth: https://www.naturalearthdata.com/
- GEBCO data/terms: https://www.gebco.net/data-products/gridded-bathymetry-data · https://www.gebco.net/data-products/gridded-bathymetry/terms-of-use
- GEBCO WMS: https://wms.gebco.net/mapserv?
- ETOPO 2022: https://www.ncei.noaa.gov/products/etopo-global-relief-model
- WOA23: https://www.ncei.noaa.gov/products/world-ocean-atlas
- Open-Meteo Marine: https://open-meteo.com/en/docs/marine-weather-api · Weather: https://open-meteo.com/en/docs · Terms: https://open-meteo.com/en/terms
