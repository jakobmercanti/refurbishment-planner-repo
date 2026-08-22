"use client";

import { Grid, OrbitControls } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import type { Opening, Placement, Point2D, Product, Room, Status } from "@/lib/types";

const SCALE = 0.001;

interface Toggles {
  walls: boolean;
  product: boolean;
  obstacles: boolean;
  clearances: boolean;
  collisions: boolean;
}

interface ViewerProps {
  room: Room;
  product: Product;
  placement: Placement;
  status: Status;
  collisionIds: string[];
}

function wallVector(start: Point2D, end: Point2D) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  return { dx: dx / length, dy: dy / length, length, angle: Math.atan2(dy, dx) };
}

function WallPiece({
  start,
  end,
  from,
  length,
  base,
  height,
  thickness,
}: {
  start: Point2D;
  end: Point2D;
  from: number;
  length: number;
  base: number;
  height: number;
  thickness: number;
}) {
  if (length <= 0 || height <= 0) return null;
  const vector = wallVector(start, end);
  const midpoint = from + length / 2;
  const exteriorX = vector.dy;
  const exteriorY = -vector.dx;
  const centerX = start.x + vector.dx * midpoint + exteriorX * thickness / 2;
  const centerY = start.y + vector.dy * midpoint + exteriorY * thickness / 2;
  return (
    <mesh
      position={[centerX * SCALE, (base + height / 2) * SCALE, -centerY * SCALE]}
      rotation={[0, vector.angle, 0]}
      castShadow
      receiveShadow
    >
      <boxGeometry args={[length * SCALE, height * SCALE, thickness * SCALE]} />
      <meshStandardMaterial color="#d9d4c8" roughness={0.82} />
    </mesh>
  );
}

function WallWithOpenings({
  index,
  room,
  start,
  end,
}: {
  index: number;
  room: Room;
  start: Point2D;
  end: Point2D;
}) {
  const vector = wallVector(start, end);
  const wallId = `wall-${String(index + 1).padStart(3, "0")}`;
  const openings = room.openings
    .filter((opening) => opening.parent_wall_id === wallId)
    .sort((a, b) => a.offset_mm - b.offset_mm);
  const pieces: React.ReactNode[] = [];
  let cursor = 0;
  openings.forEach((opening) => {
    pieces.push(
      <WallPiece
        key={`${opening.id}-before`}
        start={start}
        end={end}
        from={cursor}
        length={opening.offset_mm - cursor}
        base={0}
        height={room.wall_height.value}
        thickness={room.wall_thickness.value}
      />,
    );
    if (opening.sill_height_mm > 0) {
      pieces.push(
        <WallPiece
          key={`${opening.id}-below`}
          start={start}
          end={end}
          from={opening.offset_mm}
          length={opening.width.value}
          base={0}
          height={opening.sill_height_mm}
          thickness={room.wall_thickness.value}
        />,
      );
    }
    const top = opening.sill_height_mm + opening.height.value;
    pieces.push(
      <WallPiece
        key={`${opening.id}-above`}
        start={start}
        end={end}
        from={opening.offset_mm}
        length={opening.width.value}
        base={top}
        height={room.wall_height.value - top}
        thickness={room.wall_thickness.value}
      />,
    );
    cursor = opening.offset_mm + opening.width.value;
  });
  pieces.push(
    <WallPiece
      key={`${wallId}-after`}
      start={start}
      end={end}
      from={cursor}
      length={vector.length - cursor}
      base={0}
      height={room.wall_height.value}
      thickness={room.wall_thickness.value}
    />,
  );
  return <>{pieces}</>;
}

function Floor({ vertices }: { vertices: Point2D[] }) {
  const shape = useMemo(() => {
    const next = new THREE.Shape();
    vertices.forEach((vertex, index) => {
      const x = vertex.x * SCALE;
      const y = vertex.y * SCALE;
      if (index === 0) next.moveTo(x, y);
      else next.lineTo(x, y);
    });
    next.closePath();
    return next;
  }, [vertices]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <shapeGeometry args={[shape]} />
      <meshStandardMaterial color="#ece9e1" roughness={0.94} side={THREE.DoubleSide} />
    </mesh>
  );
}

function ProductMesh({ product, placement, status }: Omit<ViewerProps, "room" | "collisionIds">) {
  const { width, depth, height } = product.nominal_dimensions;
  const color = status === "FIT" ? "#1f9d68" : status === "VERIFY" ? "#e5a51b" : "#d84a4a";
  return (
    <mesh
      position={[
        placement.center.x * SCALE,
        (placement.base_z_mm + height.value / 2) * SCALE,
        -placement.center.y * SCALE,
      ]}
      rotation={[0, THREE.MathUtils.degToRad(placement.rotation_deg), 0]}
      castShadow
    >
      <boxGeometry args={[width.value * SCALE, height.value * SCALE, depth.value * SCALE]} />
      <meshStandardMaterial color={color} transparent opacity={0.7} roughness={0.4} />
    </mesh>
  );
}

function ClearanceMesh({ product, placement }: { product: Product; placement: Placement }) {
  const clearance = product.installation_clearance_mm;
  const { width, depth } = product.nominal_dimensions;
  return (
    <mesh
      position={[placement.center.x * SCALE, 0.012, -placement.center.y * SCALE]}
      rotation={[0, THREE.MathUtils.degToRad(placement.rotation_deg), 0]}
    >
      <boxGeometry args={[(width.value + 2 * clearance) * SCALE, 0.024, (depth.value + 2 * clearance) * SCALE]} />
      <meshStandardMaterial color="#287fb8" transparent opacity={0.2} depthWrite={false} />
    </mesh>
  );
}

function DoorSwingLeaf({
  hinge,
  initial,
  direction,
  radius,
}: {
  hinge: Point2D;
  initial: number;
  direction: number;
  radius: number;
}) {
  const shape = new THREE.Shape();
  shape.moveTo(hinge.x * SCALE, hinge.y * SCALE);
  for (let step = 0; step <= 32; step += 1) {
    const angle = initial + direction * Math.PI / 2 * step / 32;
    shape.lineTo(
      (hinge.x + radius * Math.cos(angle)) * SCALE,
      (hinge.y + radius * Math.sin(angle)) * SCALE,
    );
  }
  shape.closePath();
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.018, 0]}>
      <shapeGeometry args={[shape]} />
      <meshStandardMaterial color="#e5a51b" transparent opacity={0.28} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  );
}

function DoorSwing({ room, door }: { room: Room; door: Opening }) {
  const wallIndex = Number(door.parent_wall_id.split("-")[1]) - 1;
  const start = room.vertices[wallIndex];
  const end = room.vertices[(wallIndex + 1) % room.vertices.length];
  const vector = wallVector(start, end);
  const startX = start.x + vector.dx * door.offset_mm;
  const startY = start.y + vector.dy * door.offset_mm;
  const endX = startX + vector.dx * door.width.value;
  const endY = startY + vector.dy * door.width.value;
  const inward = door.opens_inward !== false;
  if (door.door_type === "DOUBLE") {
    return (
      <>
        <DoorSwingLeaf hinge={{ x: startX, y: startY }} initial={vector.angle} direction={inward ? 1 : -1} radius={door.width.value / 2} />
        <DoorSwingLeaf hinge={{ x: endX, y: endY }} initial={vector.angle + Math.PI} direction={inward ? -1 : 1} radius={door.width.value / 2} />
      </>
    );
  }
  const hingeStart = door.hinge_side === "START";
  const hinge = hingeStart ? { x: startX, y: startY } : { x: endX, y: endY };
  const initial = Math.atan2(hingeStart ? vector.dy : -vector.dy, hingeStart ? vector.dx : -vector.dx);
  const direction = hingeStart ? (inward ? 1 : -1) : (inward ? -1 : 1);
  return <DoorSwingLeaf hinge={hinge} initial={initial} direction={direction} radius={door.width.value} />;
}

function CameraPreset({ preset }: { preset: "perspective" | "top" }) {
  const { camera } = useThree();
  useEffect(() => {
    if (preset === "top") camera.position.set(1.6, 6.4, -1.4);
    else camera.position.set(4.6, 4.1, 4.8);
    camera.lookAt(1.6, 0, -1.4);
    camera.updateProjectionMatrix();
  }, [camera, preset]);
  return null;
}

function Scene({ room, product, placement, status, collisionIds, toggles, preset }: ViewerProps & { toggles: Toggles; preset: "perspective" | "top" }) {
  return (
    <>
      <CameraPreset preset={preset} />
      <ambientLight intensity={1.3} />
      <directionalLight position={[4, 7, 3]} intensity={2.2} castShadow />
      <Floor vertices={room.vertices} />
      {toggles.walls && room.vertices.map((start, index) => (
        <WallWithOpenings
          key={`wall-${index}`}
          index={index}
          room={room}
          start={start}
          end={room.vertices[(index + 1) % room.vertices.length]}
        />
      ))}
      {toggles.obstacles && room.obstacles.map((obstacle) => (
        <mesh
          key={obstacle.id}
          position={[
            obstacle.center.x * SCALE,
            (obstacle.base_z_mm + obstacle.dimensions.height.value / 2) * SCALE,
            -obstacle.center.y * SCALE,
          ]}
          rotation={[0, THREE.MathUtils.degToRad(obstacle.rotation_deg), 0]}
          castShadow
        >
          <boxGeometry args={[
            obstacle.dimensions.width.value * SCALE,
            obstacle.dimensions.height.value * SCALE,
            obstacle.dimensions.depth.value * SCALE,
          ]} />
          <meshStandardMaterial color="#8a7765" roughness={0.72} />
        </mesh>
      ))}
      {toggles.product && <ProductMesh product={product} placement={placement} status={status} />}
      {toggles.clearances && <ClearanceMesh product={product} placement={placement} />}
      {toggles.clearances && room.openings.filter((item) => item.kind === "DOOR").map((door) => (
        <DoorSwing key={door.id} room={room} door={door} />
      ))}
      {toggles.collisions && room.obstacles.filter((item) => collisionIds.includes(item.id)).map((obstacle) => (
        <mesh key={`collision-${obstacle.id}`} position={[obstacle.center.x * SCALE, 0.9, -obstacle.center.y * SCALE]}>
          <sphereGeometry args={[0.11, 24, 24]} />
          <meshStandardMaterial color="#ff2d2d" emissive="#ff2d2d" emissiveIntensity={1.2} />
        </mesh>
      ))}
      <Grid position={[1.6, -0.002, -1.4]} args={[8, 8]} cellSize={0.1} cellThickness={0.4} cellColor="#a9b1ac" sectionSize={1} sectionColor="#65706a" fadeDistance={9} />
      <OrbitControls makeDefault enableDamping />
    </>
  );
}

export function EngineeringViewer(props: ViewerProps) {
  const [preset, setPreset] = useState<"perspective" | "top">("perspective");
  const [toggles, setToggles] = useState<Toggles>({
    walls: true,
    product: true,
    obstacles: true,
    clearances: true,
    collisions: true,
  });
  const flip = (key: keyof Toggles) => setToggles((current) => ({ ...current, [key]: !current[key] }));
  return (
    <div className="viewer-shell">
      <div className="viewer-toolbar" aria-label="3D viewer controls">
        <div className="segmented">
          <button className={preset === "perspective" ? "active" : ""} onClick={() => setPreset("perspective")}>Perspective</button>
          <button className={preset === "top" ? "active" : ""} onClick={() => setPreset("top")}>Top</button>
        </div>
        <div className="toggle-row">
          {(Object.keys(toggles) as Array<keyof Toggles>).map((key) => (
            <button key={key} className={toggles[key] ? "active" : ""} onClick={() => flip(key)} aria-pressed={toggles[key]}>
              {key}
            </button>
          ))}
        </div>
      </div>
      <Canvas shadows camera={{ position: [4.6, 4.1, 4.8], fov: 38, near: 0.01, far: 100 }}>
        <Scene {...props} toggles={toggles} preset={preset} />
      </Canvas>
      <div className="viewer-legend"><span>1 scene unit = 1000 mm</span><span>Drag orbit · wheel zoom · right-drag pan</span></div>
    </div>
  );
}
