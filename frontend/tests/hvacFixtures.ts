import { cfdProject } from "./climoptixFixtures";
import { newHvacProject, hvacConditionsSchema } from "../lib/hvacDocument";
import { newHeatingProject } from "../lib/heatingDocument";
import { newHeatingRadiator } from "../lib/heatingDesign";
import { elementFromRadiator } from "../lib/heatingElements";
import { projectFloors } from "../lib/buildingDocument";

export function hvacProject() {
  const p = cfdProject(false), floor = projectFloors(p)[0], room = p.rooms[0];
  p.heatingLayout = newHeatingProject();
  const radiator = newHeatingRadiator(room);
  radiator.emitterTechnology = "Electric";
  radiator.ratedOutputW = 1000;
  room.obstacles = [elementFromRadiator(radiator)];
  p.hvac = newHvacProject();
  p.hvac.scenarios = [{ id: "operation-1", name: "Nominal operation", roomId: room.id, floorId: floor.id, conditions: hvacConditionsSchema.parse({ roomC: 25, outdoorC: 5, supplyC: 20 }), ventOverrides: {}, heaterOverrides: {} }];
  p.hvac.activeScenarioId = "operation-1";
  return p;
}
