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
   viewer. Checked plan markers use measured millimetres, never visual meshes.
3. Set outdoor-air fraction, room conditions, infiltration, people, equipment,
   solar gain, target ACH and optional people/area flow rates. Results update
   live; **Update calculations** explicitly validates the current inputs.
   Presets create editable operating scenarios, not compliance certificates.
   Existing per-device supply temperatures are retained until explicitly changed.
4. Add/edit radiators and UFH in Heating. Placed obstacles remain radiator
   authority; hydraulic circuits, zones and exclusions remain Heating authority.
   Both are visible in the CFD source list. UFH loops are also drawn as scene
   intent; this drawing is not a resolved heat-flux distribution.
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
is never treated as a surface temperature. UFH exports upward room-side output
and real zone/loop coverage. It does **not** impose a partial zone as a whole-floor
temperature condition. Film assumptions are retained for review with the existing
CFD Thermal Envelope adapter; they are not silently turned into Robin conditions.
See the distinction between thermal boundary models in the
[OpenFOAM boundary-condition documentation](https://www.openfoam.com/documentation/user-guide/5-models-and-physical-properties/5.1-boundary-conditions).

The native worker is isothermal. Shared HVAC thermal runs are disabled and also
rejected at the submission boundary, including custom adapters advertising run
capability. Partial UFH face-flux mapping, located zone-gain/infiltration mapping
and a compatible thermal envelope/energy adapter are not connected. Their exact
inputs remain reviewable/exportable. No CFD temperature, local velocity, humidity,
fan energy or legal compliance result is invented. Existing unrelated isothermal
CFD workflows remain operational.

Handoff snapshots are limited to five packages of 100,000 characters each,
consistent with existing project string bounds. Oversized/invalid handoffs fail
before committing; full packages can still be downloaded separately.

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
