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
pnpm test
pnpm build
```

`pnpm test` runs the unit and project-integration suites. Discovery is recursive
and includes `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs` and `.cjs` tests.
Use `.test.*` for units, `.integration.*` for project integration and `.browser.*`
for browser tests. Helpers are not tests. A missing suite fails instead of reporting
an empty successful run. `test:unit` and `test:projects` run individual suites;
the historical `test:geometry` name remains a compatibility alias for `test:unit`.
`lint` includes the source-usage check. It follows dynamic
imports, worker URLs and deployment imports, not just React imports. This check
needs Git and includes tracked and non-ignored new source files. An orphan warning
requires review of entry points; it is not permission to delete code automatically.

The independent historical marketing site in `freefloorplan3d/` has its own test
command, `node --test tests.mjs` (run inside that folder). The tests build the local worker before importing it, so
stale generated routes cannot influence results. This does not publish the site.
The separately managed `freefloorplan3d-website` checkout is not part of this cleanup.

## Current browser regressions

Build a local production export first (from `frontend/`):

```powershell
$env:PLANNER_STATIC_EXPORT='true'
$env:NEXT_PUBLIC_BASE_PATH='/planner'
$env:NEXT_PUBLIC_API_URL='/planner/engineering-api'
$env:NEXT_PUBLIC_COMMERCIAL_API_URL='/planner/engineering-api'
$env:NEXT_PUBLIC_ENABLE_PROGRAMMER_TOOLS='false'
pnpm build
pnpm test:browser
```

Browser tests require Playwright and an installed Chrome browser. An external
Playwright installation can be supplied through `PLAYWRIGHT_MODULE`; set
`BROWSER_CHANNEL=msedge` to use Edge. Missing dependencies fail explicitly rather
than silently skipping coverage. No browser is downloaded by this command.
The harness starts its own loopback-only server on a free port, uses disposable
contexts and synthetic projects, blocks external browser requests, and closes
the server/browser on completion. It never targets an existing user browser or
the live website. Browser tests intentionally run separately from fast unit tests.

The current suite replaces the old `check-shipping`, `check-ui-theme` and
`check-floorplan-styles` scripts. It checks actual UI actions rather than retired
menus, administrator-setting writes or source-code spellings. It covers current
sign-in navigation, preferences/help, drawing/export styles, heater picking,
insulation Cancel/Apply/Undo, destructive outline confirmation, native project
download/reopening and free local GLB import/placement.

The experimental `.recognition-port` tests were removed: they imported a module
that is not in the running backend, required unlisted OpenCV dependencies and
referenced an absent local drawing. Current drawing calibration and polygon
detection tests remain; no automatic-recognition feature is implied by them.

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
Python test configuration sets temporary database/settings paths before application
modules are imported, removes inherited provider credentials for the process and
rejects unmocked outbound network transports. These settings are restored after
the run. Tests must also pass independently of module/collection order. FreeCAD
discovery tests use temporary binaries instead of depending on one installed version.
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
