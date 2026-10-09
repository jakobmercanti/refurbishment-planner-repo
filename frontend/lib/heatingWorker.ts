import { autoDesignHeating, regenerateHeatingRoom } from "./heatingDesign";
import type { HeatingProject } from "./heatingDocument";
import type { Room } from "./types";
import type { ReferenceRadiator } from "./heatingCatalogue";
self.onmessage = (event: MessageEvent<{ rooms: Room[]; heating: HeatingProject; reference: number | null; roomId: string | null; catalogueRadiators?: ReferenceRadiator[] }>) => {
  try { const { rooms, heating, reference, roomId, catalogueRadiators } = event.data;
    const result = roomId ? regenerateHeatingRoom(rooms.find(r => r.id === roomId)!, heating) : autoDesignHeating(rooms, heating, reference, undefined, catalogueRadiators);
    self.postMessage({ result });
  } catch (e) { self.postMessage({ error: e instanceof Error ? e.message : "Heating generation failed." }); }
};
