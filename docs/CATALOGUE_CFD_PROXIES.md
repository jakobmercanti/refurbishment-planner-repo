# Catalogue inspection and CFD obstruction geometry

Object details use a large two-column dialog: scrollable catalogue information on the left and an orbit/zoom/Fit viewer on the right. On smaller screens the viewer stacks above the properties. The Asset view preserves detailed parametric or uploaded STL geometry. Unknown models are labelled as dimension envelopes.

Eligible entries also offer **CFD shape**. This is a separate, application-owned obstruction representation, not a replacement for the visual model or measured fit geometry. It is not connected to a CFD solver.

## Coverage and assumptions

Twenty-nine reusable profiles cover standing/seated/supine occupants, tables, solid/open-back chairs, stools, upholstered seating including handed corner sofas, beds, cabinets/appliances, basins/WCs/baths, and six shower tray/panel arrangements. Large passages under tables, seating, beds and raised slipper baths are retained, as are chair-back openings and corner-sofa voids. Wall basins and wall-hung WCs do not acquire fictitious floor-reaching pedestals. Curved baths, corner basins and quadrant showers use a few straight facets. The inset corner bath retains its predominantly square deck with a clipped corner; it is not treated as a quadrant shower. See [People catalogue](PEOPLE_CATALOGUE.md) for occupant posture, placement and support-datum limitations.

Upholstery seams, handles, taps, drains, bowl cavities, fine spindles and decorative curves are omitted or sealed. Coarse feet remain where they support a major airflow gap. Profiles have generic proportions within the catalogue envelope; they are not scans or manufacturer models. A solid envelope is deliberately conservative for unknown furniture and storage. Inspect each approximation before using it for flow analysis.

Shower proxies are particularly approximate: panels are thickened to 4% of width/depth. Walk-in entrances and wet-room side passages remain open. Alcove, corner, quadrant and freestanding screens represent the nominal closed configuration; the freestanding shell stays open at the top. Missing room walls are not invented. Confirm actual glass thickness, door state and surrounding room walls before meshing.

The preview outlines local z=0 without adding a floor or exporting that guide. Raised fittings show their nominal underside height above that origin. These are catalogue-local coordinates, not guaranteed room mounting elevations; check placement and origin when assembling a room case.

Doors, room openings, windows, electrical devices, surface materials and staircases do not receive these furniture proxies. Radiator/cabinet/appliance envelopes do not encode heat-source boundary conditions or detailed heat-transfer surface area.

## Persistence and API

`furniture_items.cfd_proxy` stores a versioned profile reference. An additive startup migration/backfill adds this without changing dimensions, product models or user descriptions. Create/update operations derive the profile from the same eligibility rules; clients cannot supply arbitrary geometry through the catalogue form.

- `GET /catalog/items/{id}/cfd` returns the deterministic surface: vertices and catalogue dimensions in **millimetres**, indexed triangles, profile label, geometry revision and assumptions. Transport/spec version remains 1; the audited geometry revision is 2.
- `GET /catalog/items/{id}/cfd.stl` downloads that same surface. STL has no formal unit metadata; the filename/header identify millimetres. Apply the correct unit scale in the mesher (for example, mm to metres is 0.001).

The public planner proxy permits only these two additional read routes; catalogue writes remain blocked. These exports describe catalogue templates, not an assembled or simulated project scene.

`geometry/cfd_profiles.py` defines a small union of upright polygonal prisms. `geometry/cfd_surface.py` builds only the exposed boundary, merges coplanar patches and uses constrained triangulation. Shared feature vertices are inserted on adjacent faces before triangulation to avoid T-junctions and cracks, including on oblique facets. Joined parts have no internal faces or loose fittings. Current profiles contain 12–128 surface triangles. `geometry/cfd.py` scales these recipes into millimetres and caches immutable meshes. Changing catalogue dimensions rebuilds the shape; the rendering boundary alone converts coordinates to preview scene units. No CFD proxy participates in fit, collision, clearance or uncertainty calculations.

## Reliability checks and limits

Regression checks cover every profile at multiple scales: positive outward volume, exact bounds, two oppositely oriented incident faces per edge, connectedness, nonzero triangle area, no internal faces, and an independent inclusion-exclusion volume calculation. All built-in fixture models are also audited for eligible coverage and bounded triangle counts. API checks cover persistence, changed dimensions, excluded categories and millimetre STL output. Browser checks cover the enlarged layout, zoom/Fit/orbit, mode switching, errors, light/dark themes and narrow screens.

Independent ray/triangle probes check exported airflow paths and obstruction positions: underside gaps, full-height headboard, handed sofa voids, chair backs, raised sanitary fittings, bath footprints and shower entrances/screens. Optional mesh-audit checks reject empty, inverted and degenerate tetrahedra.

For a repeatable read-only catalogue audit, run `uv run python -m scripts.audit_cfd_assets --output-dir .local-logs/cfd-audit`. Supplying `--gmsh <path-to-gmsh> --verify-stl` additionally meshes one fluid domain per used profile at fixed 100 mm sizing and volume-meshes every exported profile STL. Gmsh is an optional QA tool, not an application dependency. All generated files stay in the chosen QA directory. The optional `--baseline` accepts the retained v1 QA checkpoint for historical comparison.

The 20 October 2026 local audit covered all 112 eligible records and 26 profile definitions (25 used by this catalogue). Aggregate exported surface triangles fell from 6,320 to 3,992, a 36.8% reduction. All 26 exported STL surfaces volume-meshed, with positive cells and matching volumes. The paired [Gmsh](https://gmsh.info/doc/texinfo/) fluid-domain comparison used identical per-case dimensions, 100 mm min/max sizing, disabled point/curvature/boundary size propagation, no boundary layers and one thread. Nine cases had fewer volume cells, two were unchanged and fourteen increased: 567,436 to 582,280 cells in aggregate (+2.6%). Restoring real flow passages and fluid volume can require more cells; lower surface triangle counts are not a promise of fewer volume cells. These are synthetic mesh checks, not simulation-accuracy or mesh-convergence validation. The generated local evidence is in `.local-logs/cfd-r2-mesh-final/audit.json`, with per-case geometry, STL, mesh and mesher logs alongside it.

Low surface complexity is not a guarantee of low CFD cell count or simulation accuracy. Geometry, gaps, refinement levels and boundary layers all affect meshing. Check solver-specific surface quality and mesh independence. See the primary OpenFOAM documentation for [geometry inputs](https://doc.openfoam.com/2306/tools/pre-processing/mesh/generation/snappyhexmesh/geometry/), [refinement controls](https://www.openfoam.com/documentation/user-guide/4-mesh-generation-and-conversion/4.4-mesh-generation-with-the-snappyhexmesh-utility) and [surfaceCheck](https://www.openfoam.com/documentation/guides/latest/man/surfaceCheck.html).
