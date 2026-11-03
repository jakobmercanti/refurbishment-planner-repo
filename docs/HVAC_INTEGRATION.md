# Heating, Ventilation and CFD

Open **Tools → Heating Layout**, then use **Heating | Ventilation** at the top
of the existing window. The original Heating sections, controls and layouts
remain in place. Tabs use the existing workbench styles, stay visible while
scrolling and support arrow keys, Home and End.

## Using the workbench

1. Select a measured room in Ventilation. **Check room geometry** obtains the
   same deterministic host faces used by CFD. Add supply, extract or return
   devices. Return uses an extract boundary physically, with separate return-air
   accounting; it is not automatically outdoor exhaust.
2. Select a device to edit its name, host, dimensions, shape, U/V position,
   rotation, direction, free area, control mode, flow and temperature with the
   existing CFD editor. Select another row, duplicate, reorder or remove with
   confirmation. Undo/Redo uses project history. Host validation still checks
   edges, openings and overlaps. 3D dragging remains in the established CFD
   viewer. The conventional plan also supports measured-host dragging, undo and
   Escape cancellation. Checked plan markers use millimetres, never visual meshes.
3. Set outdoor-air fraction, room conditions, infiltration, people, equipment,
   solar gain, target ACH and optional people/area flow rates. Results update
   live; **Update calculations** explicitly validates the current inputs.
   Presets create editable operating scenarios, not compliance certificates.
   Existing per-device supply temperatures are retained until explicitly changed.
4. Add/edit radiators and UFH in Heating. Placed obstacles remain radiator
   authority; hydraulic circuits, zones and exclusions remain Heating authority.
   Both are visible in the CFD source list. Preparation maps UFH upward watts
   over checked tube-spacing footprints, preserving exclusions and unheated
   floor areas. The loop drawing itself never supplies a mesh or fit decision.
5. **Evaluate same configuration in CFD** checks the actual domain and displays
   the vent/heater inputs, connected-room difference, source powers and execution
   limitations. Export the boundary package or create a new CFD case. No existing
   completed/running case is overwritten. Five bounded immutable handoff packages
   are retained; later edits mark a saved package outdated.
6. In CFD Equipment, **Shared HVAC design & operation** selects permanent vent
   edits or scenario overrides. Flow/temperature overrides are visible in the
   linked conventional scenario while baseline design values are retained.
   Heater effective watts/off settings are scenario operations. **Open Ventilation**
   and **Edit shared Heating geometry** return to the actual source workbench.

Cases created before HVAC setup also receive the live design connection on load
and project updates, including Heating-only radiator/UFH projects. In CFD,
**Shared operating scenario** shows which conventional operation supplies the
case. Choose a room scenario to share operating edits in both directions; the
explicit case-air-settings option retains independent operating conditions.
Changing that selection clears case-only vent overrides. Generated radiator
treatments are transport data and are not persisted as a second heat source.
The follow-up creation-order and bidirectional checks are recorded in
`HVAC_SYNC_AUDIT_2026-11-02.md`.

## Authority and migration

`ProjectDocument.hvac` is a versioned shared design/operating document. CFD vent
arrays are derived transport views, not independently editable persisted copies.
`commitHvacCFD` is the project command boundary, including drag/optimiser edits.
Radiators retain their established `room.obstacles[].heating_spec` authority.
UFH retains per-floor `heatingLayout` zone/circuit IDs and coverage data.

Legacy CFD vents are promoted on project parsing, by stable ID. Different
operating values become explicit overrides. Conflicting geometry is retained
with a deterministic crosswalk and visible review message; reopening is
idempotent. Shared data is included in normal IndexedDB saves, portable packages,
project history and validated cloud project storage. No polling or effect-based
device synchronisation is used. Shared geometry is always in millimetres.

## Engineering model

- Supply, outdoor-air, exhaust, return and recirculated flows are distinct.
  `ACH = Q[m³/s] × 3600 / V[m³]`; occupancy flow is the explicit sum of entered
  people and area rates. A pressure-controlled outlet has unknown flow.
- Signed supply sensible gain is `ρ cp Q (Ts − Tr)`. Multiple supplies use their
  actual individual temperatures and flows. Face velocity uses effective free
  opening area; mass flow uses the specified density.
- The steady zone equilibrium sums each envelope `U A (Tadj − Tr)`, infiltration,
  supply streams, entered gains and room-effective heating once. The existing
  Heating/Insulation model supplies conductances and source temperatures; its
  separate ventilation loss is not added again. Required sensible airflow checks
  the driving-temperature sign and rejects zero/near-zero delta-T.
- No heat-removal pathway, missing effective heat or unaccounted excess extract
  produces an indeterminate result, not a fabricated finite room temperature.
  Free-floating temperature excludes mechanical supply and active heating.
- The conventional room volume is the existing clear-height prism approximation.
  Sloped roofs, voids and connected-volume differences are explicitly distinguished
  from checked CFD volume. Radiant exchange is a lumped room approximation,
  not a claim about immediate/local air temperature or comfort.

The equations were checked against the zone-air balance in the
[EnergyPlus Engineering Reference](https://energyplus.net/assets/nrel_custom/pdfs/pdfs_v25.1.0/EngineeringReference.pdf).
This is a simplified planning model, not an EnergyPlus implementation.

## Boundary package and actual supported execution

`HvacCfdBoundaryPackage` includes operating conditions; canonical vent IDs and
hosts; SI flows, effective area, mean normal velocity, density-based mass flow
and supply temperature; radiator/UFH identity, effective watts, state, domain and
source-model notes; UFH circuit/exclusion footprints and heated coverage;
insulation-backed envelope records; zone gains; provenance and immutable input
hash. Geometry preparation still uses the existing checked cutout/mesh adapter.

Radiators use one lumped surface-power representation on the existing proxy;
full output is never added again as air/radiation power, and water temperature
is never treated as a surface temperature. UFH maps upward room-side watts to
uniform tube-spacing coverage clipped to real checked floor faces, exclusions
and vent apertures. It does **not** impose a partial zone as a whole-floor
temperature condition. Overlapping/stale zones and unknown watts require review.
Insulation layers map to a Robin coefficient using `Rtotal - Rsi` once; declared
Rse stays in the outward resistance. Entered U-values without a known film split
or missing ground/adjacent temperatures remain explicitly unmapped. Floor
insulation and UFH use a combined Robin plus upward-source-flux contract.
Open apertures use backflow temperature conditions rather than solid U-values.
See the distinction between thermal boundary models in the
[OpenFOAM boundary-condition documentation](https://www.openfoam.com/documentation/user-guide/5-models-and-physical-properties/5.1-boundary-conditions).

The native worker is isothermal. Shared HVAC thermal runs are disabled and also
rejected at the submission boundary, including custom adapters advertising run
capability. Geometry/boundary preparation and a checked boundary export are
implemented; the native worker does not execute these thermal contracts. Located
zone-gain/infiltration mapping, full solid coupling and resolved radiation still
need a compatible energy adapter. Unlocated gains/flows appear as Needs input
and cannot make the capture audit report complete. No CFD temperature, local velocity, humidity,
fan energy or legal compliance result is invented. Existing unrelated isothermal
CFD workflows remain operational.

Handoff snapshots are limited to five packages of 1.5 million characters each,
with an 8 MB total project guard. This exception applies only to validated HVAC
snapshot text. Oversized/invalid handoffs fail before committing; full packages
can still be downloaded separately. The fresh two-pass review and corrective
regression evidence are in `HVAC_REAUDIT_2026-11-02.md`.
The current surface-mapping implementation, source-selection rules, tested
failure states and final audit are in `HVAC_BOUNDARY_AUDIT_2026-11-03.md`.

In CFD **Objects** or **Bounds**, expand **Shared boundary capture** to review
actual checked powers, areas, outward coefficients and missing inputs. Source
thermal fields in the surface editor show prepared values and stay read-only;
edit their Heating/Insulation source or reviewed Thermal Envelope override.
The exported shared package includes checked patch conditions. Rechecking after
source edits invalidates stale capture data without changing historical packages.

## Change map

- Shared contracts/history/persistence: `frontend/lib/hvacDocument.ts`,
  `projectDocument.ts`, `projectHistory.ts`, `useLocalProject.ts`;
  `backend/app/hvac_document.py`, `commercial_api.py`, `building_document.py`.
- Calculations and mapping: `frontend/lib/hvacCalculations.ts`, `hvacBridge.ts`,
  `climoptix.ts`, `climoptixJobs.ts`.
- Workbench and plan integration: `frontend/components/VentilationPanel.tsx`,
  `HvacContext.tsx`, `HvacPlanMarkers.tsx`, `HeatingLayoutPanel.module.css`,
  `FullFloorplanEditor.tsx`, `frontend/app/planner-client.tsx`.
- CFD integration: `frontend/components/SharedHvacCFD.tsx`,
  `ClimoptixEquipment.tsx`, `ClimoptixObjects.tsx`, `ClimoptixPhysics.tsx`,
  `ClimoptixViewer.tsx`, `ClimoptixWorkspace.tsx`.
- Tests: `frontend/tests/hvacFixtures.ts`, `hvac.test.mts`,
  `frontend/tests/browser/hvac.browser.mts`, `climoptix.browser.mts`,
  `heatingWorkbench.browser.mts`, `tests/test_hvac_document.py`.
- Discovery and both final audit passes are the adjacent `HVAC_*.md` documents.
  No new dependency or separate application/store was introduced.
