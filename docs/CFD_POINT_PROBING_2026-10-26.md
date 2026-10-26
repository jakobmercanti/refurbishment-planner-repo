# CFD result-plane point values

## Local completion after resume

The implementation was paused safely, then resumed for final diff review and
verification-log checks. It is complete on top of local master `6ed9c7b`; the
point-probe source, tests and this record belong in the local-only commit
"Add read-only CFD plane point-value probing". No known feature blocker remains.
No remote push, deployment, worker restart or user-browser modification occurred.
Build and test commands have finished. The isolated browser harnesses closed.

Do not deploy or push remotely without new authorization. The unrelated modified
`freefloorplan3d-website` gitlink and untracked
`.codex-remote-attachments/01a0b951-9092-7d80-9c5e-e9651d872a7a/` directory are
preserved and excluded. Development next-env.d.ts imports have been restored.

Changed tracked files: frontend/app/density.css; components/CFDResultsViewer.tsx,
CFDSceneResult.tsx, ClimoptixResults.tsx, ClimoptixViewer.tsx,
ClimoptixWorkspace.tsx; tests/browser/cfdFollowup.browser.mts.
New files: components/CFDPointProbeControls.tsx, lib/cfdPointProbe.ts,
tests/cfdPointProbe.test.mts, tests/browser/cfdPointProbe.browser.mts, and this doc.
All frontend paths above are relative to frontend/.

The follow-up test change waits for the initial validation stamp to be saved
before taking its baseline. Its full scenario/geometry equality checks remain;
the observed failure was validation null becoming the already-checked stamp,
not a point-probe or view-property input mutation.

## Implementation

Local implementation on top of `6ed9c7b`. No remote push, deployment, worker
restart or native/cloud solver job. Source geometry and simulation settings
are unchanged by this display-only feature.

## Use

- Load a result plane in Results. Press **V**, or choose **Probe selected plane
  (V)**, to open its independent inspector in point-probe mode. The inspector
  and verified building-plane display also have **Probe point value (V)** buttons.
- Choose the active plane/layer and displayed field/component, then click a
  point. One selectable text readout shows its value, XYZ and sampling method.
- Clicking another point replaces that readout. A blank pick removes the old
  value and explains that there is no point on the active plane. Camera drags
  do not count as picks. **Esc** exits probing without closing the result window;
  V or the toggle button also exits. Typing V in an input does not activate it.
- Field/component, slice position, layer visibility or file changes invalidate
  the old reading, including replacement files with the same filename. Pending
  slice updates disable picking until the displayed data is ready. A normal
  inspector reopen does not resurrect an acknowledged probe request.

## Value semantics

Point-data scalars are linearly interpolated from the containing surface
triangle. Vectors are interpolated component-by-component, then the displayed
component or magnitude is evaluated. Cell-centred data reports the stored
original cell value, not an invented smooth interpolation. This is numerical
result-data sampling, not colour lookup or a nearest-vertex estimate.

Surface polygons and triangle strips retain source cell IDs. Concave polygon
triangulation excludes their empty areas. VTI grid planes sample the actual
displayed slice arrays. Probing is bounded to 500,000 surface triangles; geometry
without a selected field, hidden/fully transparent layers and volume isosurfaces
do not offer plane point values.

Verified native results use U in m/s, p in kinematic m²/s² (not Pa) and coordinates
displayed in millimetres. External-file values/coordinates keep explicit
unverified file-unit labels. Geometry-only inputs never fabricate a value.

The building overlay loads a file once and derives field colouring and sampling
from the same validated arrays. Changing its field does not reread the file or
create a stale-pick race. New overlay files clear previous field readiness.
No readings are persisted as monitoring probes, telemetry or solver acceptance.

## Sources and verification

- lib/cfdPointProbe.ts: topology, ray intersection, interpolation and bounded picks.
- components/CFDPointProbeControls.tsx: shared mode, scoped shortcuts and single readout.
- CFDResultsViewer/ClimoptixResults: inspector and Results-tab actions/shortcut.
- CFDSceneResult/ClimoptixViewer/ClimoptixWorkspace: verified building-plane picking.
- app/density.css: consistent controls, readout and focus/crosshair presentation.

Four focused numerical tests passed. Full frontend unit and persistence suites:
631 + 19 passed. Production build, TypeScript and lint/source usage passed;
453 modules, no orphaned modules. Backend/worker source was not changed.

Browser tests use the real production renderers and actual pointer/keyboard
events: scalar/vector/cell values, multiple picks, misses, drag suppression,
V/Escape, typing, direct Results actions, high-DPI/mobile layout, moved VTI planes,
replacement files and native main-view pressure/velocity/coordinate consistency.
The full result/window/interaction regression sweep passed **30/30** in
`cfd-point-probe-final.tap`. After the final mobile-only overflow adjustment,
all three probe cases passed again in `cfd-point-probe-final-focused.tap`, including
the actual scrollable CSS overflow and reachable download action. The complete
30-case command preceded that last mobile-only adjustment; do not conflate them.

The build, lint/source-usage and TypeScript logs contain their final passing runs.
Screenshots for desktop inspector, main building and high-DPI phone were visually
inspected. Earlier failed runs were investigated: corrected test locators and
coordinate parsing; a real immediate-field-switch race was fixed by loading the
building file once and switching fields synchronously. No failures were waived.

Logs use `.local-logs/cfd-point-probe-*`. Screenshots under
`.local-logs/cfd-results-qa/`: point-probe-inspector.png,
point-probe-building.png and point-probe-mobile.png. Independent browser profiles
block external requests; the user's browser and saved projects are not modified.
