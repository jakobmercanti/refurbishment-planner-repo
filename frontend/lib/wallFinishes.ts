import type { Room, RoomFinishes } from "./types";

export interface WallFinishShade {
  colour: string;
  name: string;
}

export interface WallFinishUpdate {
  roomId: string;
  finishes: RoomFinishes;
}

export type WallPaintScope = "SELECTED" | "ROOM" | "ALL";

export function roomPerimeterWallIds(room: Room): string[] {
  return room.vertices.map((_vertex, index) => `wall-${String(index + 1).padStart(3, "0")}`);
}

/**
 * Build the room-scoped finish updates for the selected wall control. A full
 * floorplan owns one finish map per room, so painting all walls must update
 * every displayed room rather than mutating only the selected room's map.
 */
export function buildWallFinishUpdates(
  rooms: Room[],
  selectedRoomId: string,
  selectedWallIds: string[],
  scope: WallPaintScope | boolean,
  shade?: WallFinishShade,
): WallFinishUpdate[] {
  // Keep accepting the previous boolean shape for saved callers while the
  // viewer exposes the clearer three-way scope selector.
  const resolvedScope: WallPaintScope = typeof scope === "boolean" ? (scope ? "ALL" : "SELECTED") : scope;
  const targets = resolvedScope === "ALL" ? rooms : rooms.filter((room) => room.id === selectedRoomId);
  return targets.map((room) => {
    const wallIds = resolvedScope === "SELECTED" ? selectedWallIds : roomPerimeterWallIds(room);
    const wallColors = { ...(room.finishes?.wall_colors ?? {}) };
    const wallColorCodes = { ...(room.finishes?.wall_color_codes ?? {}) };
    wallIds.forEach((wallId) => {
      if (shade) {
        wallColors[wallId] = shade.colour;
        wallColorCodes[wallId] = shade.name;
      } else {
        delete wallColors[wallId];
        delete wallColorCodes[wallId];
      }
    });
    return {
      roomId: room.id,
      finishes: { ...room.finishes, wall_colors: wallColors, wall_color_codes: wallColorCodes },
    };
  });
}
