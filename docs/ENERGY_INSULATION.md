# Energy & Insulation

Tools → Energy & Insulation opens the existing FloatingToolbar window. Overview,
Fabric, Insulation, Openings, Upgrades, Energy and Results are sections inside
the Floorplan workspace, not an additional application mode. The SVG energy
layer has independent visibility; closing the inspector leaves its layer intact.
Each scenario selection is persisted and immediately consumed by Heating Layout.

## Shared building physics

`EnergyProject` version 1 is an optional ProjectDocument sub-document. Materials,
assemblies, existing assignments, proposed scenarios, project-specific U targets,
annual assumptions and display settings are portable and autosaved. Old files
without this sub-document remain valid. References are room IDs plus wall edge,
opening ID, floor or roof; wall endpoint signatures prevent assignments silently
moving to a different boundary after topology edits. Reassign flagged walls after
geometry changes. Deleted-room assignments are retained for restoration.

`BuildingThermalOverrides` is derived, never persisted as a second Heating copy.
The sole room heat-loss engine remains `calculateRoomHeatLoss`. Its Heating
temperatures, ventilation/ACH, allowance and heating-system data are authoritative.
Energy assignments resolve whole-element U-values and boundary overrides into
that engine, including individual openings. Heating emitter checks consume the
selected scenario immediately, without resizing emitters or regenerating pipes.
Missing layer data keeps the Heating fallback but explicitly marks the result
unverified; it never supplies a fictitious zero heat loss or sufficient status.

Energy actions have a bounded separate undo/redo history in the existing editor;
toolbar buttons and keyboard shortcuts route there while its window is open.
Heating edits made via shared building settings use Heating history.

## Constructions, scenarios and upgrades

All lengths/thicknesses are mm. Layer R = thickness / 1000 / lambda; explicit
layer resistance overrides support cavities or measured resistance. Assembly
U = 1 / (Rsi + sum R + Rse), unless an entered whole-assembly U is selected.
Surface resistances are visible, editable planning assumptions. The model is
one-dimensional: it does not account for parallel studs, fixings, moisture,
condensation or construction suitability. Ground floor uses the existing simplified
effective-U model; ceilings use room footprints rather than roof-slope surfaces.

Insulation additions require a proposed scenario. Existing construction is preserved.
When starting from a whole-element U, its full resistance is retained without
adding surface resistances twice. Layer upgrades retain explicit material/thickness/
position and geometry-derived net area/volume; order waste is separate. The target
optimizer solves added resistance analytically and compares practical increments.
"Meets selected target" is not a Building Regulations compliance statement.

Multi-selection uses Shift-click thermal surfaces or category selection buttons.
Wall/floor/roof classification can be overridden. Windows and doors use whole-product
U values, with optional glazing/frame/orientation/g-value metadata. No generic
glazing description silently inserts a product performance rating.

## Reference data

Small product-specific conductivity samples were checked against primary sources
on 9 October 2026; users must validate actual products/conditions and may edit them:

- Kingspan TW55 PIR, 0.022 W/mK: https://www.kingspan.com/content/dam/kingspan/kil/products/general-gb-and-ireland/kingspan-product-selector-brochure-en-ie.pdf
- ROCKWOOL Roll/Twin Roll reference, 0.044 W/mK: https://www.rockwool.com/syssiteassets/rw-uk/downloads/datasheets/roll-twinroll-rollbatt.pdf
- Wienerberger English Red brick, 0.450 W/mK: https://www.wienerberger.co.uk/product-range/bricks/english-red.html

Other library families are intentionally "Not set" until users enter product data.
Surface-resistance starting inputs are exposed, not a certification rule. A primary
manufacturer explanation of the horizontal-wall Rsi/Rse convention is available at
https://isocell.ie/envelope-studio?preset=hrw_vent ; users must confirm the heat-flow
direction and boundary conditions for their actual assembly.
Templates are editable starting layer arrangements, not verified assemblies.
Changing a sample conductivity labels its reference as user-entered.

## Annual estimates and rating limits

The preliminary degree-day calculation is H × HDD × 24 / 1000 × explicit schedule
multiplier. H excludes equally heated partitions, combines exposed UA and the shared
0.33 × ACH × volume coefficient. Unheated spaces are conservatively treated as full
climate exposure for annual comparison; clarify this assumption before relying on it.
Degree days require a location/year/base-temperature source supplied by the user.
Delivered energy additionally requires a stated seasonal efficiency/SPF and basis;
water temperatures are never mistaken for annual efficiency. No tariffs or savings
in money are invented. Solar/internal gains are not separately modelled, nor hot
water, lighting, PV, mixed-fuel allocations or dynamic heating schedules.

Degree-day methodology reference: https://www.cibse.org/knowledge-research/knowledge-portal/technical-memorandum-41-degree-days-theory-and-application-2006-pdf/?id=a0q20000008I73TAAS

No validated SAP/RdSAP rating engine is present. The indicative-rating interface
therefore returns unavailable rather than assigning arbitrary EPC points/letters.
Useful heat intensity and relative retrofit reductions are available instead.
This is not an official EPC or assessor replacement. Government explanation of
the richer energy model: https://www.gov.uk/government/consultations/home-energy-model-replacement-for-the-standard-assessment-procedure-sap/the-home-energy-model-making-the-standard-assessment-procedure-fit-for-a-net-zero-accessible-webpage

Thermal bridge records support future psi × length coefficients. Their annual H
contribution is separated; room/junction allocation is not yet available, so no
invented bridge contribution is added to radiator room sizing. There is no UI for
entering them yet. Roof sections/floor levels/skylights require geometry entities
not present in the current authoritative model and are not fabricated.

## Exports and checks

Energy report PDF is white/document themed and generated from current Energy and
shared Heating inputs. Includes thermal plan, scenario comparisons, fabric/room
calculation details, quantities, assumptions and sources. Paginated text handles
long words/references; pages carry numbering. CSV includes actual editable scenario
values and separately labelled net/order material quantities, with formula guards.
PDF standard fonts transliterate unsupported international characters; source data
remains unchanged.

Unit/regression coverage: layer R/U, missing values, individual openings, adjacency,
shared Heating demand/status, immutable existing scenario, optimizer, net/waste
quantities, H/HDD, stale geometry, autosave/portable file roundtrip, PDF/CSV and no
invented EPC rating. Browser QA uses the production static export to verify actual
Tools/window interactions, editing, overlay, scenarios, Heating changes, reload,
dark/compact mobile visibility and PDF download.
