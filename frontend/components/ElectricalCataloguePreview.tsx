"use client";
import { useEffect, useRef, useState } from "react";
import { FixturePreview } from "@/components/FixturePreview";
import type { CatalogueItem, Obstacle } from "@/lib/types";

/** Use the placed model itself; unmount off-screen canvases to bound GPU usage. */
export function ElectricalCataloguePreview({ item }: { item: CatalogueItem }) {
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!host.current) return;
    const observer = new IntersectionObserver(entries => setVisible(entries[0]?.isIntersecting ?? false));
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  const measurement = (value: number) => ({ value, uncertainty_mm: 0, verified: false, source_type: "USER_MEASURED" as const });
  const obstacle: Obstacle = {
    id: item.id, name: item.name, kind: "BOX", fixture_kind: "FURNITURE",
    representation_key: item.representation_key, color_hex: item.color_hex,
    center: { x: 0, y: 0 }, rotation_deg: 0, base_z_mm: 0,
    dimensions: { width: measurement(item.width_mm), depth: measurement(item.depth_mm), height: measurement(item.height_mm) },
    verified: false, source_type: "USER_MEASURED",
  };
  return <div ref={host} className="electrical-catalogue-preview" aria-label={item.name + " 3D model"}>
    {visible && <FixturePreview obstacle={obstacle} still />}
  </div>;
}
