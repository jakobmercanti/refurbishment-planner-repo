import { chooseLayoutSave } from "./electricalFilePicker";
import { downloadCFD } from "./climoptix";

/** Call directly from a user click so Chromium can open its native Save As dialog. */
export async function saveHvacCalculations(value: unknown) {
  try {
    const request = chooseLayoutSave("hvac-conventional.json");
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
    if (!request) { downloadCFD(blob, "hvac-conventional.json"); return; }
    const handle = await request, writable = await handle.createWritable();
    await writable.write(blob); await writable.close();
  } catch (error) { if (!(error instanceof DOMException && error.name === "AbortError")) throw error; }
}
