# CFD mesh inspection

Results → Mesh inspects the final checked OpenFOAM volume mesh in the existing central viewport. The green Mesh badge in each simulation row opens this tab; incomplete badges remain disabled. Inspection never submits a job. This Results location follows the user's request and supersedes the original feature prompt's Solver → Mesh placement.

## Data and geometry

`openfoam_runtime.py` publishes an atomic `mesh-inspection.json` after the existing `checkMesh` gate, before solving. Inspection publication cannot fail an otherwise successful mesh or solve. Retained older cases recover from their result manifest. Raw `constant/polyMesh/{points,faces,owner,neighbour,boundary}` and the proof follow the existing worker volume and job retention policy; the proof is also included in native-case downloads.

`cfd_mesh_inspection.py` checks project/account ownership, expiry, immutable input fingerprints, source checksum, addressing, bounds, patch coverage and measured cell count. Metadata, full boundary geometry and sections have separate authenticated endpoints, also allowlisted by the production proxy. Inspection caches never bypass these checks.

The binary CMI1 adapter consists of an eight-byte magic/header-length prefix, padded versioned JSON metadata, Float64 XYZ points in millimetres, and Uint32 triangle/edge indices. Native solver metres are normalized to millimetres in the adapter. `CFDMeshScene` alone converts to scene metres, using the existing `(X,Z,-Y)` convention.

Full display shows actual boundary polygons and their original edges. Section Only intersects the faces of actual owner/neighbour volume cells. Cached face intervals select candidates. Convex source triangles/quads use batched intersections; concave faces use constrained triangulation. Closed cell-cut loops are filled and triangulated, with a GEOS fallback for complex coincidences. Nested loops preserve holes and disconnected sections. Rounded coordinate keys and canonical polygon deduplication avoid duplicate coincident faces. There is no synthetic grid, architectural surface substitution or result-plane dependency.

## View lifecycle

`useCFDMeshInspection` binds the current study, project, worker and input revision. A pending solver run can fall back to its earlier matching checked mesh. Stale inputs, missing domains, expiry and unsupported data fail closed with guidance.

Inspection scopes the normal scene under one invisible parent and separately suppresses HTML probe labels, result overlays, legends and editing controls. Existing scene components and their preferences stay mounted. Hidden objects cannot intercept picking. The camera snapshot retains position, quaternion, up vector, zoom, target and clipping distances. An in-flight Bounds fit is stopped. Section movement changes geometry without refitting the camera.

Exit, Escape, tab/window closure, source/project changes, request failures and rendering errors release the temporary mode and restore the previous camera and normal scene. Rendering errors have a local guard. Geometry buffers are disposed when replaced/unmounted; client view buffers are cleared on exit. This code does not update project documents, solver inputs, mesh parameters, HVAC objects or saved viewer preferences.

Section requests debounce for 100 ms, abort obsolete HTTP requests and reject late responses by identity. The proxy forwards inspection cancellation. The worker checks disconnects and cooperatively stops obsolete section work. Connectivity has a one-mesh LRU; client and worker geometry caches each retain at most 12 responses / 64 MiB, keyed by mesh checksum and physical section. Equal mesh content can share derived buffers across authorized cases.

## Engineering audit, 18 November 2026

Acceptance mapping:

- A — No mesh/progress/failure/stale/domain states: hook readiness gates and panel disabled actions. Only the completed badge opens the Mesh tab; frontend regression also covers queued Run with an already checked mesh.
- B — Native provenance and geometry: worker API tests cover account/project boundaries, immutable configuration, real counts, pre-solve availability and recovery after an interrupted worker. A disposable native case ran blockMesh, surfaceFeatureExtract, snappyHexMesh and `checkMesh -allGeometry -allTopology`; the final result was `Mesh OK`.
- C — Display modes: solid, boundary edges, transparency and full-opacity reset exercised in the browser with that 16,000-cell native mesh. Resource ownership/disposal reviewed in the renderer.
- D/E — Axes, units and true sections: deterministic tests cover all X/Y/Z directions of a 2×2×2 grid, interior/boundary/coincident planes, tetrahedra, a concave prism, a one-micrometre sliver, nested holes, empty sections and invalid addressing. Node tests verify `(X,Z,-Y)` conversion and exact camera/projection restoration.
- F — Races/resources: identity checks, abort cleanup and bounded caches reviewed; cancellation is tested in the section service, HTTP disconnect handling and proxy. Geometry decoder tests reject wrong mesh/axis, truncation, non-finite coordinates and invalid indices. Legacy manifest recovery and changed-source rejection are tested against a populated geometry cache.
- G/H — Geometry/read-only boundaries: native pipeline output and concave/holed fixtures exercise actual topology. API tests compare retained files before/after requests. Source transforms are independent of floorplan/screen axes. No separate multi-floor browser fixture was exercised.
- I — Browser controls and resize: the green badge, Mesh tab, Inspect, display modes, opacity reset, Section Only, X/Y/Z selection, numeric metres, next/center/reset controls were exercised. Read-only DOM measurements at 1024×800 and 360×800 found no horizontal overflow or clipped controls. Existing theme tokens and focus/disabled styles are reused.
- J — Bounds/performance: see measurements below. Large topology processing stays on the worker, outside the browser main thread.

Defects fixed during the audit: empty single-cell neighbour lists; nested-hole containment; repeat triangulation cost; optional inspection data blocking successful solves; invisible objects intercepting result picks; unsynchronized opacity display; retained CPU buffers after tab exit; interrupted camera fitting; render-error recovery; and missing cancellation through the proxy.

Commands and observed results:

```text
uv run pytest tests/test_cfd_mesh_inspection.py tests/test_openfoam_worker.py -q
51 passed (one existing Starlette/httpx deprecation warning)

cd frontend
pnpm exec tsx --require ./tests/css-register.cjs --test tests/cfdMeshInspection.test.mts tests/railwayCFDWorker.test.ts
6 passed
node --test ../deployment/cfd-worker-proxy.test.mjs
6 passed
pnpm exec tsc --noEmit --incremental false
passed
pnpm lint
passed, including source-usage check

uv run ruff check backend/app/cfd_mesh_inspection.py backend/app/openfoam_runtime.py tests/test_cfd_mesh_inspection.py
passed
```

FastAPI tests required execution outside the Windows sandbox because its loopback socket-pair creation was blocked. Temporary audit scripts, fixture UI and native cases were kept out of the commit.

## Visual audit and remaining verification

The browser visibly rendered the native boundary mesh, transparent mesh and filled internal sections with cell partitions. Entering inspection removed the architectural scene, probe marker, normal viewer controls and legends. Functional measurements confirmed the SI position controls and responsive widths above.

Screenshot capture later timed out after viewport changes. Computer Use then stopped because it could not establish the current browser URL confidently. No screenshot artifact is claimed. Live exit/restoration, dark-theme rendering and touch interaction could not be completed in that browser pass. Exact camera restoration is covered by the automated Three.js test; full normal-scene restoration has been reviewed in code.

To finish those visual checks manually: load a checked mesh with building/results/probes already visible; record the current camera; inspect and orbit the mesh; exit and compare the camera and all layers; repeat by leaving the Mesh tab and closing setup. Repeat at narrow width and in dark theme, including an aborted request and worker error. These checks do not require a new CFD solve.

## Measured performance and supported limits

Local Windows/Python timings, without network latency:

- Native checked mesh: 16,000 cells, 50,000 faces, 18,081 points. Parse/index: 0.20 s. Fresh X/Y/Z sections: 0.23 / 0.44 / 0.45 s, with 400 / 800 / 800 intersected cells and 73–145 kB response buffers. Repeating an authenticated section request: 0.009 s after a 0.46 s cold request.
- Structured comparison mesh: 97,336 cells, 298,356 faces, 103,823 points. Parse/index: 1.53 s. Fresh sections: 1.15–1.22 s for 2,116 cells, about 379 kB. Python allocation tracing during parsing peaked at approximately 130 MiB; this is not total process/GPU memory. Large fresh sections are not claimed to be frame-rate updates.

Detailed source input is limited to 192 MiB, 500,000 cells, 4,000,000 faces and 2,000,000 points. Binary geometry responses are limited to 48 MiB, 1,000,000 triangles and 2,000,000 edges. Oversized detailed boundaries offer section inspection instead of silently decimating.

Supported: native ASCII single-fluid/default-region polyMesh, arbitrary polygonal faces, tetrahedral/polyhedral cells, disconnected fluid parts, concave sections and holes. Warped faces use a consistent piecewise-linear triangulation through source vertices. Self-intersecting/degenerate faces are unsupported. Binary/compressed polyMesh needs ASCII conversion; a VTK result plane is never accepted as proof of a volume mesh. There is no new mesh importer or multi-material/conjugate region loader. Transparency uses standard approximate WebGL depth sorting. Connectivity is reparsed after a worker restart; no permanent duplicate of the volume mesh is created for inspection.
