# Renovation Fit project guidance

- Renovation Fit verifies whether products fit measured rooms. Keep deterministic geometry and uncertainty calculations authoritative; visual output must never drive fit decisions.
- Repository layout: `geometry/` is the domain kernel, `backend/` is FastAPI, `cad/` is the FreeCAD adapter, `frontend/` is Next.js/React Three Fiber, and `tests/` contains regression coverage.
- All authoritative coordinates, dimensions, clearances, tolerances, and uncertainty values use millimetres. Only convert to scene units at the Three.js rendering boundary.
- Preserve unrelated uncommitted changes. Do not reset, discard, or reformat files outside the task.
- For bug fixes, identify the cause, make the smallest in-scope change, and avoid unrelated refactors.
- For UI work, use the reported reproduction path and verify the observable outcome; do not infer a fix from a vague label alone.
- Use `uv run pytest` for backend checks. Use `pnpm lint` from `frontend/` for frontend linting when the Node runtime is available.
- Keep final updates brief: changed files, validation performed, and any remaining blocker.

## Additional frontend guidance

Read and follow `frontend/AGENTS.md` before changing frontend code. It contains framework-specific instructions.
