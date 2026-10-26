# 2D plane/delta and adjoint execution audit

## Outcome

**2D planes and supported delta modes: verified; two export-label defects fixed.**

**Native adjoint execution: FAIL / not implemented.** Saving ten requested
movement steps does not perform ten adjoint calculations. The current feature
performs zero native adjoint solves and zero inlet moves. It remains gated off.
This audit does not claim that the requested optimisation loop has been delivered.

The user explicitly authorized pushing `master` even if that triggers online
deployment. No direct cloud deployment, service restart, credential change or
production simulation is part of these checks. The unrelated website gitlink and
attachments are excluded from the commit.

## Plane and delta verification

Added twelve independent numerical cases covering X/Y/Z normals, signed Ux,
speed differences, relative percentage and vector-difference magnitude. The
baseline uses one quadrilateral and the Option uses two triangles. Both hold
nonuniform affine point fields, so an index-wise subtraction, axis swap, image
flip, wrong component or incorrect sign cannot pass as a constant-field result.

The manufactured fields are `A = X + 2Y + 3Z`, `U_A = (A,0,0)` and
`U_B = (-2A-5,0,0)` on the same physical plane. They are analytical test data,
not claimed CFD/adjoint solutions. Expected results are computed independently:

- Signed Ux delta: `-3A-5`.
- Speed delta: `A+5`.
- Vector-difference magnitude: `3A+5`, not the speed delta.
- Signed Ux percentage: `100*(-3A-5)/|A|`.

Tests compare every raster sample to its physical-coordinate analytical result
at relative tolerance `1e-12`, then independently check mean, RMS, full coverage
and three exact point probes per case. Existing tests retain concave/hole masks,
near-zero percentage denominators, different/unknown units, temperature display,
pressure-reference gating, shifted planes, finite-data bounds and native FIELD
output from a retained ordinary solve.

The actual static production application is also tested in isolated headless
Chrome with the real local slice service. For each axis, pixel samples from the
southwest and northeast of Baseline, Option and Delta prove that the contours
are painted and follow the correct physical gradient. With constant coordinate
1.25 m, the mean signed deltas are respectively -16.25, -18.5 and -20.75 m/s.
The Z-plane vector-difference mean is +20.75 m/s. Downloaded nonuniform CSV rows
are checked individually against XYZ, both fields, the percentage expression,
the valid mask and the Option coordinates.

Existing UI regressions retain actual plane navigation, linked pan/zoom, V/Esc,
point replacement, swapping runs, manual legends, PNG/JSON/CSV downloads,
progressive inventory, stale-request cancellation and responsive layouts.

## Defects fixed

1. **Shifted-plane CSV coordinates were ambiguous.** A view-only Option at another
   coordinate could be exported beside the Baseline XYZ without row-level Option
   XYZ. The original seven CSV columns are retained in their original order;
   three explicit `Option_X_m`, `Option_Y_m`, `Option_Z_m` columns are appended.
   Metadata explains their meaning. No delta/common-valid result is invented
   between different physical planes.
2. **Older-worker coordinate compatibility.** CSV uses the selected manifest when
   optional Option-coordinate fields are absent from the v1 numerical response.
   If neither is known for incompatible data, coordinates are left blank rather
   than silently assuming colocation. Tests include a 0.5 m Baseline versus a
   0.7 m Option with the newer response metadata deliberately removed.
3. **Vector-difference PNG quantity was misleading.** Selecting a velocity
   component could label the vector-norm delta as that component. The canvas/PNG
   now explicitly says `|ΔU|`; ordinary component plots keep their component
   label. The actual exported vector-difference PNG is retained for inspection.

No change to the authoritative delta arithmetic was needed: the independent
nonuniform tests confirm its existing sign, physical sampling and formulas.
Project/building geometry and native case files are not changed by result views.

## Exact ten-step adjoint check

Traced the real implementation, not just the UI labels:

- `ClimoptixAdjoint` saves study settings and calls `validateAdjoint`.
- That call posts to `/climoptix/optimisation/prepare`, which checks configuration
  and geometry only. Its capability advertises `canRun=false`, `adjoint=false`
  and `fixedMeshMovement=false`; its iteration list is empty.
- The ordinary worker submission accepts only `mesh` or `run`. The runtime meshes
  a case and optionally executes `simpleFoam`. There is no native adjoint
  invocation, optimisation job route or accepted-movement loop.
- `perimeter_gradient` and `normalised_flux_derivative` are analytical utilities,
  not connected to a validated reduced CFD sensitivity density. Their tests do
  not establish a functioning CFD optimisation direction.

Added backend and real-UI checks for **10 requested steps and 17 mm translation**:
settings save/export correctly; execution remains unavailable; no job/run POST
is issued; no iteration history is fabricated; measured rooms and baseline inlet/
outlet coordinates remain exactly unchanged. A ten-step configuration is therefore
not incorrectly reported as ten completed calculations.

### Remaining native engineering blocker

The requested loop cannot be truthfully verified or enabled without implementing
the native fixed-mesh movable boundary law, inlet/outlet derivatives, coupled
converged primal/adjoint, and persistent worker orchestration. The local runtime
inventory did not expose a usable Docker command or configured WSL distribution;
no new native solve was attempted. Runtime availability alone would not supply
the missing solver implementation.

Before enabling Run, native acceptance must demonstrate: unchanged mesh identity;
finite-difference agreement for all inlet/outlet motion coordinates; actual
recalculation of the adjoint at every new accepted design (not ten uses of an
initial gradient); counted solve IDs; measured objective improvement; chosen
movement magnitude/direction and explicit handling of constraints/line search;
and safe convergence/failure/budget stop reasons. A maximum step setting is not
evidence of any completed solve or of a globally best direction. No fake loop,
finite-difference-as-adjoint substitute or fabricated movement was added.

## Regression evidence

- Full backend suite: **760 passed**, no skips; retained native archive supplied
  read-only. `.local-logs/cfd-plane-loop-backend-full.log`.
- Focused numerical/preparation checks: **64 passed**.
  `.local-logs/cfd-plane-loop-backend.log`.
- Frontend: **643 unit + 19 persistence passed**, no skips.
  `.local-logs/cfd-plane-loop-unit.log`.
- Proxy checks: **25 passed**, no skips.
  `.local-logs/cfd-plane-loop-proxy.log`.
- Focused new pixel/ten-step browser checks: **2 passed**, no skips.
  `.local-logs/cfd-plane-loop-focused-ui.log`.
- Full serial browser regression: **44 passed**, no failures/skips (400.773 s).
  `.local-logs/cfd-plane-loop-ui-full.log`.
- Final slice/export rerun after the readability-only CSV refactor: **7 passed**,
  no failures/skips (57.395 s). `.local-logs/cfd-plane-loop-slices-final.log`.
- Static production build, lint and source-usage check: passed; **465 modules,
  no orphaned modules**. TypeScript and final diff review: passed.
  `.local-logs/cfd-plane-loop-{build,lint,types}.log`.
- Scoped Python Ruff: passed. `.local-logs/cfd-plane-loop-ruff.log`.

Screenshots and actual PNG downloads are local QA evidence in
`.local-logs/cfd-plane-loop-qa/`, including `slices-gradient-{X,Y,Z}.png` and
`gradient-vector-delta.png`. They are not committed application assets.
One pre-existing Starlette/httpx deprecation warning remains. No native CFD
optimisation success or production deployment health is inferred from tests.
