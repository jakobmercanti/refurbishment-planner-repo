# CFD Results: 2D slices and comparison

Source brief: `climoptix_cfd_results_2d_slices_comparison.txt` on Drive,
file `1HPoKHJdKkewnsax0QXWaTSuO-XB07FaA`, version 1, 26 October 2026.
This work is local only. No deployment, remote push or native solve is authorized.

## Discovery and plan (before implementation)

- Results lives in `ClimoptixResults`, inside the existing Simulation setup
  Results panel. Existing downloads, residual charts and independent vtk.js
  inspector stay intact. New controls belong only in this Results subtree.
- `RailwayCFDWorker` lists the authenticated owner's last 100 project jobs;
  `useCFDJobs` retains only the latest per study. Comparison must list jobs
  independently, not silently treat current studies as run history.
- Worker SQLite records immutable project/study/revision/payload and timestamps.
  Owner checks are in `Store.get`; downloads validate SHA-256 and path containment.
  There is no Supabase result bucket or existing numerical comparison service.
- `openfoam_case` writes native ASCII legacy POLYDATA via OpenCFD v2312 surfaces,
  `cellPoint` interpolation at field-write cadence. `openfoam_runtime` retains
  only the latest time as browser artifacts, with older outputs in case storage.
  Existing `/result` and artifact endpoints only serve terminal jobs. No live
  complete-plane publication contract exists; do not call raw growing files ready.
- Case coordinates are global X/Y/Z in metres, Z vertical. Authoritative project
  geometry is millimetres; native boundary conversion is mm/1000. The main Three
  viewer uses [X,Z,-Y]; the new 2D plot uses physical [Y,Z], [X,Z], [X,Y].
  Existing domain hashes include rooms, floors, stop openings, roofs and equipment;
  Results must use the pinned case, never recalculate from current geometry.
- Native solver is steady `simpleFoam`, U in m/s, p kinematic in m2/s2, NOT Pa.
  Native output iteration is not elapsed physical time. Unsupported thermal or
  tracer fields cannot be invented. Unknown units/reference frames block delta.
- Existing `useCFDPointProbe`, `sampleResultPoint` and `ResultPointValue` define
  V toggle, Esc exit, one replaceable readout and real barycentric/cell sampling.
  Reuse this controller in Results, retaining the original 3D controls unchanged.
- Shared CSS lives in climoptix.css/density.css; Results uses native styled
  selects, details, token colours and responsive grids. Browser tests use isolated
  production static builds and Playwright; backend tests block external network.

Implementation sequence:

1. Bounded server reader/plane manifest and physical sampling adapter over stored
   native surfaces; common-grid comparison with masks, semantics and area statistics.
2. Authenticated worker routes and narrow proxy allowlist; project/owner/expiry,
   source hash and per-asset digest validation. No arbitrary server file paths.
3. Results-only Single Run / Compare Runs with real X/Y/Z navigation, shared
   colour range, linked pan/zoom, four labelled panes and collapsible controls.
4. Reuse V/Esc probing; full vector comparisons at one physical location, exact
   coordinates, scope invalidation, persisted per-user/project display state.
5. Metadata/CSV/plot export, cancellation/cache bounds and progressive publication
   only for atomically completed snapshots; truthful pending/unsupported states.
6. Functional/scientific audit, then actual responsive/light-dark UI audit;
   fix findings and record exact test commands, evidence and remaining limits.
