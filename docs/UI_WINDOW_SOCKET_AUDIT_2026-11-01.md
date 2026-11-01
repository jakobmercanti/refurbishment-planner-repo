# Window controls and socket circuits — 1 November 2026

Changes are local. No deployment, remote push, live simulation or account-data
change was performed for this task. Unrelated website work is preserved.

## Implemented

- Shared floating-window and popup content gutters use 5 px in Comfortable and
  3 px in Compact, with the separate 5 px resize rails retained. Nested tool
  sections use the same horizontal padding. Compact preferred widths scale to
  86%; initial docked windows and standard standalone dialogs are included.
  A manual resize retains the actual pixel width rather than scaling it twice.
  Full action text can wrap instead of being truncated.
- Floor label left padding is 12 px. A floating Export action calls the existing
  floorplan export dialog only in Floorplan 2D. Its space is reserved beside the
  floor selector on small screens; it is absent in 3D.
- Native selects, object pickers, appearance/position disclosures, catalogue
  disclosures and window accordions share an outlined chevron. Native-select
  arrow space survives density overrides. Redundant legacy service triangles
  were removed; geometry arrows and drawing symbols are unchanged.
- Repeated section help is compared by guide body and links, independent of its
  heading. Nested copies of the parent guide are suppressed. Automatic generic
  electrical section help is removed; the main window guide remains. Distinct
  contextual Heating/Energy guidance is retained without duplicate bodies.
- Socket circuits store Radial/Full ring, consumer-unit reference and ordered
  socket membership. Create socket routes creates POWER links and an explicit
  consumer-unit return for a ring, preserving control links. Existing POWER
  links in that circuit are replaced deliberately. Routes remain editable.
- Check layout supports individual socket selection from the test list or plan.
  Graph checks detect missing consumer units, disconnected sockets, open rings,
  cycles in radials, duplicate/reversed links, unexpected endpoints and shared
  circuits. Radial branches use explicit fitting connections. Power crossing
  junctions require review rather than being silently treated as passing.
  This checks the drawn schematic, not installed conductors or electrical safety.
- Circuit membership survives project JSON/normalization, and electrical-layout
  import remaps consumer-unit/socket references alongside fitting IDs. Missing
  imported fittings cannot accidentally resolve to existing destination devices.

## Audit and verification

1. Data/logic: ring return edges, broken returns, disconnected sockets, branched
   radials, cross-circuit feeds, regeneration and JSON/merge-import persistence.
2. Browser interaction: compact floating and standalone dialog widths, unclipped
   action text, unchanged edge targets, manual resizing, Export mode gating,
   individual plan socket testing and deletion of the ring return. This exposed
   a duplicate React key shared by the socket editor and connection section;
   separate keys now prevent repeated actions after updates.
3. Visual/shared-control review: desktop and phone screenshots, reduced outer
   and nested gutters, dropdown arrow visibility, matching disclosure chevrons,
   no extra triangle, and Electrical/Heating/Energy help duplication. All six
   targeted browser cases pass against the final static planner export.

655 unit tests and 19 persistence tests pass. Frontend lint and source-usage
checks pass (477 modules, no orphaned modules). Production Webpack/static export
and its TypeScript stage pass; the separate `pnpm typecheck` also passes. One old disclosure test was given an actual
connected-light fixture because empty lighting circuits are intentionally
omitted from a socket-only test window.

Evidence is in `.local-logs/ui-nov01-verified-*` and
`.local-logs/ui-nov01-qa/`. Browser sessions use isolated local saved-project
fixtures and block external requests. The complete historical browser suite
was not rerun; the six new cases cover the reported paths and shared controls.

## Follow-up — fitting selector and heating scenarios

The modern theme exposed a defect in the shared chevron styling: masking the
whole selector button affected its painting and hit target. The button now
keeps its original rectangular hit area, with only its noninteractive `::after`
icon masked. This also covers the shared door/window catalogue selectors.
Elements list content has a separate top gutter below its section heading.

Heating actions now read **Add element**. The Construction scenario submenu
contains **Add scenario** and **Delete selected scenario**, plus an optional
name. Blank names receive an unused Upgrade number. Existing scenario helpers
copy the active assignments and preserve the shared Energy/Heating document.
Existing Building cannot be deleted; deletion requires confirmation. The
existing 100-scenario limit remains enforced.

27 focused energy-scenario, heating and electrical tests pass. All eight browser
cases pass, including real modern-theme fitting selection, visible list spacing,
single-line Add element text, scenario creation with/without a name, cancellation,
deletion and save/reload. Frontend lint/source usage and the production static
build with TypeScript pass. Final screenshots were reviewed. Evidence is in
`.local-logs/ui-selector-scenario-*` and `.local-logs/ui-nov01-qa/`.
The changes remain local and have not been deployed or pushed.

## Combined release audit

Both lists were audited again with the fourteen Heating/UFH changes in
`HEATING_UFH_UI_AUDIT_2026-11-01.md`. The current release includes these previously
local fixes. All eight list-specific browser cases and the shared window,
docking and current-project workflows pass in the combined audit.
