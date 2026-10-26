# CFD/account defaults and interaction fixes — 25 October 2026

Historical numerical and implementation record. See
CFD_WORKBENCH_AUDIT_2026-10-25.md for the completed local audit and final tests.
Earlier no-commit notes below describe their original checkpoint only.

Subsequent screenshot changes are documented in
[CFD_RESULTS_WORKBENCH_2026-10-25.md](CFD_RESULTS_WORKBENCH_2026-10-25.md).
In particular, the former per-simulation Reset default is now a backed-up,
global Restore default producing one group and one simulation; Clear all also
removes folder metadata. The real numerical evidence below remains historical,
not evidence of a new solver run after those later changes.

Local changes on `master`; no commit, push, merge or deployment for this task.
Measured room geometry and unrelated changes are preserved.

## Requested outcomes

- Account: four signed-in actions in an equal 2×2 grid. Plans/billing moved out
  of the header and always opens a new tab. Sign-in/Create account sits below
  the email/password fields; Enter, mode switching and duplicate-submit guards
  remain functional.
- Lists: deeper child indentation and shared group/item action columns, with
  equal widths and fitting labels at desktop and 390px phone sizes.
- Clear all: confirmation for simulations, CFD objects, boundary customizations,
  refinements and probes. Cancellation/Escape does not delete anything. Source
  room surfaces and measured furniture are never deleted by CFD bulk actions.
- Vent placement: repeated wall clicks and dragging edit a draft with live
  coordinates/dimensions. Only its editor is shown; OK/Cancel stays pinned at
  the bottom. OK commits once; Cancel/close discards the draft and returns to
  Equipment. Selecting a refinement does not refit the camera.
- Preferences: temperature K/°C/°F, length and volume-flow displays. Authoritative
  storage stays K, mm and m³/s. Unit changes never reinterpret stored values.
- Defaults: opposing-wall Supply/Extract, adiabatic no-slip solids, steady
  laminar isothermal SIMPLE, bounded mesh, 1 CPU/4 GB/15 minutes. New measured
  cases use the authoritative factory. Reset default confirms and saves a
  recoverable copy before replacement; stale replies, backup failure and active
  or uncertain worker submissions cannot replace the setup.
- Boundary editing now explains that an ordinary solid surface cannot be an
  inlet/outlet; users create Supply/Extract openings instead. Invalid imported
  conditions stay visible to validation, not silently suppressed.

## Real solver evidence

The actual selected **Simulation 1** was backed up, reset and run through the
existing authenticated OpenFOAM worker before the pause. Other simulations and
measured geometry were retained.

- Job: `b6486570-3a24-4508-9a1e-4fb2d42a4f59`.
- OpenCFD v2312 / simpleFoam; **71,944 cells**.
- Native log: **SIMPLE converged in 161 iterations**; about 27 seconds solver time.
- Final initial residuals: Ux 5.291985053e-5, Uy 4.969888063e-6,
  Uz 5.296750363e-5, p 9.465630319e-5; target 1e-4.
- Conservation passed: inflow −0.005 m³/s, outflow 0.0049999999985 m³/s;
  relative imbalance 2.9999995547817223e-10, tolerance 0.05.
- Mesh non-orthogonality 24.05994532°, skewness 0.1686918282,
  aspect ratio 1.804500266. Native result is marked accepted.
- Verified ZIP evidence: `.local-logs/cfd-defaults-qa/native-accepted-case.zip`;
  contains manifest, result, solver log and native patch-flux data.
- Original portable scenario backup:
  `.local-logs/cfd-defaults-qa/Simulation-1-before-default.scenario.json`.
  Browser backup key: `climoptix:before-default:<projectId>:<studyId>`.

The native-tested case predates adding one passive interior monitoring probe
to the source factory. That addition has preparation/submission regression
coverage, but no second live native run. The user's selected native-tested
case remains unchanged. The currently deployed worker does not supply optional
live probe/flux streams; the UI reports their absence instead of inventing
data. No newer worker was deployed here.

## Verification

- Backend full suite: **691 passed**.
- Frontend unit suite: **618 passed**; project suite: **19 passed**.
- Production/auth/CFD proxy and preview suites: **28 passed** in total.
- Lint/source-usage checks and TypeScript: clean; 432 source modules, no orphans.
- Production static build: passed. Restored development-only generated type
  imports afterward and rechecked TypeScript.
- Local backend health and the previously broken local Plans page: HTTP 200.
- Broad CFD/account browser sweep: **80/81 passed**; the remaining test sampled
  the camera before an intentional room-view fit had finished. It now waits for
  that explicit fit to settle before asserting that selection leaves it alone.
- Final focused browser run: **23/23 passed**, including all seven requested
  points, actual repeated wall clicks and live pointer dragging, probe/empty-group
  clearing, modal Escape/focus return and active-job reset protection. Together
  with the broad run, all 81 distinct cases passed their latest executions.
- A parallel follow-up attempt hit headless WebGL-context creation errors;
  rerunning the final 23 cases serially in fresh isolated browsers completed
  without those errors. Console errors were not suppressed or ignored.
- Final `git diff --check`: clean. Branch remains `master` at `140cc57` with
  local uncommitted work; unrelated nested-site/attachment changes are retained.

## Review corrections

The review caught real phone-width group/item column differences, action-label
crowding caused by higher-specificity shared button styles, and Clear all being
disabled for an object list containing only empty custom groups. These are fixed
and covered by observable browser assertions. Mesh-budget and worker-rejection
tests now explicitly create the oversized inputs they intend to exercise, rather
than depending on the former unsafe starter defaults.

## Boundaries of this validation

The user could not reconnect Chrome after the native-case download, so resumed
UI checks use isolated browsers and mock account/worker transports. Preparation
and default generation use the real geometry backend. The R3F interaction test
uses the actual production canvas, meshes, camera and pointer events. Screenshots
under `.local-logs/cfd-defaults-qa/` are isolated QA images, not evidence of a
second native job. No real password, account registration or billing mutation
was used by these tests.

Defaults cannot repair invalid measured geometry or create opposing walls in
a room that lacks them. Such cases show an actionable preparation error; worker
connection and account authorization are still required to run a simulation.
