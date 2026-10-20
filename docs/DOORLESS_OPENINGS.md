# Doorless openings

Choose **Doors → Openings** in Add to plan or the object catalogue. The six templates are single, double, wide rectangular, round arch, shallow arch and chamfered. Width and height remain editable; all stored dimensions are millimetres. Height is measured to the crown, so arched and chamfered openings have less headroom at their sides.

These are real wall cuts, not doors with hidden leaves. They have no hinges, swing envelope or door purchase quantity. The asset preview shows the cut in a wall section. On shared room walls, both room faces use the same aperture. Editing, Undo, project reload, floor copying and portable project export retain the profile.

## Data and geometry

- `frontend/lib/doorModels.json` defines the six catalogue models in `doors-openings`; default database seeding and category navigation consume this shared definition.
- Doorway records retain `kind: DOOR` for placement compatibility and carry a validated `passage_profile`: `RECTANGULAR`, `ROUND_ARCH`, `SEGMENTAL_ARCH` or `CHAMFERED`.
- `frontend/lib/passageOpenings.ts` computes profile elevations and exact clear area. Quantities and heat-loss wall areas do not depend on rendered meshes.
- `geometry/opening_profiles.py` provides the matching deterministic millimetre geometry for CAD. FreeCAD cuts a sampled elevation through the wall; it does not add a door swing.
- Reveal geometry is rendered once on the wall owner, with profile coordinates preserved across split shared-wall spans.

An opening is not a structural design or a headroom compliance assessment. Confirm support and clearances separately. Heat loss through air transfer to a colder space is not modelled; such a boundary is flagged for review instead of being treated as a sealed door.

## Regression coverage

- `tests/test_passage_openings.py`: catalogue seeding, validation, domain collision behaviour and CAD snapshot profiles.
- `frontend/tests/passageOpenings.test.mts`: all six models, profile area and split spans, plan symbols, quantities, skirting, heat-loss warnings and help text.
- `frontend/tests/buildingPersistence.integration.mts`: multi-floor IndexedDB and portable package round trips for all six templates.
- `frontend/tests/browser/passageOpenings.browser.mts`: catalogue and live previews, shared-wall placement, 3D rendering, reload, editing, Undo and deletion.

Run `uv run pytest`, `pnpm test`, `pnpm lint`, `pnpm typecheck` and the production-build browser suite using the repository's normal test setup.
