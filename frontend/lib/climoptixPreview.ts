/** Presentation helpers only. No fit, connectivity or CFD decisions use them. */
import type { CFDHost, CFDReport, Vec3 } from "./climoptix";
import type { CFDScenario, CFDVent } from "./climoptixDocument";
import {
  refinementLevel,
  refinementColour,
  refinementCell,
} from "./climoptixWorkflow";

/** Reserved for selection, never a refinement-level or vent-role colour. */
export const CFD_SELECTION_COLOUR = "#ff7900";

/** Propose a host-plane UV position, keeping the rectangular footprint in its
 * frame. This is UI snapping only: authoritative preparation still checks the
 * real polygon, holes, obstructions, clearances and neighbouring vents. */
export function snapVentUV(vent: CFDVent, host: CFDHost, u: number, v: number): [number, number] | null {
  const angle = vent.rotationDeg * Math.PI / 180;
  const halfU = vent.shape === "circle" ? vent.diameterMm / 2 :
    (Math.abs(Math.cos(angle)) * vent.widthMm + Math.abs(Math.sin(angle)) * vent.heightMm) / 2;
  const halfV = vent.shape === "circle" ? vent.diameterMm / 2 :
    (Math.abs(Math.sin(angle)) * vent.widthMm + Math.abs(Math.cos(angle)) * vent.heightMm) / 2;
  const marginU = (halfU + vent.edgeClearanceMm) / host.widthMm;
  const marginV = (halfV + vent.edgeClearanceMm) / host.heightMm;
  if (marginU > .5 || marginV > .5 || !Number.isFinite(u + v)) return null;
  return [Math.max(marginU, Math.min(1 - marginU, u)), Math.max(marginV, Math.min(1 - marginV, v))];
}

export const previewScene = (p: Vec3): Vec3 => [
  p[0] * 0.001,
  p[2] * 0.001,
  -p[1] * 0.001,
];

export function ventCenter(
  vent: CFDVent,
  host: CFDHost,
  u = vent.host.u,
  v = vent.host.v,
): Vec3 {
  return host.originMm.map(
    (x, i) =>
      x + host.uAxis[i] * u * host.widthMm + host.vAxis[i] * v * host.heightMm,
  ) as Vec3;
}

export function ventFootprint(
  vent: CFDVent,
  host: CFDHost,
  u = vent.host.u,
  v = vent.host.v,
): Vec3[] {
  const points =
    vent.shape === "circle"
      ? Array.from({ length: 64 }, (_, i) => [
          (Math.cos((i * Math.PI) / 32) * vent.diameterMm) / 2,
          (Math.sin((i * Math.PI) / 32) * vent.diameterMm) / 2,
        ])
      : [
          [-vent.widthMm / 2, -vent.heightMm / 2],
          [vent.widthMm / 2, -vent.heightMm / 2],
          [vent.widthMm / 2, vent.heightMm / 2],
          [-vent.widthMm / 2, vent.heightMm / 2],
        ];
  const angle = (vent.rotationDeg * Math.PI) / 180,
    center = ventCenter(vent, host, u, v);
  return points.map(
    ([x, y]) =>
      center.map(
        (c, i) =>
          c +
          host.uAxis[i] * (x * Math.cos(angle) - y * Math.sin(angle)) +
          host.vAxis[i] * (x * Math.sin(angle) + y * Math.cos(angle)),
      ) as Vec3,
  );
}

/** Same prescribed yaw/pitch convention as the provider, not a solved velocity. */
export function ventDirection(vent: CFDVent, host: CFDHost): Vec3 {
  const yaw = (vent.yawDeg * Math.PI) / 180,
    pitch = (vent.pitchDeg * Math.PI) / 180,
    sign = vent.role === "supply" ? -1 : 1;
  return host.normal.map(
    (n, i) =>
      sign * n * Math.cos(yaw) * Math.cos(pitch) +
      host.uAxis[i] * Math.sin(yaw) * Math.cos(pitch) +
      host.vAxis[i] * Math.sin(pitch),
  ) as Vec3;
}

/** Group once per report, not one full triangle scan per displayed patch. */
export function patchPositions(
  report: CFDReport | null,
): Map<string, number[]> {
  const result = new Map<string, number[]>();
  report?.surface.triangles.forEach((triangle, i) => {
    const id = report.surface.trianglePatches[i],
      positions = result.get(id) ?? [];
    triangle.forEach((vertex) =>
      positions.push(...previewScene(report.surface.verticesMm[vertex])),
    );
    result.set(id, positions);
  });
  return result;
}

export interface RefinementPreview {
  id: string;
  name: string;
  shape: "box" | "sphere" | "object";
  centerMm: Vec3;
  sizeMm: Vec3;
  cellMm: number;
  level: number;
  colour: string;
}
export function refinementPreviews(
  scenario: CFDScenario,
  report: CFDReport | null,
): RefinementPreview[] {
  return scenario.mesh.refinements.flatMap((region) => {
    const level = refinementLevel(scenario.mesh.baseCellMm, region);
    const preview = {
      ...region,
      level,
      colour: refinementColour(level),
      cellMm: refinementCell(scenario.mesh.baseCellMm, region),
    };
    if (region.shape !== "object") return [preview];
    const object = report?.objects.find(
      (o) =>
        o.id === region.objectId &&
        o.mode === "solidProxy" &&
        o.verticesMm.length,
    );
    if (!object) return [];
    const low = [0, 1, 2].map((i) =>
        Math.min(...object.verticesMm.map((v) => v[i])),
      ),
      high = [0, 1, 2].map((i) =>
        Math.max(...object.verticesMm.map((v) => v[i])),
      );
    return [
      {
        ...preview,
        centerMm: low.map((v, i) => (v + high[i]) / 2) as Vec3,
        sizeMm: low.map((v, i) => high[i] - v) as Vec3,
      },
    ];
  });
}
