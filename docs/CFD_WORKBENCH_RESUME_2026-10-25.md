# CFD/account checkpoint — 25 October 2026

## LATEST — local audit completed on 26 October 2026

The user resumed after the pause below. Screenshot implementation and local
verification are recorded in CFD_WORKBENCH_AUDIT_2026-10-25.md. Release scope is
LOCAL master only: no remote push, deployment, worker restart or live cloud job.
The earlier paused/unverified sections below are historical checkpoints, not the
current test status. Backend 696, frontend unit 626 + persistence19, proxy/auth/
preview29 and 93 distinct browser cases passed across the audit and targeted
reruns. Production static build, lint and TypeScript passed; development
next-env.d.ts imports restored. User Chrome and saved projects were left alone.

Previously remaining failures are resolved: independent editor focus/portal
stacking; View properties helper clicking Minimise; Results fetching while
hidden; docking persistence across workbenches; thermal navigation mode/help
cascade; independent windows inheriting the 360px mobile bottom sheet; starter
factory assumptions and drag coordinates in old tests. The current full 5,000-step
residual history regression passes without spending the budget on p correctors.

Important remaining capability: heating/insulation imports prepare/export reviewed
thermal conditions, but the current native worker is isothermal-only. No actual
radiator/UFH temperature/buoyancy solve is claimed. New telemetry/post-processing
worker code remains offline and needs a separate explicit deployment request.
The unrelated website gitlink and remote-attachment directory must stay excluded
from staging. The original backend remains the selected live service; the token/
replacement-service notes below are history, not new authorization to release.

---

## PAUSED BY USER — 26 October 2026 (read this before older notes)

User: "ok resume the big list of updates and push on local master not online",
then "Ok stop in a way you can resume". Work is now stopped at that request.
Finish/audit locally on resume, then commit to LOCAL master only. No remote Git
push, Railway deploy, Cloudflare release, worker restart or cloud solve.
No commit was made. Branch master remains at 140cc578e9e70c8c0d66ff692a7944996ad1791d.
All source changes are saved and uncommitted. Preserve the unrelated nested
freefloorplan3d-website gitlink and .codex-remote-attachments directory.

### New implementation saved

The 15 screenshot items are mapped in docs/CFD_WORKBENCH_AUDIT_2026-10-25.md.
Added independent CFD windows, real probe markers/visible XYZ menus, per-field
residual graphs (default Ux/Uy/Uz/p 2x2), navigable archive window, independent
plane inspector and verified-plane main-building R3F overlay, shared minimize
and bottom-left restore tabs, clearer unsupported-physics diagnostics, and
independent source-linked radiator/UFH/insulation preparation imports. Progress
messages now live in the bars, including idle simulations and all solver subtabs.
Unit/navigation controls use the regular responsive labelled field styles.
Earlier default/groups/account/FIELD parsing changes remain in the same tree.
Heating still cannot be solved by the isothermal-only native worker: handoff is
preparation/export and deliberately blocks incompatible native runs. No thermal
result is fabricated. UFH uses whole checked floor patches, not resolved loops.

### Fresh validation completed

- Full backend: 696 passed, 2 known warnings. Log:
  .local-logs/cfd-resume-backend-approved.log. Unprivileged uv failed on cache
  permissions; approved run succeeded. Do not change/delete cache ACLs.
- Full frontend unit: 625 passed; project persistence: 19 passed. Log:
  .local-logs/cfd-resume-unit.log. One new parser regression was added afterwards;
  focused latest workflow/results/heating run: all 16 passed.
- Local static production build succeeded (session28917). It predates the last
  foreground-on-mount and full-history parser changes below; rebuild is required.
- Browser sweep session16930 was explicitly interrupted with Ctrl+C for user
  stop; exit1 is not a completed-suite conclusion. TAP log:
  .local-logs/cfd-resume-browser-approved.tap. 28 individual cases recorded:
  25 passed, 3 failed. All later thermal/window/worker files are unfinished.
  Passing new checks include group clear/defaults, unit prefs, online folder
  downloads, multi-plane/field/legend/volume/isosurface rendering, verified main
  building overlay, retained real native planes, residual 2x2 selection,
  explicit radiator+UFH UI import without source geometry changes, orange real
  probe selection/XYZ and minimize restore, actual multi-wall vent placement,
  readable run/post layouts and per-study convergence history.
- No new native solve was submitted; retained native archive is historical data,
  not evidence of a fresh solver run or deployment.
- Lint last failed on one newly added test's explicit any. Replaced with imported
  CFDBoundary type, but lint/typecheck have NOT rerun after that correction.
- git diff --check passed before the last small patches; rerun at finish.

### Immediate resume work and remaining failures

1. Inspect latest source then rebuild BEFORE rerunning isolated browser tests.
   Do not rebuild while harness serves out/. All test sessions from this pass
   have stopped; no background monitor was created. Do not touch user Chrome.
2. Recovered older-job Monitor dropdown renders real FIELD geometry/fields and
   bounded canvas but setup window intercepts Fit after field select. DOM portal
   bubbling guards in FloatingToolbar fixed other thermal focus issues, but a
   second mount/focus race remains. LATEST UNBUILT attempted fix: new
   foregroundOnMount ref schedules requestAnimationFrame bring-to-front after
   parent's focus-request layout effect; CFDIndependentWindow now passes
   bringToFront. Test cfdResults: 'Monitor result dropdown opens real FIELD...'.
   Verify this fix rather than assume; pointer interactions must really work.
3. climoptixMonitor '3D refinements use distinct level colours...' failed at
   line214: resize-right boundingBox null after opening View properties. Inspect
   actual hidden/stack/layout condition; do not weaken rendered-pixel test.
   windowControls 'CFD maximise and restore...' earlier also had view-properties
   trouble; rerun after root fix. cfdWindow helper clicks Move View properties
   at x220, which may overlap the newly inserted minimize/header controls on a
   narrow 340px window: investigate that concrete reproduction.
4. climoptixResponsive mobile/tablet test line171 expects wide thermal navigation
   after opening the new independent window (1120px wide); now actual selector is
   visible. Update expectation to independent window's real width, not setup
   window width. Landscape thermal test must explicitly close/minimize independent
   thermal dialog before operating covered setup selector, and account for the
   intentionally retained independent window rather than blindly count1 toolbar.
5. thermal.browser drag/resize tests now target .cfx-thermal-import, not setup.
   Latest CSS makes portalled thermal parent flex and named container so footer
   remains bounded. Reverify full thermal suite (prior failures included footer
   below window and focus interception in wall/door source round trips).
6. windowDocking keyboard test used End assuming Float was last menu item. It is
   now Minimise. Test updated to assert focus on Minimise then ArrowUp+Enter for
   Float; NOT rerun. Add/keep real minimize restore tests rather than undo new UI.
7. LATEST UNBUILT parser update coalesces repeated pressure corrections into
   first-initial/last-final per field+outer step BEFORE 20,000 sample cap. New
   regression verifies complete 5000-step four-field history survives pressure
   correctors; 16 focused tests passed. Non-time-stamped logs retain old bound.
   Residual legend now respects initial/final metric too. Full unit/lint/build
   and browser four-graph checks still need fresh run after this update.
8. Finish broad CFD/thermal/window/worker/recovery sweeps and accountPolish,
   accountAuthentication and requestedUiPolish for earlier included account edits.
   Use approved local browser command because sandbox localhost gets
   ERR_NETWORK_ACCESS_DENIED. Unapproved sweep log is environmental failures only.
9. Final restore generated frontend/next-env.d.ts imports to .next/dev/types
   routes/root-params using apply_patch, then typecheck. Last build left it changed.
10. Update audit final actual test results/remaining native limits; review diff
    and stage explicit task allowlist (not git add .). Local master commit only
    after verification. .git write may need approved escalation. No remote push.

Browser commands and historical native archive are documented below. Latest
approved sweep used PLAYWRIGHT_MODULE from bundled runtime, BROWSER_ARTIFACTS
.../.local-logs/cfd-results-qa, CFD_NATIVE_ARCHIVE_PATH
.../.local-logs/cfd-defaults-qa/native-accepted-case.zip, TAP concurrency2 and
files cfdResults,cfdSurfacePresentation,cfdDefaults,openfoamRecovery,climoptixWorker,
climoptixWorkspace,climoptixMonitor,climoptixResponsive,screenshotFixes,thermal,
windowControls,windowDocking. Actual filename is thermal.browser.mts, not
thermalEnvelope.browser.mts. Do not confuse the previous interrupted sweep with
a clean result. Root/frontend AGENTS and installed Next use-client guide were read.

---

## CURRENT — backend replacement cancelled; local Railway login recovery verified

The latest user request supersedes the replacement-service plan: keep the previous
backend and rotate the Railway API token because of an attack. User explicitly
identified the credential as a Railway account/deployment token, not Supabase or
OpenFOAM. Do not request its value in chat or rotate unrelated keys speculatively.

The original `freefloorplan3d-api` is still active/healthy (deployment
`77e185ea-d3f8-4a60-bbc8-083b93f8e389` SUCCESS). Live Cloudflare version
`4dd7fba0-c356-4c9c-9413-46d3fe9c7a0a` has 100% traffic and still points to that
original origin. The unused new service's deployment
`c47c0655-74d7-4e2f-b7d8-8d97439cdc5d` was stopped/removed, verified REMOVED with
rollback/redeploy available. Its service configuration was retained. Do not run
`deployment/package-api.ps1 -Deploy`, reactivate it or switch routing unless the
user requests this again. Old API source stays disconnected/manual as approved.

The user reported no account tokens; the correct project Settings > Tokens page
was also visibly empty. The user then reported creating `freefloorplan-production`
for production; its value was never accessed by the agent. Keep it private and
unused unless a specific deployment consumer needs it. No local token environment
variables were present (process/user/machine), and there is no .github/workflows
directory. Existing local releases use a saved Railway CLI login. Other machines
and external CI have not been audited.

Ordinary PowerShell could not find pnpm, so the user was given a verified existing
native Railway executable, with no installation or execution-policy changes:
`C:/Users/Dell/AppData/Local/pnpm-cache/dlx/bac0001b00d2277c8ec46cf11df27bad/pkg/node_modules/@railway/cli/bin/railway.exe`.
The user completed logout/login, followed by a successful read-only whoami and
original backend health `ok`. Local access recovery is verified; do not repeat
the login instructions unnecessarily. No token was installed or credential value
read/created/revoked/rotated by the agent. Revocation and incident exposure have
not been independently audited. Do not claim full incident remediation or the
earlier CFD/UI release is complete. No code release, Git commit/push, worker update
or saved-data change happened during this credential recovery.

The earlier sections below are historical and superseded where they conflict.

## New API service completed

The user chose the existing freefloorplan3D project. A separate
`freefloorplan-api` service (`a680ebe4-8ec9-4f97-9240-ca000a984d2d`) is now live
at <https://freefloorplan-api-production.up.railway.app>, deployment
`c47c0655-74d7-4e2f-b7d8-8d97439cdc5d` SUCCESS. Live stateless API checks and
160 focused local regressions passed; public catalogues/settings match the old
API exactly. Read [FREEFLOORPLAN_API_2026-10-25.md](FREEFLOORPLAN_API_2026-10-25.md)
for configuration, dependencies and reproducible upload/check commands.

The old API and OpenFOAM service remain running. New API has no GitHub source;
manual releases preserve the later offline-master-push requirement. Public
planner routing is NOT switched yet; no Git commit/push or frontend release
occurred. Earlier canvas visibility regression and the new 15-point workbench
list remain pending. No frontend code was edited in this API-creation step.
The old project-location question below is answered; do not ask it again or
create another replacement service.

## CURRENT HANDOFF — replacement Railway API choice pending

The user resumed with a large new screenshot list and explicitly approved two
release stages: publish the EXISTING fixes/API first, then implement the new
list and push master WITHOUT deploying those later changes. The user's latest
clarification is to **create a NEW Railway API for FreeFloorplan**, test it,
then replace the current backend while keeping the old API as a fallback.
An asynchronous question is still pending: create it inside the existing
`freefloorplan3D` project, or in a new separate Railway project? Do not provision
a service/project or switch production routing until that choice is known.

### Infrastructure action actually performed, explicitly approved

The user could find only Disconnect in Railway Source settings. After explaining
the distinction from Disable, they explicitly approved **disconnect GitHub
source; use manual releases**. Executed scoped CLI source-disconnect for API
service `31789d11-d7e6-471c-81bf-665edfb634c2`, production environment
`e1e7e064-a93e-4c5d-8f96-fa21dcc00e2b`, project
`45ec36d9-5b66-437c-a1b3-d85bdfb5a97f`. CLI confirmed repo/branch/image null.
This was NOT a service/deployment deletion. Read-only checks afterward confirmed:

- API deployment remains `77e185ea-d3f8-4a60-bbc8-083b93f8e389`, SUCCESS,
  health `ok` at `https://freefloorplan3d-api-production.up.railway.app`.
- OpenFOAM deployment remains `d636ed28-3f79-4972-b0be-05a5b448aaf4`, SUCCESS,
  health `ok`, executionReady true at its existing domain. It was already
  manually uploaded, without a GitHub source.
- No Git commit/push, API creation, new deployment or production route switch
  has occurred yet. Master/remote remain `140cc57` with the dirty tree retained.
- User confirms **all simulations stopped/completed; safe to update worker**,
  and was asked not to start another during rollout. Recheck if much time passes.
- Read-only worker SSH aggregate-status attempt failed: no registered SSH keys.
  Do not register/import keys without asking. No SSH command reached the worker.
- Railway connector auth was accepted but subsequent calls require a non-empty
  `link_id` unavailable in current metadata. The authenticated CLI works.
  Do not dump raw config/variables; parse output and print selected metadata only.

### Resumed baseline checks and remaining real blocker

- Fresh full backend **695 passed**, proxy/auth/preview **29 passed**.
- Fresh frontend **624 unit + 19 project passed**; lint/source usage and
  TypeScript passed, including build; later tiny scroll changes need their final
  check after resolution. Build uses `.env.production.local`, `/planner`.
- Six-file browser sweep completed **35/36 passed**. The two old strict-mode
  selectors are fixed and their responsive/workspace tests now pass.
- The remaining test is `Monitor result dropdown...` in cfdResults.browser.mts.
  Initially it failed because a local variable named `window` was renamed by
  esbuild and captured in a serialized `page.evaluate` closure (`window2`).
  That was corrected to `windowBox`; it now reaches the genuine layout assertion.
- Actual native FIELD planes render with p/U, including the recovered older-job
  dropdown flow. BUT full canvas visibility on opening still fails: canvas
  x325,y693,w645,h550; setup window x20,y140,w1000,h852. The scene is partly below
  the fold. Do NOT waive this assertion or claim final browser suite passed.
- `CFDResultsViewer.tsx` currently tries `requestAnimationFrame` after the populated
  layout, then directly adjusts nearest `.cfx-setup-panel.scrollTop` to centre the
  scene; `presented.current=files` is assigned only inside the non-cancelled
  callback, with cancelAnimationFrame cleanup. A generic scrollIntoView attempt
  failed too. Latest build22165 includes this direct-scroll version; focused
  run85440 still failed. Investigate actual scroll resets/effect timing or
  restructure Results so the scene is foremost. The latest test asserts initial
  full visibility immediately after native load, before field/Fit interactions,
  using eventually; after controls it explicitly scrolls for screenshot capture.
  Temporary console diagnostics were removed.
- Build22165, browser85440, lint/type session69688 all completed; no intentional
  running test/build. Last build regenerated `next-env.d.ts` to `.next/types`;
  restore dev imports after the final build. No new 15-point source work started.

### Release and new-list obligations (not completed)

After resolving baseline checks: commit only task source/docs/tests, exclude
unrelated nested website gitlink and remote attachments. Prepare whitelisted
runtime bundles, never recursively upload the dirty checkout or credentials.
`deployment/package-openfoam.ps1 -Deploy` is the existing worker helper; newly
added runtime files must be tracked before using its git-ls-files allowlist.
Read `deployment/README.md` and `docs/OPENFOAM_WORKER.md` before release. API is
now manual: don't redeploy the old fallback when user wants a new replacement.
The new replacement service must also remain manual to keep final master pushes
offline. Preserve existing auth/billing/storage configuration without dumping
secrets; clarify what must be shared before moving across projects.

The latest new workbench list includes: remove redundant job detail row and put
message in bar; selectable visible XYZ probes in Solver/Post with orange 3D
markers; actionable unsupported-physics diagnostics; genuine phase percentages;
equal action rows; independent Explorer-like private-file window; independent
large plane inspector plus native-result overlays in main building 3D; shared
minimise/restore/taskbar controls; Settings navigation/unit typography; multiple
residual graphs, default Ux/Uy/Uz/p 2×2 over full history; independent insulation
and heating-load import window with real boundary/heater mappings. Audit every
point, then push master but DO NOT publish this second batch. Current native
worker is isothermal U/p only; thermal CFD must not be claimed unless a real
supported, tested solver path is added. Existing thermal-envelope import/snapshot
functionality already exists—inspect/reuse it, do not invent duplicated loads.

The original active-pause section below is historical; use this current section
for publication authority, service state, fresh checks and pending choices.

## ACTIVE PAUSE — status bars, metrics and result dropdown follow-up

Paused at the user's explicit request, **“Stop in a way you can resume”**.
This section supersedes older completion/pending-work sections below for the
latest four-screenshot request. Resume the existing dirty tree; do not restart,
discard changes, push or deploy. All work is local and uncommitted on `master`
at `140cc57`. No real native job was started in this follow-up. The user's
browser and saved project were not accessed or changed.

### Latest request and implementation

1. Every simulation now renders `CFDJobProgress`, including unsubmitted and
   archived entries when shown. Idle = **Not submitted · 0%**; actual jobs with
   null progress remain unknown, never a fabricated 0%. Changed
   `ClimoptixStudies.tsx` and `CFDJobProgress.tsx`.
2. `CFDWorkerTelemetry.tsx` merges final residuals into the same metrics `dl`.
   `density.css` sets normal sans-serif UI typography, readable 12px labels /
   13px values scaled by density, full-contrast labels, tabular numbers and
   aligned two-line label slots. Four columns at setup width >=960px, three at
   medium widths, two <=640px, one <=400px. Actual browser checks of 4/3/1
   columns, text visibility/family and aligned values have passed.
3. `CFDResultFiles.tsx` replaces the main artifact button list with two labelled
   selects: **View result in 3D** and **Download simulation data**. Download
   choices include the native ZIP, post-processing ZIP (including old-worker
   fallback), and individual retained planes. Existing private-folder browsing,
   SHA checks, abort/duplicate locks and error recovery remain intact.
4. The screenshot's legacy FIELD parser bug had already been fixed in the prior
   local work. A NEW browser regression exercises the exact Monitor dropdown →
   Results route using actual retained native FIELD planes, a recovered older
   completed job, no artifact names (legacy worker shape), and **zero worker
   submissions**. It passed and rendered native p/U in the real vtk.js canvas.
5. Visual review showed that the folder panel can push the new viewer below the
   fold. **Very latest source change, NOT YET REBUILT/TESTED:**
   `CFDResultsViewer.tsx` tracks `presented` files and calls the viewer's
   `scrollIntoView({block:"start"})` after a newly loaded file set renders.
   It avoids doing so for unchanged files on context refresh. The new native
   route test now also asserts the complete canvas fits inside the visible
   setup window; that latest assertion has NOT run yet.

### Validation state at pause

- Full frontend **624 unit + 19 project tests passed**, after the status bars,
  metrics and dropdown changes, but BEFORE the final viewer-scroll line.
- Lint/source usage passed (442 modules, no orphans), also before that line.
- Production static build and TypeScript passed before that line. Generated
  `next-env.d.ts` imports were restored to `.next/dev/types/` and TypeScript
  rechecked successfully before the final viewer-scroll change.
- Focused production-bundle browser sweep completed: **36 cases, 34 passed,
  2 failed**. Both failures were test selector ambiguity, NOT rendering errors:
  old `row.locator("strong")` matches the study name AND the new progress label.
  Selectors are now fixed to `.cfx-study-name strong` in
  `climoptixResponsive.browser.mts` and `climoptixWorkspace.browser.mts`,
  **not rerun yet**. Do not report the whole 36-case suite as passed.
- That sweep's passing cases include the native FIELD monitor-to-3D dropdown
  flow, artifact/postprocessing downloads, scalar volumes, private folders,
  visible idle bars, worker submission/reload/cancellation/recovery, and
  measured metrics responsive typography/alignment.
- `climoptixWorkspace` old compact-row assertion was intentionally updated from
  <=52px to <=88px to include the now-required 28px idle bar. The two selector
  failures occurred before those later assertions; verify the new bound too.
- Local planner HTTP200 was checked read-only. Do not touch the user's browser.
- Backend not changed this follow-up; prior full **695 backend / 29 proxy**
  successes remain historical evidence, not freshly rerun here.
- Browser sweep session84301 completed exit1 (the two described test-selector
  failures). Build2309, unit15167, lint73174, typecheck25491 all completed.
  No test/build process is intentionally left running. Local existing planner
  and backend services were left alone.

### Exact remaining work

1. Rebuild the static production bundle to include viewer auto-scroll. Do not
   rebuild while a browser harness serves `frontend/out/`.
2. Rerun the six browser files below, especially the two corrected selectors
   and the new native canvas visibility assertion. Diagnose real failures;
   do not weaken layout/field assertions to obtain a pass.
3. Inspect the new screenshot after auto-scroll. Current screenshot
   `.local-logs/cfd-results-qa/monitor-native-dropdown-to-3d.png` proves native
   rendering but predates auto-scroll and shows the lower scene clipped by the
   viewport. The new screenshot should show the scene fully visible.
4. Run lint/typecheck after the final source line; restore generated
   `next-env.d.ts` development imports again after building. Unit/project suites
   can be rerun if any further production changes are needed.
5. Record this follow-up in `docs/CFD_RESULTS_WORKBENCH_2026-10-25.md`, currently
   still describing the PREVIOUS seven-screenshot completed task, not these
   latest dropdown/status/metrics modifications. Keep historical counts clear.
6. `git diff --check`, confirm master unchanged, preserve unrelated dirty
   `freefloorplan3d-website` and `.codex-remote-attachments/...` plus all earlier
   account/default/placement work. Finish with a brief validation summary.
   **No push/deployment** without fresh explicit direction.

### Resume commands

Frontend cwd: `C:/Users/Dell/Documents/ChatGPT/Online refurbishment planner/frontend`.

Build: `$env:PLANNER_STATIC_EXPORT='true'; pnpm build`.

Browser environment:
`$env:PLAYWRIGHT_MODULE='C:/Users/Dell/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'`
`$env:BROWSER_ARTIFACTS='C:/Users/Dell/Documents/ChatGPT/Online refurbishment planner/.local-logs/cfd-results-qa'`
`$env:CFD_NATIVE_ARCHIVE_PATH='C:/Users/Dell/Documents/ChatGPT/Online refurbishment planner/.local-logs/cfd-defaults-qa/native-accepted-case.zip'`

Then `pnpm exec tsx --require ./tests/css-register.cjs --test --test-concurrency=2`
with `tests/browser/` files: `cfdResults.browser.mts`,
`openfoamRecovery.browser.mts`, `climoptixWorker.browser.mts`,
`climoptixWorkspace.browser.mts`, `climoptixMonitor.browser.mts`,
`climoptixResponsive.browser.mts`.

All source edits use apply_patch. Root and frontend AGENTS and installed Next
use-client.md were read for this follow-up. No skill or multi-agent workflow
was activated. No credentials used. Native numerical evidence remains the
prior retained accepted archive; mock transports never submit a real job.

## Later results-workbench follow-up

The subsequent seven-screenshot request (group clearing, global Restore default,
header spacing, phase bars, collapsible two-chart monitor, private result folder
and interactive Results) is documented in
[CFD_RESULTS_WORKBENCH_2026-10-25.md](CFD_RESULTS_WORKBENCH_2026-10-25.md).
Its implementation and validation supersede older Reset/group/results behavior
in the snapshot below. All changes remain local and uncommitted; do not publish
or rerun paid native jobs based on historical requests. The user's browser
remains untouched. Preserve the existing dirty tree.

## Resumed outcome

Implementation and local QA are complete. Read
[the final validation report](CFD_DEFAULTS_VALIDATION_2026-10-25.md) for the
seven requested outcomes, verified native solver evidence, backup locations,
final checks and the optional probe/hosted-worker telemetry limitations.

Backend: 691 passed. Frontend: 618 unit + 19 project tests passed. Final focused
browser run: 23/23 passed, including the repaired camera-fit timing assertion.
Lint, TypeScript, production build, proxy/preview checks and diff checks passed.
No publication, Git commit or deployment occurred. Existing unrelated edits are
preserved. The user's browser was left alone after they could not reconnect it.
The local backend now runs as PID 50716 (verify its command before any future
process action); backend health and local Plans both returned HTTP 200.

The original pause snapshot below is historical. Its old pending-check list,
test totals, backend PID and build status are superseded by this section and the
final report; do not redo its completed actions or restore its older code.

## Original pause snapshot

Paused at the user's explicit request: “Stop in a way you can resume”.
All work is uncommitted and local. Nothing was pushed, merged or deployed during this task.
Resume from the existing dirty tree; do not restart or discard changes.

## Active request

Implement and test seven screenshot points: account actions 2×2; sign-in/create-account actions below fields; hierarchical list indentation/aligned equal action widths; confirmed Clear all in equivalent list windows; transactional 3D vent rehosting/dragging with live coordinates and OK/Cancel; engineering display preferences (temperature/length/flow); genuinely runnable starter ventilation, opposing wall inlet/outlet, adiabatic walls and confirmed Reset default. User explicitly permits overwriting their current CFD settings, not measured room geometry.

The separate earlier account fixes were already dirty at this turn's start. Preserve them. Historic audit commit/master HEAD is 140cc578e9e70c8c0d66ff692a7944996ad1791d. Do not infer fresh publication authority from old messages.

## Actual local project and real native run — achieved

- Used the user's existing Chrome localhost:3000 tab, selected Climoptix, and confirmed Reset default for their selected **Simulation 1**. Other simulations and measured geometry were retained.
- Original backup downloaded to `C:/Users/Dell/Downloads/Simulation-1-before-default.json` (wrapper with scenario/metadata). A directly importable scenario copy is also at `.local-logs/cfd-defaults-qa/Simulation-1-before-default.scenario.json`.
- A browser localStorage backup also exists at `climoptix:before-default:<projectId>:<studyId>`. Reset fails closed if backup storage fails. Subsequent new reset downloads now use portable direct scenario JSON, rather than that wrapper.
- Clicked the actual Run solver UI. Authenticated live OpenFOAM job **b6486570-3a24-4508-9a1e-4fb2d42a4f59** completed, accepted, converged and passed conservation.
- Native result: **71,944 cells**, max non-orthogonality **24.05994532°**, skewness **0.1686918282**, aspect ratio **1.804500266**; solver.log reports **SIMPLE converged in 161 iterations**, about 27 seconds solver time. UI residual parser counts 162 samples/timesteps (do not confuse this with physical iterations).
- Final initial residuals: Ux 5.291985053e-5, Uy 4.969888063e-6, Uz 5.296750363e-5, p 9.465630319e-5, target 1e-4.
- Native result relative flow imbalance 2.9999995547817223e-10 (fraction), tolerance .05; inflow -.005 m³/s, outflow .0049999999985 m³/s.
- The downloaded ~9.9 MB archive was verified as a real ZIP containing manifest.json, result.json, solver.log and native patch flux files. Local retained evidence: `.local-logs/cfd-defaults-qa/native-accepted-case.zip`. Original download: `C:/Users/Dell/Downloads/b6486570-3a24-4508-9a1e-4fb2d42a4f59-native-case.zip`.
- Monitor really loaded residuals, measured final metrics and slice/native-case artifact actions. Hosted worker is the existing deployed version: its optional live probe/flux telemetry is not available; UI correctly says so. Do not claim new worker sources were deployed.
- The native-tested reset preceded adding one default interior probe to the factory. Current source factory has a probe (authoritative interior representative point); this extra probe has preflight/submission regression coverage but has not had a fresh live run. Current user's selected simulation remains the native-tested configuration without that new probe. Do not silently claim those exact two configurations are identical.

## Browser access paused/unavailable

Chrome disconnected after the native-case download. The download itself succeeded (file verified). Browser waitForEvent timed out, resetting the tool kernel.
User replied **“cannot do now”** to reconnect request. Acknowledged and promised to leave their browser alone; finish via isolated browser tests. Do not keep asking or trying to reconnect without user direction.
Former tab ID 98665064, URL http://localhost:3000/. Inventory browser IDs changed after kernel reset (Chrome 3 → 2); reacquisition returned “Debugger unattached”. Do not rely on those IDs.
No credentials/passwords were used or copied. Screenshots exposed a password; user was already advised to change it. Never repeat it.

## Implemented source changes this turn

- AccountExperience/AccountDialog/commercial.css: signed-in actions 2×2; billing new-tab action moved to body; sign-in/create-account single submit/mode pair moved below email/password, retaining mode-change preventDefault, duplicate-submit lock and native Enter behavior. Utility row remains equal-width. Header empty navigation removed.
- density.css: nested row indent 28px, common action width and gap, group header gutter calculated to align with row menu. Placement window footer is outside scrolling content; compact placement leaves 3D view accessible.
- CFDConfirmAction.tsx: reusable native modal confirmation with safe Cancel/Escape/focus return. Applied to Objects, boundary customizations, refinements and probes; Simulations already had confirmed Clear all.
- Objects Clear all removes CFD devices/copies/treatments and excludes source objects, preserving measured furniture and geometry. Boundaries Clear all resets overrides/type/group conditions, never deletes measured surfaces.
- ClimoptixWorkspace/Viewer/Equipment: placement uses a local draft CFDVent; multiple face picks and drag previews do not persist until OK. Cancel/close returns to Equipment and discards draft. Only placement editor shown; live host-plane coordinates and dimensions; drag reports draft updates live. Existing non-placement drag still discrete committed edit. Other vents cannot be dragged into the active draft.
- cfdUnits.ts/appPreferences.ts/SettingsDialog/CFDFields: persisted engineering preferences; K/°C/°F absolute temperature conversions, CFD length mm display conversions, m³/s↔L/s↔m³/h. Stored quantities remain K/mm/SI; coefficients J/kg·K etc are not absolute temperatures. Unit change remounts numeric draft. Existing vent per-editor flow selector retained with explicit conversion suppression to avoid double conversion. Top Settings menu length callback now uses shared preference persistence.
- climoptix_defaults.py + `/climoptix/default-setup`: stateless authoritative factory, preserving identity/seed (or first measured room), excludes source furniture from simple baseline, clears old thermal/flow overrides, checks vent rectangles against actual planar wall polygons/holes/clearance using Shapely, requires opposing wall normals in same room, small inlet .005 m³/s, pressure outlet0, laminar steady isothermal SIMPLE, no-slip/adiabatic solids, serial1CPU/4GB/15min/1GB/3days, bounded uniform-refined mesh, interior probe. Invalid measured room/opposing-wall geometry remains a clear error.
- New simulation in measured project requests validated defaults. Reset default confirms, backs up, checks stale async response and replaces selected scenario with history checkpoint. Does NOT automatically start jobs.
- Source resource defaults changed to supported limits in Python and Zod. **Very latest, not yet rerun**: generic mesh defaults changed from target500k/max2m to target100k/max500k in both schemas, so selecting a mesh preset does not reintroduce incompatible budgets. Removed redundant constructor mesh override.
- Boundary editor disables inlet/outlet options on ordinary solid surfaces and explains to use Supply/Extract. Existing invalid imported selections remain diagnosable/resettable, not hidden.
- Production planner-worker.mjs explicitly allows default-setup with existing same-origin/body-size/no-credentials/no-cache guards. Test added.
- AccountStatusButton latest tiny hardening: Object.hasOwn protects plan label lookup from prototype keys. Not yet rerun after this final line.

## Validation completed before pause

- Full backend: **690 passed** before extra endpoint test; later focused defaults suite **4 passed** including new API endpoint and worker preflight. Expected full count next run691 (verify, don't assert until run).
- Full frontend unit suite **618 passed**, project suite **19 passed** (dot reporter exit0), before latest mesh-default/plan-lookup/top-menu callback adjustments.
- Lint/source usage (432 modules, no orphans) and TypeScript passed. One temporary ref cleanup warning was fixed and a subsequent lint run was clean.
- Two production static Webpack builds passed. Latest output includes placement footer and empty account header nav fix, but **does not include the final top-menu callback, mesh defaults, portable reset download or hasOwn plan lookup edits**. Rebuild before final browser run.
- Production proxy: **19 passed**, including same-origin POST-only default-setup. Other proxy/preview suites not rerun yet.
- Focused browser sweep: **21 cases, 20 passed, 1 test-setup failure**. Failure was new cfdDefaults unit-preference case clicking Settings but not its Preferences… submenu. Test now fixed to click Preferences…; **not rerun yet**. Other passed cases cover reset confirm/cancel/backup/new defaults, all bulk clears, actual R3F camera/color/face placement, account/recovery/auth at1440/390, requested UI polish.
- accountPolish tests subsequently gained explicit signed-in 2×2 grid assertions; rerun these newer assertions.
- Broader CFD browser sweep session59147 was **interrupted with Ctrl+C at user stop**, exit1 is NOT a failure conclusion. At least18 cases had individually passed (core walkthrough, duplicate/archive/import, numeric drafts, normal3D vent drag, exports/project replacement, VTK, both theme/density responsive walkthroughs, convergence/refinement visibility). No full suite conclusion. Rerun targeted files or the sweep.
- git diff --check passed before latest edits; no commits made.
- QA images `.local-logs/cfd-defaults-qa/`, especially default-simulations.png (verified aligned child/header action columns), account screenshots and realR3F selection/placement test images. These isolated test screenshots are NOT evidence of the real native job; use the real archive above for that.

## Remaining resume work

1. Review all latest diffs for transactional placement, default factory, stale/reset races, unit conversions and response/schema compatibility. Do not start unrelated refactors.
2. Finish fresh automated browser tests after rebuild: fixed preference/cancel case; account2×2 assertions; pinned footer; actual multi-wall click/rehost and in-placement drag/live-coordinate assertions (normal drag passed; new placement pointer face +OK passed, but stronger repeated-wall/drag coverage desirable). Add quantitative grouped action alignment tests at desktop and small widths.
3. Validate reset backup quota/failure path and stale default response (currently guarded, not directly browser-tested). Ensure active/ambiguous jobs cannot be reset or cleared. During reset, job submission handlers are guarded and Play busy; consider a final ref-based job check before replacement for racing actions.
4. Finish all relevant CFD browser regressions, unit/backend/proxy lint/typecheck/build after latest edits. Do not build while browser harness serves out/.
5. Backend current local PID16152 was explicitly restarted to load new endpoint, but subsequently loaded default module predates added probe. Restart only the verified project's backend service once final code is ready, preserving user's project. Local Next dev is still running on3000. Do not kill unrelated services. No native job remains running.
6. `frontend/next-env.d.ts` is build-generated `.next/types`; restore the original `.next/dev/types/routes.d.ts` and root-params import using apply_patch near end (don't discard other changes).
7. Write final brief assessment/validation handoff noting measured room preserved, actual selected study reset and backed up, native solve succeeded, and new code not published. Do not claim optional live telemetry or new probe was exercised by the first solve.

## Preserve unrelated and earlier changes

- Dirty `freefloorplan3d-website` nested gitlink is unrelated; do not modify/reset it.
- Untracked `.codex-remote-attachments/01a0b951-9092-7d80-9c5e-e9651d872a7a/` unrelated; leave alone.
- Earlier local account development fixes in .env.example, frontend/.env.example, next.config.ts, planner-client.tsx, AccountStatusButton and account tests/docs remain uncommitted and must be retained.
- Workspace root guidance: authoritative geometry mm, preserve user changes, use apply_patch for files; frontend/AGENTS.md requires reading installed Next docs (use-client.md was read). Backend uv run pytest; frontend pnpm lint.
- No Luna workflow was activated; no new subagents used. User's earlier independent-review choice was for a completed previous audit, not blanket delegation permission.

## Test commands

Frontend cwd: `C:/Users/Dell/Documents/ChatGPT/Online refurbishment planner/frontend`.

`pnpm lint`; `pnpm typecheck`; `pnpm test:unit --test-reporter=dot`; `pnpm test:projects --test-reporter=dot`.

Build: `$env:PLANNER_STATIC_EXPORT='true'; pnpm build`.

Browser: `$env:PLAYWRIGHT_MODULE='C:/Users/Dell/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'`; `$env:BROWSER_ARTIFACTS='C:/Users/Dell/Documents/ChatGPT/Online refurbishment planner/.local-logs/cfd-defaults-qa'`; then `pnpm exec tsx --require ./tests/css-register.cjs --test --test-concurrency=2 tests/browser/<file>.browser.mts`.

Focused files: cfdDefaults, cfdSurfacePresentation, accountPolish, requestedUiPolish, accountPasswordReset, accountAuthentication.
Broad interrupted files: climoptix, climoptixAudit, climoptixMonitor, climoptixResponsive, climoptixUiV2, climoptixWorker, climoptixWorkflow, climoptixWorkspace, openfoamRecovery, cfdReadiness.

Root: `uv run pytest -q`; `node --test deployment/planner-worker.test.mjs`.
Pytest cache ACL and Starlette/httpx deprecation warnings are pre-existing and non-blocking. Do not delete directories or change ACLs to silence them.
