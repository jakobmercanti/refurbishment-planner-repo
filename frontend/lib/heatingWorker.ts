import { autoDesignHeating, regenerateHeatingRoom } from "./heatingDesign";
import type { HeatingProject } from "./heatingDocument";
import type { Room } from "./types";
self.onmessage = (event: MessageEvent<{ rooms: Room[]; heating: HeatingProject; reference: number | null; roomId: string | null }>) => {
  try { const { rooms, heating, reference, roomId } = event.data;
    const result = roomId ? regenerateHeatingRoom(rooms.find(r => r.id === roomId)!, heating) : autoDesignHeating(rooms, heating, reference);
    self.postMessage({ result });
  } catch (e) { self.postMessage({ error: e instanceof Error ? e.message : "Heating generation failed." }); }
};
