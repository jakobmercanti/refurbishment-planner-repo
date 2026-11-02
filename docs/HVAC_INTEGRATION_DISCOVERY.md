# HVAC integration discovery — 2 November 2026

The requested brief is `climoptix_hvac_ventilation_heating_cfd_integration_codex_prompt.txt`
in the existing New Features folder. Context was read from CFD ventilation tech
chat and Commercial version, including the latest Heating/UFH audit fixes.

## Existing authority

- `projectDocument.ts`, `useLocalProject.ts`, `projectHistory.ts` own validation,
  IndexedDB autosave, package persistence and project undo/redo.
- Radiators already belong to measured room obstacles (`heating_spec`);
  `heatingElements.ts` derives the Heating view and commits edits atomically.
  UFH zones/circuits/exclusions belong to each floor's `heatingLayout`.
- `FullFloorplanEditor.tsx` contains the existing Heating Layout window.
  `HeatingLayoutPanel.tsx` and its CSS supply the native tabs/controls.
- `ClimoptixEquipment.tsx` owns the reusable vent editor; checked host geometry,
  vent dragging and obstruction/overlap checks use the existing CFD adapter.
- Legacy vent designs live inside CFD scenarios. New shared HVAC data promotes
  these by stable identity, retaining conflicting operating values as explicit
  scenario overrides. CFD vent arrays become derived transport views. A single
  project action commits canonical changes; there are no polling/effect syncs.
- `heatingDesign.ts`, `heatingCalculations.ts`, `energyCalculations.ts` provide
  actual emitter output and insulation-backed surface conductances. Reuse those
  outputs; do not add their ventilation loss again to a mechanical air balance.
- `climoptix.ts` is the preparation/worker contract boundary. All clients must
  resolve shared designs there, including hashing and stale-result detection.
- The native worker is isothermal. Thermal manifests can be prepared/exported;
  temperature/buoyancy execution must remain blocked. UFH partial coverage must
  never silently become a whole-floor temperature condition.

All measured geometry stays in mm. Flow/heat equations use explicit SI
conversions. Existing permanent-opening connectivity and door/window stopping
rules remain authoritative. The website repositories and pre-existing changes
are outside this implementation.
