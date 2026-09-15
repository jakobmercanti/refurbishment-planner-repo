export type ToolbarId =
  | "floorplan-build"
  | "floorplan-coordinates"
  | "floorplan-openings"
  | "floorplan-view"
  | "viewer-analysis"
  | "viewer-layout-analysis"
  | "viewer-person"
  | "viewer-view";

export interface ToolbarDefinition {
  id: ToolbarId;
  name: string;
}

export type ToolbarVisibility = Record<ToolbarId, boolean>;

export const FLOORPLAN_TOOLBARS: ToolbarDefinition[] = [
  { id: "floorplan-build", name: "Build floorplan" },
  { id: "floorplan-coordinates", name: "Coordinates" },
  { id: "floorplan-openings", name: "Add elements" },
  { id: "floorplan-view", name: "View properties" },
];

export const VIEWER_TOOLBARS: ToolbarDefinition[] = [
  { id: "viewer-analysis", name: "Add elements" },
  { id: "viewer-layout-analysis", name: "Layout analysis" },
  { id: "viewer-person", name: "Human mock-up" },
  { id: "viewer-view", name: "View properties" },
];

export const DEFAULT_TOOLBAR_VISIBILITY = Object.fromEntries(
  [...FLOORPLAN_TOOLBARS, ...VIEWER_TOOLBARS].map((toolbar) => [toolbar.id, toolbar.id !== "viewer-person" && toolbar.id !== "floorplan-coordinates"]),
) as ToolbarVisibility;

export const DEFAULT_TOOLBAR_AVAILABILITY = Object.fromEntries(
  [...FLOORPLAN_TOOLBARS, ...VIEWER_TOOLBARS].map((toolbar) => [toolbar.id, true]),
) as ToolbarVisibility;
