import staircaseModels from "./staircaseModels.json";

export interface StaircaseModel {
  family: string; name: string; glass: boolean;
  width: number; depth: number; height: number; open: boolean; column: boolean;
  steps: { points: number[][]; top: number }[];
  rails: { a: number[]; b: number[]; post: boolean; guard_a: number; guard_b: number }[];
}
export const STAIRCASE_MODELS: Record<string, StaircaseModel> = staircaseModels;
export const STAIRCASE_KEYS = Object.keys(STAIRCASE_MODELS);
export const WINDOW_FAMILY_KEYS = ["window-bay", "window-bow", "window-sash", "window-casement"];

/** Plan vertices, shared with window meshes; depth is the full projection envelope. */
export function windowPlanVertices(key: string, width: number, depth: number): [number, number][] {
  if (key === "window-bay") return [[-width / 2, depth / 2], [-width * .30, -depth * .42], [width * .30, -depth * .42], [width / 2, depth / 2]];
  if (key === "window-bow") return Array.from({ length: 6 }, (_, i) => {
    const angle = Math.PI * i / 5;
    return [-width / 2 * Math.cos(angle), depth / 2 - Math.sin(angle) * depth * .92] as [number, number];
  });
  return [[-width / 2, 0], [width / 2, 0]];
}
