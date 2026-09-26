import * as THREE from "three";

export type CameraFramingVector = [number, number, number];

/** Return a camera zoom that keeps every scene-bounds corner inside the current view. */
export function fitCameraZoomForBounds(
  camera: THREE.Camera,
  size: { width: number; height: number },
  center: CameraFramingVector,
  span: CameraFramingVector,
) {
  camera.updateMatrixWorld(true);
  const [cx, cy, cz] = center;
  const [spanX, spanY, spanZ] = span;
  const corners = [-1, 1].flatMap((xSign) => [-1, 1].flatMap((ySign) => [-1, 1].map((zSign) => new THREE.Vector3(
    cx + xSign * spanX / 2,
    cy + ySign * spanY / 2,
    cz + zSign * spanZ / 2,
  ))));
  const inverse = camera.matrixWorldInverse;
  const fitPadding = 0.96;

  if ((camera as THREE.OrthographicCamera).isOrthographicCamera) {
    const orthographic = camera as THREE.OrthographicCamera;
    const frustumHalfWidth = Math.abs(orthographic.right - orthographic.left) / 2;
    const frustumHalfHeight = Math.abs(orthographic.top - orthographic.bottom) / 2;
    const frustumCentreX = (orthographic.left + orthographic.right) / 2;
    const frustumCentreY = (orthographic.top + orthographic.bottom) / 2;
    let maxX = 0;
    let maxY = 0;
    corners.forEach((corner) => {
      const local = corner.applyMatrix4(inverse);
      maxX = Math.max(maxX, Math.abs(local.x - frustumCentreX));
      maxY = Math.max(maxY, Math.abs(local.y - frustumCentreY));
    });
    if (maxX <= 0 || maxY <= 0) return orthographic.zoom;
    return THREE.MathUtils.clamp(Math.min(frustumHalfWidth / maxX, frustumHalfHeight / maxY) * fitPadding, 0.0001, 1_000_000);
  }

  if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
    const perspective = camera as THREE.PerspectiveCamera;
    const aspect = perspective.aspect > 0 ? perspective.aspect : Math.max(size.width / Math.max(size.height, 1), 0.1);
    const verticalFov = THREE.MathUtils.degToRad(perspective.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect);
    const verticalTangent = Math.tan(verticalFov / 2);
    const horizontalTangent = Math.tan(horizontalFov / 2);
    let maxRatio = 0;
    let hasBehindPoint = false;
    corners.forEach((corner) => {
      const local = corner.applyMatrix4(inverse);
      const depth = -local.z;
      if (depth <= 0.001) {
        hasBehindPoint = true;
        return;
      }
      maxRatio = Math.max(maxRatio, Math.abs(local.x) / (depth * horizontalTangent), Math.abs(local.y) / (depth * verticalTangent));
    });
    if (hasBehindPoint) return 0.05;
    if (maxRatio <= 0) return perspective.zoom;
    return THREE.MathUtils.clamp(fitPadding / maxRatio, 0.05, 10);
  }

  return "zoom" in camera ? (camera as THREE.OrthographicCamera | THREE.PerspectiveCamera).zoom : 1;
}
