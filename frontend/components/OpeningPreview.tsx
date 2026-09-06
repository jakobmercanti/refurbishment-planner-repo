/* Catalogue symbols can be data URLs or local SVGs; Next image optimisation is not applicable. */
/* eslint-disable @next/next/no-img-element */

import type { CatalogueItem } from "@/lib/types";

type OpeningPreviewProps = {
  item?: CatalogueItem;
  kind: "DOOR" | "WINDOW";
  doorType?: "SINGLE" | "DOUBLE";
};

function paneCount(item?: CatalogueItem) {
  const label = `${item?.subcategory ?? ""} ${item?.name ?? ""} ${item?.representation_key ?? ""}`.toLowerCase();
  return label.includes("triple") ? 3 : label.includes("double") ? 2 : 1;
}

function FallbackOpeningSymbol({ kind, doorType, panes }: { kind: "DOOR" | "WINDOW"; doorType: "SINGLE" | "DOUBLE"; panes: number }) {
  if (kind === "WINDOW") {
    return <svg viewBox="0 0 240 150" role="img" aria-label={`${panes}-pane window floorplan preview`}><rect width="240" height="150" fill="#f4f6f2" /><path d="M18 68 H76 M164 68 H222 M18 82 H76 M164 82 H222" stroke="#233e37" strokeWidth="7" /><rect x="76" y="62" width="88" height="26" fill="white" stroke="#287fb8" strokeWidth="3" />{Array.from({ length: panes - 1 }, (_, index) => <line key={index} x1={76 + (88 * (index + 1)) / panes} y1="62" x2={76 + (88 * (index + 1)) / panes} y2="88" stroke="#287fb8" strokeWidth="2" />)}</svg>;
  }
  if (doorType === "DOUBLE") return <svg viewBox="0 0 240 150" role="img" aria-label="Double door floorplan preview"><rect width="240" height="150" fill="#f4f6f2" /><path d="M18 68 H84 M156 68 H222 M18 82 H84 M156 82 H222" stroke="#233e37" strokeWidth="7" /><path d="M84 68 A36 36 0 0 1 120 104 M156 68 A36 36 0 0 0 120 104" fill="none" stroke="#4caf8a" strokeWidth="3" /><path d="M84 68 L120 104 M156 68 L120 104" stroke="#4caf8a" strokeWidth="2" /></svg>;
  return <svg viewBox="0 0 240 150" role="img" aria-label="Single door floorplan preview"><rect width="240" height="150" fill="#f4f6f2" /><path d="M18 68 H84 M156 68 H222 M18 82 H84 M156 82 H222" stroke="#233e37" strokeWidth="7" /><path d="M84 68 A72 72 0 0 1 156 140 M84 68 L156 140" fill="none" stroke="#4caf8a" strokeWidth="3" /></svg>;
}

export function OpeningPreview({ item, kind, doorType = "SINGLE" }: OpeningPreviewProps) {
  const image = item?.plan_symbol_data_url || item?.plan_symbol_url;
  const panes = paneCount(item);
  return <div className="opening-preview" aria-label={`${item?.name ?? (kind === "DOOR" ? "Door" : "Window")} preview`}>
    {image ? <img src={image} alt={`${item?.name ?? kind} architectural floorplan symbol`} /> : <FallbackOpeningSymbol kind={kind} doorType={doorType} panes={panes} />}
    <span>{item?.name ?? (kind === "DOOR" ? "Door" : `${panes}-pane window`)}</span>
  </div>;
}
