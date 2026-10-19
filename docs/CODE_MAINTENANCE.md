# Code maintenance and reliability checks

Run the complete Python checks from the repository root:

```powershell
uv run ruff check backend geometry cad database scripts tests
uv run ruff format --check backend geometry cad database scripts tests
uv run mypy geometry backend database cad/generator.py
uv run pytest
node --test deployment/planner-worker.test.mjs
```

Run the frontend checks from `frontend/`:

```powershell
pnpm lint
pnpm typecheck
pnpm test:geometry
pnpm test:projects
pnpm build
```

Despite its historical name, `test:geometry` includes all `*.test.mts` and
`*.test.tsx` files: rendering, UI/help conventions, billing, services and building
tests as well as geometry. `test:projects` covers package validation, persistence
and project isolation. `lint` includes the source-usage check. It follows dynamic
imports, worker URLs and deployment imports, not just React imports. This check
needs Git and includes tracked and non-ignored new source files. An orphan warning
requires review of entry points; it is not permission to delete code automatically.

The independent historical marketing site in `freefloorplan3d/` has its own test
command, `node --test tests.mjs` (run inside that folder). The tests build the local worker before importing it, so
stale generated routes cannot influence results. This does not publish the site.
The separately managed `freefloorplan3d-website` checkout is not part of this cleanup.

## Compatibility boundaries

- Keep deterministic geometry, uncertainty and fit calculations in millimetres.
  Rendering must not decide whether an item fits.
- Retain saved-project readers, catalogue upgrade paths and SQL migrations even
  when the current UI no longer writes an old format. They still serve existing data.
- The deployed plans page uses `frontend/lib/commercialCatalogue.ts`. Removing an
  old React billing panel does not make that shared catalogue or checkout APIs dead.
- `heatingWorker.ts` is a browser-worker entry point, not an orphaned library.
- Never identify unused CSS only by similar names: the floorplan SVG uses
  `.plan-grid`, while the retired React billing page used the same class for cards.
- Keep repository-wide formatting mechanical and separate from changes to fit
  decisions or persistence formats; rerun regressions after either.

## Failure paths and external integrations

Tests use isolated storage and mocked providers for queue processing, billing,
rendering and AI generation. They do not spend credits or alter live subscriptions.
Worker tests verify namespace checks before storage access/cleanup, safe error
logging, retry behaviour and rollback. Settings writes and CAD outputs use atomic
replacement; failure tests verify that existing files survive and temporary files
are cleaned up.

The installed FreeCAD runtime can be smoke-tested separately:

```powershell
uv run python -m cad.generator --demo cad/output/maintenance-smoke.FCStd
```

Static and automated tests cannot certify live provider credentials, webhooks or
production infrastructure. Those require an explicitly authorised staging/live
check. A passing suite is not building-code certification or proof of zero defects.
