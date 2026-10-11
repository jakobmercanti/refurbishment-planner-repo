import { useEffect, useMemo, useState } from "react";
import { assetUrl } from "@/lib/assetUrl";
import type { Obstacle } from "@/lib/types";
import { isHeatingElement } from "@/lib/heatingElements";
import { fixtureKindForObstacle } from "@/lib/fixtureCatalog";
import { resolvedPartColours } from "@/lib/assetColours";
import { colouredFixtureSymbol } from "@/lib/fixtureSymbolAppearance";
import { electricalDevicePlanSize, electricalDevicePlanSymbol } from "@/lib/electricalPlanSymbols";

export function fixtureRepresentation(obstacle: Pick<Obstacle, "representation_key" | "fixture_kind" | "name" | "model_id">) {
  if (obstacle.representation_key) return obstacle.representation_key;
  const kind = fixtureKindForObstacle(obstacle as Obstacle).toLowerCase();
  const text = `${obstacle.name} ${obstacle.model_id ?? ""}`.toLowerCase();
  if (kind === "toilet") return `toilet-${text.includes("hung") ? "wall-mounted" : "close-coupled"}`;
  if (kind === "basin") return `basin-${text.includes("double") ? "double-vanity" : text.includes("vanity") ? "vanity" : "pedestal"}`;
  if (kind === "shower") return `shower-${text.includes("walk") ? "walk-in" : "corner"}`;
  return "furniture";
}

/** The local symbol faces down the sheet (negative world Y), as the 3D model does. */
export function FixturePlanSymbol({ obstacle, x, y, width: footprintWidth, depth: footprintDepth, selected = false, electricalMode = false, symbolSize }: { obstacle: Obstacle; x: number; y: number; width: number; depth: number; selected?: boolean; electricalMode?: boolean; symbolSize?: { width: number; depth: number } }) {
  const key = fixtureRepresentation(obstacle);
  const heatingElement = isHeatingElement(obstacle);
  const deviceSymbol = electricalDevicePlanSymbol(key, electricalMode);
  const { width, depth } = symbolSize ?? electricalDevicePlanSize(key, footprintWidth, footprintDepth, electricalMode);
  // Symbol and hit-target minima are screen pixels only; stored millimetre geometry is unchanged.
  const heatingWidth = Math.max(24, width), heatingDepth = Math.max(8, depth);
  const url = deviceSymbol?.dataUrl ?? assetUrl(obstacle.plan_symbol_data_url || obstacle.plan_symbol_url || `/fixture-symbols/${key}.svg`);
  const componentColoursSignature = JSON.stringify(obstacle.component_colors ?? {});
  const partColours = useMemo(() => resolvedPartColours({
    representation_key: obstacle.representation_key,
    fixture_kind: obstacle.fixture_kind,
    color_hex: obstacle.color_hex,
    secondary_color_hex: obstacle.secondary_color_hex,
    hardware_color_hex: obstacle.hardware_color_hex,
    handrail_color_hex: obstacle.handrail_color_hex,
    component_colors: JSON.parse(componentColoursSignature),
    stl_base64: obstacle.stl_base64,
  }), [obstacle.representation_key, obstacle.fixture_kind, obstacle.color_hex, obstacle.secondary_color_hex, obstacle.hardware_color_hex, obstacle.handrail_color_hex, obstacle.stl_base64, componentColoursSignature]);
  const partColoursSignature = Object.entries(partColours).sort(([left], [right]) => left.localeCompare(right)).map(([part, colour]) => `${part}:${colour}`).join("|");
  const [embedded, setEmbedded] = useState<{url: string; data: string; modern: string; creative: string} | null>(null);
  useEffect(() => {
    if (deviceSymbol || heatingElement) return;
    if (key === "furniture" && !obstacle.plan_symbol_data_url && !obstacle.plan_symbol_url) return;
    const controller = new AbortController();
    fetch(url, { signal: controller.signal }).then(response => { if (!response.ok) throw new Error("Missing symbol"); return response.text(); }).then(svg => {
      if (!/<svg\b/i.test(svg)) return;
      const dataUrl = (text: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
      setEmbedded({ url, data: dataUrl(svg), modern: dataUrl(colouredFixtureSymbol(svg, key, false, obstacle.color_hex, partColours)), creative: dataUrl(colouredFixtureSymbol(svg, key, true, obstacle.color_hex, partColours)) });
    }).catch(() => {});
    return () => controller.abort();
  }, [key, url, deviceSymbol, heatingElement, obstacle.color_hex, obstacle.plan_symbol_data_url, obstacle.plan_symbol_url, partColours, partColoursSignature]);
  return <g className={embedded?.url === url ? "coloured-fixture-symbol" : undefined} transform={`translate(${x} ${y}) rotate(${-obstacle.rotation_deg})`}>
    <rect className="fixture-symbol-hit-area" x={-(heatingElement ? heatingWidth : width) / 2} y={-(heatingElement ? Math.max(18, depth) : depth) / 2} width={heatingElement ? heatingWidth : width} height={heatingElement ? Math.max(18, depth) : depth} style={{fill: "transparent", stroke: "none", pointerEvents: "all", cursor: "grab"}} />
    {heatingElement ? <g className="heating-plan-symbol" pointerEvents="none">
      <rect x={-heatingWidth / 2} y={-heatingDepth / 2} width={heatingWidth} height={heatingDepth} rx="2" style={{ fill: obstacle.color_hex ?? "#fff4e8", stroke: selected ? "#075dad" : "#874422", strokeWidth: 1.5, strokeDasharray: "none" }} />
      {obstacle.heating_spec?.category === "Boiler" ? <circle r={Math.min(heatingWidth, heatingDepth) / 4} style={{ fill: "none", stroke: "#874422", strokeWidth: 1 }} /> : Array.from({length: 5}, (_, index) => <path key={index} d={`M${heatingWidth * (index - 2) / 6},${-heatingDepth / 2 + 2}V${heatingDepth / 2 - 2}`} style={{ fill: "none", stroke: "#874422", strokeWidth: 1 }} />)}
    </g> : deviceSymbol ? <image href={deviceSymbol.dataUrl} x={-width / 2} y={-depth / 2} width={width} height={depth} preserveAspectRatio="xMidYMid meet" pointerEvents="none" /> : (obstacle.plan_symbol_data_url || key !== "furniture") ? <>
      <image className="symbol-default" href={obstacle.plan_symbol_data_url || (embedded?.url === url ? embedded.data : url)} x={-width / 2} y={-depth / 2} width={width} height={depth} preserveAspectRatio="none" pointerEvents="none" />
      {embedded?.url === url && ["modern", "creative"].map((style) => <image key={style} className={`symbol-${style}`} style={{ display: "none" }} href={embedded[style as "modern" | "creative"]} x={-width / 2} y={-depth / 2} width={width} height={depth} preserveAspectRatio="none" pointerEvents="none" />)}
    </> : <rect className="furniture-material" x={-width / 2} y={-depth / 2} width={width} height={depth} style={{ fill: selected ? "#e69a32" : partColours.body ?? partColours.frame ?? partColours.top ?? obstacle.color_hex ?? "#b99b77", stroke: selected ? "#b8640c" : "#222" }} />}
    {selected && <rect className="fixture-selection-overlay" x={-width / 2} y={-depth / 2} width={width} height={depth} rx={deviceSymbol || heatingElement ? 4 : undefined} style={deviceSymbol || heatingElement ? { fill: "none", stroke: "#075dad", strokeWidth: 2, strokeDasharray: "none" } : undefined} />}
  </g>;
}
