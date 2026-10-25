import { z } from "zod";
import {
  preparationInput,
  preparationRequestBody,
  type Vec3,
} from "./climoptix";
import { newCFDScenario } from "./climoptixDocument";
import type { ProjectDocument } from "./projectDocument";

const vec = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);
const index = z.number().int().nonnegative();
const sceneSchema = z.object({
  kind: z.literal("ClimoptixBuildingView"),
  units: z.literal("mm"),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  rooms: z.array(z.object({ id: z.string(), floorId: z.string() })).max(200),
  airVolumes: z.array(z.array(z.string()).min(1)).max(200),
  patches: z
    .array(
      z.object({
        id: z.string(),
        kind: z.string(),
        roomId: z.string(),
        floorId: z.string(),
        sourceId: z.string(),
      }),
    )
    .max(6000),
  verticesMm: z.array(vec).max(100000),
  triangles: z.array(z.tuple([index, index, index])).max(100000),
  trianglePatches: z.array(z.string()).max(100000),
});
export type CFDScene = z.infer<typeof sceneSchema>;
export type CFDViewPatch = CFDScene["patches"][number];

/** Exclude study intent, camera, and thermal edits from read-only scene requests. */
export function sceneInput(project: ProjectDocument): string {
  const input = JSON.parse(
    preparationInput(project, newCFDScenario(project.projectId)),
  );
  delete input.scenario;
  return JSON.stringify(input);
}

export function parseScene(raw: unknown): CFDScene {
  const scene = sceneSchema.parse(raw);
  const rooms = new Set(scene.rooms.map((r) => r.id));
  const patches = new Set(scene.patches.map((p) => p.id));
  const volumes = scene.airVolumes.flat();
  if (
    rooms.size !== scene.rooms.length ||
    patches.size !== scene.patches.length ||
    new Set(volumes).size !== volumes.length ||
    volumes.length !== rooms.size ||
    volumes.some((id) => !rooms.has(id)) ||
    scene.patches.some((p) => !rooms.has(p.roomId)) ||
    scene.triangles.length !== scene.trianglePatches.length ||
    scene.triangles.some((t) => t.some((i) => i >= scene.verticesMm.length)) ||
    scene.trianglePatches.some((id) => !patches.has(id))
  )
    throw new Error(
      "The building viewer received inconsistent geometry. Refresh to retry.",
    );
  return scene;
}

export async function requestScene(
  apiUrl: string,
  project: ProjectDocument,
  signal: AbortSignal,
): Promise<CFDScene> {
  const source = JSON.parse(
    preparationRequestBody(
      project,
      newCFDScenario(project.projectId),
      "0".repeat(64),
    ),
  ).project;
  const response = await fetch(`${apiUrl}/climoptix/geometry`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({ project: source }),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(
      typeof detail?.detail === "string"
        ? detail.detail
        : "The building geometry service is unavailable. Your project is unchanged.",
    );
  }
  return parseScene(await response.json());
}

/** Scene units are introduced only at the rendering boundary. */
export function scenePositions(scene: CFDScene): Map<string, number[]> {
  const result = new Map<string, number[]>();
  scene.triangles.forEach((triangle, i) => {
    const id = scene.trianglePatches[i];
    const values = result.get(id) ?? [];
    triangle.forEach((index) => {
      const [x, y, z] = scene.verticesMm[index] as Vec3;
      values.push(x / 1000, z / 1000, -y / 1000);
    });
    result.set(id, values);
  });
  return result;
}
