/** Image placement in millimetres; never changes the measured building geometry. */
export function orthogonalCalibrationPoint(
  start: { x: number; y: number },
  requested: { x: number; y: number },
) {
  return Math.abs(requested.x - start.x) >= Math.abs(requested.y - start.y)
    ? { x: requested.x, y: start.y }
    : { x: start.x, y: requested.y };
}

export function calibratedDrawingSize(
  size: { width: number; height: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
  lengthMm: number,
) {
  const measured = Math.hypot(end.x - start.x, end.y - start.y);
  if (![size.width, size.height, start.x, start.y, end.x, end.y, lengthMm, measured].every(Number.isFinite)
    || size.width <= 0 || size.height <= 0 || lengthMm <= 0 || measured < .001) return null;
  const factor = lengthMm / measured;
  const width = size.width * factor;
  const height = size.height * factor;
  return Number.isFinite(width) && Number.isFinite(height) ? { width, height } : null;
}
