import type { CFDWindowId } from "@/components/ClimoptixWindowMenu";
import type { WindowHelpStep } from "./windowHelp";

import { THERMAL_HELP } from "./thermalHelp";

type HelpStep = { heading: string; text: string };

const OPENFOAM = "https://doc.openfoam.com/2306/";
const meshDocs = { label: "OpenFOAM v2306 · snappyHexMesh", url: OPENFOAM + "tools/pre-processing/mesh/generation/snappyhexmesh/" };
const numericsDocs = { label: "OpenFOAM v2306 · numerics and schemes", url: OPENFOAM + "tools/processing/numerics/" };
const fluidDocs = { label: "OpenFOAM v2306 · thermophysical models", url: OPENFOAM + "tools/processing/models/thermophysical/" };

export const CFD_SECTION_HELP: Record<string, WindowHelpStep[]> = {
  "Mesh origin & alignment": [{
    heading: "Background grid placement",
    text: "The native worker uses blockMesh to create a Cartesian grid of hexahedral cells around the checked domain. snappyHexMesh refines the grid near surfaces, removes cells outside the air volume and snaps the boundary to the geometry. Origin is the grid anchor and rotation pivot. Alignment rotates the grid about the fixed building axes in X, Y, Z order. The interior point locationInMesh separately identifies cells to keep.",
    links: [meshDocs, { label: "OpenFOAM v2306 · castellation and cell retention", url: meshDocs.url + "castellation/" }],
  }],
  "Fluid properties": [{
    heading: "Air model",
    text: "Use a consistent set of properties at the study's operating temperature and pressure. The native isothermal worker uses density and dynamic viscosity to calculate kinematic viscosity. Heat capacity, thermal conductivity, Prandtl number and expansion are inputs for thermal-capable solvers. In OpenFOAM’s constant transport model, thermal conductivity follows k = cp × μ / Pr, so these inputs should agree for the same air state.",
    links: [fluidDocs, { label: "OpenFOAM v2306 · constant transport model", url: fluidDocs.url + "transport/rtm/const/" }],
  }],
  "Reference & ambient conditions": [{
    heading: "Reference state and outdoor air",
    text: "Reference values define the design state used by the chosen physical model. Outdoor values describe air outside the study domain. Setting an outdoor value does not assign it to an individual vent or wall. Set imported or explicit surface conditions in Bounds. Gravity uses the building's axes with Z up.",
    links: [fluidDocs],
  }],
  "Initial fields": [{
    heading: "Start values in the air volume",
    text: "OpenFOAM uses initial fields in its zero-time directory to start the calculation. Boundary conditions are specified separately. Temperature and CO₂ apply when their transport equations are enabled. Only quantities used by the selected turbulence model need initial turbulence values.",
    links: [{ label: "OpenFOAM v2306 · case structure and fields", url: OPENFOAM + "quickstart/" }, { label: "OpenFOAM v2306 · turbulence models", url: OPENFOAM + "tools/processing/models/turbulence/" }],
  }],
  "Simulation & resources": [{
    heading: "Worker eligibility and run limits",
    text: "This section combines the current worker connection, its simulation allowance and the resources requested by this study. A mesh-only job checks the grid. Running the solver also requires a supported physics setup and an available solve allowance. Refresh connection retrieves the worker's current capabilities. Use worker resource limits clamps this study to the published limits.",
    links: [{ label: "OpenFOAM v2306 · case and solver setup", url: OPENFOAM + "quickstart/" }],
  }],
  "Iterations & convergence targets": [{
    heading: "What controls a steady solve",
    text: "OpenFOAM reads discretisation from fvSchemes and pressure–velocity coupling and convergence controls from fvSolution. The native worker uses steady SIMPLE. Monitor residuals and inlet/outlet balance together, and compare the results on a refined mesh when accuracy matters. A run can reach its iteration limit before meeting the residual target.",
    links: [numericsDocs, { label: "OpenFOAM v2306 · SIMPLE and residual control", url: OPENFOAM + "quickstart/" }],
  }],
  "Time stepping & output intervals": [{
    heading: "Transient solver settings",
    text: "Transient controls describe how a supported solver advances physical time and saves field states. The native worker solves steady isothermal airflow. These settings are available for configuration handoff.",
    links: [numericsDocs],
  }],
  "Sampling planes": [{
    heading: "Plan where to sample",
    text: "Each direction defaults to 15 equally spaced slices and accepts at least 10. Preview shows their positions within checked bounds. Computed field values become available for verified solver outputs in Results.",
  }],
  "Local refinement regions": [{
    heading: "Refine where the flow changes",
    text: "Use a box, sphere or measured object to put finer cells around a jet, wake or opening. Each level halves the nominal edge length. The final cell count depends on the region, the transition between levels and the removal of cells outside the measured volume.",
    links: [{ label: "OpenFOAM v2306 · castellation", url: meshDocs.url + "castellation/" }],
  }],
  "Refinements, layers, tolerances & quality intent": [{
    heading: "Mesh resolution and quality",
    text: "Surface and volume refinements control where cells are split. Snap iterations guide the boundary towards the source surfaces. Mesh quality checks detect distorted or invalid cells before solving. Layer settings describe near-wall prism layers for a compatible mesher. The native worker currently creates no added layers.",
    links: [{ label: "OpenFOAM v2306 · mesh quality controls", url: meshDocs.url + "meshquality/" }],
  }],
  "Flow & thermal conditions": [{
    heading: "Conditions at the face",
    text: "Choose how momentum crosses this surface and how heat would cross it in a thermal solve. A no-slip wall has zero relative velocity at the face. A pressure opening uses a pressure reference and can admit backflow. Define dedicated supply and extract flows in Objects. The native solver uses smooth, adiabatic boundaries for isothermal airflow.",
    links: [{ label: "OpenFOAM v2306 · boundary conditions", url: OPENFOAM + "tools/processing/boundary-conditions/" }],
  }],
  "Additional boundary fields": [{
    heading: "Properties of an advanced boundary",
    text: "Set roughness, incoming turbulence and scalar conditions where the selected boundary type and solver use them. Scalar flux and concentration describe different physical inputs. Review the worker compatibility checks before submitting a case that uses them.",
  }],
  "Surface settings": [{
    heading: "Edit a single surface",
    text: "The editor shows the selected surface and its room. Changes set a condition for this surface in this simulation. Clear override restores its group or surface-type condition. Supply and extract settings belong to their devices in Objects.",
  }],
  "Surface assignment": [{
    heading: "Assign surfaces to a boundary group",
    text: "Check a surface to move it into this group. Uncheck it to return it to Default surfaces. A per-surface override still takes precedence. Supply and extract faces are edited in Objects.",
  }],
  "Requested outputs": [{
    heading: "Fields to save",
    text: "Choose the fields the solver should write. Native runs can save velocity and kinematic pressure. Temperature, CO₂, age of air and thermal comfort need solver support for the corresponding equations or derived quantities.",
  }],
  "Monitoring probe positions": [{
    heading: "Sample at fixed points",
    text: "Probes record field values at points in the air volume on each configured write. Enter building X, Y and Z coordinates in millimetres. A probe should be inside the fluid and clear of solid objects.",
  }],
  "Sampled fields & output cadence": [{
    heading: "Decide what to extract and when",
    text: "Choose which saved fields to extract on the requested planes. A cadence of 1 samples every field write. Solver write frequency controls which iterations reach disk. Sampling more often or on more planes increases result storage.",
  }],
  "Convergence & residuals": [{
    heading: "Track iterative convergence",
    text: "Residuals measure the remaining equation imbalance as the solver iterates. Use these trends together with the flow balance and stable values at probes. A run can reach its iteration limit before converging.",
    links: [numericsDocs],
  }],
  "Resources & retention": [{
    heading: "Storage, scheduling and expiry",
    text: "Storage limits the generated files the worker may keep for this job. Retention expresses how many days they should remain available within the worker’s maximum. Queue is a configuration handoff field. The native service manages its own queue.",
  }],
  "Preflight diagnostics": [{
    heading: "Find and repair preparation issues",
    text: "Blocking errors prevent submission. Warnings identify assumptions or settings to inspect. Filter by severity and choose Inspect to open the associated setting or highlight its geometry. Repeat Refresh checks after editing.",
  }],
  "Cached result layers": [{
    heading: "Manage local files displayed in the viewer",
    text: "Load a field layer from a verified run or import a supported external file. Unloading removes the displayed copy. Restore default and New simulation can permanently delete saved worker files after confirmation. Files you previously downloaded remain on your computer.",
  }],
};
CFD_SECTION_HELP["Advanced numerics & convergence targets"] = CFD_SECTION_HELP["Iterations & convergence targets"];

export function climoptixSectionHelp(title: string) {
  const key = title.split(" · ")[0].replace(/\s*\(\d+\)$/, "");
  return Object.hasOwn(CFD_SECTION_HELP, key) ? CFD_SECTION_HELP[key] : undefined;
}

const CFD_CONTROL_HELP: Record<string, string> = {
  "seed floor": "Choose the building level containing the first room of the CFD air domain. Physical openings can connect that room to other levels.",
  "seed room": "Choose where connected air-volume discovery starts. Permanent open passages and physical slab voids can extend the calculation into adjoining rooms.",
  "mesh intent preset": "Apply a starter set of base and local cell sizes and cell budgets. Changing an individual mesh size selects Custom.",
  "base cell": "Approximate edge length of a blockMesh background cell. Smaller cells increase the starting cell count in all three directions.",
  "min cell": "Smallest permitted nominal cell size. Each snappyHexMesh refinement level halves the edge length. Choose compatible values if a requested local size rounds to a level below this limit.",
  "max cell": "Upper cell-size setting retained with the mesh recipe. The native worker builds its uniform background block from Base Cell.",
  "target cell count": "Planning target used to assess the mesh recipe. Actual cell count depends on the domain, refinement and discarded cells.",
  "maximum cell budget": "Hard cell-count ceiling for the native mesh. Increase the base cell size or reduce local refinement if the mesh would exceed this limit.",
  "predicted cells before refinement": "Estimate using the last checked domain bounds and the current base size, origin and alignment. The native block is rounded out to grid lines with two extra cells on each side.",
  "mesh origin & alignment": "Place and rotate the background mesh grid relative to the measured building.",
  "air density": "Mass per cubic metre at the design air state. Converts prescribed mass flow to volume flow and combines with dynamic viscosity to give kinematic viscosity, ν = μ/ρ.",
  "dynamic viscosity": "The fluid’s resistance to shear. Enter μ in Pa·s. The native incompressible worker uses ν = μ/ρ in m²/s.",
  "heat capacity": "Specific heat at constant pressure, cp. It is the heat needed to raise one kilogram of air by one kelvin at constant pressure and controls how strongly temperature responds to heat input.",
  "thermal conductivity": "How readily heat diffuses through air. A larger value increases conductive heat transfer for a given temperature gradient.",
  "prandtl number": "Momentum diffusivity divided by thermal diffusivity. For consistent constant air properties, Pr = μ × cp / k. The thermal transport model determines how it is used.",
  "thermal expansion": "Fractional volume change per kelvin at constant pressure. A Boussinesq model uses it to relate a small temperature change to buoyancy. For ideal air it is approximately 1 divided by the reference temperature in kelvin.",
  "reference temperature": "Reference air temperature for the study’s thermophysical model, including the temperature difference used for Boussinesq buoyancy.",
  "reference pressure": "Absolute pressure of the reference air state. Initial relative pressure and vent pressure offsets use a gauge reference instead.",
  "outdoor temperature": "Design temperature outside the building. Check the outdoor or adjacent-air condition assigned to each thermal boundary in Bounds.",
  "relative humidity": "Water vapour content as a fraction of saturation at the specified air temperature. Enter 0.5 for 50% relative humidity. The isothermal worker does not solve humidity transport.",
  "outdoor co2": "Background outdoor CO₂ concentration by volume, in parts per million. Use an appropriate measured or design value when the scalar transport model is enabled.",
  "initial relative pressure": "Gauge pressure used to initialise the air volume. The native worker divides the entered Pa by air density to initialise OpenFOAM’s kinematic pressure field.",
  "initial temperature": "Starting temperature of the air volume for an energy solve. Vent inlet temperatures and wall temperatures are boundary settings.",
  "initial co2": "Starting CO₂ concentration by volume in the air volume, in ppm, for a solver that transports CO₂.",
  "initial turbulent k": "Initial turbulent kinetic energy per unit mass. Use a positive value representative of the flow when using a RANS model.",
  "initial ε": "Initial dissipation rate of turbulent kinetic energy for k–ε. Specify it in m²/s³.",
  "initial ω": "Initial specific dissipation rate for k–ω SST. Specify it in inverse seconds.",
  "physics preset": "Apply a matching set of airflow, thermal and scalar equations. Choose isothermal ventilation to run with the native velocity and pressure worker.",
  "turbulence": "Choose Laminar to solve without a turbulence model, k–ε for a two-equation RANS model, or k–ω SST for a RANS model that blends near-wall k–ω and outer-flow behaviour.",
  "simulation type": "Steady SIMPLE iterates toward a time-independent flow. Transient PIMPLE advances time and requires a compatible solver. The native worker runs steady SIMPLE.",
  "cpu cores": "Number of processing cores requested for the run. The worker enforces the core limit for the current service.",
  "memory limit": "Maximum memory requested for the job. Refined meshes and extra result data can exceed it.",
  "time limit": "Maximum elapsed time allowed for the worker job, including case execution. The service enforces its own upper limit.",
  "coupling": "Pressure–velocity algorithm. SIMPLE uses successive pressure corrections for steady flow. PIMPLE combines PISO and SIMPLE corrections for transient flow and needs a compatible solver.",
  "gradient": "Approximates spatial derivatives of cell values. Linear uses Gauss with linear interpolation. Limited Linear limits the extrapolated face values to neighbouring cell bounds to reduce overshoots.",
  "convection": "Approximates transport through cell faces. Upwind uses the upstream cell for robustness. Linear Upwind adds a gradient correction. Limited Linear blends toward upwind where limiting is needed.",
  "non orthogonal corrections": "Additional pressure corrections per SIMPLE iteration to account for cell faces whose normals are misaligned with the line between neighbouring cell centres. More corrections increase work per iteration.",
  "relaxation": "Under-relaxation factor for equation updates. Values closer to one allow larger changes per iteration. Smaller values can stabilise the solve but usually slow convergence. Native pressure relaxation is set separately.",
  "residual target": "Initial residual threshold applied by SIMPLE residualControl to pressure, velocity and the active turbulence equations. Also inspect continuity and physical quantities before accepting a solution.",
  "max iterations": "Upper bound on steady SIMPLE iterations. The solver can stop earlier when residual controls are met.",
  "write fields every n iterations": "Save the flow fields every N steady iterations. Smaller intervals provide more checkpoints for sampling and consume more storage.",
  "balance tolerance": "Maximum relative mismatch allowed between total incoming and outgoing flow for the conservation check. Enter a fraction, such as 0.05 for 5%. This is separate from numerical residuals.",
  "monitor": "Choose the quantity to track alongside residuals. The native worker supports flow balance. Temperature and CO₂ monitors require an adapter that computes those fields.",
  "start": "Physical start time of the transient calculation in seconds.",
  "end": "Physical time in seconds at which the transient calculation stops.",
  "step": "Time increment for a fixed-step solve, or the initial increment when time-step adjustment is enabled.",
  "adjustable": "Allow a compatible transient solver to adjust the time step to control the Courant number.",
  "maximum courant intent": "Upper target for the ratio of the distance transported in one time step to the cell size. A compatible adaptive solver can reduce the time step to stay within it.",
  "write interval": "Physical time between saved fields for a transient study. Smaller intervals increase data volume.",
  "statistics start": "Time from which statistics can be accumulated, typically after the starting flow has settled.",
  "storage": "Disk-space allowance requested for saved fields, sampled planes and the run archive.",
  "retention days": "Requested lifetime of the stored job outputs. The service may enforce a shorter maximum.",
  "queue": "Requested scheduling destination retained in the study. The native service uses its own runner queue.",
  "preview sampling planes in 3d": "Show planned sampling positions as translucent planes in the checked air domain. Computed results are loaded separately from Results.",
  "yz slices (normal x)": "Request slices parallel to the YZ plane, distributed along the building X axis.",
  "xz slices (normal y)": "Request slices parallel to the XZ plane, distributed along the building Y axis.",
  "xy slices (normal z)": "Request horizontal slices parallel to the XY plane, distributed over the checked height.",
  "add probe": "Add a monitoring point inside the checked air volume. Move it in the viewer or enter building coordinates to set the location for field sampling.",
  "velocity": "Velocity U is a vector in m/s. Results can display its speed or a signed component along a building axis.",
  "pressure": "Pressure describes the force per unit area. The native incompressible worker writes kinematic pressure in m²/s², which is gauge pressure divided by density.",
  "age of air": "Request a residence-time field describing how long air takes to reach each point from supply. This requires a compatible scalar solver.",
  "comfort": "Request supported thermal comfort outputs derived from solved airflow and thermal fields. These require a compatible solver and suitable comfort inputs.",
  "cfd view scope": "Show the whole building, one measured room or a connected air volume without changing which rooms are included in the simulation.",
  "cfd patch display": "Use Default for the normal geometry, thermal overlays and detailed assets. Choose a parameter to colour the checked surfaces by boundary type, value or refinement level.",
  "ceilings": "Show ceiling surfaces in the 3D viewer. This changes the view of the domain.",
  "visual assets": "Show detailed building objects in Default mode. The solver uses the checked physical representation selected in Objects.",
  "2d wall outlines": "Show wall outlines in Default mode so you can see through the walls while inspecting the domain.",
  "isolate selection": "Show the selected CFD surface or vent on its own. Choose another view scope to clear isolation.",
  "refinement intent": "Show the local regions in which the mesh requests finer cells. These previews describe the recipe before meshing.",
  "new simulation": "Create a starter simulation. If a study is selected, confirmation deletes that study’s saved results and clears the viewer.",
  "restore default": "Replace the workbench with one starter airflow case. Confirmation clears loaded results and permanently deletes the replaced simulations’ worker results.",
  "refinement shape": "Choose a box, sphere or checked object to define where to request finer cells.",
  "refinement level": "Number of times snappyHexMesh divides the base cell size by two in each direction. One level can replace one cell with eight.",
  "refinement object": "Choose a checked CFD object as the source of this region’s measured bounds.",
  "feature angle": "Angle threshold for identifying changes in surface orientation that may need extra feature refinement.",
  "snap iterations": "Maximum iterations for pulling background mesh points toward the input surface during snapping.",
  "maximum non-orthogonality": "Mesh quality limit in degrees for the angle between a cell-to-cell direction and the shared face normal.",
  "max skewness": "Limit mesh distortion from the offset between a face centre and the intersection of the line connecting its adjacent cell centres.",
  "max aspect ratio": "Limit how elongated a cell can be. Large ratios can reduce accuracy and stability, depending on the flow direction and discretisation.",
  "minimum cell volume intent": "Smallest intended valid cell volume in cubic metres. Very small cells can cause poor conditioning or time-step restrictions.",
  "cleanup tolerance intent": "Distance tolerance for geometry cleanup. Use a small value relative to measured openings and clearances so they survive preparation.",
  "snap tolerance intent": "Distance tolerance recorded for snapping the mesh to its source surfaces. The native worker chooses its snappyHexMesh controls from its supported recipe.",
  "small feature": "Scale for judging which geometric details need attention. Keep it below the width of any gap or opening the mesh must preserve.",
  "load imbalance": "Requested tolerance for the difference in cell count between processors during parallel refinement.",
  "vent cell": "Nominal size of cells at a vent face. A compatible refinement level must resolve the opening across multiple cells.",
  "jet cell": "Requested cell size in the volume near an inlet where the air jet develops.",
  "opening cell": "Requested cell size around windows, doors and other openings recognised by the mesh recipe.",
  "object cell": "Requested cell size near the geometry of a CFD obstacle.",
  "wake cell": "Requested cell size in the refinement volume around a CFD obstacle where separated flow can develop.",
  "wall cell": "Requested cell size on the envelope surfaces. Smaller cells can represent wall features more closely.",
  "minimum layer coverage": "Fraction of the requested surface intended to retain prism layers. The connected native worker does not generate added layers.",
  "boundary condition type": "Colour each domain patch by its assigned boundary type so that you can check walls, inlets, outlets and open boundaries.",
  "flow condition": "Choose the momentum boundary applied to this surface. Use Objects to configure dedicated supply and extract vents.",
  "thermal condition": "Choose how a thermal-capable solver exchanges heat across the surface, such as insulating it or prescribing a temperature.",
  "clear override · inherit group": "Remove the explicit setting for this surface so that it uses the condition assigned to its boundary group.",
  "surface type defaults": "Define fallback conditions for walls, floors, ceilings and other surface types when they have no explicit override.",
  "find surface · room, surface or source": "Filter the list by room, measured surface name or its source. This only changes which entries are listed.",
  "find a cfd patch": "Filter surfaces by room, surface name or source. The current conditions and group assignments are kept.",
  "boundary setup": "Switch between flow conditions on individual surfaces and the shared thermal boundary inputs.",
  "collapse all": "Close the collapsible settings in this window. Expand a heading to edit it again.",
  "expand all": "Open the collapsible settings in this window. Row action menus stay closed.",
  "refresh connection": "Fetch the worker’s current connectivity, capabilities, resource caps and remaining solver allowance.",
  "use worker resource limits": "Bring the study’s resource requests within the limits published by the connected worker. Review mesh resolution separately if the cell budget changes.",
  "review issues": "Open the current study’s geometry checks, worker readiness and submission diagnostics. Select a different study first to inspect its issues.",
};

export function climoptixFieldDescription(label: string) {
  const full = label.toLowerCase().replaceAll("₂", "2");
  const key = full.replace(/\s*\([^)]*\)\s*$/, "");
  const axis = key.match(/ ([xyz])$/)?.[1].toUpperCase();
  if (/^[xyz] plane count$/.test(key)) return "Number of equally spaced interior slices normal to this building axis. Increasing the count improves spatial coverage and uses more result storage.";
  if (/^probe \d+ [xyz]$/.test(key)) return `Coordinate of this monitor along building ${axis}, relative to the building origin. Z is elevation above the origin.`;
  if (axis) {
    if (/^origin(?: \(mm\))? [xyz]$/.test(key)) return `Offset of the background grid along building ${axis}. Grid lines repeat every Base Cell increment from this coordinate. Measured geometry stays in place.`;
    if (key.startsWith("rotation about ")) return `Right-hand rotation about the fixed building ${axis} axis through the grid origin, in degrees. Rotations apply in X, Y, Z order.`;
    if (key.startsWith("gravity")) return `Gravity acceleration along building ${axis}. With Z up, standard downward gravity is about −9.81 m/s² along Z and zero on X and Y.`;
    if (key.startsWith("initial velocity")) return `Starting velocity component along building ${axis} in m/s inside the domain. Prescribed vent flow is applied separately at its boundary.`;
  }
  if (Object.hasOwn(CFD_CONTROL_HELP, full)) return CFD_CONTROL_HELP[full];
  return Object.hasOwn(CFD_CONTROL_HELP, key) ? CFD_CONTROL_HELP[key] : undefined;
}

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
      text: "Choose a seed floor and room. Checks refresh automatically after committed changes. Use Refresh checks in the Simulation setup title bar to retry. Only permanent doorless passages and physical slab voids expand the connected air volume. Doors and windows stop discovery at every open state. Their virtual caps may use an opening or pressure boundary. Viewer scope is independent of the seed.",
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
      heading: "Airflow and thermal studies",
      text: "For an isothermal airflow study, the worker calculates velocity and pressure using the measured geometry and vent flows. Use Prepare thermal CFD in Heating or Ventilation to capture heat-transfer inputs for a compatible solver.",
    },
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
      text: "Choose source constructions, site/weather, gains and calculation assumptions, then Calculate & preview. The main window help includes each thermal step and its engineering assumptions. Preview is an envelope estimate, not a solved CFD result. Apply transfers a revision-bound thermal contract; stale or incomplete calculations cannot be applied. A future worker still needs validated thermal boundary/source adapters.",
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

export const CFD_WORKBENCH_HELP = [
  {
    heading: "Your 3D workspace",
    text: "Use View to inspect the whole building, a room or a connected air volume. This does not change your simulation's seed room. Open and close the tabbed setup window from Toolbar or by right-clicking the background. Drag a titlebar to move a window and its edges to resize it.",
  },
  {
    heading: "One shared building",
    text: "Create a simulation and choose its seed room; preparation checks refresh automatically after committed changes. On phones and tablets, choose Simulations from Phase to create, group or select a simulation. On wider screens, use the Simulation selector and phase tabs. Thermal is inside Bounds; convergence is inside Solver → Monitor. Geometry, furniture and people come from the shared measured building in millimetres. File → Save includes simulations and their folders.",
  },
  {
    heading: "Connectivity is explicit",
    text: "Only permanent doorless passages and physical slab voids connect air regions. Doors and windows stop discovery at every open state. Their virtual caps can use an opening/pressure boundary; they are not automatically solid walls.",
  },
  {
    heading: "Prepare, inspect, export",
    text: "Open Domain in Solver → Mesh to choose the connected air volume. Add equipment under Bounds → Objects and group surfaces under Bounds → Conditions. Solver contains Mesh, Run, Monitor, Post and Optimisation. Refresh checks in the title bar retries geometry preparation. Worker submission performs its own preflight.",
  },
  {
    heading: "No simulated results",
    text: "Without a connected worker, Mesh/Run stay disabled and no simulation results are computed. Connected jobs show only worker-reported progress. Imported real solver logs and VTK surface/slice files remain external, not verified results for this simulation. Counts are estimates. Review engineering assumptions before connecting a worker.",
  },
];

/** Complete guide stays available while individual phase panels are unmounted. */
export const CFD_SETUP_HELP = [...Object.values(CFD_PHASE_HELP).flat(), ...CFD_SIMULATION_HELP, ...THERMAL_HELP, ...CFD_WORKBENCH_HELP];
