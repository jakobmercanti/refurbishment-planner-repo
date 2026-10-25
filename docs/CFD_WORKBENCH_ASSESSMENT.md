# CFD workbench assessment — 25 October 2026

## Scope and baseline

Work starts on `master` at `a8898d7`, including the earlier uncommitted OpenFOAM,
account and UI fixes. Unrelated nested website changes and attachments are excluded
from publication. No reset, force push or loss of measured project geometry is allowed.

The reproducible baseline is `CFD_AUDIT_BASELINE_2026-10-25.json`.
Run `node scripts/count_source_lines.mjs` from the repository root.
Counts are physical source lines including comments and blanks, not executable SLOC.
The same fixed file-extension and exclusion rules apply at the end.

- Repository: 94,925 lines across 557 files; 89,815 nonblank lines.
- Production/tools: 70,990 lines; tests: 23,935 lines.
- CFD-named production/tools: 16,506 lines; CFD-named tests: 8,292 lines.
- Generated output, dependencies, public/vendor assets, data, type declarations,
  nested website checkout, attachments and ignored files are excluded.
- The counting script is new assessment tooling and is absent from the baseline;
  its lines will be included in the final count rather than hidden.

## Final source measurement

The final per-file snapshot is `CFD_AUDIT_FINAL_2026-10-25.json`, measured in
the working tree before the publication commit (its `head` identifies the base).
The identical script/filter rules produce these comparisons:

- **Total repository source:** 94,925 → 95,004 physical lines (**+79**).
- **Production/tools:** 70,990 → 70,952 (**−38**).
- **Tests:** 23,935 → 24,052 (**+117**).
- **CFD-named production/tools:** 16,506 → 16,429 (**−77**).
- **CFD-named tests:** 8,292 → 8,370 (**+78**).
- **Nonblank repository source:** 89,815 → 89,866 (**+51**).
- Files: 557 → 568. The CFD-named subset is a path-name classification, not a
  claim to include every shared dependency of the workbench.

Production code decreased despite the new readiness/compatibility controls and
stricter runtime checks. Total source increased because meaningful regression
coverage and reproducible counting tooling were added. Module extraction alone
is not counted as a code reduction, and a smaller number was not pursued by
deleting unique tests or compressing source formatting.

## Assessment and changes

The workbench separates preparation, execution and results. Geometry remains
deterministic and authoritative in millimetres; a coloured mesh, saved setting or
successful HTTP deployment is never treated as a computed CFD result.

- **Structure:** replaced the 1,888-line mixed-purpose `ClimoptixPanels.tsx`
  (including earlier local edits) with phase-specific Domain, Equipment,
  Boundaries, Physics and Mesh modules, plus shared form controls. There is no
  compatibility barrel keeping the replaced implementation alive.
- **Form maintenance:** consolidated recursive parameter rendering and immutable
  array/vector updates; refinement centre/size reuse the same axis-labelled
  controls. Numeric drafts still commit only on blur/Enter and invalid changes
  do not overwrite saved values.
- **Efficiency:** boundary ownership is indexed once per surface snapshot instead
  of rebuilding patch/assignment maps for every group and filter; residual logs
  are parsed only when text changes; current worker input is serialized once per
  project/study snapshot for monitor provenance. These are structural improvements,
  not a claimed measured solver speedup.
- **Native correctness:** final flux acceptance now selects restart directories
  numerically, not lexically, and reads a bounded complete-line tail. Final patch
  timestamps must agree with each other and the finite final solver iteration;
  unterminated final data is rejected. An older aligned live sample cannot pass a
  final incomplete result. Missing/invalid native measurements never become zero.
- **Async reliability:** cancellation/download actions are scoped to their monitor
  lifecycle; leaving it or changing its adapter aborts pending actions, and a late
  artifact cannot open results for another context. Downloads remain hash-checked.
- **Readiness:** a compact summary consistently distinguishes current geometry,
  stale checks and blocking input, with a direct Review issues action. Submission
  failures are visible in the selected study's Warnings page. A duplicate alert
  caught by browser regression was consolidated into one message/action.
- **Worker compatibility:** advisory explanations identify unsupported physics,
  outputs, layers, sampling and iteration budgets. The explicit resource-limit
  action preserves geometry/physics and never increases a smaller request.
  The authenticated server still performs full, fresh validation.
- **UI consistency:** equal-width Run controls, compact `+ sim`, nested grouped
  rows, separate boundary actions windows, compact metrics, explicit wall/floor/
  ceiling assignment, collapse controls, aligned transfer controls and orange-only
  selection are retained and checked. Shared semantic colours follow both planner
  palettes, dark mode and density settings; mobile navigation remains bounded.
- **Account integration:** account/recovery controls follow the planner theme;
  ordinary sign-in returns to the saved floorplan, explicit checkout retains its
  plan, and plans/billing always open in a separate tab. Local exported previews
  have an HTML Plans fallback instead of a dead link.
- **Earlier unpublished worker fixes included:** definite 422 releases rejected
  immutable input; ambiguous dispatch retains its original account/project-scoped
  journal before sending; storage failure prevents dispatch; result GET recovery
  is bounded and never reruns a solve; native probe/flux histories and explicit-unit
  CSV/final metrics are exposed; the API installs the pinned Foamlib extra.
- **Removed code:** replaced all-in-one panel implementation; confirmed unused
  provider, inspector-heading, patch-list, provenance, simulation-title, old
  study-select and connection-status CSS. No unrelated module was removed.

## Test assessment

Age alone did not make a test obsolete. The older baseline browser suites passed
24 tests before the refactor and retained unique state/race/geometry coverage.
The overlapping `climoptixRailway.browser.mts` suite was retired only after moving
its explicit room-to-surface picker and HTTP cancellation/reload cases into the
surface-presentation and recovery suites. Its whitespace/background deselection
checks now accompany actual R3F camera/material assertions; compact metrics,
indentation and collapse assertions moved into the UI-polish walkthrough.
Existing row-width, transfer-column and keyboard cases remain in focused suites.
New tests cover worker-limit immutability/profile advice, malformed capabilities,
numeric native time folders, stale/partial final flux, missing solver timestamps,
late artifact responses, real preview routing and singular Thermal error feedback.
Tests were not deleted
to hide failures or solely to achieve a smaller line count.

Final verification:

- `uv run pytest -q`: **687 passed**.
- `pnpm test:unit`: **614 passed**.
- `pnpm test:projects`: **19 passed**.
- Auth/CFD/planner proxy and actual preview-server tests: **27 passed**.
- **89 unique browser regression cases verified.** The 88-case sweep finished
  87/88: the remaining failure was a new test assertion inspecting Delete after
  navigating away from Simulations. Moving that assertion before navigation
  corrected the test; the final affected-suite run passed **16/16**, including
  that recovery case and the additional Thermal readiness regression. No failing
  case was removed. The final production bundle contains the Thermal fix.
- `pnpm lint`, source usage (426 reachable modules, no orphans), `pnpm typecheck`,
  and the production static Webpack build pass. Next's generated declaration
  imports were restored to development paths; generated output is not committed.
- Desktop/phone, both palettes, light/dark, density and actual R3F camera/material
  screenshots were inspected under `.local-logs/cfd-audit-qa` (not published).

Nonblocking environment/dependency warnings remain: pytest's existing cache ACL,
Starlette's httpx deprecation notice, and Node's module-type warning for the
existing catalogue import. No dependency or global ACL was changed to hide them.

## Independent review and corrections

An independent read-only reviewer examined the entire unpublished diff, including
new files and the earlier fixes. Its two initial actionable findings were corrected:

- **P1 — stale final conservation:** incomplete trailing flux rows now fail final
  acceptance instead of falling back to a previous complete row. Native acceptance
  also requires flux for the final solver iteration, not merely matching old patch
  times. Live telemetry remains intentionally tolerant of in-progress writes.
- **P2 — release-preview Plans 404:** the real preview handler now serves Next's
  extensionless `out/plans` as HTML for both Plans URL variants. A direct loopback
  server test also verifies that encoded traversal cannot escape to a sibling path.

The reviewer checked the fixes and reported one additional **P3** duplicate shared
input alert in Thermal. The readiness banner now owns that shared failure;
Thermal retains only its own preparation error. A browser regression with a
successful thermal preparation reproduced the duplicate in the pre-fix bundle;
the corrected build passed that regression. No reviewer edited files or
changed Git/cloud state. The parent also reviewed the changes and regressions.

## Verification boundaries

Mocked browser transport is integration evidence, not proof of a new OpenFOAM solve.
Native execution is separate: the existing Railway deployment has previously
recorded real startup acceptance for serial steady isothermal SIMPLE with laminar,
kEpsilon and kOmegaSST. This is not new native evidence for the modified sources.
This host has no Docker/OpenFOAM runtime or installed WSL distribution. Railway
SSH refuses access because no key is registered; no key was added. The strengthened
startup gate must pass on the updated native worker before its new runtime code
can be called verified in production. Thermal/CO2/transient/parallel and unsupported
boundary/device/source models remain rejected, not silently substituted.

The specialized Bugbot runner is unavailable. The user approved an ordinary
independent review agent instead; it is not represented as a Bugbot run.

## Publication boundaries

Git publication targets `master`, without force pushing. The API is repository
linked. The existing OpenFOAM worker has no repository source and uses explicit
CLI source uploads; the frontend uses a separate Cloudflare publish command.
Pushing Git alone does not deploy those two services. No manual worker/frontend
upload, new paid solve, production account mutation or credential/SSH change is
part of this audit. Native deployment verification remains a separate release gate.

The Git release includes the assessment and both reproducible per-file count
snapshots. Unrelated nested-website edits and user attachments remain untouched
and excluded. The task handoff records the resulting commit and verifies the
remote `master` revision rather than treating a local commit as a successful push.
