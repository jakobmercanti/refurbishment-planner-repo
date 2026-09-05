import { useEffect, useState } from "react";
import type { Obstacle } from "@/lib/types";
import { fixtureKindForObstacle } from "@/lib/fixtureCatalog";

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
  const url = obstacle.plan_symbol_url || `/fixture-symbols/${key}.svg`;
  const [embedded, setEmbedded] = useState<{url: string; data: string} | null>(null);
  useEffect(() => {
    if (key === "furniture") return;
    const controller = new AbortController();
    fetch(url, { signal: controller.signal }).then(response => { if (!response.ok) throw new Error("Missing symbol"); return response.text(); }).then(svg => setEmbedded({ url, data: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` })).catch(() => {});
    return () => controller.abort();
  }, [key, url]);
  return <g transform={`translate(${x} ${y}) rotate(${-obstacle.rotation_deg})`}>
    <rect x={-width / 2} y={-depth / 2} width={width} height={depth} style={{fill: "transparent", stroke: "none", cursor: "grab"}} />
    {(obstacle.plan_symbol_data_url || key !== "furniture") ? <image href={obstacle.plan_symbol_data_url || (embedded?.url === url ? embedded.data : url)} x={-width / 2} y={-depth / 2} width={width} height={depth} preserveAspectRatio="none" pointerEvents="none" /> : <rect x={-width / 2} y={-depth / 2} width={width} height={depth} fill="white" stroke="#222" />}
  </g>;
}
