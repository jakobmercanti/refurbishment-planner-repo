export type Status = "FIT" | "VERIFY" | "FAIL";
export type CheckStatus = "PASS" | "VERIFY" | "FAIL" | "NOT_APPLICABLE";

export interface Point2D {
  x: number;
  y: number;
}

export interface Measurement {
  value: number;
  uncertainty_mm: number;
  verified: boolean;
  source_type: string;
}

export interface Dimensions3D {
  width: Measurement;
  depth: Measurement;
  height: Measurement;
}

export interface Opening {
  id: string;
  kind: "DOOR" | "WINDOW" | "GENERIC";
  parent_wall_id: string;
  offset_mm: number;
  width: Measurement;
  height: Measurement;
  sill_height_mm: number;
  reveal_depth_mm?: number;
  hinge_side?: "START" | "END";
  door_type?: "SINGLE" | "DOUBLE";
  swing_angle_deg?: number;
  opens_inward?: boolean;
  metadata?: Record<string, unknown>;
}

export interface Obstacle {
  id: string;
  name: string;
  kind?: "BOX" | "CYLINDER";
  center: Point2D;
  dimensions: Dimensions3D;
  base_z_mm: number;
  rotation_deg: number;
  source_type?: string;
  verified: boolean;
  fixture_kind?: "SHOWER" | "BASIN" | "TOILET" | "FURNITURE";
  model_id?: string;
  wall_lock?: boolean;
}

export type TilePattern = "NONE" | "SQUARE_300" | "SQUARE_600" | "HERRINGBONE" | "CHECKERBOARD" | "DIAMOND" | "KITKAT" | "TERRAZZO" | "HEXAGON" | "MARBLE";

export interface RoomFinishes {
  wall_colors?: Record<string, string>;
  floor_color?: string;
  floor_pattern?: TilePattern;
  floor_tile_id?: string;
}

export interface Room {
  id: string;
  name: string;
  version: number;
  vertices: Point2D[];
  wall_height: Measurement;
  wall_thickness: Measurement;
  openings: Opening[];
  obstacles: Obstacle[];
  finishes?: RoomFinishes;
}

export interface Product {
  id: string;
  manufacturer: string;
  sku: string;
  name: string;
  version: number;
  nominal_dimensions: Dimensions3D;
  installation_clearance_mm: number;
}

export interface Placement {
  id: string;
  center: Point2D;
  base_z_mm: number;
  rotation_deg: number;
  available_installation_width?: Measurement;
}

export interface FitCheck {
  check_id: string;
  status: CheckStatus;
  explanation: string;
  margin_mm?: number;
  uncertainty_mm: number;
}

export interface FitResult {
  status: Status;
  summary: string;
  checks: FitCheck[];
  minimum_clearance_mm?: number;
  collisions: Array<{ object_id: string; collision_type: string }>;
  manual_measurements_required: string[];
  engine_version: string;
}

export interface LayoutResult {
  status: Status;
  summary: string;
  checks: FitCheck[];
  collision_ids: string[];
  engine_version: string;
  room_id: string;
  room_version: number;
}

export interface DemoResponse {
  room: Room;
  product: Product;
  placements: Record<Status, Placement>;
  results: Record<Status, FitResult>;
}

export interface WallSummary {
  id: string;
  start: Point2D;
  end: Point2D;
  length_mm: number;
}

export interface GeometryInvalidation {
  entity_id: string;
  entity_type: string;
  reason: string;
}

export interface RoomValidationResponse {
  valid: boolean;
  area_mm2: number;
  perimeter_mm: number;
  orientation: "CCW";
  walls: WallSummary[];
  invalidations: GeometryInvalidation[];
  warnings: string[];
}
