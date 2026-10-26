# Pass one: mathematical, physical and implementation audit

## Outcome and scope

**Preparation layer operational; requested CFD optimiser NOT complete.** This is a separate engineering audit pass by the implementing agent, not an independent external CFD certification. No production fixed-mesh boundary, native adjoint, accepted movement, best design or optimisation worker has been implemented. The feature fails closed for every solver mode. The staged/unavailable provision in the Drive brief is used explicitly; neither analytic tests nor a normal simpleFoam result is relabelled as an adjoint.

Discovery and sequence: [CFD_ADJOINT_DISCOVERY.md](CFD_ADJOINT_DISCOVERY.md). The pre-existing 2D slice/comparison implementation remains independent and unchanged by this work.

## Mathematical convention and measured verification

For a translated footprint A(p), m(s,p)=1_A(s−p), so ∂p m=−∇s m=n_edge δ_boundary(A). With a **full reduced** sensitivity density g=δJ/δm, the sharp translation gradient is `∇p J = ∮ g n_edge dl`. The unconstrained descent is its negative. `n_edge` is the outward **in-surface** normal, never the three-dimensional wall normal. g has units J/m², dl has units m, and the translation gradient has units J/m. A primal colour or local cost value is not g.

`geometry/vent_position_gradient.py` integrates all four rotated rectangle edges with Gauss–Legendre quadrature, or the entire circle with periodic quadrature. It takes a trusted numerical callable, not user executable text. It is NOT wired to a CFD density because none has been validated. SI metre arguments are explicitly named numerical inputs; saved project geometry, frames, dimensions and clearance remain millimetres.

For integrated prescribed inlet flux `F_a = Q A_a m_a / S`, `S=Σ A_b m_b`, the implemented algebra includes both terms in `∂p F_a = Q(A_a ∂p m_a/S − A_a m_a ∂p S/S²)`. Its sum is zero while ΣF=Q. This is **only a derivative identity**; it does not prove pressure–velocity BC stability, no-slip outside a mask, wall leakage, pressure-outlet sensitivity or physical mesh resolution.

The future residual convention must be `R_qᵀ λ = −J_qᵀ`, `dJ/dp = J_p + λᵀR_p`; all coupled state and BC terms must be differentiated. No transpose residual solve is currently supplied.

Measured analytic checks (rectangles/circles; orientations 0°,31°,90°; both tangent directions; perturbations 10⁻²,10⁻³,10⁻⁴,10⁻⁵ m):

- Maximum absolute error against the known affine-density gradient: **2.4424906541753444e−15**.
- Maximum absolute error against the analytic functional's central differences: **5.00111063672648e−12**.
- Constant closed-perimeter density cancels within 2e−14; a deliberately reversed gradient fails the sign check.
- Nonpolynomial circle quadrature refinement and normalized-flux central differences are tested.
- **Native primal solves: 0. Native adjoint solves: 0. CFD gradient error, leakage, adjoint memory/runtime, local-search cost comparison: not measured.** No accepted mesh hashes/cell IDs or repeated-adjoint counts exist to confirm.

## Requirement trace and acceptance matrix

- Brief 00/01: shared domain kernel and existing worker architecture inspected. Vent sizes/supports are captured, not moved. Domain discovery is untouched. Supported **ordinary** execution remains steady isothermal SIMPLE U/p; optimisation for laminar, RANS, thermal, buoyant and scalar modes remains unavailable.
- Brief 02: integrated tab, saved configurations, current-case capture, selected existing marker, locks, local movement bounds, explicit objective definitions and budgets, server validation, clone/remove, JSON/CSV export and navigation operational. Ghost drag/confirm preview, arbitrary occupied zones, composites/linkages, sensitivity overlays, execution/history/apply-best are not implemented.
- Brief 03 / acceptance A,E: **blocked**. Current adapter cuts actual vent holes and remeshes. No normalized mixed/transpiration/porous wall law has been installed; no mesh invariance or physical flux/leakage evidence is claimed. The existing executable is not silently reused.
- Brief 04: explicit worker capability `optimisation.canRun=false`, `adjoint=false`, `fixedMeshMovement=false`. No optimisation run endpoint or queue insertion exists. No thermal or frozen-turbulence adjoint claim.
- Brief 05 / acceptance B,C: analytic perimeter and normalization identities tested. Acceptance D (inlet AND outlet U/V CFD gradient sweeps) is **blocked**. There is no outlet gradient to reuse as an inlet gradient or vice versa.
- Brief 06 / acceptance F,G,I: **blocked**. Accepted-step and solve/wall-clock budgets are validated configuration intent, not functioning orchestration. No fake iteration counter, progress percentage, pause/resume checkpoint, line search or best result is exposed.
- Acceptance H: conservative swept footprint/spacing checks include fixed and movable neighbours. Future paths and corner transfers are not executed. Moving to another surface changes the physical fingerprint and requires a new configuration.
- Acceptance J: real MONO inclined-ceiling frame, original host polygons/holes, rotated footprints, normal vectors and existing domain regressions tested. Nearby three-dimensional obstruction sweep and fixed boundary-face coverage remain unverified and are explicitly disclosed.
- Acceptance K: energy, buoyancy, CO₂, transient or applied-heating intent generates an actionable capability issue; execution is always false. No source/physics is silently disabled.
- Brief 07 / acceptance M,N: bounded optional version-1 `scenario.adjointStudies` metadata; frozen baseline footprints/frames; source/config/revision binding; strict port/settings/objective models; saved/clone/remove/export/reload. Old projects remain loadable. Cosmetic draft edits are excluded from ordinary solver fingerprints and handoff bodies. No DB migration or new SaaS/storage infrastructure. Executed history/artifacts/worker recovery remain **blocked**.
- Acceptance L: existing worker, geometry, slice, probe, thermal import, window and vent-dragging regressions exercised; details in the UX audit.
- Acceptance O: existing Results 2D comparison stays available for actual ordinary runs. No optimisation baseline/best comparison is created because no best run exists. No fabricated delta is supplied.
- Brief 08/09/10: deterministic tests and two distinct audit passes supplied. **Not all requested stages or acceptance requirements are complete.** Full native adjoint verification and an independent solver-engineering review are still prerequisites for release of execution.

## Issues found and fixed

1. Initial region checker incorrectly treated inter-port minimum spacing as wall-edge clearance. Separated wall clearance from pairwise spacing; actual full-footprint tests pass.
2. A long Unicode `\w` support-ID regex exceeded Pydantic's compiled regex bound. Replaced with the existing ASCII identifier alphabet and explicit length bounds; the entire provider imports and regressions run again.
3. Pydantic Literal(1) accepted boolean true. Added an explicit integer version validator and rejection tests.
4. Historical draft display originally depended on current vent dimensions. Added frozen footprint/support frame snapshots and canonical server-side comparison; source edits never rewrite them.
5. Added finite/overflow guards to mathematical utilities. Unknown objective expressions, nonfinite values, fractional/bool step counts, zero steps and insufficient budgets are rejected.
6. Kept all ordinary CFD preparation/worker fingerprints independent of saved optimisation drafts. Transport strips the new optional metadata for older workers; duplicate ordinary simulations do not silently inherit revision-bound studies.

## Reproducible checks

Final pass results: **219 backend checks passed** (including 32 new preparation/mathematical cases and the retained native ZIP read test; no skips), **640 frontend unit + 19 persistence tests passed**, **21 planner proxy checks passed**, and **40 production-export browser tests passed** (no skips; 387.735 seconds for the browser sweep). Backend sweep elapsed 23.36 seconds. These are test-suite timings, not CFD/adjoint runtime metrics. Production static build, frontend lint/type checking, scoped Ruff and strict mypy pass.

See `.local-logs/adjoint-backend-regression.log`, `adjoint-unit.log`, `adjoint-proxy.log`, `adjoint-lint.log`, `adjoint-types.log` and `adjoint-static-build.log`. Backend uses a fresh explicit pytest basetemp and `-p no:cacheprovider`; retained native ZIP audit reads existing results without a new solve. New mathematical modules pass Ruff and strict mypy. One existing Starlette/httpx deprecation warning remains; no unrelated dependency migration was attempted.

## Exact change groups and persistence

- New geometry: `geometry/climoptix_adjoint.py`, `geometry/vent_position_gradient.py`.
- Updated geometry contract: `geometry/climoptix_models.py`.
- New backend: `backend/app/climoptix_adjoint.py`.
- Updated API/boundaries/capability/fingerprint: `backend/app/climoptix_api.py`, `backend/app/main.py`, `backend/app/climoptix_provider.py`, `backend/app/openfoam_service.py`.
- New UI/client/schema/style: `frontend/components/ClimoptixAdjoint.tsx`, `frontend/lib/cfdAdjoint.ts`, `frontend/lib/cfdAdjointDocument.ts`, `frontend/app/cfd-adjoint.css`.
- Integrated UI: `frontend/components/ClimoptixWindowMenu.tsx`, `frontend/components/ClimoptixWorkspace.tsx`, `frontend/lib/climoptixHelp.ts`, `frontend/app/climoptix.css`, `frontend/app/layout.tsx`.
- Ordinary-handoff compatibility: `frontend/lib/climoptix.ts`, `frontend/lib/climoptixDocument.ts`, `frontend/lib/climoptixJobs.ts`.
- Same-origin public preparation proxy: `deployment/planner-worker.mjs`, `deployment/planner-worker.test.mjs`.
- Tests: `tests/test_climoptix_adjoint.py`, `frontend/tests/cfdAdjoint.test.mts`, `frontend/tests/browser/cfdAdjoint.browser.mts`, `frontend/tests/browser/harness.mjs`.
- Documentation: this audit, discovery note and UX audit. **No SQL/DB schema change.** Existing project save/undo/persistence owns optional preparation metadata. No worker job, result field or mesh is stored by this endpoint.

## Next engineering work (not enabled)

Implement and natively validate a fixed wall-exchange law on a once-prepared boundary-face set; derive inlet normalization and distinct outlet derivatives; implement a consistent converged laminar primal/adjoint; verify all four inlet/outlet coordinates with mesh/smoothing/epsilon sweeps and leakage metrics. Only then implement the checkpointed projected multi-step runner and real accepted/best artifact integration. Native benchmark evidence and independent physical review must precede enabling Run. No claim of global optimality is permitted.
