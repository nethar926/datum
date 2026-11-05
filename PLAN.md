# Sonar Sim — Project Plan (draft for Wilson)

Browser training tool for reading sonar grams as a **fictional maritime-patrol aircraft** acoustic operator (never named/styled as a real aircraft). Lays sonobuoy patterns; RF channels, battery, depth; tactical plot shows aircraft track, buoys, fixes. Ship/sub-mounted mode later. **Everything fictional** — invented platforms/nations/signatures. Physics: public textbook/Wikipedia only (spreading, Thorp, Wenz-style ambient, Doppler, generic blade/shaft harmonics, Lloyd’s mirror).

**Stack:** React + TypeScript + Vite · Canvas → WebGL when needed · Web Audio later · Web Worker signal engine · static build for **GitHub Pages** (`base` configurable).

**Team:** Project Lead coordinates · **Acoustics Physicist** owns signal/propagation/Doppler/Lloyd’s · **Display Frontend** owns grams, tactical plot, tools, quiz.

**Physics core:** `/workspace/sonar-sim/acoustics/` (standalone TS package: PRNG, kinematics/CPA, Doppler, Lloyd’s, TL, ambient, sources, receivers, LOFAR/DEMON, scenario schema). App consumes it; do not fork physics into `src/`. Empty `src/signal/` stubs (if any) are discarded in favor of this package.

---

## Fictional data policy

No real class/hull/navy names or measured signatures. Contacts from made-up params. Invented nation/hull strings only. No classified freqs, ranges, or sensor performance. UI may evoke operator displays without copying proprietary/classified layouts.

---

## Robustness bar (“crazy robust”)

Seeded deterministic scenarios · thorough unit tests on acoustics models · typed arrays + Web Worker for many contacts/buoys · WebGL waterfall when canvas lags · validate/reject bad inputs gracefully · `npm test` + `npm run build` green every ship.

---

## Milestone table

| ID | Scope (one line) | Owner | Done when |
|----|------------------|-------|-----------|
| **M0** | Scaffold Vite app; wire `acoustics/` as dependency; Pages-ready `base` | Project Lead | App builds; imports acoustics; PLAN approved |
| **M1 MVP** | Aircraft + passive omni & DIFAR buoys + LOFAR waterfall + 1 seeded scenario + basic tactical plot (A/C track, buoy pos) | Acoustics: scenario/omni/DIFAR spectra · Frontend: LOFAR + plot + play/pause/speed | Seeded run shows tonals on LOFAR; plot shows A/C + buoys; tests green |
| **M2** | Buoy lifecycle: RF channel, battery, depth setting; pattern drop (line/field/barrier) | Frontend (+ Acoustics schema) | Drop pattern; channels unique; dead buoy stops audio path |
| **M3** | Spectrum slice + harmonic cursors | Frontend | Cursor readout; N·f marks; snap optional |
| **M4** | Doppler → radial speed tool (truth toggle for training) | Acoustics model · Frontend UI | Δf → v matches `f·v/c` (c≈1500) within test tol |
| **M5** | DEMON display | Acoustics DEMON · Frontend gram | Blade-rate lines visible on seeded contact |
| **M6** | Bearing-time from DIFAR synthetics | Acoustics bearings · Frontend BTR | BTR tracks match scenario bearings |
| **M7** | Active DICASS-style + A-scan | Acoustics · Frontend | Ping/echo range on A-scan |
| **M8** | VLAD-style VLA (generic) + bathythermograph / simple SVP | Acoustics · Frontend plot | Depth/SVP affects TL sketch; VLA selectable |
| **M9** | Lloyd’s mirror / multipath range–depth helpers | Acoustics · Frontend tools | Interference nulls match model tests |
| **M10** | CPA estimation aid | Acoustics kinematics · Frontend | CPA time/range vs scenario truth |
| **M11** | Quiz/practice scoring vs scenario truth | Frontend (+ Acoustics truth API) | Score run; reproducible seed |
| **M12** | Polish: Web Audio listen-through, WebGL waterfall if needed, Pages deploy, docs | Both · Lead | Small pushes; hosted demo URL |

Ship small increments after M1; prefer polish in thin PRs over big-bang.

---

## Open questions for Wilson

1. Approve this plan / milestone order?
2. GitHub repo name + Pages base (`/` vs `/sonar-sim/`)?
3. After M1: buoy patterns (M2) vs DEMON (M5) vs Doppler tool (M4) first?
4. Default LOFAR band (0–500 Hz vs 0–1 kHz)?
