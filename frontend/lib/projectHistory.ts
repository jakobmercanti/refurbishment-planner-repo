import type { ProjectDocument } from "./projectDocument";
import { buildingOf, projectFloors } from "./buildingDocument";
import { requiresHvacThermalExecution } from "./hvacBridge";
/** View-only changes must not bury modelling edits in the history. */
function editKey(p: ProjectDocument) {
  // Canonical level content is independent of which floor is projected into
  // legacy fields. Strip viewport state on every floor, not only the active one.
  const floors=projectFloors(p).map(f=>({
    ...f,
    content:{
      ...f.content,
      heatingLayout: f.content.heatingLayout ? { ...f.content.heatingLayout, enabled: undefined } : undefined,
      rooms:f.content.rooms.map(room=>({...room,person_mockup:room.person_mockup??null})),
      floorplan:f.content.floorplan?{
        ...f.content.floorplan,
        rooms:f.content.floorplan.rooms.map((room,index)=>({...room,sourceWallIds:undefined,colourIndex:room.colourIndex??index%6})),
        roomFinishes:f.content.floorplan.roomFinishes??{},
        viewSettings:undefined,selectedRoomId:undefined,canvasSize:undefined,
      }:null,
    },
  }));
  // Schema parsing and editor hydration can insert identical fields in a
  // different order. Compare object contents, while retaining array order.
  const hvac = p.hvac ? { ...p.hvac, activeScenarioId: undefined, bindings: Object.fromEntries(Object.entries(p.hvac.bindings).map(([id, binding]) => [id, { ...binding, editMode: undefined, scopeRooms: undefined, scopeSeed: undefined }])) } : undefined;
  const radiatorIds = new Set(projectFloors(p).flatMap(f => f.content.rooms.flatMap(r => r.obstacles.filter(o => o.heating_spec && o.heating_spec.category !== "Boiler").map(o => o.id))));
  const cases = p.cfdScenarios?.map(s => {
    const binding = p.hvac?.bindings[s.id], linked = !!binding?.operatingScenarioId;
    const thermalSource = !!binding && requiresHvacThermalExecution(p, { ...s, sharedBoundaries: undefined });
    return { ...s, validation: undefined, updatedAt: undefined, sharedBoundaries: undefined,
      assetOverrides: binding ? s.assetOverrides.filter(o => !radiatorIds.has(o.objectId)) : s.assetOverrides,
      // These fields are projections of the shared operating scenario, not
      // independent modelling edits made by background preparation.
      ...(thermalSource ? { physics: { ...s.physics, preset: undefined, energy: undefined, boussinesq: undefined, ...(linked ? { densityKgM3: undefined, heatCapacityJKgK: undefined, referenceTemperatureK: undefined, initialTemperatureK: undefined, outdoorTemperatureK: undefined } : {}) }, outputs: { ...s.outputs, temperature: undefined }, postProcessing: { ...s.postProcessing, fields: s.postProcessing.fields.filter(f => f !== "T") } } : {}),
    };
  }) ?? [];
  return JSON.stringify([floors,buildingOf(p).roof,cases,p.cfdSimulationGroups??[],hvac],(_key,value:unknown)=>
    value&&typeof value==="object"&&!Array.isArray(value)
      ?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0))
      :value);
}
export class ProjectHistory {
  past: ProjectDocument[] = []; future: ProjectDocument[] = []; private lastTime = -Infinity;
  record(before: ProjectDocument, next: ProjectDocument, force = false, now = Date.now()) {
    if (editKey(before) === editKey(next)) return;
    if (force || now - this.lastTime > 500) this.past = [...this.past.slice(-49), before];
    this.future=[];this.lastTime=now;
  }
  undo(current: ProjectDocument) { const p=this.past.at(-1);if(!p)return null;this.past=this.past.slice(0,-1);this.future=[current,...this.future].slice(0,50);this.lastTime=-Infinity;return p; }
  redo(current: ProjectDocument) { const p=this.future[0];if(!p)return null;this.future=this.future.slice(1);this.past=[...this.past.slice(-49),current];this.lastTime=-Infinity;return p; }
  clear() { this.past=[];this.future=[];this.lastTime=-Infinity; }
}
