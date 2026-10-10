import type { ThermalMaterial } from "./energyDocument";

const government = "https://assets.publishing.service.gov.uk/government/uploads/system/uploads/attachment_data/file/815955/R3_M3_Calculation_methods.pdf";
const block = "https://www.rockwool.com/uk/applications/product-overview/trade-insulation-range/thermal-insulation-cavity-slab-32/";
const plaster = "https://www.british-gypsum.com/documents/declaration-performance-dop/british-gypsum-dop-plast112-uk-thistle-bonding-60.pdf";
const xps = "https://ravagobuildingsolutions.com/industry/wp-content/uploads/sites/24/2023/09/ravago-eu-00-005-ravatherm-industry-brochure-2023-v1-1.pdf";
const cavity = "https://www.ofgem.gov.uk/sites/default/files/docs/2017/05/uv_summary_report.pdf";

/** Indicative planning inputs, researched 2026-10-10. Never product approval.
 * IDs retain compatibility with saved projects. Product/density/conditions matter.
 */
export const CONSTRUCTION_MATERIAL_DEFAULTS: ThermalMaterial[] = [
  ["Concrete block", 1.13, block, "Dense block, 1900–2250 kg/m³"],
  ["Dense concrete", 1.35, government + "#page=19", "Concrete slab, 2000 kg/m³"],
  ["PUR", .025, government + "#page=34", "Polyurethane sample"],
  ["EPS", .040, government + "#page=19", "EPS sample, 15 kg/m³"],
  ["XPS", .035, xps, "Ravatherm LB sample; conservative thick-board value"],
  ["Phenolic foam", .025, government + "#page=25", "Phenolic sample"],
  ["Timber", .13, government + "#page=18", "Softwood, 500 kg/m³"],
  ["Plasterboard", .21, government + "#page=26", "Gypsum board, 700 kg/m³"],
  ["Plaster", .30, plaster, "Thistle Bonding 60 reference"],
  ["Air cavity", null, cavity, "Unventilated vertical cavity ≥25 mm, ordinary surfaces; R=0.18. Not ventilated or reflective cavities"],
  ["Screed", 1.15, government + "#page=19", "Concrete screed, 1200 kg/m³"],
  ["Plywood", .17, government + "#page=60", "Plywood, 700 kg/m³"],
  ["OSB", .13, "https://www.egger.com/get_download/d2229856-1570-4bf7-9f7f-4ffa6b507f7a/Certificate-BBA-08-4546-OSB3-Sheathing-en.pdf?country=GB", "EGGER OSB 3 reference"],
  ["Roof tile", 1.0, government + "#page=34", "Clay tile sample"],
].map(([name, lambda, url, conditions], index) => ({
  materialId: `custom-${index}`, name: `${name} — indicative default`,
  category: ["PUR", "EPS", "XPS", "Phenolic foam"].includes(String(name)) ? "Insulation" : "Construction",
  lambda: lambda as number | null, density: null, vapourResistance: null,
  reference: `Planning assumption: ${conditions}. Confirm the actual product and conditions. ${url}`,
  editable: true, ...(index === 9 ? { resistance: .18, resistanceMinThicknessMm: 25 } : {}),
}));

/** Only the exact untouched legacy placeholders are upgraded; custom edits survive. */
export function upgradeLegacyMaterial(material: ThermalMaterial): ThermalMaterial {
  const preset = CONSTRUCTION_MATERIAL_DEFAULTS.find(m => m.materialId === material.materialId);
  const legacyName = preset?.name.replace(" — indicative default", " — specify product value");
  return preset && material.name === legacyName && material.lambda === null && material.resistance === undefined &&
    material.reference === "Not supplied: enter a declared/design value for the actual product and conditions." && material.density === null && material.vapourResistance === null && material.category === preset.category && material.editable && material.resistanceMinThicknessMm === undefined && material.resistanceReferenceThicknessMm === undefined
    ? { ...preset } : material;
}
