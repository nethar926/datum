# Sonar Sim — Project Plan (draft for Wilson)

Browser training tool for reading sonar grams as a **fictional maritime-patrol aircraft** acoustic operator (never named/styled as a real aircraft). Lays sonobuoy patterns; RF channels, battery, depth; tactical plot shows aircraft track, buoys, fixes. Ship/sub-mounted mode later. **Everything fictional** — invented platforms/nations/signatures. Physics: public textbook/Wikipedia only (spreading, Thorp, Wenz-style ambient, Doppler, generic blade/shaft harmonics, Lloyd’s mirror).

**Stack:** React + TypeScript + Vite · Canvas → **WebGL** waterfalls · Web Audio later · **Web Worker** signal engine · typed arrays · static build for **GitHub Pages** (`base` configurable).

**Team:** Project Lead coordinates · **Acoustics Physicist** owns signal/propagation/Doppler/Lloyd’s/platform generator · **Display Frontend** owns grams, tactical plot, tools, quiz, design system, platform-card / planner UI.

**Physics core:** `/workspace/sonar-sim/acoustics/` (standalone TS: PRNG, kinematics/CPA, Doppler, Lloyd’s, TL, ambient, sources, receivers, LOFAR/DEMON, scenario schema, platform generator). App consumes it; do not fork physics into `src/`.

---

## Fictional data policy

No real class/hull/navy names, measured signatures, or real AIP plant names. Every boat/ship is invented from generic, physically sane parameter ranges. Derived tonals must come only from those params (shaft × blades × gear × electrical × aux) so grams are consistent and teachable — never tuned to mimic a real class. Invented nation/hull strings only. No classified freqs, ranges, or sensor performance. UI may evoke operator displays without copying proprietary/classified layouts.

---

## Design language

Sleek, “like Apple built it”: `system-ui` / SF-style type stack, generous spacing, refined dark chrome, subtle depth, smooth motion, precise controls. **Grams stay operator-faithful** (phosphor LOFAR/DEMON, dense monospace). Apple polish = chrome around them (toolbar, plot frame, platform card, planner), not fake sonar glass.

---

## Efficient acoustic processing

Worker signal engine · typed arrays + preallocated buffers (no per-frame alloc) · incremental FFT/LOFAR rows · WebGL texture scrolling. **Budget:** ≥60 fps UI with 50+ contacts / 32 buoys on a mid-range laptop; perf benchmark as done-criteria once engine is wired.

---

## Fictional platform generator

**Acoustics** owns the seeded model + JSON schema; **Frontend** owns the platform-card inspector (hidden during quizzes).

Three sub propulsion families: **nuclear**, **diesel-electric**, **fictional AIP** (plausible-sounding fake plant types only). Each draw gets a parameter sheet from invented ranges (never real-class matched): propulsion/main-motor config; shaft & bearing config; reduction gear ratio; max shaft/propulsor RPM; blade count (+ optional pumpjet-style propulsor); max & quiet speeds; auxiliaries (pumps, compressors, generators, ventilation — each with a tonal family); electrical plant (generic supply frequency + harmonics); transient/emitter list (hull pops, door slams, active emitters); depth/speed envelopes. **Derived acoustics:** tonals = f(shaft rate, blades, gear, electrical, aux). Seeded + serializable JSON. **Surface ships** later on the same generator.

---

## Scenario modes

1. **Randomized** — one click: contacts (via platform generator), environment, mission; seed → reproducible.
2. **Custom Scenario Planner** — instructor builds an exercise (platforms, waypoints + speed/depth over time, timed transients, environment/SSP, buoy load-out, objectives/scoring), saves shareable JSON/link; trainee runs it. Quiz builds on planner objectives.

---

## Robustness

Seeded determinism · acoustics unit tests · graceful bad-input handling · `npm test` + `npm run build` (+ perf check) green every ship.

---

## Milestone table

| ID | Scope (one line) | Owner | Done when |
|----|------------------|-------|-----------|
| **M0** | Scaffold; wire `acoustics/`; Pages `base`; design tokens | Lead · Frontend | Builds; imports acoustics; PLAN approved |
| **M1 MVP** | Aircraft + omni/DIFAR + LOFAR (WebGL) + Worker + 1 seeded scenario + basic tactical plot | Acoustics · Frontend | Tonals on LOFAR; A/C+buoys; tests; Worker live |
| **M2** | **Platform generator** (nuke/DE/fake-AIP) + **randomized scenario** one-click + platform card UI | Acoustics model · Frontend card | Seed→JSON boat; tonals match params; random mission runs |
| **M3** | Buoy lifecycle (RF, battery, depth) + drop patterns | Frontend (+ Acoustics schema) | Patterns; unique channels; dead buoy silent |
| **M4** | Perf hardening + benchmark harness | Acoustics · Frontend | 50 contacts / 32 buoys @ ≥60 fps |
| **M5** | Spectrum + harmonic cursors | Frontend | Cursor + N·f |
| **M6** | Doppler → speed tool | Acoustics · Frontend | Δf → v ≈ f·v/c in tests |
| **M7** | DEMON (WebGL) | Acoustics · Frontend | Blade-rate on seed |
| **M8** | Bearing-time (DIFAR) | Acoustics · Frontend | BTR matches bearings |
| **M9** | DICASS-style + A-scan | Acoustics · Frontend | Ping/echo range |
| **M10** | VLAD-style VLA + BT/SVP | Acoustics · Frontend | SVP affects TL; VLA selectable |
| **M11** | Lloyd’s / multipath helpers | Acoustics · Frontend | Nulls match tests |
| **M12** | CPA estimation aid | Acoustics · Frontend | CPA vs truth |
| **M13** | **Custom Scenario Planner** (edit platforms/waypoints/transients/env/buoys/objectives; export JSON/link) | Frontend · Acoustics schema | Instructor file loads identically for trainee |
| **M14** | Quiz/practice scoring (uses planner objectives) | Frontend (+ Acoustics truth) | Scored seeded/custom run |
| **M15** | Surface-ship generator pass (same engine) | Acoustics · Frontend card | Seeded surface contact on LOFAR |
| **M16** | Polish: Web Audio, motion, Pages deploy, docs | Both · Lead | Hosted demo URL |

Thin increments after M1; pull M4 earlier if LOFAR janks.

---

## Open questions for Wilson

1. Approve plan / milestone order?
2. GitHub repo name + Pages base (`/` vs `/sonar-sim/`)?
3. Default LOFAR band (0–500 Hz vs 0–1 kHz)?
4. **Shorthand mapping (correct us):** PMs→propulsion/main-motor config; S/B→shaft & bearing; MAX PSRPMS→max shaft/propulsor RPM; Emitters→transient/active emitter list; EDAs→aux machinery (pumps/compressors/vents)?; ELECTRICAL→supply freq + harmonics; swaths→?; SRCs→radiated source characteristics / levels? Which did we misread?
