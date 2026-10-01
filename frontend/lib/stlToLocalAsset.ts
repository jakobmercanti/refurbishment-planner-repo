import { Mesh, MeshStandardMaterial } from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";

export type StlUnit = "mm" | "cm" | "in";
const MAX_STL_BYTES = 50 * 1024 * 1024;
const MAX_TRIANGLES = 2_000_000;

export async function convertStlToGlb(file: File, unit: StlUnit): Promise<File> {
  if (!file.name.toLowerCase().endsWith(".stl") || file.size < 84 || file.size > MAX_STL_BYTES) {
    throw new Error("Choose a valid STL file of 50 MB or less.");
  }
  const geometry = new STLLoader().parse(await file.arrayBuffer());
  try {
    const positions = geometry.getAttribute("position");
    if (!positions || positions.count < 3 || positions.count % 3 !== 0 || positions.count / 3 > MAX_TRIANGLES) {
      throw new Error("The STL has invalid or unsupported triangle geometry.");
    }
    geometry.computeVertexNormals();
    const toMetres: Record<StlUnit, number> = { mm: 0.001, cm: 0.01, in: 0.0254 };
    geometry.scale(toMetres[unit], toMetres[unit], toMetres[unit]);
    const mesh = new Mesh(geometry, new MeshStandardMaterial({ color: "#d9d9d9", roughness: 0.82, metalness: 0 }));
    mesh.name = file.name.replace(/\.stl$/i, "").slice(0, 180) || "Imported STL";
    try {
      const result = await new GLTFExporter().parseAsync(mesh, { binary: true, onlyVisible: true });
      if (!(result instanceof ArrayBuffer)) throw new Error("The STL could not be converted to a binary GLB.");
      const name = `${file.name.replace(/\.stl$/i, "").slice(0, 180) || "Imported STL"}.glb`;
      return new File([result], name, { type: "model/gltf-binary" });
    } finally {
      mesh.material.dispose();
    }
  } finally {
    geometry.dispose();
  }
}
