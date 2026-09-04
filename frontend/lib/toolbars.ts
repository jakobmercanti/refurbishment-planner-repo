export type ToolbarId =
  | "floorplan-build"
  | "floorplan-properties"
  | "floorplan-import"
  | "floorplan-coordinates"
  | "floorplan-rooms"
  | "floorplan-openings"
  | "floorplan-view"
  | "viewer-room"
  | "viewer-analysis"
  | "viewer-person"
  | "viewer-view";

export interface ToolbarDefinition {
  id: ToolbarId;
  name: string;
}

export type ToolbarVisibility = Record<ToolbarId, boolean>;

export const FLOORPLAN_TOOLBARS: ToolbarDefinition[] = [
  { id: "floorplan-build", name: "Build floorplan" },
  { id: "floorplan-properties", name: "Overall properties" },
  { id: "floorplan-import", name: "Import drawing" },
  { id: "floorplan-coordinates", name: "Coordinates" },
  { id: "floorplan-rooms", name: "Rooms & 3D viewer" },
  { id: "floorplan-openings", name: "Doors & windows" },
  { id: "floorplan-view", name: "View properties" },
];

export const VIEWER_TOOLBARS: ToolbarDefinition[] = [
  { id: "viewer-room", name: "Room selector" },
  { id: "viewer-analysis", name: "Layout & fit analysis" },
  { id: "viewer-person", name: "Human mock-up" },
  { id: "viewer-view", name: "View properties" },
];

export const DEFAULT_TOOLBAR_VISIBILITY = Object.fromEntries(
  [...FLOORPLAN_TOOLBARS, ...VIEWER_TOOLBARS].map((toolbar) => [toolbar.id, toolbar.id !== "viewer-person"]),
) as ToolbarVisibility;
