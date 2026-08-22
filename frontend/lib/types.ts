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
  hinge_side?: "START" | "END";
  swing_angle_deg?: number;
  opens_inward?: boolean;
}

export interface Obstacle {
  id: string;
  name: string;
  center: Point2D;
  dimensions: Dimensions3D;
  base_z_mm: number;
  rotation_deg: number;
  verified: boolean;
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

export interface DemoResponse {
  room: Room;
  product: Product;
  placements: Record<Status, Placement>;
  results: Record<Status, FitResult>;
}

