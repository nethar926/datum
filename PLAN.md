# Sonar Sim — Project Plan (draft for Wilson)

Browser training tool for reading sonar grams as a **fictional maritime-patrol aircraft** acoustic operator (never named/styled as a real aircraft). Lays sonobuoy patterns; RF channels, battery, depth; tactical plot shows aircraft track, buoys, fixes. Ship/sub-mounted mode later. **Everything fictional** — invented platforms/nations/signatures. Physics: public textbook/Wikipedia only (spreading, Thorp, Wenz-style ambient, Doppler, generic blade/shaft harmonics, Lloyd’s mirror).

**Stack:** React + TypeScript + Vite · Canvas → **WebGL** waterfalls · Web Audio later · **Web Worker** signal engine · typed arrays · static build for **GitHub Pages** (`base` configurable).

**Team:** Project Lead coordinates · **Acoustics Physicist** owns signal/propagation/Doppler/Lloyd’s · **Display Frontend** owns grams, tactical plot, tools, quiz, design system.

**Physics core:** `/workspace/sonar-sim/acoustics/` (standalone TS: PRNG, kinematics/CPA, Doppler, Lloyd’s, TL, ambient, sources, receivers, LOFAR/DEMON, scenario schema). App consumes it; do not fork physics into `src/`. Any empty `src/signal/` stubs are discarded.

---

## Fictional data policy

No real class/hull/navy names or measured signatures. Contacts from made-up params. Invented nation/hull strings only. No classified freqs, ranges, or sensor performance. UI may evoke operator displays without copying proprietary/classified layouts.

---

## Design language

Sleek, “like Apple built it”: `system-ui` / SF-style type stack, generous spacing, refined dark chrome, subtle depth (soft shadows / hairline borders), smooth motion, precise controls. **Grams stay faithful to operator displays** (phosphor LOFAR/DEMON, dense monospace readouts, dark plot). Apple polish lives in chrome around them — toolbar, tactical plot frame, panels, typography — not in fake skeuomorphic sonar glass.

---

## Efficient acoustic processing

- Signal engine in a **Web Worker**; main thread = UI + WebGL only.
- **Typed arrays** + **preallocated buffers**; no per-frame heap alloc in the hot path.
- **Incremental** FFT / LOFAR row compute (one new row per sim tick, not full-history recompute).
- **WebGL texture scrolling** for waterfalls (ring texture / `texSubImage2D`), not CPU canvas pixel shifts at scale.
- **Perf budget (done-criteria):** ≥60 fps UI with **50+ contacts and 32 buoys** on a mid-range laptop; Worker frame time headroom logged. Ship a **perf benchmark** (automated or scripted) that fails CI/local check if budget is missed once the engine is wired.

---

## Robustness bar (“crazy robust”)

Seeded deterministic scenarios · thorough unit tests on acoustics models · graceful reject/clamp of bad inputs · `npm test` + `npm run build` (+ perf check when applicable) green every ship.

---

## Milestone table

| ID | Scope (one line) | Owner | Done when |
|----|------------------|-------|-----------|
| **M0** | Scaffold Vite app; wire `acoustics/`; Pages `base`; design tokens (dark system-ui chrome) | Project Lead · Frontend tokens | App builds; imports acoustics; PLAN approved |
| **M1 MVP** | Aircraft + omni & DIFAR + LOFAR (WebGL scroll) + Worker engine + 1 seeded scenario + basic tactical plot | Acoustics: spectra/scenario · Frontend: LOFAR/plot/controls | Seeded tonals on LOFAR; A/C+buoys on plot; unit tests green; Worker path live |
| **M2** | Buoy lifecycle (RF, battery, depth) + drop patterns (line/field/barrier) | Frontend (+ Acoustics schema) | Patterns drop; unique channels; dead buoy silent |
| **M3** | Perf hardening: buffer pools, incremental rows, benchmark harness | Acoustics · Frontend | Benchmark passes 50 contacts / 32 buoys @ ≥60 fps UI |
| **M4** | Spectrum slice + harmonic cursors | Frontend | Cursor + N·f marks |
| **M5** | Doppler → radial speed tool (truth toggle) | Acoustics · Frontend | Δf → v ≈ `f·v/c` (c≈1500) in tests |
| **M6** | DEMON display (WebGL) | Acoustics DEMON · Frontend | Blade-rate lines on seeded contact |
| **M7** | Bearing-time from DIFAR | Acoustics · Frontend | BTR matches scenario bearings |
| **M8** | Active DICASS-style + A-scan | Acoustics · Frontend | Ping/echo range on A-scan |
| **M9** | VLAD-style VLA (generic) + BT / simple SVP | Acoustics · Frontend | SVP affects TL sketch; VLA selectable |
| **M10** | Lloyd’s mirror / multipath helpers | Acoustics · Frontend | Nulls match model tests |
| **M11** | CPA estimation aid | Acoustics · Frontend | CPA vs scenario truth |
| **M12** | Quiz/practice scoring | Frontend (+ Acoustics truth) | Scored seeded run |
| **M13** | Polish: Web Audio listen-through, motion polish, Pages deploy, docs | Both · Lead | Hosted demo URL; small pushes |

After M1, prefer thin increments; M3 may slip earlier if LOFAR janks.

---

## Open questions for Wilson

1. Approve this plan / milestone order?
2. GitHub repo name + Pages base (`/` vs `/sonar-sim/`)?
3. After M1: buoy patterns (M2), perf (M3), or DEMON (M6) first?
4. Default LOFAR band (0–500 Hz vs 0–1 kHz)?
