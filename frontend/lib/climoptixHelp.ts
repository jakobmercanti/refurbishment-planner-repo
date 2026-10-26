import type { CFDWindowId } from "@/components/ClimoptixWindowMenu";

type HelpStep = { heading: string; text: string };

/** Contextual guidance lives in the native help window, not above editable data. */
export const CFD_PHASE_HELP: Record<CFDWindowId, HelpStep[]> = {
  adjoint: [{heading:"Vent-position preparation",text:"Capture the current CFD setup, choose movable existing vents, set host-local bounds in millimetres and validate full swept footprints. Configurations save with the project without moving the building or baseline vents. Execution is unavailable: the current simpleFoam adapter remeshes and has no validated boundary-mask adjoint. Geometry or physical setup changes require a new configuration. Mathematical perimeter tests are not CFD gradient verification."}],
  studies: [
    { heading: "Compact groups", text: "Select a group to highlight it; New simulation adds inside that group. Collapse hides its children without removing them. A collapsed header still accepts grip-only drops. Clear all asks for confirmation and removes all simulations, including archived ones, but keeps the measured building and folders. Undo restores them. Active or unresolved worker submissions block clearing." },
    {
      heading: "Simulations and folders",
      text: "Each simulation uses the shared measured building and independent settings. Add group creates an empty folder. Rename folders inline; use a simulation's actions menu to rename, duplicate, archive or move it. Only grips initiate drag/drop, with insertion previews; Escape cancels. Mouse, touch/pen and Arrow Up/Down are supported, and Move to group is the non-drag alternative. Folder duplication copies its simulations with fresh IDs and cleared validation/history. Deleting a folder keeps its simulations in Ungrouped. Undo restores organizational changes. Files include empty folders and simulation order; imported logs and VTK remain session-only.",
    },
    {
      heading: "Mesh and Run",
      text: "Use Mesh or Run on a simulation's row to submit that simulation. Each simulation is validated against its current building and settings before being sent to a trusted worker. Mesh prepares and checks the mesh; Run also requests the solver. You can submit other simulations independently without changing the active selection. Progress is reported by the worker for the current phase, never estimated from elapsed time. Without a connected worker these actions remain unavailable. If submission status is unknown, retry the same operation to recover the original request, even if you have edited the setup since. Resolve that request before starting a different operation. Active or unresolved jobs cannot be deleted or archived.",
    },
  ],
  domain: [
    {
      heading: "Choose the simulation volume",
      text: "Choose a seed floor and room. Checks refresh automatically after committed changes; Toolbar → Refresh checks can retry manually. Only permanent doorless passages and physical slab voids expand the connected air volume. Doors and windows stop discovery at every open state. Their virtual caps may use an opening/pressure boundary; they are not automatically solid walls. The viewer's inspection scope does not change this seed. Checks are preparation only, never a mesh or solve.",
    },
    {
      heading: "Global mesh settings",
      text: "Choose the mesh intent preset, base/minimum/maximum cell sizes in millimetres, target cell count and maximum cell budget here in Domain. Custom preserves your current values; changing a numeric setting selects Custom. Presets retain existing refinement regions, mesh origin and alignment. These settings express mesh intent, not achieved resolution or cell count. Local refinement regions, layers, tolerances and quality controls are in Solver → Mesh. Validate after changing global or local settings.",
    },
  ],
  equipment: [
    { heading: "Groups and simulation-only copies", text: "Use Add object group, then drag grips or Move to group to organize devices and measured objects. Groups can collapse, reorder, duplicate or dissolve without changing the shared building. Edit opens a separate window. Duplicate creates a CFD-only measured-source instance with its own millimetre offset; edit that offset to place the copy, and review overlap/out-of-domain checks. Delete removes a CFD copy or excludes a source object only in this simulation. Removed source objects can be restored from the list. Imported visual-only meshes have no measured copy adapter." },
    {
      heading: "Vents and objects",
      text: "A checked seed room provides room-facing wall and ceiling hosts. Add Supply/Extract creates a device in the draggable equipment list and opens its floating editor. Each device has Edit, Duplicate and Delete. Use the grip or Arrow Up/Down to reorder. Place on face uses a checked 3D host; dragging a marker changes host coordinates, not measured building geometry. Supply/Extract determines flow direction; enter a positive magnitude. A recirculating unit needs separate supply and return devices. Optimization settings are metadata, not an active optimizer. Furniture, people and fixtures remain owned by the shared Floorplan building; their CFD overrides belong to this simulation.",
    },
    {
      heading: "Simplified representations",
      text: "Solid proxies are simplified CFD obstacles, not detailed render meshes. Excluded objects have no CFD effect; heat-only sources do not create solid obstacles. Dimensions are millimetres, power is watts, temperatures are kelvin, and concentration is ppm by volume. Emissions start at zero and require calibrated inputs: the CO₂ source rate is pure-gas m³/s, not ppm/s. Review proxy assumptions and source summaries before running.",
    },
  ],
  boundaries: [
    { heading: "Compact group actions", text: "Conditions, Thermal, Add boundary group and Find surface share the toolbar. Group and surface grips use protected drag/drop; groups can collapse while remaining drop targets. Edit opens the group or surface window. Duplicate copies conditions to an empty group, never duplicate physical faces. Deleting a custom group or assignment returns its surfaces to Default surfaces and preserves the building geometry." },
    {
      heading: "Surface conditions",
      text: "Default surfaces initially contains all checked patches. Add boundary group creates an empty group; drag surface grips between groups, use the Move menu, or create a new group from a surface. Group colours match the 3D viewer and legend. Select a group to inspect its members and conditions. Default-group conditions form the global base; a named group's conditions override that base, and explicit surface overrides take priority. Clear surface overrides in group restores inheritance. Surface type defaults preserve older configurations. Vents remain controlled by their Equipment settings, and object heat/temperature inputs cannot be silently over-constrained. Missing references are reported, not discarded. The Thermal sub-tab contains envelope, sun, weather and applied thermal contracts.",
    },
  ],
  physics: [
    {
      heading: "Physics and units",
      text: "Presets are starting intentions, not certified engineering settings. Physics uses SI units: temperatures in kelvin and CO₂ in ppm by volume (1 ppm = 10⁻⁶ volume fraction). Numerical controls and time stepping are in Solver → Run. Age of air and comfort are requested future outputs, not computed metrics. A worker must explicitly support the selected solver, turbulence, energy and scalar models before execution.",
    },
  ],
  mesh: [
    {
      heading: "Mesh, Run and Post-processing",
      text: "Domain defines global mesh preset, cell sizes and budgets. Solver → Mesh defines local refinements, layers, tolerances and quality intent; Run defines numerics, cores and resource limits; Monitor imports real residual logs; Post defines named X/Y/Z slices and fields before execution. Checks refresh automatically after committed changes. Intent and estimates are not a generated mesh or solved result. Play remains unavailable until a trusted OpenFOAM worker is connected.",
    },
  ],
  review: [
    { heading: "Review, warnings and transfers", text: "Review contains notes and provenance. Warnings & checks contains filterable current diagnostics and Inspect links. Import / export contains editable simulation JSON, preparation ZIP and settings/preflight downloads. Import creates a separate simulation; stale preparation cannot be exported as current. Provider limitations are in this help window." },
    {
      heading: "Validation and export",
      text: "Validate the current source and setup before exporting. The preparation manifest records blocking diagnostics; boundary STL is included only when geometry checks pass. Source geometry is millimetres; exported STL is metres. Preparation and optional Foamlib settings ZIPs are configuration handoffs, not runnable solver cases. A worker must revalidate, construct a complete case, mesh and check it before solving. Review the visible diagnostics, assumptions and provenance hashes.",
    },
  ],
  view: [
    {
      heading: "Inspect without changing the simulation",
      text: "The 3D viewer's View properties button opens a separate floating window, not a simulation phase. View the whole building, a room or connected air volume without changing the seed. Orbit by dragging, zoom with the wheel or touch gesture, and Fit resets framing. Toggle ceilings, detailed assets, selection isolation and refinement overlays here. Floating windows can be moved, resized or attached to a side.",
    },
  ],
  thermal: [
    {
      heading: "Thermal envelope",
      text: "Choose source constructions, site/weather, gains and calculation assumptions, then Calculate & preview. The Thermal help button explains each step and its engineering assumptions. Preview is an envelope estimate, not a solved CFD result. Apply transfers a revision-bound thermal contract; stale or incomplete calculations cannot be applied. A future worker still needs validated thermal boundary/source adapters.",
    },
  ],
  convergence: [
    {
      heading: "Convergence monitor",
      text: "Solver → Monitor imports a real OpenFOAM log and plots initial residuals. Histories are session-only for the latest three simulations, not saved with the project. Imported logs are external, not live or verified results for the current simulation. Repeated pressure corrections are retained. Plots are clipped to 10⁻¹²–1 and decimated for readability; download preserves the original file. Residuals alone do not establish convergence or conservation.",
    },
  ],
  results: [
    {
      heading: "Imported VTK results",
      text: "Open a real VTK PolyData surface or slice in Solver → Post-processing. Imported results stay local and are labelled external/unverified; they are not evidence that this simulation ran. Supports bounded ASCII .vtp and legacy POLYDATA .vtk up to 25 MB. Select a scalar or vector magnitude; drag to orbit, use the wheel or zoom buttons to zoom, and Fit to reset framing. Every displayed value comes from the imported file. Download preserves the original for ParaView. Legacy FIELD, colour/texture sections and 64-bit IDs need ASCII .vtp; VTU volumes and compressed/binary files need a worker-side surface/slice export.",
    },
  ],
};

export const CFD_REFINEMENT_HELP: HelpStep[] = [
  {
    heading: "Refinement region",
    text: "Changes save to this simulation as you edit. Centres and dimensions are millimetres. Cuboids and spheres use explicit bounds; object extents follow the last checked solid proxy and need refresh after source placement changes. Regions are wireframe intent, not cells or achieved resolution. Duplicate, delete and reorder regions in Solver → Mesh. The highest overlapping level wins; list order is only organisational.",
  },
  {
    heading: "Level and nominal size",
    text: "Each snappyHexMesh level halves the base cell along X, Y and Z. A custom target rounds up to a level that is at least as fine; global limits also apply to the rounded size. Colours match between the list and viewer. Cell counts, snapping, layers, quality and y+ must be measured by a real mesher; the displayed count range is only an estimate.",
  },
];

export const CFD_SIMULATION_HELP: HelpStep[] = [
  ...CFD_PHASE_HELP.mesh,
  ...CFD_REFINEMENT_HELP,
  {
    heading: "Run and export",
    text: "Select steady/transient, cores, memory and time limits. A connected worker validates each simulation before submission; Simulations provides Mesh/Run on each row and worker-reported phase progress. Without a worker no background job is submitted. Foamlib exports settings for OpenCFD v2312, including cores, run controls, refinement regions and named slices. This ZIP is a configuration handoff, not a runnable case. A worker must enforce resource limits and support the selected physics.",
  },
  {
    heading: "Slices",
    text: "Planes are normal to source X, Y or Z and evenly spaced inside the last checked domain bounds. Choose plane counts, solved fields and sampling every N field writes before running. Validate to resolve positions. Named cutting planes and fields are included in the settings export for the future worker.",
  },
  ...CFD_PHASE_HELP.convergence,
  ...CFD_PHASE_HELP.results,
];
