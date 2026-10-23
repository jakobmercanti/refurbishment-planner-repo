import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CatalogueAssetPreview } from "../components/CatalogueAssetPreview";
import { parseCfdMesh } from "../lib/cfd";
import { windowHelpSteps } from "../lib/windowHelp";
import type { CatalogueItem } from "../lib/types";

const data = () => ({ version: 1, units: "mm", profile: "block", label: "Solid envelope", dimensions_mm: [1000, 800, 600],
  vertices_mm: [[0,0,0],[1000,0,0],[0,800,0],[0,0,600]], triangles: [[0,2,1],[0,1,3],[0,3,2],[1,2,3]], assumptions: ["Generic geometry"] });

test("CFD transport keeps mm and rejects invalid or unbounded mesh data before rendering", () => {
  assert.deepEqual(parseCfdMesh(data()), data());
  assert.equal(parseCfdMesh({ ...data(), geometry_revision: 2 }).geometry_revision, 2);
  assert.throws(() => parseCfdMesh({ ...data(), geometry_revision: 0 }));
  for (const change of [{units:"m"},{version:2},{vertices_mm:[[NaN,0,0],...data().vertices_mm.slice(1)]},{triangles:[[0,1,99]]},
    {triangles:[[0,0,1],[0,1,2],[1,2,3],[0,2,3]]},{dimensions_mm:[0,800,600]}, {vertices_mm:[[2000,0,0],...data().vertices_mm.slice(1)]},
    {triangles:data().triangles.map(face=>[...face].reverse())}, {triangles:[...data().triangles.slice(0,3),data().triangles[0]]}])
    assert.throws(() => parseCfdMesh({...data(),...change}));
});

const item = (overrides:Partial<CatalogueItem> = {}):CatalogueItem => ({id:"test", name:"Measured table", category_id:"living-tables", category_name:"Tables",
  fixture_kind:"FURNITURE", supplier:"QA", sku:"table", width_mm:1000, depth_mm:800, height_mm:600, color_hex:"#AABBCC", description:"", is_default:true,
  subcategory:"Dining", representation_key:"furniture-table-dining", plan_shape:"RECTANGLE", images:[], supplier_editable:true, active:true,
  created_at:"2026-10-20T00:00:00Z", updated_at:"2026-10-20T00:00:00Z", cfd_proxy:{version:1,profile:"table"}, ...overrides});

test("eligible asset viewer exposes both modes and keyboard-accessible zoom/fit controls", () => {
  const html = renderToStaticMarkup(createElement(CatalogueAssetPreview,{item:item(),apiUrl:"/api"}));
  assert.match(html,/CFD shape/);assert.match(html,/Asset representation/);assert.match(html,/Preview zoom/);assert.match(html,/>Fit</);
  assert.match(html,/Measured dimensions/);assert.doesNotMatch(html,/Drag to orbit/);
  assert.match(windowHelpSteps("Catalogue entry details").map(step => step.text).join(" "), /Drag to orbit/);
});

test("doors, windows, electrical entries and legacy records cannot offer accidental furniture CFD modes", () => {
  for (const overrides of [{fixture_kind:"DOOR"},{fixture_kind:"WINDOW"},{category_id:"electric"}, {representation_key:"electrical-socket-single"}, {cfd_proxy:null}]) {
    const html = renderToStaticMarkup(createElement(CatalogueAssetPreview,{item:item(overrides as Partial<CatalogueItem>),apiUrl:"/api"}));
    assert.doesNotMatch(html,/CFD shape/);
  }
});

test("catalogue viewer help covers controls, proxy limitations and STL unit scaling", () => {
  const text=windowHelpSteps("Catalogue entry details").map(s=>s.text).join(" ");
  for (const phrase of [/zoom slider/,/CFD shape/,/millimetres/,/no unit metadata/,/cell count/,/Doors, windows, electrical/]) assert.match(text,phrase);
});
