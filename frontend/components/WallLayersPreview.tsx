"use client";
import type { ConstructionAssembly, ThermalMaterial } from "@/lib/energyDocument";
import { assemblyThickness, LAYER_COLOURS } from "@/lib/energyWallConstruction";
import { FixturePreview } from "./FixturePreview";
import type { Obstacle } from "@/lib/types";

/** Same orbit interaction and compact/expanded shell as Add to plan. */
export function WallLayersPreview({ assembly, materials }: { assembly: ConstructionAssembly; materials: ThermalMaterial[] }) {
  const total = assemblyThickness(assembly), largest = Math.max(1000, total);
  const measured = (value: number) => ({ value, uncertainty_mm: 0, verified: false });
  const obstacle = { id: assembly.assemblyId, name: "Wall composition", kind: "BOX", fixture_kind: "FURNITURE", base_z_mm: 0, verified: false, center: { x: 0, y: 0 }, rotation_deg: 0, dimensions: { width: measured(1000), height: measured(1000), depth: measured(Math.max(1, total)) } } as Obstacle;
  return <section aria-label="Wall composition preview">
    <strong>Wall composition · {Number(total.toFixed(2))} mm</strong>
    <FixturePreview obstacle={obstacle} compact>
      {assembly.layers.map((layer, index) => {
        const preceding = assembly.layers.slice(0, index).reduce((sum, l) => sum + l.thicknessMm, 0);
        return <mesh key={layer.layerId} position={[0, 0, (preceding + layer.thicknessMm / 2 - total / 2) / largest]}>
          <boxGeometry args={[1000 / largest, 1000 / largest, Math.max(.01, layer.thicknessMm) / largest]} />
          <meshStandardMaterial color={layer.colorHex ?? LAYER_COLOURS[index % LAYER_COLOURS.length]} roughness={.75} />
        </mesh>;
      })}
    </FixturePreview>
    <small>Outside → inside. Drag to rotate. Illustrative wall sample, not a fit calculation.</small>
    <ol>{assembly.layers.map((layer, index) => <li key={layer.layerId}><span style={{ display: "inline-block", width: 10, height: 10, marginRight: 6, background: layer.colorHex ?? LAYER_COLOURS[index % LAYER_COLOURS.length] }} />{materials.find(m => m.materialId === layer.materialId)?.name ?? "Wall — layers not defined"} · {Number(layer.thicknessMm.toFixed(2))} mm</li>)}</ol>
  </section>;
}
