import type { Obstacle } from "@/lib/types";

export type FixtureKind = "SHOWER" | "BASIN" | "TOILET" | "FURNITURE";

export interface FixtureModel {
  id: string;
  kind: FixtureKind;
  name: string;
  width: number;
  depth: number;
  height: number;
}

export const FIXTURE_MODELS: FixtureModel[] = [
  { id: "shower-corner-800", kind: "SHOWER", name: "Corner enclosure 800 × 800", width: 800, depth: 800, height: 1950 },
  { id: "shower-corner-900", kind: "SHOWER", name: "Corner enclosure 900 × 900", width: 900, depth: 900, height: 2000 },
  { id: "shower-walk-in-1200", kind: "SHOWER", name: "Walk-in enclosure 1200 × 800", width: 1200, depth: 800, height: 2000 },
  { id: "basin-compact-450", kind: "BASIN", name: "Compact basin 450 × 350", width: 450, depth: 350, height: 850 },
  { id: "basin-vanity-600", kind: "BASIN", name: "Vanity basin 600 × 500", width: 600, depth: 500, height: 850 },
  { id: "basin-double-1200", kind: "BASIN", name: "Double vanity 1200 × 500", width: 1200, depth: 500, height: 850 },
  { id: "toilet-wall-hung", kind: "TOILET", name: "Wall-hung toilet 360 × 540", width: 360, depth: 540, height: 400 },
  { id: "toilet-compact", kind: "TOILET", name: "Compact toilet 365 × 600", width: 365, depth: 600, height: 780 },
  { id: "toilet-close-coupled", kind: "TOILET", name: "Close-coupled toilet 380 × 650", width: 380, depth: 650, height: 800 },
  { id: "furniture-base-cabinet-600", kind: "FURNITURE", name: "Base cabinet 600 × 450", width: 600, depth: 450, height: 850 },
  { id: "furniture-tall-storage-400", kind: "FURNITURE", name: "Tall storage unit 400 × 350", width: 400, depth: 350, height: 1800 },
  { id: "furniture-bench-800", kind: "FURNITURE", name: "Bathroom bench 800 × 350", width: 800, depth: 350, height: 450 },
];

export function fixtureKindForObstacle(obstacle: Obstacle): FixtureKind | "FIXED" {
  if (obstacle.fixture_kind) return obstacle.fixture_kind;
  const name = obstacle.name.toLowerCase();
  if (name.includes("shower") || name.includes("enclosure")) return "SHOWER";
  if (name.includes("basin") || name.includes("vanity")) return "BASIN";
  if (name.includes("toilet") || name.includes("wc")) return "TOILET";
  if (name.includes("cabinet") || name.includes("storage") || name.includes("bench") || name.includes("furniture")) return "FURNITURE";
  return "FIXED";
}

export function modelsForKind(kind: FixtureKind): FixtureModel[] {
  return FIXTURE_MODELS.filter((model) => model.kind === kind);
}

export function modelForObstacle(obstacle: Obstacle): FixtureModel | undefined {
  if (obstacle.model_id) return FIXTURE_MODELS.find((model) => model.id === obstacle.model_id);
  const kind = fixtureKindForObstacle(obstacle);
  return FIXTURE_MODELS.find((model) =>
    model.kind === kind
    && model.width === obstacle.dimensions.width.value
    && model.depth === obstacle.dimensions.depth.value
    && model.height === obstacle.dimensions.height.value,
  );
}
