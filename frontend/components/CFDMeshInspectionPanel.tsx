"use client";

import type { useCFDMeshInspection } from "./useCFDMeshInspection";
import { CFDNumber } from "./CFDFields";
import { WindowHelpButton } from "./WindowHelpButton";
import type { MeshAxis, MeshDisplay } from "@/lib/cfdMeshInspection";

export function CFDMeshInspectionPanel({inspection}: {inspection: ReturnType<typeof useCFDMeshInspection>}) {
  const mesh = inspection.metadata;
  return <section className="cfx-mesh-inspection" aria-label="Mesh inspection" data-cfx-collapse-root>
    <details open><summary>Mesh inspection<WindowHelpButton section title="Mesh inspection" steps={[
      {heading: "Actual solver mesh", text: "This view reads the final checked OpenFOAM points, faces, owner, neighbour and boundary files. Full mesh displays boundary faces and their original polygon edges. Sections intersect the actual volume cells, including internal partitions. Native metres are normalized to millimetres internally. The position control displays global solver metres."},
      {heading: "Temporary isolated view", text: "Inspect Mesh temporarily isolates the mesh in the main 3D view. Orbit, pan and zoom remain available. Exit Inspection or leave this tab to restore the previous camera and visible scene. Display and section controls change this view only."},
      {heading: "Topology and display limits", text: "Native ASCII single-fluid polyMesh is supported, including disconnected fluid regions and polyhedral cells. Warped faces use constrained triangulation through their original vertices. Binary polyMesh requires ASCII conversion. Detailed display is bounded to 48 MB per response. Transparent faces use standard depth-sorted WebGL transparency."},
    ]} /></summary>
      <p className="cfx-caption" role="status">{inspection.status}</p>
      {inspection.error && <p className="cfx-error" role="alert">{inspection.error}</p>}
      <div className="cfx-equal-actions">
        <button className={inspection.inspecting ? "cfx-primary" : undefined} aria-pressed={inspection.inspecting} disabled={!mesh}
          onClick={inspection.toggle}>{inspection.inspecting ? "Exit Inspection" : "Inspect Mesh"}</button>
        <button disabled={!inspection.inspecting} onClick={inspection.fit}>Fit mesh</button>
      </div>
      {inspection.error && <button onClick={inspection.retry}>Reload mesh</button>}
      {inspection.loading && <p role="status">{inspection.sectioning ? "Calculating volume-cell section…" : "Loading final mesh boundary…"}</p>}
      {inspection.geometry && inspection.sectioning && <p className="cfx-caption" role="status">{inspection.geometry.sectionCells
        ? inspection.geometry.sectionCells.toLocaleString() + " intersected volume cells" : "Empty section · no volume cells intersect this plane"}</p>}
    </details>
    <details open><summary>Display</summary><fieldset disabled={!mesh} className="cfx-mesh-inspection-fields">
      <label>Display mode<select aria-label="Mesh display mode" value={inspection.display} onChange={event => inspection.setDisplay(event.target.value as MeshDisplay)}>
        <option value="solid">Solid boundary</option><option value="wireframe">Boundary edges</option><option value="transparent">Transparent</option>
      </select></label>
      <label>Opacity · {inspection.display === "transparent" ? inspection.opacity : 100}%<input type="range" aria-label="Mesh opacity" min={5} max={100} step={1}
        disabled={inspection.display !== "transparent"} value={inspection.display === "transparent" ? inspection.opacity : 100} onChange={event => inspection.setOpacity(Number(event.target.value))} /></label>
      <button onClick={() => { inspection.setDisplay("solid"); inspection.setOpacity(100); }}>Full opacity</button>
    </fieldset></details>
    <details open><summary>Sectioning</summary><fieldset disabled={!mesh} className="cfx-mesh-inspection-fields">
      <label className="cfx-check"><input type="checkbox" checked={inspection.sectioning} onChange={event => inspection.setSectioning(event.target.checked)} />Section only</label>
      <fieldset disabled={!inspection.sectioning} className="cfx-mesh-inspection-fields">
        <label>Global axis<select aria-label="Mesh section axis" value={inspection.axis} onChange={event => inspection.setAxis(event.target.value as MeshAxis)}>
          {["X", "Y", "Z"].map(axis => <option key={axis} value={axis}>{axis}</option>)}
        </select></label>
        <label>Section position · {(inspection.coordinateMm / 1000).toFixed(4)} m<input type="range" aria-label="Mesh section position"
          min={inspection.min} max={inspection.max} step={(inspection.max - inspection.min) / 500} value={inspection.coordinateMm}
          onChange={event => inspection.setCoordinate(Number(event.target.value))} /></label>
        <CFDNumber convert={false} label="Section position (m)" min={inspection.min / 1000} max={inspection.max / 1000} value={inspection.coordinateMm / 1000}
          onChange={value => inspection.setCoordinate(value * 1000)} />
        <div className="cfx-equal-actions"><button disabled={inspection.coordinateMm <= inspection.min} onClick={() => inspection.step(-1)} aria-label="Previous mesh section">Previous section</button>
          <button disabled={inspection.coordinateMm >= inspection.max} onClick={() => inspection.step(1)} aria-label="Next mesh section">Next section</button>
          <button onClick={inspection.center}>Center section</button><button onClick={() => { inspection.setAxis("Z"); inspection.center(); }}>Reset section</button></div>
        {mesh && <small className="cfx-caption">{inspection.axis} bounds · {(inspection.min / 1000).toFixed(4)} to {(inspection.max / 1000).toFixed(4)} m</small>}
      </fieldset>
    </fieldset></details>
    {mesh && <details><summary>Mesh information</summary><dl className="cfx-grid cfx-mesh-information">
      <div><dt>Cells</dt><dd>{mesh.cells.toLocaleString()}</dd></div><div><dt>Faces</dt><dd>{mesh.faces.toLocaleString()}</dd></div>
      <div><dt>Points</dt><dd>{mesh.points.toLocaleString()}</dd></div><div><dt>Mesh revision</dt><dd title={mesh.meshId}>{mesh.meshId.slice(0, 16)}</dd></div>
      <div><dt>Source</dt><dd>Final checked polyMesh</dd></div><div><dt>Regions</dt><dd>{mesh.regions.join(", ")}</dd></div>
      {mesh.boundsMm[0].map((value, index) => <div key={index}><dt>{"XYZ"[index]} bounds (m)</dt><dd>{(value / 1000).toFixed(4)} to {(mesh.boundsMm[1][index] / 1000).toFixed(4)}</dd></div>)}
    </dl><ul>{mesh.patches.map(patch => <li key={patch.name}>{patch.name} · {patch.faces.toLocaleString()} faces</li>)}</ul></details>}
  </section>;
}
