"use client";

import { useSyncExternalStore } from "react";
import type { useCFDMeshInspection } from "./useCFDMeshInspection";
import { CFDNumber } from "./CFDFields";
import { WindowHelpButton } from "./WindowHelpButton";
import type { MeshAxis, MeshDisplay } from "@/lib/cfdMeshInspection";
import { meshSectionContains } from "@/lib/cfdMeshInspection";

export function CFDMeshInspectionPanel({inspection: state, onOpenMeshSetup}: {
  inspection: ReturnType<typeof useCFDMeshInspection>; onOpenMeshSetup: () => void;
}) {
  const fraction = useSyncExternalStore(state.position.subscribe, state.position.getSnapshot, state.position.getSnapshot);
  const coordinateMm = state.min + (state.max - state.min) * fraction;
  const ready = !!state.geometry && (!state.sectioning || meshSectionContains(state.geometry, state.axis, coordinateMm));
  const inspection = {...state, coordinateMm, loading: state.inspecting && !ready,
    displayedCoordinate: ready ? coordinateMm : state.geometry?.coordinateMm ?? coordinateMm};
  const mesh = inspection.metadata;
  const metres = (mm: number) => Number((mm / 1000).toPrecision(12));
  return <section className="cfx-mesh-inspection" aria-label="Mesh inspection" data-cfx-collapse-root>
    <details open><summary>Mesh inspection<WindowHelpButton section title="Mesh inspection" steps={[
      {heading: "Current status", text: inspection.guidance},
      ...(inspection.error ? [{heading: "Worker details", text: inspection.error}] : []),
      {heading: "Checked mesh", text: "Inspection reads the final volume mesh after its meshing checks pass. Opening this view does not generate a mesh or start a solve. Mesh setup opens the source settings without changing them."},
      {heading: "Temporary view", text: "Inspect mesh temporarily isolates the mesh in the existing 3D view. Orbit, pan and zoom remain available. Exit inspection, Escape or leaving this tab restores the previous camera and scene. Display controls never change project or simulation inputs."},
    ]} /></summary>
      <p id="cfx-mesh-status" className={inspection.error ? "cfx-error" : "cfx-caption"} role={inspection.error ? "alert" : "status"}>{inspection.status}</p>
      {inspection.inspecting && inspection.historical && <p className="cfx-caption">Submitted mesh · earlier setup</p>}
      <div className="cfx-equal-actions">
        {inspection.error ? <button type="button" onClick={inspection.retry}>Retry mesh</button> :
          <button type="button" className={inspection.inspecting ? "cfx-primary" : undefined} aria-pressed={inspection.inspecting}
            aria-describedby="cfx-mesh-status" disabled={!inspection.canInspect} onClick={inspection.toggle}>
            {inspection.inspecting ? "Exit inspection" : "Inspect mesh"}</button>}
        {mesh ? <button type="button" disabled={!inspection.inspecting} onClick={inspection.fit}>Fit view</button> :
          <button type="button" onClick={onOpenMeshSetup}>Mesh setup</button>}
      </div>
      {inspection.loading && <p className="cfx-caption" role="status">{inspection.geometry?.axis
        ? `Showing ${inspection.geometry.axis} = ${metres(inspection.displayedCoordinate)} m · updating…`
        : inspection.sectioning ? "Updating section…" : "Loading mesh…"}</p>}
      {!inspection.loading && inspection.inspecting && inspection.geometry?.axis && <p className="cfx-caption" role="status">{inspection.geometry.sectionCells
        ? inspection.geometry.sectionCells.toLocaleString() + " intersected cells" : "Empty section"}</p>}
    </details>
    {mesh && <>
    <details open><summary>Mesh appearance<WindowHelpButton section title="Mesh appearance" steps={[
      {heading: "Display mode", text: "Solid boundary shows the actual boundary faces and their original edges. Boundary edges shows those edges alone, without triangulation diagonals. Transparent shows the same mesh with adjustable face opacity. Section view uses the same appearance settings."},
      {heading: "Opacity", text: "Opacity is active in Transparent mode. Full opacity returns to solid faces immediately. Edges remain visible against both light and dark backgrounds. Transparency uses standard WebGL depth sorting."},
    ]}/></summary><fieldset disabled={!inspection.canInspect} className="cfx-mesh-inspection-fields">
      <div className="cfx-mesh-form">
        <label>Display mode<select aria-label="Mesh display mode" value={inspection.display} onChange={event => inspection.setDisplay(event.target.value as MeshDisplay)}>
          <option value="solid">Solid boundary</option><option value="wireframe">Boundary edges</option><option value="transparent">Transparent</option>
        </select></label>
        <button type="button" disabled={inspection.display === "solid"} onClick={() => { inspection.setDisplay("solid"); inspection.setOpacity(100); }}>Full opacity</button>
      </div>
      <label>Opacity · {inspection.display === "transparent" ? inspection.opacity : 100}%<input type="range" aria-label="Mesh opacity" min={5} max={100} step={1}
        aria-valuetext={`${inspection.display === "transparent" ? inspection.opacity : 100} percent`}
        disabled={inspection.display !== "transparent"} value={inspection.display === "transparent" ? inspection.opacity : 100} onChange={event => inspection.setOpacity(Number(event.target.value))} /></label>
    </fieldset></details>
    <details open><summary>Section<WindowHelpButton section title="Mesh section" steps={[
      {heading: "Section", text: "Show a genuine cut through the volume cells, including their internal partitions. X, Y and Z are the solver's global axes; the selected axis is perpendicular to the section. Keep rear mesh retains the boundary behind the cut, away from the current camera when the axis is selected. Only its clipping plane moves; the boundary is loaded once."},
      {heading: "Position and movement", text: "Position is in metres in solver coordinates. The slider, numeric entry and previous/next buttons stay synchronized within the mesh bounds. Steps move by one percent of the selected axis span. Center section uses its midpoint; Reset section restores Z and its midpoint. Section movement preserves the camera."},
      {heading: "Smooth movement", text: "Within a checked topology interval, only section vertex positions update locally. Crossing an interval requests the next exact cut. During that update, the previous section and rear cut remain at their actual displayed position. Switching axis or mesh never reuses another axis or revision."},
      {heading: "Supported topology", text: "Sections use native ASCII single-fluid polyMesh, including polyhedral and concave cells and disconnected fluid parts. Warped faces are triangulated through source vertices. Binary meshes need ASCII conversion. Detailed geometry responses are bounded to 48 MB."},
      {heading: "Current bounds", text: [0, 1, 2].map(index => `${"XYZ"[index]}: ${metres(mesh.boundsMm[0][index])} to ${metres(mesh.boundsMm[1][index])} m`).join("; ")},
    ]}/></summary><fieldset disabled={!inspection.canInspect} className="cfx-mesh-inspection-fields">
      <div className="cfx-mesh-toggles">
        <label className="cfx-check"><input type="checkbox" checked={inspection.sectioning} onChange={event => inspection.setSectioning(event.target.checked)} />Show section</label>
        <label className="cfx-check"><input type="checkbox" disabled={!inspection.sectioning} checked={inspection.showRear} onChange={event => inspection.setShowRear(event.target.checked)} />Keep rear mesh</label>
      </div>
      {inspection.sectioning && inspection.showRear && inspection.rearError && <p className="cfx-error" role="alert">{inspection.rearError}</p>}
      {inspection.sectioning && <>
        <div className="cfx-mesh-form">
          <label>Normal axis<select aria-label="Mesh section axis" value={inspection.axis} onChange={event => inspection.setAxis(event.target.value as MeshAxis)}>
            {["X", "Y", "Z"].map(axis => <option key={axis} value={axis}>{axis}</option>)}
          </select></label>
          <CFDNumber convert={false} label="Section position (m)" min={metres(inspection.min)} max={metres(inspection.max)} value={metres(inspection.coordinateMm)}
            validate={value => value < metres(inspection.min) || value > metres(inspection.max) ? `Use ${metres(inspection.min)} to ${metres(inspection.max)} m.` : undefined}
            onChange={value => inspection.setCoordinate(value * 1000)} />
        </div>
        <label>Position · {metres(inspection.coordinateMm)} m<input type="range" aria-label="Mesh section position"
          min={inspection.min} max={inspection.max} step={(inspection.max - inspection.min) / 500} value={inspection.coordinateMm}
          aria-valuetext={`${inspection.axis} = ${metres(inspection.coordinateMm)} metres`}
          onChange={event => inspection.setCoordinate(Number(event.target.value))} /></label>
        <div className="cfx-equal-actions"><button type="button" disabled={inspection.coordinateMm <= inspection.min} onClick={() => inspection.step(-1)} aria-label="Previous mesh section">Previous section</button>
          <button type="button" disabled={inspection.coordinateMm >= inspection.max} onClick={() => inspection.step(1)} aria-label="Next mesh section">Next section</button>
          <button type="button" onClick={inspection.center}>Center section</button><button type="button" onClick={() => { inspection.setAxis("Z"); inspection.center(); }}>Reset section</button></div>
      </>}
    </fieldset></details>
    <details><summary>Mesh information<WindowHelpButton section title="Mesh information" steps={[
      {heading: "Source", text: "Counts and bounds come from the final checked volume mesh. The defaultRegion name denotes the single fluid region; disconnected fluid parts can share that region."},
      {heading: "Read-only inspection", text: "These values describe the retained mesh. Mesh setup opens the source domain and meshing settings. Viewing, fitting or sectioning cannot modify those inputs, boundary conditions or shared Heating and Ventilation data."},
    ]}/></summary><dl className="cfx-mesh-information">
      <div><dt>Cells</dt><dd>{mesh.cells.toLocaleString()}</dd></div><div><dt>Faces</dt><dd>{mesh.faces.toLocaleString()}</dd></div>
      <div><dt>Points</dt><dd>{mesh.points.toLocaleString()}</dd></div>
      <div><dt>Source</dt><dd>Final checked polyMesh</dd></div><div><dt>Regions</dt><dd>{mesh.regions.join(", ")}</dd></div>
      {mesh.boundsMm[0].map((value, index) => <div key={index}><dt>{"XYZ"[index]} bounds (m)</dt><dd>{metres(value)} to {metres(mesh.boundsMm[1][index])}</dd></div>)}
    </dl>
      <div className="cfx-equal-actions"><button type="button" onClick={onOpenMeshSetup}>Mesh setup</button></div>
    </details>
    </>}
  </section>;
}
