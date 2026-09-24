"use client";
import { useThree } from "@react-three/fiber";
import { Bounds, Center, OrbitControls, useBounds } from "@react-three/drei";
import { useEffect, useState, type WheelEvent as ReactWheelEvent } from "react";
import { ParametricFixture } from "@/components/ParametricFixture";
import { StableCanvas } from "@/components/StableCanvas";
import type { Obstacle } from "@/lib/types";

const PREVIEW_ZOOM_MIN = 0.6;
const PREVIEW_ZOOM_MAX = 2.4;

function PreviewCameraFrame({ frameKey, fitRequest, zoom }: { frameKey: string; fitRequest: number; zoom: number }) {
  const bounds = useBounds();
  const { camera } = useThree();

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      bounds.refresh().fit().clip();
      camera.zoom = zoom;
      camera.updateProjectionMatrix();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [bounds, camera, fitRequest, frameKey, zoom]);

  return null;
}

function positiveDimension(value: number, fallback: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

export function FixturePreview({ obstacle, compact = false, appearanceControls = false }: { obstacle: Obstacle; compact?: boolean; appearanceControls?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [fitRequest, setFitRequest] = useState(0);
  const sourceDimensions = [obstacle.dimensions.width.value, obstacle.dimensions.depth.value, obstacle.dimensions.height.value].map(Number);
  const fallbackDimension = Math.max(...sourceDimensions.filter(value => Number.isFinite(value) && value > 0), 1);
  const width = positiveDimension(obstacle.dimensions.width.value, fallbackDimension);
  const depth = positiveDimension(obstacle.dimensions.depth.value, fallbackDimension);
  const height = positiveDimension(obstacle.dimensions.height.value, fallbackDimension);
  const largest = Math.max(width, depth, height, 1);
  const isExpanded = compact ? expanded : true;
  const frameKey = `${obstacle.representation_key ?? "fixture"}|${width}|${depth}|${height}|${obstacle.rotation_deg}`;
  const updateZoom = (value: number) => setZoom(Math.max(PREVIEW_ZOOM_MIN, Math.min(PREVIEW_ZOOM_MAX, value)));
  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!appearanceControls) return;
    event.preventDefault();
    setZoom(current => Math.max(PREVIEW_ZOOM_MIN, Math.min(PREVIEW_ZOOM_MAX, current * (event.deltaY > 0 ? 0.9 : 1.1))));
  };
  return <div className={`fixture-preview ${compact ? "fixture-preview-compact" : ""} ${isExpanded ? "expanded" : ""}`} style={{ height: compact ? (isExpanded ? 230 : 106) : 180, background: "#eef1ed", borderRadius: 12 }} aria-label="Live element preview" role={compact ? "button" : undefined} tabIndex={compact ? 0 : undefined} aria-expanded={compact ? isExpanded : undefined} onClick={compact ? () => setExpanded(value => !value) : undefined} onKeyDown={compact ? event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setExpanded(value => !value); } } : undefined} onWheel={appearanceControls ? handleWheel : undefined}>
    <StableCanvas camera={{ position: [1.7, 1.6, 2.2], fov: 36 }}>
      <ambientLight intensity={1.8} /><directionalLight position={[3, 5, 4]} intensity={3} />
      <Bounds fit clip observe margin={1.22} maxDuration={0.35}>
        <PreviewCameraFrame frameKey={frameKey} fitRequest={fitRequest} zoom={zoom} />
        <Center cacheKey={frameKey}><group rotation={[0, Number(obstacle.rotation_deg) * Math.PI / 180, 0]}><ParametricFixture obstacle={obstacle} width={width / largest} depth={depth / largest} height={height / largest} /></group></Center>
      </Bounds>
      <OrbitControls makeDefault enablePan={false} enableZoom={false} />
    </StableCanvas>
    {appearanceControls && <div className="fixture-preview-zoom-controls" aria-label="Preview zoom controls">
      <input className="fixture-preview-zoom-slider" type="range" min={PREVIEW_ZOOM_MIN} max={PREVIEW_ZOOM_MAX} step="0.05" value={zoom} aria-label="Preview zoom" onChange={(event) => updateZoom(Number(event.target.value))} />
      <button type="button" className="fixture-preview-fit-button" onClick={() => { updateZoom(1); setFitRequest(value => value + 1); }}>Fit</button>
    </div>}
    {compact && <span className="fixture-preview-hint" aria-hidden>{isExpanded ? "Click to collapse" : "Click to enlarge"}</span>}
  </div>;
}
