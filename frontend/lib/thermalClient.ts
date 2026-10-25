import { z } from "zod";
import type { ProjectDocument } from "./projectDocument";
import type { CFDScenario } from "./climoptixDocument";
import { preparationRequestBody } from "./climoptix";
import {
  thermalLocationSchema,
  thermalPackageSchema,
  type ThermalPackage,
} from "./thermalDocument";

async function checked<T>(
  response: Response,
  schema: z.ZodType<T>,
  invalidMessage: string,
): Promise<T> {
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      data &&
      typeof data === "object" &&
      "detail" in data &&
      typeof data.detail === "string"
        ? data.detail
        : "Thermal service unavailable. Your settings remain saved; no CFD was run.",
    );
  const result = schema.safeParse(data);
  if (!result.success) throw new Error(invalidMessage);
  return result.data;
}
export async function requestThermal(
  apiUrl: string,
  project: ProjectDocument,
  scenario: CFDScenario,
  revision: string,
  calculate: boolean,
  signal?: AbortSignal,
): Promise<ThermalPackage> {
  const response = await fetch(
    `${apiUrl}/climoptix/${calculate ? "thermal-preview" : "thermal-envelope"}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: preparationRequestBody(project, scenario, revision),
      signal,
    },
  );
  const data = await checked(
    response,
    thermalPackageSchema,
    "The thermal service returned an incomplete or incompatible response. Refresh the envelope or check the service version. Your settings are unchanged.",
  );
  if (
    data.projectId !== project.projectId ||
    data.domainId !== scenario.id ||
    data.sourceRevision !== revision
  )
    throw new Error(
      "The thermal response belongs to another study or source revision. Refresh the envelope.",
    );
  return data;
}
const epwSchema = z.object({
  location: thermalLocationSchema,
  source: z.string().max(2000),
  rejectedRows: z.number().int().min(0),
  timeConvention: z.string().max(2000),
  records: z
    .array(
      z.object({
        index: z.number().int().min(0),
        localDateTime: z.string().min(1).max(40),
        temperatureC: z.number().finite().min(-100).max(200),
        relativeHumidity: z.number().finite().min(0).max(1),
        windMS: z.number().finite().min(0).max(150),
        ghiWm2: z.number().finite().min(0).max(2000),
        dniWm2: z.number().finite().min(0).max(2000),
        dhiWm2: z.number().finite().min(0).max(2000),
      }),
    )
    .min(1)
    .max(8784),
});
export type EPWData = z.infer<typeof epwSchema>;
export async function importEPW(
  apiUrl: string,
  file: File,
  signal?: AbortSignal,
): Promise<EPWData> {
  if (file.size > 4 * 1024 * 1024)
    throw new Error("Choose an EPW file smaller than 4 MB.");
  const response = await fetch(`${apiUrl}/climoptix/thermal-epw`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: file.name.slice(0, 120),
      text: await file.text(),
    }),
    signal,
  });
  return checked(
    response,
    epwSchema,
    "The weather service returned invalid EPW data. No weather was imported. Try again or check the service version.",
  );
}
