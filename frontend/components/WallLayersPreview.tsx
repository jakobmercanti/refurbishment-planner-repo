"use client";
import type { ConstructionAssembly, ThermalMaterial } from "@/lib/energyDocument";
import { assemblyThickness, LAYER_COLOURS } from "@/lib/energyWallConstruction";
import { FixturePreview } from "./FixturePreview";
import type { Obstacle } from "@/lib/types";

type PreviewAssembly = Pick<ConstructionAssembly, "assemblyId" | "category" | "layers">;

export function WallLayersPreview({ assembly, compact = false }: { assembly: PreviewAssembly; compact?: boolean }) {
  const total = assemblyThickness(assembly), largest = Math.max(1000, total);
  const measured = (value: number) => ({ value, uncertainty_mm: 0, verified: false });
  const obstacle = { id: assembly.assemblyId, name: `${assembly.category} composition`, kind: "BOX", fixture_kind: "FURNITURE", base_z_mm: 0, verified: false, center: { x: 0, y: 0 }, rotation_deg: 0, dimensions: { width: measured(1000), height: measured(1000), depth: measured(Math.max(1, total)) } } as Obstacle;
  const horizontal = assembly.category === "floor" || assembly.category === "roof";
  const centres: number[] = [];
  let preceding = 0;
  for (const layer of assembly.layers) {
    centres.push((preceding + layer.thicknessMm / 2 - total / 2) / largest);
    preceding += layer.thicknessMm;
  }
  const label = horizontal ? assembly.category === "floor" ? "Floor" : "Roof" : "Wall";
  return <section className={compact ? "wall-layers-preview-inline" : "wall-layers-preview-editor"} aria-label={`${label} composition preview`}>
    <FixturePreview obstacle={obstacle} compact={compact} appearanceControls={!compact}>
      {assembly.layers.map((layer, index) => {
        const centre = centres[index];
        return <mesh key={layer.layerId} position={horizontal ? [0, centre, 0] : [0, 0, centre]}>
          <boxGeometry args={horizontal ? [1000 / largest, Math.max(.01, layer.thicknessMm) / largest, 1000 / largest] : [1000 / largest, 1000 / largest, Math.max(.01, layer.thicknessMm) / largest]} />
          <meshStandardMaterial color={layer.colorHex ?? LAYER_COLOURS[index % LAYER_COLOURS.length]} roughness={.75} />
        </mesh>;
      })}
    </FixturePreview>
  </section>;
}

export function WallLayerKey({ assembly, materials }: { assembly: ConstructionAssembly; materials: ThermalMaterial[] }) {
  return <details><summary>Layer key · outside → inside</summary>
    <ol>{assembly.layers.map((layer, index) => <li key={layer.layerId}><span style={{ display: "inline-block", width: 10, height: 10, marginRight: 6, background: layer.colorHex ?? LAYER_COLOURS[index % LAYER_COLOURS.length] }} />{materials.find(m => m.materialId === layer.materialId)?.name ?? "Custom material"} · {Number(layer.thicknessMm.toFixed(2))} mm</li>)}</ol>
  </details>;
}
