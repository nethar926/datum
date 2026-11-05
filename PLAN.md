# Sonar Sim — Project Plan (draft for Wilson)

Browser training tool for reading sonar grams as a **fictional maritime-patrol aircraft** acoustic operator (never named/styled as a real aircraft). Lays sonobuoy patterns; RF channels, battery, depth; tactical plot shows aircraft track, buoys, fixes. Ship/sub-mounted mode later. **Everything fictional** — invented platforms/nations/signatures. Physics: public textbook/Wikipedia only (spreading, Thorp, Wenz-style ambient, Doppler, generic blade/shaft harmonics, Lloyd’s mirror).

**Stack:** React + TypeScript + Vite · Canvas → **WebGL** waterfalls · Web Audio later · **Web Worker** signal engine · typed arrays · static build for **GitHub Pages** (`base` configurable).

**Team:** Project Lead coordinates · **Acoustics Physicist** owns signal/propagation/Doppler/Lloyd’s/**platform catalog** · **Display Frontend** owns grams, tactical plot, tools, quiz, design system, platform-card / planner UI.

**Physics core:** `/workspace/sonar-sim/acoustics/` (standalone TS: PRNG, kinematics/CPA, Doppler, Lloyd’s, TL, ambient, sources, receivers, LOFAR/DEMON, scenario schema, **catalog loader**). App consumes it; do not fork physics into `src/`.

---

## Fictional data policy

No real class/hull/navy names, measured signatures, or real AIP plant names. Platforms live in a **fixed fictional catalog** — invented classes with fixed configs, never tuned to mimic a real class. Tonals derive only from each class/variant’s catalog params (shaft × blades × gear × electrical × aux) so grams are consistent and teachable. Invented country/hull strings only. No classified freqs, ranges, or sensor performance. UI may evoke operator displays without copying proprietary/classified layouts.

---

## Design language

Sleek, “like Apple built it”: `system-ui` / SF-style type stack, generous spacing, refined dark chrome, subtle depth, smooth motion, precise controls. **Grams stay operator-faithful** (phosphor LOFAR/DEMON, dense monospace). Apple polish = chrome around them (toolbar, plot frame, platform card, planner), not fake sonar glass.

---

## Efficient acoustic processing

Worker signal engine · typed arrays + preallocated buffers (no per-frame alloc) · incremental FFT/LOFAR rows · WebGL texture scrolling. **Budget:** ≥60 fps UI with 50+ contacts / 32 buoys on a mid-range laptop; perf benchmark as done-criteria once engine is wired.

---

## Fictional platform catalog

**Not random-on-the-fly.** A **versioned JSON catalog** the physics model reads. **Acoustics** authors the catalog + schema + tonal derivation; **Frontend** owns the platform-card inspector (hidden during quizzes).

Each **fictional class** has: fixed config (propulsion/main-motor; shaft & bearing; reduction gear; max shaft/propulsor RPM; blade count + optional pumpjet-style propulsor; max/quiet speeds; aux tonal families; electrical plant; transient/emitter list; depth/speed envelopes); a **fixed hull-number list**; **alts/variants** (refit/flight with changed aux, propulsor, or blade count); membership in a **fictional country**.

**Forces:** countries group into forces. Default electrical convention — **Blue** and **Green** → **60 Hz**; **Red** → **50 Hz**. Other force-level conventions may be defined later.

Propulsion families in catalog: **nuclear**, **diesel-electric**, **fictional AIP** (fake plant types only), with an **initial set of classes per force** (Acoustics-owned authoring task). **Derived acoustics:** tonals = f(class/variant config). **Surface-ship classes** added later to the same catalog format.

---

## Scenario modes

Both modes pick platforms **from the catalog** (never invent ad-hoc configs).

1. **Randomized** — one click: seeded pick of class / hull / variant + environment + mission; varies **only operational state** (speed, depth, course, machinery lineup). Seed → reproducible.
2. **Custom Scenario Planner** — instructor picks catalog platforms, sets waypoints + speed/depth over time, timed transients, environment/SSP, buoy load-out, objectives/scoring; saves shareable JSON/link; trainee runs it. Quiz builds on planner objectives.

---

## Robustness

Seeded determinism · acoustics unit tests · graceful bad-input handling · `npm test` + `npm run build` (+ perf check) green every ship.

---

## Milestone table

| ID | Scope (one line) | Owner | Done when |
|----|------------------|-------|-----------|
| **M0** | Scaffold; wire `acoustics/`; Pages `base`; design tokens | Lead · Frontend | Builds; imports acoustics; PLAN approved |
| **M1 MVP** | Aircraft + omni/DIFAR + LOFAR (WebGL) + Worker + 1 seeded scenario + basic tactical plot | Acoustics · Frontend | Tonals on LOFAR; A/C+buoys; tests; Worker live |
| **M2** | **Catalog schema + initial fictional classes** (nuke/DE/fake-AIP × Blue/Green/Red) + loader + tonal derivation + **randomized mode** (pick class/hull/variant; vary ops state) + platform card | Acoustics catalog · Frontend card | Versioned JSON loads; tonals match class config; seed picks catalog only |
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
| **M13** | **Custom Scenario Planner** (pick catalog platforms; waypoints/transients/env/buoys/objectives; export JSON/link) | Frontend · Acoustics schema | Instructor file loads identically for trainee |
| **M14** | Quiz/practice scoring (uses planner objectives) | Frontend (+ Acoustics truth) | Scored seeded/custom run |
| **M15** | Surface-ship **classes** added to catalog | Acoustics · Frontend card | Seeded surface contact from catalog on LOFAR |
| **M16** | Polish: Web Audio, motion, Pages deploy, docs | Both · Lead | Hosted demo URL |

Thin increments after M1; pull M4 earlier if LOFAR janks.

---

## Open questions for Wilson

1. Approve plan / milestone order?
2. GitHub repo name + Pages base (`/` vs `/sonar-sim/`)?
3. Default LOFAR band (0–500 Hz vs 0–1 kHz)?
4. **Shorthand mapping (correct us):** PMs→propulsion/main-motor config; S/B→shaft & bearing; MAX PSRPMS→max shaft/propulsor RPM; Emitters→transient/active emitter list; EDAs→aux machinery (pumps/compressors/vents)?; ELECTRICAL→supply freq + harmonics; swaths→?; SRCs→radiated source characteristics / levels? Which did we misread?
5. How many initial classes per force / family for M2 catalog v1?
