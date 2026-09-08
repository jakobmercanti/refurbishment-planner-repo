import { useEffect, useState } from "react";
import type { Obstacle } from "@/lib/types";
import { fixtureKindForObstacle } from "@/lib/fixtureCatalog";
import { colouredFixtureSymbol } from "@/lib/fixtureSymbolAppearance";

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
export function FixturePlanSymbol({ obstacle, x, y, width, depth }: { obstacle: Obstacle; x: number; y: number; width: number; depth: number }) {
  const key = fixtureRepresentation(obstacle);
  const url = obstacle.plan_symbol_data_url || obstacle.plan_symbol_url || `/fixture-symbols/${key}.svg`;
  const [embedded, setEmbedded] = useState<{url: string; data: string; modern: string; creative: string} | null>(null);
  useEffect(() => {
    if (key === "furniture" && !obstacle.plan_symbol_data_url && !obstacle.plan_symbol_url) return;
    const controller = new AbortController();
    fetch(url, { signal: controller.signal }).then(response => { if (!response.ok) throw new Error("Missing symbol"); return response.text(); }).then(svg => {
      if (!/<svg\b/i.test(svg)) return;
      const dataUrl = (text: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
      setEmbedded({ url, data: dataUrl(svg), modern: dataUrl(colouredFixtureSymbol(svg, key, false)), creative: dataUrl(colouredFixtureSymbol(svg, key, true)) });
    }).catch(() => {});
    return () => controller.abort();
  }, [key, url, obstacle.plan_symbol_data_url, obstacle.plan_symbol_url]);
  return <g className={embedded?.url === url ? "coloured-fixture-symbol" : undefined} transform={`translate(${x} ${y}) rotate(${-obstacle.rotation_deg})`}>
    <rect x={-width / 2} y={-depth / 2} width={width} height={depth} style={{fill: "transparent", stroke: "none", cursor: "grab"}} />
    {(obstacle.plan_symbol_data_url || key !== "furniture") ? <>
      <image className="symbol-default" href={obstacle.plan_symbol_data_url || (embedded?.url === url ? embedded.data : url)} x={-width / 2} y={-depth / 2} width={width} height={depth} preserveAspectRatio="none" pointerEvents="none" />
      {embedded?.url === url && ["modern", "creative"].map((style) => <image key={style} className={`symbol-${style}`} style={{ display: "none" }} href={embedded[style as "modern" | "creative"]} x={-width / 2} y={-depth / 2} width={width} height={depth} preserveAspectRatio="none" pointerEvents="none" />)}
    </> : <rect className="furniture-material" x={-width / 2} y={-depth / 2} width={width} height={depth} fill="white" stroke="#222" />}
  </g>;
}
