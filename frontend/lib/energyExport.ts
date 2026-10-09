import { PDFDocument, rgb, StandardFonts, type PDFPage } from "pdf-lib";
import type { Room } from "./types";
import type { HeatingProject } from "./heatingDocument";
import { ENERGY_DISCLAIMER, type EnergyProject } from "./energyDocument";
import { calculateAssemblyUValue, calculateMaterialQuantities, compareThermalScenarios, energyResults, scenarioAssignments } from "./energyCalculations";

export function insulationScheduleCsv(rooms: Room[], heating: HeatingProject, energy: EnergyProject) {
  const current = energyResults(rooms, heating, energy, null), proposed = energyResults(rooms, heating, energy), rows: (string | number)[][] = [["Element", "Boundary", "Area m2", "Existing U W/m2K", "Selected U W/m2K", "Existing W", "Selected W", "Reduction W", "Assumptions"]];
  for (const e of proposed.elements) { const before = current.elements.find(v => v.elementId === e.elementId);rows.push([e.label, e.boundary, e.areaM2.toFixed(1), before?.uValue.toFixed(3) ?? "Not set", e.uValue.toFixed(3), Math.round(before?.heatLossW ?? 0), Math.round(e.heatLossW), Math.round((before?.heatLossW ?? 0) - e.heatLossW), e.warnings.join("; ")]); }
  rows.push([], ["Insulation material quantities", "Thickness mm", "Net m2", "Net m3", "Order m2", "Order m3", "Waste %"]);
  for (const r of calculateMaterialQuantities(rooms, heating, energy)) rows.push([`${r.element.label}: ${r.material}`, r.thicknessMm, r.areaM2.toFixed(1), r.volumeM3.toFixed(2), r.orderAreaM2.toFixed(1), r.orderVolumeM3.toFixed(2), energy.energySettings.wastePercent]);
  return rows.map(row => row.map(value => { const text = String(value), safe = /^[=+@\-\t\r]/.test(text) ? `'${text}` : text;return `"${safe.replaceAll('"', '""')}"`; }).join(",")).join("\r\n");
}
export async function buildEnergyPdf(rooms: Room[], heating: HeatingProject, energy: EnergyProject, projectName: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold), result = energyResults(rooms, heating, energy), comparison = compareThermalScenarios(rooms, heating, energy);
  const ascii = (value: string) => value.replace(/[–—]/g, "-").replace(/·/g, " - ").replace(/×/g, "x").replace(/°/g, " deg ").replace(/²/g, "2").replace(/³/g, "3").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7e]/g, "?");
  let page!: PDFPage, y = 0;
  const start = (title: string) => { page = pdf.addPage([595, 842]);page.drawRectangle({ x: 0, y: 0, width: 595, height: 842, color: rgb(1, 1, 1) });page.drawText(title, { x: 36, y: 802, size: 17, font: bold, color: rgb(.12, .28, .25) });y = 778; };
  const text = (value: string, heading = false) => {
    const tokens = ascii(value).split(/\s+/).flatMap(word => { const chunks: string[] = [];while (font.widthOfTextAtSize(word, 10) > 510) { let cut = word.length - 1;while (cut > 1 && font.widthOfTextAtSize(word.slice(0, cut), 10) > 510) cut--;chunks.push(word.slice(0, cut));word = word.slice(cut); }return [...chunks, word]; });
    let line = "";const lines: string[] = [];
    for (const token of tokens) { const next = line ? `${line} ${token}` : token;if (font.widthOfTextAtSize(next, 10) > 510) { lines.push(line);line = token; } else line = next; }if (line) lines.push(line);
    for (const line of lines) { if (y < 55) start("Energy & Insulation - continued");page.drawText(line, { x: 36, y, size: 10, font: heading ? bold : font, color: rgb(.1, .14, .18) });y -= 15; }y -= 5;
  };
  start("Energy & Insulation - retrofit planning");text(projectName, true);text(`Selected model: ${energy.scenarios.find(s => s.scenarioId === energy.activeScenarioId)?.name ?? "Existing Building"}`);
  text(`Floor area ${result.areaM2.toFixed(1)} m2 | Design heat loss ${(result.designW / 1000).toFixed(1)} kW | H ${Math.round(result.coefficient.total)} W/K`);
  text(`Shared Heating inputs: outside ${heating.buildingSettings.externalDesignTemperatureC} C; ACH fallback ${heating.buildingSettings.airChangeRate}; allowance ${heating.buildingSettings.designAllowancePercent}%. System ${heating.heatingSystem.name} ${heating.heatingSystem.flowTemperatureC}/${heating.heatingSystem.returnTemperatureC} C.`);
  const points = rooms.flatMap(r => r.vertices);
  if (points.length) {
    const bounds = points.reduce((b, p) => ({ minX: Math.min(b.minX, p.x), minY: Math.min(b.minY, p.y), maxX: Math.max(b.maxX, p.x), maxY: Math.max(b.maxY, p.y) }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }), scale = Math.min(500 / Math.max(1, bounds.maxX - bounds.minX), 260 / Math.max(1, bounds.maxY - bounds.minY)), top = y - 10;
    const at = (p: { x: number; y: number }) => ({ x: 42 + (p.x - bounds.minX) * scale, y: top - (p.y - bounds.minY) * scale });
    for (const room of rooms) for (let i = 0; i < room.vertices.length; i++) page.drawLine({ start: at(room.vertices[i]), end: at(room.vertices[(i + 1) % room.vertices.length]), thickness: 1, color: rgb(.55, .58, .6) });
    for (const e of result.elements.filter(e => e.startMm && e.endMm && e.category === "wall")) { const intensity = Math.min(1, e.uValue / 2);page.drawLine({ start: at(e.startMm!), end: at(e.endMm!), thickness: 4, color: rgb(.15 + .7 * intensity, .65 - .4 * intensity, .45 - .2 * intensity) }); }
    y = top - 280;text("Thermal plan: green = lower U, red = higher U (0-2+ W/m2K). Refer to the labelled schedule; colour is not a compliance test.");
  }
  text("Existing and proposed scenarios", true);
  for (const s of comparison) text(`${s.name}: ${(s.result.designW / 1000).toFixed(1)} kW; H ${Math.round(s.result.coefficient.total)} W/K; reduction ${(s.reductionW / 1000).toFixed(1)} kW${!s.result.verified ? "; incomplete construction inputs - fallback, unverified" : ""}.`);
  start("Building fabric and calculation details");
  const assignments = scenarioAssignments(energy);
  for (const e of result.elements) {
    text(e.label, true);text(`${e.boundary}: ${e.areaM2.toFixed(1)} m2 x U ${e.uValue.toFixed(3)} W/m2K x ${e.deltaTK.toFixed(1)} K = ${Math.round(e.heatLossW)} W. ${e.warnings.join(" ")}`);
    const assembly = energy.assemblies.find(a => a.assemblyId === assignments.find(a => a.elementId === e.elementId)?.assemblyId);
    if (assembly) { const c = calculateAssemblyUValue(assembly, energy.materials);text(`${assembly.name}: ${c.method}; Rsi ${assembly.rsi}, Rse ${assembly.rse}; total R ${c.totalR?.toFixed(3) ?? "Not set"}; U ${c.uValue?.toFixed(3) ?? "Not set - Heating fallback shown"}.`);for (const l of c.layers) { const m = energy.materials.find(m => m.materialId === l.layer.materialId);text(`${m?.name}: ${l.layer.thicknessMm} mm; lambda ${l.layer.lambdaOverride ?? m?.lambda ?? "Not set"}; R ${l.resistance?.toFixed(3) ?? "Not set"}${l.layer.resistanceOverride !== null ? " (entered R override)" : ""}.`); } }
  }
  text("Room heating demand and ventilation", true);for (const r of result.rooms) text(`${r.room.name}: ${r.loss.targetC} C; ${r.loss.volumeM3.toFixed(1)} m3; ACH ${r.loss.ach}; fabric ${Math.round(r.loss.fabricW)} W; ventilation 0.33 x ${r.loss.ach} x ${r.loss.volumeM3.toFixed(1)} x ${Math.max(0, r.loss.targetC - result.outside).toFixed(1)} = ${Math.round(r.loss.ventilationW)} W; design ${Math.round(r.loss.designW)} W.`);
  start("Insulation schedule and energy assumptions");
  for (const r of calculateMaterialQuantities(rooms, heating, energy)) text(`${r.element.label}: ${r.material}, ${r.thicknessMm} mm; net ${r.areaM2.toFixed(1)} m2 / ${r.volumeM3.toFixed(2)} m3; with ${energy.energySettings.wastePercent}% waste ${r.orderAreaM2.toFixed(1)} m2 / ${r.orderVolumeM3.toFixed(2)} m3.`);
  if (result.annual) { text(`Indicative useful space heat: approximately ${Math.round(result.annual.usefulKwh / 100) * 100} kWh/year; H x HDD x 24 / 1000 x schedule factor. Delivered energy ${result.annual.deliveredKwh === null ? "Not set" : `approximately ${Math.round(result.annual.deliveredKwh / 100) * 100} kWh/year`}.`);text(`HDD ${energy.energySettings.heatingDegreeDays}, base ${energy.energySettings.baseTemperatureC} C, source ${energy.energySettings.climateReference}, schedule multiplier ${energy.energySettings.scheduleFactor}; seasonal efficiency / SPF ${energy.energySettings.seasonalEfficiency ?? "Not set"}, basis ${energy.energySettings.efficiencyBasis || "Not set"}.`); }
  else text("Annual energy: Not set. Degree days and climate reference must be supplied.");
  text("Energy rating: not calculated. No validated EPC scoring model; no arbitrary points or bands.");
  for (const warning of result.warnings) text(warning);
  text("Material references (product-specific samples; modified values require revalidation)", true);for (const m of energy.materials.filter(m => energy.assemblies.some(a => a.layers.some(l => l.materialId === m.materialId)))) text(`${m.name}: ${m.reference}`);
  text(ENERGY_DISCLAIMER);
  pdf.getPages().forEach((p, index) => p.drawText(`Preliminary planning | Page ${index + 1} of ${pdf.getPageCount()}`, { x: 36, y: 27, size: 8, font, color: rgb(.35, .38, .4) }));
  return pdf.save();
}
