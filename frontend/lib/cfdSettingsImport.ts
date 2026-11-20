import { z } from "zod";
import { archiveEntries, archiveFile } from "./cfdArchive";
import { cfdScenarioSchema, type CFDScenario } from "./climoptixDocument";

/** Import typed settings, never execute dictionaries, includes or Allrun scripts. */
export async function readOpenFOAMSettings(file: File, current: CFDScenario): Promise<CFDScenario> {
  if (file.size > 8 * 1024**2) throw new Error("Settings ZIP exceeds 8 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const entries = archiveEntries(bytes);
  for (const name of ["manifest.json", "scenario.json"]) {
    const entry = entries.find(item => item.name === name);
    if (!entry || entry.size > 4 * 1024**2) throw new Error("Choose a Climoptix OpenFOAM settings ZIP containing manifest.json and scenario.json.");
  }
  const manifest = archiveFile(bytes,"manifest.json"), scenario = archiveFile(bytes,"scenario.json");
  if (manifest.size > 4 * 1024**2 || scenario.size > 4 * 1024**2) throw new Error("Settings metadata exceeds 4 MB.");
  if (!z.object({kind:z.literal("ClimoptixOpenFOAMSettings"),version:z.literal(1)}).safeParse(
    JSON.parse(await manifest.text())).success) throw new Error("Choose a Climoptix OpenFOAM settings export.");
  const parsed = cfdScenarioSchema.safeParse(JSON.parse(await scenario.text()));
  if (!parsed.success) throw new Error("The settings contain invalid or unsupported simulation parameters.");
  const imported = parsed.data;
  return {...current, mesh:imported.mesh, physics:imported.physics, resources:imported.resources,
    outputs:imported.outputs, postProcessing:imported.postProcessing,
    thermalEnvelope:imported.thermalEnvelope, thermalSnapshots:undefined, validation:null};
}
