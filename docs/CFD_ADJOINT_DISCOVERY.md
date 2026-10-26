# Vent-position adjoint: discovery and delivery plan

Date: 2026-10-26. Brief: `climoptix_adjoint_vent_optimisation_codex_prompt.txt`, Drive file `1xTXEUTdcLzRvx3YQ9Up0OEMBqCixyRdh` (version 1.0). Local-only work; no deployment or remote push.

## Evidence and capability boundary

- `geometry/climoptix_models.py` / `frontend/lib/climoptixDocument.ts` already describe finite rectangular/circular vents, normalized support-local positions and dormant optimisation intent. They do not contain an optimiser.
- `backend/app/climoptix_provider.py::_prepare_vents` constructs true planar support frames, subtracts vent holes from the canonical skin and checks footprints/clearance against original face polygons. Doors/windows terminate domain discovery; this must remain unchanged.
- `backend/app/openfoam_case.py` generates separate vent patches. `openfoam_runtime.py` unconditionally invokes blockMesh, feature extraction, snappyHexMesh and checkMesh before simpleFoam. Translating a vent currently changes the skin and mesh. There is no invariant boundary-face mask representation, its tangent action, or its adjoint.
- The isolated worker uses pinned OpenCFD v2312; steady, isothermal SIMPLE U/p only. Thermal/scalar/buoyant/transient studies and applied heating conditions are rejected. Pressure is kinematic m²/s². No valid thermal, scalar, turbulence or pressure-outlet position adjoint has been demonstrated.
- Supabase-authenticated worker jobs use owner-scoped SQLite, immutable payloads, bounded execution, retention, cancellation and artifact downloads. Results / 2D Slices already handle verified run references and common-coordinate comparisons. None should be bypassed by a separate simulator.
- UI state is persisted with the project; optional additive scenario metadata can preserve old projects. Exclude optimisation preparation metadata from solver fingerprints and submission bodies so editing a draft cannot invalidate an unchanged physical case or break an older worker.
- Official v2312 documentation describes shape/topology optimisation, not proof of a compatible normalized moving boundary-mask derivative: [OpenCFD release notes](https://www.openfoam.com/news/main-news/openfoam-v2312/numerics), [manual](https://www.openfoam.com/documentation/files/adjointOptimisationFoamManual_v2312.pdf). Local WSL inventory is permission-restricted; no claim about installed adjoint binaries or native benchmark execution is made.

## Implementation plan for an honest gated delivery

1. Versioned, bounded configuration contract mirrored in Python/Zod; saved configurations with source/configuration binding, selected ports, locks, metric movement bounds, clearance, objective and accepted-move/compute budgets. No fabricated iteration histories.
2. Stateless authoritative preparation endpoint: recompute source geometry, derive support frames, inspect full rotated footprints, domain holes, other vents and movement bounds; distinguish current starting-layout feasibility from unverified future paths. Return actionable per-port diagnostics and explicit fixed-mesh/adjoint blockers. No solver launches or user expressions/paths.
3. Integrated main-window Adjoint Optimisation tab with functional save/clone/remove/validate/export and existing Boundary/Solver/Results navigation. Selection uses existing viewer markers. All execution remains disabled until a real compatible backend is implemented and validated; no pseudo progress, best design or unavailable pause/resume controls.
4. Isolated mathematical perimeter-quadrature utility: outward in-plane normals for rotated rectangles/circles, positive sharp-mask convention `grad J = integral g n_edge dl`, descent `-grad J`. Test constant cancellation and analytic translation derivatives with refinement/finite differences. These are mathematical tests, NOT CFD adjoint validation. No synthetic density is shown as a CFD result.
5. Run focused contract/API/unit/browser regressions, desktop/tablet/mobile visual checks, and separate mathematical/physical and usability audits. Record unsupported acceptance items rather than claim the requested full optimiser is complete.

## Explicit outstanding engineering milestones

Production fixed-mesh wall-exchange BC with conservative inlet normalization and derivative; pressure/extraction outlet law and derivative; converged coupled residual linearization/transpose solve; actual inlet/outlet U/V gradient finite-difference sweeps on a pinned laminar CFD benchmark; leakage/conditioning/resolution evidence; invariant mesh hash/cell addressing; durable multi-step worker lifecycle; accepted/best result artifacts and apply-as-new-scenario; gradient-free cost comparison. These cannot be replaced by a disconnected reduced simulator, a stock aerodynamic shape sensitivity or finite differences labelled adjoint.
