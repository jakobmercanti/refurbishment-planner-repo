import { BufferGeometry, Color, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, Object3D } from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

export type CadFormat = "igs" | "stp";
export type ModelUnit = "mm" | "cm" | "m" | "in";

const UNIT_TO_METRES: Record<ModelUnit, number> = { mm: 0.001, cm: 0.01, m: 1, in: 0.0254 };
const UNIT_TO_OCCT: Record<ModelUnit, string> = { mm: "millimeter", cm: "centimeter", m: "meter", in: "inch" };

const MAX_CAD_FILE_BYTES = 50 * 1024 * 1024;
const MAX_CAD_TRIANGLES = 500_000;

interface CadMeshData {
  name?: string;
  color?: unknown;
  attributes?: { position?: { array?: unknown }; normal?: { array?: unknown } };
  index?: { array?: unknown };
}

interface CadNodeData {
  name?: string;
  meshes?: number[];
  children?: CadNodeData[];
}

interface CadImportResult {
  success: boolean;
  root?: CadNodeData;
  meshes?: CadMeshData[];
}

function flattenNumbers(value: unknown, label: string): number[] {
  const numbers: number[] = [];
  const collect = (entry: unknown): void => {
    if (typeof entry === "number") {
      if (!Number.isFinite(entry)) throw new Error(`The CAD file contains invalid ${label} values.`);
      numbers.push(entry);
      return;
    }
    if (Array.isArray(entry) || ArrayBuffer.isView(entry)) {
      for (const item of Array.from(entry as ArrayLike<unknown>)) collect(item);
      return;
    }
    throw new Error(`The CAD file contains invalid ${label} data.`);
  };
  collect(value);
  return numbers;
}

function readCadFile(file: File, format: CadFormat, unit: ModelUnit, onWorker: (worker: Worker | null) => void): Promise<CadImportResult> {
  if (typeof Worker === "undefined") return Promise.reject(new Error("This browser does not support local CAD file import."));
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const worker = new Worker(`${basePath}/vendor/occt-import-js/occt-import-js-worker.js`, { name: "local-cad-import" });
  onWorker(worker);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (complete: () => void) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      onWorker(null);
      complete();
    };
    worker.onmessage = (event: MessageEvent<CadImportResult & { error?: string }>) => {
      const result = event.data;
      if (result?.error) { finish(() => reject(new Error(result.error))); return; }
      if (!result?.success || !result.root || !Array.isArray(result.meshes) || result.meshes.length === 0) {
        finish(() => reject(new Error("No usable 3D geometry was found. Try exporting the CAD file again.")));
        return;
      }
      finish(() => resolve(result));
    };
    worker.onerror = event => {
      event.preventDefault();
      finish(() => reject(new Error("The CAD file could not be read. Try exporting it as STEP/STP or IGES/IGS.")));
    };
    void file.arrayBuffer().then(buffer => {
      if (settled) return;
      try {
        worker.postMessage({
          format: format === "igs" ? "iges" : "step",
          buffer,
          params: { linearUnit: UNIT_TO_OCCT[unit] },
        }, [buffer]);
      } catch (reason) {
        finish(() => reject(reason instanceof Error ? reason : new Error("The CAD file could not be sent to the local importer.")));
      }
    }).catch(reason => finish(() => reject(reason instanceof Error ? reason : new Error("The CAD file could not be read."))));
  });
}

function colorFrom(value: unknown): Color {
  if (Array.isArray(value) && value.length >= 3 && value.slice(0, 3).every(channel => typeof channel === "number" && Number.isFinite(channel))) {
    return new Color(value[0], value[1], value[2]);
  }
  return new Color("#d9d9d9");
}

export async function convertCadToGlb(file: File, format: CadFormat, unit: ModelUnit, scale: number, onWorker: (worker: Worker | null) => void = () => undefined): Promise<File> {
  if (file.size < 1 || file.size > MAX_CAD_FILE_BYTES) throw new Error("Choose a CAD file of 50 MB or less.");
  if (!Number.isFinite(scale) || scale <= 0 || scale > 1000) throw new Error("Enter a scale greater than 0 and no greater than 1,000.");
  const result = await readCadFile(file, format, unit, onWorker);
  const geometries: BufferGeometry[] = [];
  const materials: MeshStandardMaterial[] = [];
  let scene: Group | null = null;

  try {
    let triangleCount = 0;
    for (const cadMesh of result.meshes ?? []) {
      const positions = flattenNumbers(cadMesh.attributes?.position?.array, "vertex");
      const indices = flattenNumbers(cadMesh.index?.array, "index");
      if (positions.length < 9 || positions.length % 3 !== 0 || indices.length < 3 || indices.length % 3 !== 0) {
        throw new Error("The CAD file contains incomplete triangle geometry.");
      }
      triangleCount += indices.length / 3;
      if (triangleCount > MAX_CAD_TRIANGLES) throw new Error("This CAD model is too detailed for the browser planner. Export a simplified model and try again.");
      const vertexCount = positions.length / 3;
      if (indices.some(index => !Number.isInteger(index) || index < 0 || index >= vertexCount)) throw new Error("The CAD file contains invalid triangle indices.");

      const geometry = new BufferGeometry();
      const toMetres = UNIT_TO_METRES[unit] * scale;
      geometry.setAttribute("position", new Float32BufferAttribute(Float32Array.from(positions, value => value * toMetres), 3));
      const normalData = cadMesh.attributes?.normal?.array;
      if (normalData !== undefined) {
        const normals = flattenNumbers(normalData, "normal");
        if (normals.length === positions.length) geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
      }
      geometry.setIndex(indices);
      if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
      geometries.push(geometry);
      materials.push(new MeshStandardMaterial({ color: colorFrom(cadMesh.color), roughness: 0.82, metalness: 0 }));
    }

    let visitedNodes = 0;
    const buildNode = (node: CadNodeData, depth = 0): Group => {
      visitedNodes += 1;
      if (depth > 64 || visitedNodes > 20_000) throw new Error("This CAD assembly is too complex for the browser planner.");
      const group = new Group();
      group.name = node.name || "CAD model";
      for (const meshIndex of node.meshes ?? []) {
        const geometry = geometries[meshIndex];
        const material = materials[meshIndex];
        if (!geometry || !material) throw new Error("The CAD file contains an invalid assembly reference.");
        const mesh = new Mesh(geometry, material);
        mesh.name = result.meshes?.[meshIndex]?.name || group.name;
        group.add(mesh);
      }
      for (const child of node.children ?? []) group.add(buildNode(child, depth + 1));
      return group;
    };

    scene = buildNode(result.root!);
    const exported = await new GLTFExporter().parseAsync(scene, { binary: true, onlyVisible: true });
    if (!(exported instanceof ArrayBuffer)) throw new Error("The CAD model could not be converted to GLB.");
    const baseName = file.name.replace(/\.(?:igs|iges|stp|step)$/i, "").slice(0, 180) || "Imported CAD model";
    return new File([exported], `${baseName}.glb`, { type: "model/gltf-binary" });
  } finally {
    scene?.traverse(object => { if (object instanceof Mesh) object.material.dispose(); });
    geometries.forEach(geometry => geometry.dispose());
    if (!scene) materials.forEach(material => material.dispose());
  }
}

/** Rewrites a GLB with declared source units and scale baked into its mesh geometry. */
export async function convertGlbUnitsAndScale(file: File, unit: ModelUnit, scale: number): Promise<File> {
  // STL metres are normalized from the existing millimetre-based converter, so
  // its unit reinterpretation can combine with the user multiplier (up to 1e6).
  if (!Number.isFinite(scale) || scale <= 0 || scale > 1_000_000) throw new Error("The combined unit conversion and scale is outside the supported range.");
  const gltf = await new GLTFLoader().parseAsync(await file.arrayBuffer(), "");
  const root = gltf.scene;
  root.scale.setScalar(UNIT_TO_METRES[unit] * scale);
  root.updateMatrixWorld(true);
  try {
    const exported = await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: true });
    if (!(exported instanceof ArrayBuffer)) throw new Error("The GLB could not be normalized to the selected units.");
    return new File([exported], file.name, { type: "model/gltf-binary" });
  } finally {
    root.traverse((object: Object3D) => {
      if (!(object instanceof Mesh)) return;
      object.geometry.dispose();
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        for (const value of Object.values(material)) {
          if (value && typeof value === "object" && "isTexture" in value && "dispose" in value) (value as import("three").Texture).dispose();
        }
        material.dispose();
      }
    });
  }
}
