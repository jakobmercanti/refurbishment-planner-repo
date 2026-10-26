import { projectFloors } from "./buildingDocument";
import { assetOverrideSchema, boundarySchema, cfdScenarioSchema, type CFDScenario } from "./climoptixDocument";
import type { CFDReport } from "./climoptix";
import type { ProjectDocument } from "./projectDocument";

export interface CFDHeatingCandidate { id:string;name:string;kind:"object"|"floor";target:string;boundary?:CFDReport["patches"][number]["boundary"] }

/** Reference measured sources, never clone or move authoritative building objects. */
export function cfdHeatingCandidates(project:ProjectDocument,report:CFDReport):CFDHeatingCandidate[] {
  const rooms=new Set(report.domain.includedRoomIds),result:CFDHeatingCandidate[]=[];
  for(const floor of projectFloors(project)) {
    for(const room of floor.content.rooms.filter(room=>rooms.has(room.id)))for(const object of room.obstacles) {
      if(!object.heating_spec||object.heating_spec.category==="Boiler"||!report.objects.some(item=>item.id===object.id&&item.floorId===floor.id))continue;
      result.push({id:`object:${object.id}`,name:`${floor.name} · ${room.name} · ${object.name}`,kind:"object",target:object.id});
    }
    const heatedRooms=new Set(floor.content.heatingLayout?.ufhZones.map(zone=>zone.roomId)??[]);
    for(const patch of report.patches.filter(patch=>patch.floorId===floor.id&&patch.kind==="floor"&&rooms.has(patch.roomId)&&heatedRooms.has(patch.roomId)))
      result.push({id:`floor:${patch.id}`,name:`${floor.name} · ${floor.content.rooms.find(room=>room.id===patch.roomId)?.name??patch.roomId} · UFH floor`,kind:"floor",target:patch.id,boundary:patch.boundary});
  }
  return result;
}

/** An explicit temperature handoff; source wattage/water temperature is never guessed. */
export function applyCFDHeating(scenario:CFDScenario,candidates:CFDHeatingCandidate[],selected:Record<string,number>):CFDScenario {
  const next=structuredClone(scenario);
  for(const [id,temperatureK] of Object.entries(selected)) {
    const source=candidates.find(item=>item.id===id);
    if(!source)throw new Error("Heating source is no longer in the checked CFD domain. Refresh the import.");
    if(!Number.isFinite(temperatureK)||temperatureK<150||temperatureK>1500)throw new Error("Enter a surface temperature between 150 and 1500 K.");
    if(source.kind==="object") {
      const previous=next.assetOverrides.find(item=>item.objectId===source.target);
      const override=assetOverrideSchema.parse({...previous,objectId:source.target,mode:"solidProxy",heatW:0,temperatureK,notes:"Surface temperature explicitly imported from heating workbench source; not inferred from water temperature or rated watts."});
      next.assetOverrides=[...next.assetOverrides.filter(item=>item.objectId!==source.target),override];
      next.hiddenObjectIds=next.hiddenObjectIds?.filter(id=>id!==source.target);
    } else next.boundaries.patches[source.target]=boundarySchema.parse({...source.boundary,thermal:{type:"temperature",value:temperatureK,ambientK:scenario.physics.referenceTemperatureK},materialLabel:"UFH · explicit whole-floor surface temperature"});
  }
  if(Object.keys(selected).length) {
    next.physics={...next.physics,preset:"custom",energy:true,boussinesq:true};
    next.outputs.temperature=true;
    if(!next.postProcessing.fields.includes("T"))next.postProcessing.fields.push("T");
    next.validation=null;
  }
  return cfdScenarioSchema.parse(next);
}
