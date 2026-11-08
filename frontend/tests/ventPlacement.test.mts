import test from "node:test";
import assert from "node:assert/strict";
import { realPreparation, cfdProject } from "./climoptixFixtures";
import { preparationRequestBody } from "../lib/climoptix";
import { ventSchema } from "../lib/climoptixDocument";
import { ventHostAtCoordinates, ventHostAtPoint } from "../lib/ventPlacement";
import { ventCenter } from "../lib/climoptixPreview";
import { containsPoint } from "../lib/elementPlacement";

test("vent rehosting matches checked walls, floor and ceiling in measured millimetres",()=>{
 const p=cfdProject(false), report=realPreparation(JSON.parse(preparationRequestBody(p,p.cfdScenarios![0],"a".repeat(64))));
 const vent=ventSchema.parse({id:"drag",name:"Dragged vent",role:"supply",host:{patchId:"unassigned"},widthMm:200,heightMm:200});
 for (const kind of ["wall", "floor", "ceiling"]) {
  const patches = report.patches.filter(patch => patch.hostable && patch.host && patch.kind === kind);
  const positions = [.25, .5, .75].flatMap(u => [.25, .5, .75].map(v => ({ u, v })));
  const candidate = patches.flatMap(patch => {
    const host = patch.host!;
    return positions.filter(({ u, v }) => {
      const point = { x: u * host.widthMm, y: v * host.heightMm };
      return host.polygonsMm.some(([outline, ...holes]) =>
        containsPoint(point, outline.map(([x, y]) => ({ x, y }))) &&
        !holes.some(hole => containsPoint(point, hole.map(([x, y]) => ({ x, y })))));
    }).map(({ u, v }) => ({ patch, host, u, v }));
  }).find(({ host }) => host.widthMm > 500 && host.heightMm > 500);
  assert.ok(candidate, `Expected an interior ${kind} test point`);
  const { patch, host, u, v } = candidate;
  const match = ventHostAtPoint(vent, report.patches, ventCenter(vent, host, u, v));
  assert.equal(match?.patch.id, patch.id);
  assert.ok(Math.abs(match.uv[0] - u) < .001 && Math.abs(match.uv[1] - v) < .001);
  const numeric = ventHostAtCoordinates(vent, report.patches, ventCenter(vent, host, u, v));
  assert.equal(numeric?.patchId, patch.id);
  assert.ok(Math.abs(numeric.u - u) < .001 && Math.abs(numeric.v - v) < .001);
  assert.equal(ventHostAtCoordinates(vent, [patch], ventCenter(vent, host, .001, v)), null);
 }
 assert.equal(ventHostAtPoint(vent,report.patches,[1e8,1e8,1e8]),null);
 const floor=report.patches.find(p=>p.kind==="floor"&&p.host)!;
 const point=ventCenter(vent,floor.host!,.4,.4);
 const withHole={...floor,host:{...floor.host!,polygonsMm:floor.host!.polygonsMm.map(poly=>[poly[0],[[0,0],[floor.host!.widthMm,0],[floor.host!.widthMm,floor.host!.heightMm],[0,floor.host!.heightMm]]])}};
 assert.equal(ventHostAtPoint(vent,[withHole],point),null);
});
