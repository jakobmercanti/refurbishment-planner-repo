import type { Room, RoomFinishes } from "./types";

export type FloorTileScope = "SELECTED" | "ROOM" | "ALL";

export interface FloorFinishUpdate {
  roomId: string;
  finishes: RoomFinishes;
}

/** Build finish updates for the selected floor, current room, or all displayed rooms. */
export function buildFloorFinishUpdates(
  rooms: Room[],
  selectedRoomId: string,
  scope: FloorTileScope,
  update: (finishes: RoomFinishes, room: Room) => RoomFinishes,
): FloorFinishUpdate[] {
  const targets = scope === "ALL" ? rooms : rooms.filter((room) => room.id === selectedRoomId);
  return targets.map((room) => ({
    roomId: room.id,
    finishes: update(room.finishes ?? {}, room),
  }));
}
