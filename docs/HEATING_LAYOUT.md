# Heating Layout

## Integration and local-first storage

Tools → Heating Layout opens the same `FloatingToolbar` window used by Electrical Layout: dragging, resizing, stacking, closing and mobile bounds are inherited. Heating is a separate SVG layer inside `FullFloorplanEditor`, not a new application/workspace. Its five sections are Heat Loss, Radiators, UFH, System and Results.

`HeatingProject` version 1 is an optional `ProjectDocument.heatingLayout` extension. Old files remain valid without it. The existing IndexedDB autosave, backup, portable `.floorplan3d` import/export and cloud document validation preserve settings and full pipe geometry. Loading never regenerates a route. Radiators, zones and exclusions refer to existing room IDs; coordinates and pipe/control-point geometry remain millimetres. Results are derived, not persisted arithmetic copies.

## Thermal calculations and assumptions

`heatingCalculations.ts` implements pure deterministic fabric (`U × A × ΔT`) and ventilation (`0.33 × ACH × volume × ΔT`) calculations. Room areas/perimeters/heights/openings use current authoritative floorplan data. Shared collinear boundaries, including partial shared walls, are divided into adjacent/external segments. Equally heated partitions have no heat loss; differing adjacent targets are calculated explicitly. Opening areas are deducted from opaque walls.

Unmatched walls default to external, floors to ground-facing and ceilings to exposed. These assumptions are visible and overridable. Ground loss uses the entered effective U-value against external design temperature, **not** a full ground heat-transfer model. Multi-storey exposure, thermal bridges, ventilation heat recovery, moisture, solar gains, dynamic recovery and geographic weather lookup are not automatically inferred. Insulation/ACH and covering-resistance presets are editable preliminary assumptions, not surveyed or certified properties. Design allowance defaults to 0%.

## Emitters and operating conditions

- Hydronic panels support Type 10/11/21/22/33, towel/custom categories, dimensions, wall position, ΔT rating and exponent. Estimated power-law correction uses the supplied reference output. No manufacturer rating is invented. Generic automatic sizing requires a user-entered ΔT50 W/metre reference at 600 mm height and labels linear width scaling as an estimate.
- Direct electric sizing searches standard capacities for the smallest adequate total and exposes connected electrical load. No hydronic correction applies.
- Hybrid/fan-assisted output uses supplied operating/fan-mode points. Interpolation is limited to a supplied coordinate-grid or a collinear segment containing the requested condition; no extrapolation or generic panel substitution.
- UFH output uses `UFHPerformanceDataset` matching pipe diameter, floor build-up, spacing, thermal resistance and operating temperatures. Without compatible data output is **Not set**. Without surface-temperature data, compatibility is **Not verified**, not passed. The UI exposes a small published-system library and imports of supplied JSON tables. Saved circuits with a different diameter/spacing cannot use a newly selected zone performance table until explicitly regenerated.
- Scenario presets 75/65, 55/45, 45/40, 40/35 and 35/30 recalculate outputs. This is emitter-capacity screening, not heat-pump equipment sizing or annual running-cost prediction.

Radiators can be selected, wall-snapped, dragged, resized, rotated, duplicated, locked and deleted. Wall fit, door and fitting-footprint conflicts are warnings. Existing emitter choices are preserved by Auto Design; it reports every new selection. Mixed Radiator + UFH rooms can add supplementary radiators.

### Published reference library

`heatingCatalogue.ts` includes eight Purmo Compact C22 models (600 mm high), with published 75/65/20 and 70/55/20 points and product exponent 1.3358; three Jaga Strada Hybrid STRW 035 models, with 35/30, 45/40, 50/45 and 55/45 points at room 20°C, fan electrical input and sound data; and two Uponor system-table subsets. Sources were checked on 2026-10-08. These are reference selections, not a complete catalogue, availability guarantee or approval of the actual installation.

Jaga Silent/Normal/Boost labels map to the source's fan positions 1/2/3. No other room temperature is assumed supported. Purmo exact published points override the power-law estimate; other conditions remain explicitly estimated using the published reference/exponent. Editing a selected product's dimensions/type removes its ratings; editing ratings/exponent removes the manufacturer table/provenance rather than masking user changes.

Uponor's UK technical-guide page 33 is Siccus FX, 16 mm PEX, foil-faced timber suspended/floating construction with 18 mm chipboard, spacing 150 mm and water drop 5 K. Page 37 is Tignum timber panel, 12 mm PEX, 25 mm gypsum or 12 mm plywood capping, spacing 150 mm and water drop 10 K. The selected subsets cover room temperatures 20–22°C and resistance 0.01–0.1 m²K/W. Stored flow/return pairs come from the table's mean water temperature and stated drop; a different drop is not treated as equivalent. The published 70 W/m² ceiling is retained. Surface temperatures are not supplied, so these data alone never certify floor-surface safety. Select only the matching physical build-up and confirm current specifications with the manufacturer. Applying a table visibly changes zone inputs, retains existing pipe geometry and requires explicit regeneration; it does not invent a pipe bend-radius limit.

- [Purmo Compact published outputs and exponents](https://www.purmo.com/au/products/panels/purmo-compact.htm)
- [Jaga Strada Hybrid technical tables, pages 5 and 10](https://jaga.com/ex/download/strada-hybrid-brochure-ex/?wpdmdl=42784)
- [Uponor UK UFH technical guide, pages 33 and 37](https://www.uponor.com/getmedia/55d4b2f6-778d-435d-9167-0e27ea46a9eb/ufh-installation-guidepdf?sitename=UK)

## UFH geometry and editing

`heatingGeometry.ts` generates persisted geometric paths, not decorative line art. Rectangular rooms support rounded counterflow spiral layouts. Concave/L/U/irregular rooms and exclusions use a clearly announced serpentine fallback when a safe spiral is unavailable. Boundary/exclusion clearances are checked geometrically. Overlapping/clipped polygon exclusions are subtracted by a piecewise-linear sweep, not duplicated area deductions.

Minimum bend radius, diameter, spacing, wall offset and preferred maximum circuit length are visible per zone. The initial 16 mm / 200 mm / 80 mm bend-radius / 100 m choices are **editable starting parameters**, not validated hydraulic limits for every pipe. A route is refused where the selected geometry cannot accommodate the requested radius. Loop splitting balances heated path lengths and checks each circuit's actual heated + supply + return length against the limit. Manifold port overflow is flagged.

**Manifold leads remain provisional editable routes**: wall penetrations, supply/return separation and coordination with other building services require review. Automatic routing is not an installation-ready hydraulic design. Heated coverage is estimated from heated path length × spacing, capped at active room area; it is not a certified EN 1264 coverage model. Manual route edits require spacing/crossing/bend-radius review.

Select a circuit on the plan. Drag visible handles, Shift-drag a pipe segment, double-click a segment to insert a point, or right-click an interior point to choose Delete control point. Supply/return paths are editable. Actual lengths update during dragging; full thermal/hydraulic results update on release. Splitting, bounded merging, locking, room/all regeneration and restoring a selected generated route are available. Locking any circuit protects its zone's existing layout during regeneration. Geometry/exclusion changes mark layouts for explicit review, never destroy manual routes on load.

UFH generation runs in a dedicated Web Worker. Changed inputs during generation cause the result to be discarded rather than overwrite newer edits. Heating history uses bounded snapshots and the existing editor's Ctrl+Z/Ctrl+Y routing while the module is active, with dedicated Undo heating / Redo heating buttons.

## Water flow and optional hydraulics

Flow uses `Q / (cp × water ΔT)` with explicit pure-water approximations cp = 4180 J/kgK and density = 998 kg/m³. Actual-output flow stays unknown without a performance table; demand-based flow is labelled separately. Optional Darcy-Weisbach pipe-only pressure estimates require internal diameter and known output/flow, assume smooth pipe and water at 20–80°C, and omit transitional Reynolds-number results and manifold/fitting allowances. These are estimates, not a pump-selection design.

## Results and export

Results include room/house demand, emitter capacities, active/estimated covered area, circuit lengths and flows, known electrical load, manifolds/ports, warnings and separately identified BOM wastage. A temperature scenario cannot pass missing product data.

Heating Plan PDF uses current geometry and current edited heating inputs, explicit white document styling, plan/legend, paginated schedules/materials, assumptions and calculation details. CSV export distinguishes unavailable values and protects spreadsheet formula-like strings. Heating JSON export/import is an optional scoped backup; normal project save/load already includes the module.

## References and professional boundary

The user-specified preliminary formulas are implemented transparently. Product/system abstractions are informed by primary manufacturer guidance, without copying product datasets or claiming standards compliance:

- [Caleffi: hydronic emitter output relationships](https://www.caleffi.com/en-us/blog/appendix-1)
- [Purmo: product-specific radiator outputs/exponents](https://www.purmo.com/public/prod/bcd2c0f2-6156-46c6-99cd-ddcde7354507/17185/a04c93d7262c7b6a37e21006f8118156/en-files-1_global_new-technical-guide-verticals_master_eng-global_240523_web.pdf)
- [Uponor: UFH planning principles and performance constraints](https://brandportal.uponor.com/asset/32e8123e-3e31-4fd0-9ece-96ea89f0a4b0/TI-planning-principles-UFHC-EN-1186660-v1.pdf)

The UI and exports state that the module is preliminary planning software. There is no claim of BS EN 12831, EN 442, EN 1264, MCS or Building Regulations certification.

## Verification

The focused tests cover known fabric/ventilation examples; shared/partial/overridden boundaries; glazing deductions; temperature changes; hydronic/electric/hybrid/UFH outputs; interpolation/no extrapolation; water flows; active-area exclusion clipping/union; rectangular, L, U and irregular routes; islands; maximum lengths and balancing; spiral generation; locked/manual routes; source-change warnings; wall snap/door warnings; project-package and local-storage round trips; CSV/PDF export. Browser checks exercise the actual Tools entry, shared window, worker design, UFH generation, history, scenarios, PDF, autosave/reload and mobile bounds. Validation is not independent engineering certification.
