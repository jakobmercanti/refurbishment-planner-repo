# Architecture

## Decision: deterministic kernel with one-way adapters

**Problem.** Fit decisions must remain reproducible even as databases, user interfaces, CAD
versions, and optional AI providers change.

**Decision.** Domain models and the geometry/fit engine form a pure Python kernel. FastAPI,
SQLAlchemy, FreeCAD, and Next.js are adapters around that kernel. Authoritative data flows one way:

```text
domain models -> geometry -> fit rules -> result snapshot
                         -> FreeCAD adapter
                         -> API -> browser viewer
```

FreeCAD and browser rendering consume the same versioned inputs but cannot modify a result.

**Alternatives.** Browser-side collision checks were rejected because JavaScript scene units and
rendering approximations are not authoritative. FreeCAD-only fit checks were rejected because they
would couple rules to a heavy runtime and make fast, isolated testing harder.

## Boundaries

- `geometry.models`: validated engineering inputs and version identifiers.
- `geometry.engine`: Shapely-based deterministic 2D/2.5D fit checks.
- `geometry.walls`: derived wall segments and outward wall footprints.
- `cad`: repeatable FreeCAD generation in a separate process.
- `backend`: HTTP validation and orchestration only.
- `database`: immutable analysis snapshots; no geometry calculations.
- `frontend`: informational editing/viewing boundary; millimetres are converted only for display.

## Versioning and reproducibility

Rooms and products carry explicit positive integer versions. Each `FitResult` records the engine
version, room version, product version, placement, and individual input measurements. Historical
analysis records store the complete input/result JSON snapshots so later product edits cannot
silently rewrite an earlier decision.

## Deferred work

Authentication, supplier workflows, scanning, photorealistic rendering, AI extraction, and a full
catalogue are intentionally outside milestone 1. Interfaces for capture and rendering providers
belong above the deterministic kernel.

