"use client";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { WOOD_COLOURS } from "@/lib/flooring";
import { normalizeSkirting, skirtingRuns } from "@/lib/skirting";
import type { RenderedWall } from "@/lib/wallRendering";
import type { Point2D, WallViewMode } from "@/lib/types";

const SCALE = .001;
const noRaycast: THREE.Mesh["raycast"] = () => undefined;
const near = (a: Point2D, b: Point2D) => Math.hypot(a.x - b.x, a.y - b.y) < .5;

function SkirtingWall({ wall, walls, wallMode, defaultWallColour }: { wall: RenderedWall; walls: RenderedWall[]; wallMode: WallViewMode; defaultWallColour: string }) {
  const settings = normalizeSkirting(wall.room.finishes?.skirting_board);
  const wood = settings.colour_mode === "WOOD" ? WOOD_COLOURS.find(item => item.id === settings.wood_id) : undefined;
  const texture = useMemo(() => {
    if (!wood) return null;
    const base = new THREE.Color(wood.base), grain = new THREE.Color(wood.grain);
    const data = new Uint8Array(256 * 64 * 4);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 256; x++) {
      const wave = Math.sin(y * 2.1 + Math.sin(x * .04 + wood.seed) * .9);
      const shade = base.clone().lerp(grain, .08 + .20 * (wave + 1) / 2).convertLinearToSRGB();
      const at = (y * 256 + x) * 4;
      data.set([Math.round(shade.r * 255), Math.round(shade.g * 255), Math.round(shade.b * 255), 255], at);
    }
    const result = new THREE.DataTexture(data, 256, 64, THREE.RGBAFormat);
    result.colorSpace = THREE.SRGBColorSpace; result.wrapS = result.wrapT = THREE.RepeatWrapping; result.magFilter = THREE.LinearFilter; result.minFilter = THREE.LinearFilter; result.needsUpdate = true;
    return result;
  }, [wood?.base, wood?.grain, wood?.seed]);
  useEffect(() => () => texture?.dispose(), [texture]);
  const geometry = useMemo(() => {
    const { height_mm: h, thickness_mm: t } = normalizeSkirting(wall.room.finishes?.skirting_board);
    const vertices = wall.room.vertices;
    const winding = vertices.reduce((area, p, i) => { const q = vertices[(i + 1) % vertices.length]; return area + p.x * q.y - q.x * p.y; }, 0) >= 0 ? 1 : -1;
    const length = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
    const direction = { x: (wall.end.x - wall.start.x) / length, y: (wall.end.y - wall.start.y) / length };
    const normal = { x: -direction.y * winding, y: direction.x * winding };
    const previous = walls.find(other => other !== wall && other.room.id === wall.room.id && near(other.end, wall.start));
    const next = walls.find(other => other !== wall && other.room.id === wall.room.id && near(other.start, wall.end));
    function corner(depth: number, neighbour?: RenderedWall) {
      if (!neighbour) return { x: normal.x * depth, y: normal.y * depth };
      const dx = neighbour.end.x - neighbour.start.x, dy = neighbour.end.y - neighbour.start.y, len = Math.hypot(dx, dy);
      const n = { x: -dy / len * winding, y: dx / len * winding };
      const denominator = 1 + normal.x * n.x + normal.y * n.y;
      if (denominator < .05) return { x: normal.x * depth, y: normal.y * depth };
      const x = (normal.x + n.x) * depth / denominator, y = (normal.y + n.y) * depth / denominator;
      const limit = Math.min(8 * t, length / 2, len / 2), factor = Math.min(1, limit / (Math.hypot(x, y) || 1));
      return { x: x * factor, y: y * factor };
    }
    // Rounded ogee shoulder, small upper bead, flat back against the wall.
    const profile = [[0, 0], [t, 0], [t, h * .73], [t * .98, h * .77], [t * .9, h * .80], [t * .73, h * .83], [t * .54, h * .86], [t * .45, h * .89], [t * .43, h * .92], [t * .48, h * .945], [t * .48, h * .967], [t * .40, h * .99], [t * .27, h], [0, h]];
    const cap = THREE.ShapeUtils.triangulateShape(profile.map(([d, z]) => new THREE.Vector2(d, z)), []);
    const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
    const count = profile.length;
    for (const [from, to] of skirtingRuns(wall)) {
      const base = positions.length / 3;
      for (const distance of [from, to]) for (const [depth, z] of profile) {
        const offset = distance < .001 ? corner(depth, previous) : Math.abs(distance - length) < .001 ? corner(depth, next) : { x: normal.x * depth, y: normal.y * depth };
        positions.push((wall.start.x + direction.x * distance + offset.x) * SCALE, z * SCALE, -(wall.start.y + direction.y * distance + offset.y) * SCALE);
        uvs.push(distance / 800, z / 200);
      }
      for (let i = 0; i < count; i++) { const j = (i + 1) % count; indices.push(base + i, base + j, base + count + j, base + i, base + count + j, base + count + i); }
      for (const [a, b, c] of cap) indices.push(base + c, base + b, base + a, base + count + a, base + count + b, base + count + c);
    }
    if (winding < 0) for (let i = 0; i < indices.length; i += 3) [indices[i], indices[i + 2]] = [indices[i + 2], indices[i]];
    const result = new THREE.BufferGeometry(); result.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3)); result.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2)); result.setIndex(indices); result.computeVertexNormals();
    return result;
  }, [wall, walls]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const colour = wood ? "#ffffff" : settings.colour_mode === "WALL" ? wall.room.finishes?.wall_colors?.[`wall-${String(wall.index + 1).padStart(3, "0")}`] ?? defaultWallColour : settings.custom_colour;
  // Key the material to the selected wood so React Three Fiber replaces the
  // material/map pair when the wood dropdown changes instead of retaining the
  // previous GPU texture on the existing material instance.
  const materialKey = `${settings.colour_mode}-${settings.wood_id}`;
  return <mesh geometry={geometry} raycast={noRaycast} castShadow={wallMode !== "TRANSPARENT"} receiveShadow>
    <meshStandardMaterial key={materialKey} color={colour} map={texture} roughness={wood ? .48 : .32} side={THREE.DoubleSide} transparent={wallMode === "TRANSPARENT"} opacity={wallMode === "TRANSPARENT" ? .28 : 1} depthWrite={wallMode !== "TRANSPARENT"} />
  </mesh>;
}

export function SkirtingBoards({ walls, wallMode, defaultWallColour }: { walls: RenderedWall[]; wallMode: WallViewMode; defaultWallColour: string }) {
  if (wallMode === "INVISIBLE" || wallMode === "CUTAWAY_2D") return null;
  return <group>{walls.filter(wall => normalizeSkirting(wall.room.finishes?.skirting_board).enabled).map(wall => <SkirtingWall key={`${wall.room.id}-${wall.index}-${wall.sourceOffsetMm}-${wall.paintOnly}`} wall={wall} walls={walls} wallMode={wallMode} defaultWallColour={defaultWallColour} />)}</group>;
}
