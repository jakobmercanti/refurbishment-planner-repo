# Renovation Fit

Renovation Fit is an engineering-first platform that determines whether a real product fits
inside a measured room. The authoritative path is deterministic: verified measurements,
manufacturer specifications, explicit uncertainty intervals, geometry, fit rules, and only then
CAD/browser visualisation.

Milestone 1 uses an L-shaped bathroom, an inward-opening door, a window, a vanity obstacle, and a
parametric shower enclosure. It produces reproducible `FIT`, `VERIFY`, and `FAIL` results with
numeric explanations.

## Truth hierarchy

1. Verified user measurements
2. Verified manufacturer dimensions
3. Deterministic geometry
4. Explicit uncertainty calculations
5. CAD representation
6. Browser visualisation
7. Optional generative rendering

Visual output never feeds back into fit decisions. When uncertainty can change the result, the
engine returns `VERIFY`, never an unjustified `FIT`.

## Repository layout

- `geometry/`: authoritative domain, geometry, uncertainty, fixture, and fit-rule code
- `cad/`: headless FreeCAD adapter and worker
- `backend/`: FastAPI transport layer
- `frontend/`: Next.js/React Three Fiber engineering viewer
- `database/`: versioned persistence records, separate from the geometry kernel
- `fixtures/`: serialised regression inputs
- `tests/`: deterministic regression suite
- `docs/`: architectural and engineering decisions

## Local development

```powershell
uv sync
uv run pytest
uv run uvicorn backend.app.main:app --reload
```

In another terminal:

```powershell
cd frontend
pnpm install
pnpm dev
```

Generate the demonstration CAD model with an installed FreeCAD command line:

```powershell
uv run python -m cad.generator --demo cad/output/l_shaped_bathroom.FCStd
```

The internal authoritative unit is always millimetres. See `docs/UNITS.md` and
`docs/GEOMETRY.md` before changing geometry code.

Current milestone boundaries and known limitations are recorded in `docs/LIMITATIONS.md`.
