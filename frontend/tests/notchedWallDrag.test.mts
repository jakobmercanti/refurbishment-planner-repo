import assert from "node:assert/strict";
import test from "node:test";
import { closedRooms } from "../lib/roomDetection.ts";
import {
  appendWallRunPreservingExistingWalls, materializeWallJunctionsForSelection,
  separateParallelSegmentStartForDrag, separateParallelSegmentEndForDrag,
  preserveUnrelatedParallelWallSegments, followTerminatingEndpointsOnTranslatedSegments,
  reanchorAttachedWallEndpoints, retainDraggedWallConnections, reanchorAutoWallBridges,
  preserveUnrelatedWallGeometry, materializeWallIntersections,
  ensureVisibleBridgeCorners, ensureVisibleJunctionCorners,
} from "../lib/wallDragGeometry.ts";

test("notched rectangle: add wall 7-4 then drag down retains the corner between 8 and 11", () => {
  // Step 1: draw the rectangle with a top notch, numbered as in the report.
  const outline = { id: "outline", points: [
    {x:0,y:0}, {x:6000,y:0}, {x:6000,y:4500}, {x:4200,y:4500},
    {x:4200,y:2500}, {x:1800,y:2500}, {x:1800,y:4500}, {x:0,y:4500}, {x:0,y:0},
  ] };
  const initial = appendWallRunPreservingExistingWalls([], outline);
  assert.equal(closedRooms(initial).length, 1);
  // Step 2: click corner 7, then corner 4 (outgoing host segments 6 and 3).
  const joined = appendWallRunPreservingExistingWalls(initial, {
    id: "wall-7-4", points: [{x:1800,y:4500}, {x:4200,y:4500}],
    attachments: {
      0: {wallId:"outline",segmentIndex:6,along:0,hideCorner:true},
      1: {wallId:"outline",segmentIndex:3,along:0,hideCorner:true},
    },
  });
  assert.equal(closedRooms(joined).length, 2);
  // Step 3: select the new wall and translate it 600 mm down.
  const selected = materializeWallJunctionsForSelection(joined, "wall-7-4", 0, {x:3000,y:4500});
  const start = separateParallelSegmentStartForDrag(selected.walls, "wall-7-4", selected.segmentIndex);
  const end = separateParallelSegmentEndForDrag(start.walls, "wall-7-4", start.segmentIndex);
  const before = end.walls;
  const detached = [start.detachedPointIndex, end.detachedEndPointIndex].filter(index => index !== undefined);
  const keepHidden = [start.keepDetachedPointHidden ? start.detachedPointIndex : undefined, end.keepDetachedEndPointHidden ? end.detachedEndPointIndex : undefined];
  const moved = before.map(wall => ({...wall, points: wall.points.map((point,index) =>
    wall.id === "wall-7-4" && (index === end.segmentIndex || index === end.segmentIndex + 1)
      ? {...point,y:point.y-600} : {...point})}));
  for (const wall of moved) {
    if (wall.id === "wall-7-4" && wall.attachments) {
      wall.attachments = {...wall.attachments};
      for (const index of detached) if (!keepHidden.includes(index)) delete wall.attachments[index];
    }
  }
  const fixed = preserveUnrelatedParallelWallSegments(before, reanchorAutoWallBridges(moved, "wall-7-4"), "wall-7-4", end.segmentIndex);
  const followed = reanchorAttachedWallEndpoints(followTerminatingEndpointsOnTranslatedSegments(before, fixed, "wall-7-4"), "wall-7-4");
  const connected = reanchorAutoWallBridges(retainDraggedWallConnections(before, followed, "wall-7-4", end.segmentIndex), "wall-7-4");
  const parallel = reanchorAutoWallBridges(preserveUnrelatedParallelWallSegments(before, connected, "wall-7-4", end.segmentIndex), "wall-7-4");
  const isolated = preserveUnrelatedWallGeometry(before, parallel, "wall-7-4", end.segmentIndex);
  let result = ensureVisibleJunctionCorners(ensureVisibleBridgeCorners(materializeWallIntersections(reanchorAutoWallBridges(isolated, "wall-7-4", false))));
  if (!result.every(wall => wall.points.slice(0,-1).every((point,index) => point.x === wall.points[index+1].x || point.y === wall.points[index+1].y))) {
    result = ensureVisibleJunctionCorners(ensureVisibleBridgeCorners(materializeWallIntersections(reanchorAutoWallBridges(
      retainDraggedWallConnections(before, moved, "wall-7-4", end.segmentIndex), "wall-7-4",
    ))));
  }
  assert.equal(closedRooms(result).length, 2, "both rooms remain closed");
  const visibleAt = (x:number,y:number) => result.flatMap(wall => wall.points.slice(0,
    wall.points.length > 2 && wall.points[0].x === wall.points.at(-1)!.x && wall.points[0].y === wall.points.at(-1)!.y ? -1 : undefined)
    .flatMap((point,index) => point.x === x && point.y === y && !wall.attachments?.[index]?.hideCorner ? [point] : []));
  for (const [x,y] of [[1800,4500],[4200,4500],[1800,3900],[4200,3900]]) {
    assert.equal(visibleAt(x,y).length, 1, `exactly one editable corner at ${x},${y}`);
  }
});
