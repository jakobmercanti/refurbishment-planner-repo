/** Shared UI presentation and bounded imported-log parsing; no synthetic results. */
import type { CFDScenario } from "./climoptixDocument";
import type { Vec3 } from "./climoptix";

export const LEVEL_COLOURS = [
  "#64748b",
  "#2675bd",
  "#009c9a",
  "#34a853",
  "#c69a00",
  "#436b85",
  "#d34c65",
  "#aa59c6",
  "#7754d1",
  "#b23d91",
  "#6260c6",
] as const;
export type Refinement = CFDScenario["mesh"]["refinements"][number];
export function refinementLevel(
  base: number,
  region: Pick<Refinement, "level" | "cellMm">,
): number {
  return (
    region.level ??
    Math.max(0, Math.ceil(Math.log2(base) - Math.log2(region.cellMm) - 1e-12))
  );
}
export const refinementColour = (level: number) =>
  LEVEL_COLOURS[Math.min(10, Math.max(0, level))];
export const refinementCell = (
  base: number,
  region: Pick<Refinement, "level" | "cellMm">,
) => {
  const level = refinementLevel(base, region);
  // Split exponent scaling to avoid overflowing 2^level for invalid tiny input.
  return (base / 2 ** Math.min(level, 1023)) * 2 ** -Math.max(level - 1023, 0);
};

export interface SamplingPlane {
  id: string;
  axis: "X" | "Y" | "Z";
  pointMm: Vec3;
  normal: Vec3;
}
export function samplingPlanes(
  bounds: [Vec3, Vec3] | null,
  post: CFDScenario["postProcessing"],
): SamplingPlane[] {
  if (!bounds) return [];
  return (["x", "y", "z"] as const).flatMap((axis, i) => {
    const stack = post[axis];
    if (!stack.enabled) return [];
    return Array.from({ length: stack.count }, (_, n) => {
      const point = bounds[0].map((v, j) => (v + bounds[1][j]) / 2) as Vec3;
      point[i] =
        bounds[0][i] +
        ((bounds[1][i] - bounds[0][i]) * (n + 1)) / (stack.count + 1);
      return {
        id: `slice_${axis}_${String(n + 1).padStart(3, "0")}`,
        axis: axis.toUpperCase() as SamplingPlane["axis"],
        pointMm: point,
        normal: [0, 1, 2].map((j) => Number(i === j)) as Vec3,
      };
    });
  });
}

export interface ResidualSample {
  field: string;
  time: number;
  initial: number;
  final: number;
  iteration: number;
}
export function parseResidualLog(text: string): {
  samples: ResidualSample[];
  truncated: boolean;
} {
  if (text.length > 8 * 1024 * 1024)
    throw new Error("Solver logs must be at most 8 MB.");
  const samples: ResidualSample[] = [];
  const fields = new Set<string>();
  const lastByField = new Map<string, number>();
  let time = 0,
    iteration = 0,
    truncated = false;
  let pendingTime = false, sampledTime: number | null = null;
  const number = "([+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?)";
  const residual = new RegExp(
    `Solving for ([A-Za-z][A-Za-z0-9_]{0,63}),\\s*Initial residual = ${number},\\s*Final residual = ${number}`,
  );
  const timePattern = new RegExp(`^Time\\s*=\\s*${number}\\s*$`);
  for (const line of text.split(/\r?\n/)) {
    const tick = line.match(timePattern);
    if (tick) {
      time = Number(tick[1]);
      pendingTime = true;
    }
    const hit = line.match(residual);
    if (!hit) continue;
    const initial = Number(hit[2]),
      final = Number(hit[3]);
    if (
      ![time, initial, final].every(Number.isFinite) ||
      initial < 0 ||
      final < 0
    )
      continue;
    if (!fields.has(hit[1]) && fields.size >= 32) {
      truncated = true;
      continue;
    }
    // Mesh utilities also print Time. Count only time steps that actually
    // contain solver residuals, not preliminary mesh/metadata headings.
    if (pendingTime && sampledTime !== time) { iteration++; sampledTime = time; }
    pendingTime = false;
    // Keep one first-initial/last-final measurement per field and outer step.
    // Pressure correctors must not consume the history budget before later steps.
    const previousIndex = lastByField.get(hit[1]);
    if (iteration > 0 && previousIndex !== undefined && samples[previousIndex].iteration === iteration) {
      samples[previousIndex].final = final;
      continue;
    }
    if (samples.length === 20000) {
      truncated = true;
      break;
    }
    fields.add(hit[1]);
    lastByField.set(hit[1],samples.length);
    samples.push({ field: hit[1], time, initial, final, iteration });
  }
  return { samples, truncated };
}
