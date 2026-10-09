import { PDFDocument, rgb, StandardFonts, type PDFPage } from "pdf-lib";
import type { Room, Point2D } from "./types";
import type { HeatingProject } from "./heatingDocument";
import { HEATING_DISCLAIMER } from "./heatingDocument";
import { heatingResults } from "./heatingDesign";
export function heatingScheduleCsv(rooms: Room[], heating: HeatingProject) {
  const results = heatingResults(rooms, heating), rows: (string | number)[][] = [["Room", "Area m2", "Target C", "Design demand W", "Heating method", "Emitter W", "UFH W", "Circuit", "Pipe m", "Output flow L/min", "Demand-based flow L/min", "Status"]];
  for (const r of results.rooms) {
    rows.push([r.room.name, r.demand.areaM2.toFixed(1), r.demand.targetC, Math.round(r.demand.designW), r.settings.selectedEmitterType, r.emitters.some(e => e.outputW === null) ? "Not set" : Math.round(r.radiatorW), r.zones.some(z => !z.performance) ? "Not set" : Math.round(r.ufhW), "", "", "", "", r.status]);
    for (const z of r.zones) for (const c of z.circuits) rows.push([r.room.name, "", "", "", "UFH circuit", "", "", c.circuit.name, c.lengthM.toFixed(1), c.flowLmin?.toFixed(1) ?? "Not set", c.designFlowLmin?.toFixed(1) ?? "Not set", c.warnings.join("; ")]);
  }
  return rows.map(row => row.map(v => { const s = String(v), safe = /^[=+@\-\t\r]/.test(s) ? `'${s}` : s;return `"${safe.replaceAll('"', '""')}"`; }).join(",")).join("\r\n");
}
export async function buildHeatingPdf(rooms: Room[], heating: HeatingProject, projectName: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold), results = heatingResults(rooms, heating);
  const ascii = (value: string) => value.normalize("NFKD").replace(/²/g, "2").replace(/[^\x20-\x7e\n]/g, "?");
  let page!: PDFPage;let y = 0;
  const pageStart = (title: string) => { page = pdf.addPage([595, 842]);page.drawRectangle({ x: 0, y: 0, width: 595, height: 842, color: rgb(1, 1, 1) });page.drawText(ascii(title), { x: 36, y: 802, size: 17, font: bold, color: rgb(.14, .2, .27) });let name = ascii(projectName);while (font.widthOfTextAtSize(name, 10) > 500) name = name.slice(0, -1);page.drawText(name + (name !== ascii(projectName) ? "..." : ""), { x: 36, y: 782, size: 10, font });y = 755; };
  const text = (value: string, heading = false) => {
    const words = ascii(value).split(/\s+/), lines: string[] = [];let line = "";
    for (const word of words) { const candidate = line ? `${line} ${word}` : word;if (font.widthOfTextAtSize(candidate, 10) > 515 && line) { lines.push(line);line = word; }else line = candidate; }if (line) lines.push(line);
    for (const value of lines) { if (y < 55) pageStart("Heating schedule - continued");page.drawText(value, { x: 36, y, size: heading ? 11 : 10, font: heading ? bold : font });y -= 15; }y -= 4;
  };
  pageStart("Heating plan - preliminary design");
  text(`System ${heating.heatingSystem.flowTemperatureC}/${heating.heatingSystem.returnTemperatureC} C | External ${heating.buildingSettings.externalDesignTemperatureC} C | Design heat loss ${Math.round(results.heatLossW)} W`);
  const points = [...rooms.flatMap(r => r.vertices), ...heating.manifolds.map(m => m.positionMm), ...heating.exclusions.flatMap(e => e.polygonMm), ...heating.radiators.flatMap(r => { const angle = r.rotationDeg * Math.PI / 180, x = Math.cos(angle) * r.widthMm / 2, y = Math.sin(angle) * r.widthMm / 2;return [{ x: r.positionMm.x - x, y: r.positionMm.y - y }, { x: r.positionMm.x + x, y: r.positionMm.y + y }]; }), ...heating.ufhCircuits.flatMap(c => [...c.pathMm, ...c.supplyPathMm, ...c.returnPathMm])];
  if (points.length) {
    const bounds = points.reduce((b, p) => ({ minX: Math.min(b.minX, p.x), maxX: Math.max(b.maxX, p.x), minY: Math.min(b.minY, p.y), maxY: Math.max(b.maxY, p.y) }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
    const { minX, maxX, minY, maxY } = bounds, scale = Math.min(515 / Math.max(1, maxX - minX), 520 / Math.max(1, maxY - minY));
    const map = (p: Point2D) => ({ x: 40 + (p.x - minX) * scale, y: 660 - (p.y - minY) * scale });
    const roomLabels: { x: number; y: number; label: string }[] = [];
    const line = (points: Point2D[], colour: ReturnType<typeof rgb>, width: number, closed = false) => { const path = closed ? [...points, points[0]] : points;for (let i = 1; i < path.length; i++) page.drawLine({ start: map(path[i - 1]), end: map(path[i]), color: colour, thickness: width }); };
    for (const r of rooms) { line(r.vertices, rgb(.25, .29, .32), 1, true);const mid = map({ x: r.vertices.reduce((s, p) => s + p.x, 0) / r.vertices.length, y: r.vertices.reduce((s, p) => s + p.y, 0) / r.vertices.length }), demand = results.rooms.find(row => row.room.id === r.id)!.demand;roomLabels.push({ ...mid, label: `${ascii(r.name).slice(0, 35)}: ${Math.round(demand.designW)} W` }); }
    for (const c of heating.ufhCircuits) { line(c.pathMm, rgb(.75, .31, .09), .6);line(c.supplyPathMm, rgb(.83, .32, .16), .7);line(c.returnPathMm, rgb(.12, .4, .65), .7);const p = map(c.pathMm[0]);page.drawText(ascii(c.name).slice(0, 40), { ...p, size: 7, font }); }
    for (const ex of heating.exclusions) line(ex.polygonMm, rgb(.6, .47, .23), .8, true);
    for (const r of heating.radiators) { const p = map(r.positionMm), angle = r.rotationDeg * Math.PI / 180, v = { x: Math.cos(angle) * r.widthMm / 2, y: Math.sin(angle) * r.widthMm / 2 };line([{ x: r.positionMm.x - v.x, y: r.positionMm.y - v.y }, { x: r.positionMm.x + v.x, y: r.positionMm.y + v.y }], rgb(.55, .14, .11), 4);page.drawText(ascii(r.model).slice(0, 35), { x: p.x, y: p.y + 6, size: 7, font }); }
    for (const m of heating.manifolds) { const p = map(m.positionMm);page.drawRectangle({ x: p.x - 7, y: p.y - 4, width: 14, height: 8, borderColor: rgb(.1, .3, .5), borderWidth: 1 });page.drawText(ascii(m.name).slice(0, 35), { x: p.x + 11, y: p.y + 10, size: 7, font }); }
    for (const label of roomLabels) { const width = font.widthOfTextAtSize(label.label, 8);page.drawRectangle({ x: label.x - width / 2 - 4, y: label.y - 14, width: width + 8, height: 14, color: rgb(1, 1, 1) });page.drawText(label.label, { x: label.x - width / 2, y: label.y - 10, size: 8, font }); }
    y = 118;
    text("Legend: dark walls | red radiator | orange UFH/supply | blue return | brown exclusion | outlined manifold");
  }
  text(HEATING_DISCLAIMER);
  pageStart("Heating schedule and material summary");
  text(`Project: ${projectName}`);
  text(`Design loss ${Math.round(results.heatLossW)} W; known radiator output ${Math.round(results.radiatorW)} W; known UFH output ${Math.round(results.ufhW)} W; electric heating + known fans ${Math.round(results.electricW)} W.`);
  text(`Radiators ${heating.radiators.length}; manifolds ${heating.manifolds.length}; ports ${heating.manifolds.reduce((s, m) => s + m.ports, 0)}; circuits ${heating.ufhCircuits.length}; actual pipe ${results.pipeM.toFixed(1)} m; separately stated wastage ${heating.buildingSettings.wastagePercent}% (${(results.pipeM * heating.buildingSettings.wastagePercent / 100).toFixed(1)} m).`);
  for (const row of results.rooms) {
    text(`${row.room.name}: ${row.demand.areaM2.toFixed(1)} m2; ${row.demand.targetC} C; design demand ${Math.round(row.demand.designW)} W; ${row.settings.selectedEmitterType}; ${row.status}`, true);
    for (const emitter of row.emitters) text(`${emitter.radiator.model}: ${emitter.radiator.widthMm} x ${emitter.radiator.heightMm} mm; output ${emitter.outputW === null ? "Not set" : `${Math.round(emitter.outputW)} W`}. ${emitter.note}`);
    for (const z of row.zones) { text(`UFH active ${z.activeAreaM2.toFixed(1)} m2; coverage estimate ${z.coveredAreaM2.toFixed(1)} m2; spacing ${z.zone.spacingMm} mm; performance ${z.performance ? `${Math.round(z.performance.outputWm2)} W/m2` : "Not set"}.`);for (const c of z.circuits) text(`${c.circuit.name}: ${c.lengthM.toFixed(1)} m; output ${c.outputW === null ? "Not set" : `${Math.round(c.outputW)} W`}; output-based flow ${c.flowLmin?.toFixed(1) ?? "Not set"} L/min; demand-based flow ${c.designFlowLmin?.toFixed(1) ?? "Not set"} L/min.`); }
    for (const warning of [...new Set([...row.warnings, ...row.demand.warnings])]) text(`Warning: ${warning}`);
  }
  pageStart("Heat-loss calculation details and assumptions");
  text(`U x A x temperature difference, plus 0.33 x ACH x volume x temperature difference. Allowance ${heating.buildingSettings.designAllowancePercent}%. Ground floor is a simplified effective-U model; thermal bridges, solar gains and dynamic recovery are not modelled.`);
  for (const row of results.rooms) { text(row.room.name, true);for (const s of row.demand.surfaces) text(`${s.label}: ${s.areaM2.toFixed(1)} m2 x ${s.uValue} W/m2K x ${Math.max(0, row.demand.targetC - s.adjacentTemperatureC).toFixed(1)} K = ${Math.round(s.lossW)} W.`);text(`Ventilation: 0.33 x ${row.demand.ach} x ${row.demand.volumeM3.toFixed(1)} m3 x ${Math.max(0, row.demand.targetC - heating.buildingSettings.externalDesignTemperatureC)} K = ${Math.round(row.demand.ventilationW)} W. Design total ${Math.round(row.demand.designW)} W.`); }
  pdf.getPages().forEach((p, i, all) => p.drawText(`Preliminary design - ${i + 1}/${all.length}`, { x: 36, y: 25, size: 8, font, color: rgb(.4, .4, .4) }));
  return pdf.save();
}
