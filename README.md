# San Pablo Solar — Subcontractor Allocation Simulator

Single self-contained HTML/JS app (`solar_subcon_simulator.html`) that simulates day-by-day
progress of MS (mounting structure) and PV (panel) installation across a solar park, with
configurable subcontractor crews, productivity, zone (MVPS) priority, and VRE-test thresholds.

No build step — open the `.html` file directly in a browser.

## Data sources

- `San_Pablo_Solar___Progress_Tracker.xlsx` — real current state of all 3,524 tables:
  id, MVPS zone, current phase (0–6), assigned MS/PV subcontractor.
  `config` tab has the subcontractor list (`contractedMS`/`contractedPV` counts, colors).
- `solar_park_tracker_DEV.jsx` — the original (separate) progress-tracking React app this
  project is derived from. Reused from it:
  - Table geometry (`_MV`, `_ZN`, `_N`, `_X2`, `_Y2` arrays → id, zone, x, y per table).
  - `PHASE_DEFS` / `makePhases()` color logic (darken/lighten of base sp/ms/pv hex colors)
    — replicated in the simulator with `DEFAULT_COLORS = {sp:"#f97316", ms:"#65a30d", pv:"#2563eb"}`.
  - Total park constants: **3,524 tables, 65.018 MWp** (≈18.45 kWp/table).

All of this is pre-extracted and embedded as a single JSON blob (`RAW`) inside the HTML —
see the Python build script logic described below if you need to regenerate it from a newer
export of the Excel/tracker.

## Phase model (per table)

Real phase codes (from the Excel, 0–6):
| ph | meaning |
|----|---------|
| 0 | Not started |
| 1 | Screwpiles pending inspection |
| 2 | Screwpiles approved |
| 3 | MS pending inspection |
| 4 | MS approved ("green" — ready for PV) |
| 5 | PV installed, pending inspection ("dark blue" — simulation treats this as DONE) |
| 6 | PV approved ("light blue" — only reachable via real inspection, the sim never produces this on its own) |

Key simplifications agreed with the user:
- **Screwpile approval is irrelevant** — MS can be mounted on any table with screwpiles, regardless
  of ph 1 vs 2.
- **Inspection is out of scope** — once PV is physically installed (ph 4 → ph 5), the simulation
  considers the table finished. It will never auto-promote a table to ph 6; only tables that were
  *already* ph 6 in the real data stay light-blue.
- `msDone(t) = t.ph >= 4`
- `pvDone(t) = t.ph >= 5` (i.e. "PV physically installed", not "approved")

## Two PV work pools per MVPS (important — this was a specific correction)

Within each zone there are **two independent backlogs of "green" tables waiting for PV**, because
of how subcontractors are assigned:

- **Pool A** — tables that *already had MS done* in the real Excel data (`ph === 4`). These can
  **only** be installed by subcontractors flagged **"PV only"** in the UI.
- **Pool B** — tables that go through MS *during the simulation* (started as screwpile-only).
  The **same** (non-PV-only) subcontractor that mounts the MS also installs the PV — i.e. a
  full-pipeline crew works MS then PV on its own tables, in that order, every day.

A non-PV-only sub never touches Pool A. A PV-only sub never does MS; it drains Pool A first, then
helps with Pool B if A is exhausted that day.

This split exists because of a real business rule: new installs are owned end-to-end by one crew,
but the pre-existing MS-done backlog (inherited from before this tool existed) is handled by a
separate "PV only" crew type.

## Engine (`simulate(maxDays)`)

Per zone, per day:
1. Each **active** subcontractor (selectable via checkbox; inactive ones collapse into a separate
   list) determines its target zone: the highest-priority zone (per the draggable `zonePriority`
   list) that (a) is not yet "VRE-satisfied" (see below) and (b) has relevant work for that sub's
   type (Pool A/B for PV-only, MS+Pool B for full-pipeline). Falls back to any zone with relevant
   work if all are satisfied (so idle capacity still mops up leftovers).
2. **Full-pipeline subs**: `capacity = workers × prodMs`. Spend on remaining MS for the zone first;
   leftover worker-days (if MS runs out) convert to PV capacity (`× prodPv`) and drain Pool B.
3. **PV-only subs**: `capacity = workers × prodPv`, spent on Pool A then Pool B.
4. Workforce (`workers`) for a given sub/day comes from `workersOnDay()`, which checks a
   day-by-day override map (`workforceOverrides`, edited via the on-screen calendar table) before
   falling back to the sub's base `workers` value.
5. Productivity (`prodMs`/`prodPv`) is either a single **common rate** applied to every active sub,
   or **per-subcontractor** rates — toggled via radio buttons. Switching from common → per-sub
   copies the common values into every sub's fields first (so you don't start from zero).

### VRE-test threshold (`zoneThresholds[z]`, default 100)

A zone is "satisfied" once `(total - remaining) / total * 100 >= zoneThresholds[z]`, where
`remaining = ms + pvA + pvB`. Once satisfied, subs stop prioritizing that zone (per the manual
`zonePriority` order) and move to the next one — but the zone keeps whatever natural backlog it
had at that point in *both* pools (this is intentional — an earlier, more aggressive "don't do
MS you don't need" cap was removed because it artificially drained Pool A/B to exactly zero,
which didn't match the user's expectation of a realistic pipeline cushion).

Two dates are tracked and shown per zone:
- **VRE test ready** — day `zoneSatisfiedDay[z]` is reached (the % threshold).
- **Fully completed** — day `zoneCompletionDay[z]` is reached (100%, nothing left in any pool).

### Global deadline & target %

- A single global deadline date (no more per-zone deadlines).
- A separate "Target % of park to complete" box (independent of per-zone VRE thresholds) — shows
  how many tables/MWp that % represents (using the exact 3,524-table / 65.018-MWp totals), and the
  global stats panel reports the projected date the *whole park* reaches that % cumulatively,
  compared against the deadline.

## Visual rendering

- Tables are drawn as small rounded rectangles (`RW=16, RH=3.8`, corner radius 0.5) — same
  proportions as the original tracker app, not plain dots.
- **Layers (independent on/off toggles)**:
  - *Phase colors* — fill color per `PHASE_COLOR` table.
  - *Subcontractor colors* — colored stroke/border per table showing which sub "owns" it
    (reconstructed from a chronological consumption queue per zone/pool — `ownerFromQueue()` — not
    a literal per-table assignment, but gives geographically contiguous blocks because tables are
    walked in **spatial order** — row by row, `(y, x)` — rather than alphabetical id order, which
    was a bug fixed earlier: string-sorting ids like "C1-10" before "C1-2" scattered the blocks).
  - *Active manpower markers* — small colored dots next to each zone's label showing which subs are
    currently working there for the selected day.
- Canvas supports pan (drag) and zoom (mouse wheel); a "Reset view" button re-fits the whole park.
  No +/- zoom buttons (removed per request — wheel zoom only).
- Day navigation: range slider plus ◀ ▶ step buttons for single-day stepping.
- All left-panel sections are collapsible (`.sec-head` / `.sec-body` pattern).

## Known approximations (flagged to the user, may need revisiting)

- Per-table subcontractor ownership is reconstructed after the fact from aggregate daily
  consumption counts, not tracked as a literal table-by-table assignment during the simulation.
  It's a reasonable approximation for visualization but not authoritative.
- No optimizer yet — `zonePriority` order is manual (drag and drop). A "find the best order /
  best subcontractor-to-zone allocation automatically" mode was discussed as a future step but not
  built.
- Workforce calendar regenerates from the global deadline date; very long horizons (the code caps
  at 730 days) could get slow to render as a table — worth virtualizing if that becomes an issue.

## Suggested next steps if continuing in Claude Code

1. Extract `simulate()` and `deriveDay()` into a standalone, framework-free JS module with unit
   tests (there are several edge cases worth locking down: zone satisfaction with threshold <100%,
   PV-only vs full-pipeline pool isolation, workforce override lookups, spatial ownership blocks).
2. Re-implement the UI in React (the original tracker app this was derived from is React/JSX) once
   the engine has test coverage, so UI and simulation logic can be iterated independently.
3. Consider an actual optimizer pass (e.g. greedy or small search) to suggest a `zonePriority`
   order and subcontractor-to-zone allocation automatically, instead of manual drag-and-drop only.
