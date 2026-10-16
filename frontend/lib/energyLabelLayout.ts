import type { Point2D } from './types';

export type EnergyLabelBox = { x: number; y: number; width: number; height: number };
export type EnergyLabelRequest = { id: string; roomId: string; width: number; height: number; category: 'wall' | 'floor' | 'roof'; start?: Point2D; end?: Point2D; preferred?: Point2D };
export type LabelRoom = { id: string; polygon: Point2D[]; titleBox?: EnergyLabelBox };
export function labelBoxesOverlap(a: EnergyLabelBox, b: EnergyLabelBox, gap = 6) {
  return Math.abs(a.x - b.x) < (a.width + b.width) / 2 + gap && Math.abs(a.y - b.y) < (a.height + b.height) / 2 + gap;
}
function inside(p: Point2D, polygon: Point2D[]) {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) result = !result;
  }
  return result;
}
function fits(box: EnergyLabelBox, polygon: Point2D[]) {
  return [-1, 0, 1].every(x => [-1, 0, 1].every(y => inside({ x: box.x + x * (box.width / 2 + 8), y: box.y + y * (box.height / 2 + 8) }, polygon)));
}
/** Screen-space presentation only. Hidden labels retain their selectable geometry/tooltip.
 * No layout result is used by the authoritative thermal or geometry calculations. */
export function layoutEnergyLabels(rooms: LabelRoom[], requests: EnergyLabelRequest[]): Record<string, EnergyLabelBox | undefined> {
  const occupied: EnergyLabelBox[] = rooms.filter(r => r.polygon.length).map(r => {
    const center = r.polygon.reduce((p, v) => ({ x: p.x + v.x / r.polygon.length, y: p.y + v.y / r.polygon.length }), { x: 0, y: 0 });
    return r.titleBox ?? { ...center, width: 100, height: 24 }; // reserve the actual room title, including dragged titles
  });
  const result: Record<string, EnergyLabelBox | undefined> = {};
  // User positions first, then surface cards, then wall labels. Stable tie-breaks avoid jitter.
  const priority = (r: EnergyLabelRequest) => r.preferred ? 0 : r.category === 'wall' ? 2 : 1;
  for (const r of [...requests].sort((a, b) => priority(a) - priority(b) || a.id.localeCompare(b.id))) {
    const polygon = rooms.find(room => room.id === r.roomId)?.polygon;
    if (!polygon?.length) continue;
    if (r.preferred) {
      // Collision avoidance is only an automatic-placement aid. A user's anchor
      // wins, including over room titles, other labels and outside the room.
      const box = { ...r.preferred, width: r.width, height: r.height };
      result[r.id] = box; occupied.push(box); continue;
    }
    const candidates: Point2D[] = [];
    const minX = Math.min(...polygon.map(p => p.x)), maxX = Math.max(...polygon.map(p => p.x));
    const minY = Math.min(...polygon.map(p => p.y)), maxY = Math.max(...polygon.map(p => p.y));
    if (r.category === 'wall' && r.start && r.end) {
      const dx = r.end.x - r.start.x, dy = r.end.y - r.start.y, length = Math.hypot(dx, dy);
      if (length > 0) {
        for (const offset of [18, 34, 52, 72]) for (const t of [.5, .3, .7, .15, .85]) for (const side of [1, -1]) {
          const support = (Math.abs(dy) * r.width + Math.abs(dx) * r.height) / (2 * length);
          candidates.push({ x: r.start.x + dx * t - dy / length * (offset + support) * side, y: r.start.y + dy * t + dx / length * (offset + support) * side });
        }
      }
    } else {
      const title = rooms.find(room => room.id === r.roomId)?.titleBox;
      const center = title ?? { x: (minX + maxX) / 2, y: (minY + maxY) / 2, height: 24 };
      candidates.push({ x: center.x, y: center.y + (r.category === 'roof' ? -1 : 1) * (center.height / 2 + r.height / 2 + 8) });
      const edgeY = r.category === 'roof' ? minY + r.height / 2 + 12 : maxY - r.height / 2 - 12;
      for (const x of [.5, .25, .75]) candidates.push({ x: minX + (maxX - minX) * x, y: edgeY });
      const ys = r.category === 'roof' ? [.25, .15, .35, .65, .75, .85] : [.75, .85, .65, .35, .25, .15];
      for (const y of ys) for (const x of [.5, .25, .75, .15, .85, .35, .65]) candidates.push({ x: minX + (maxX - minX) * x, y: minY + (maxY - minY) * y });
    }
    for (const scale of r.category === "wall" ? [1] : [1, .8, .6, .4]) {
    for (let i = 0; i < candidates.length; i++) {
      const box = { ...candidates[i], width: r.width * scale, height: r.height * scale };
      if (fits(box, polygon) && !occupied.some(other => labelBoxesOverlap(box, other))) {
        result[r.id] = box; occupied.push(box); break;
      }
    }
    if (result[r.id]) break;
    }
  }
  return result;
}

/** Automatic labels first, user-positioned labels above them, newest move on top. */
export function energyLabelPaintOrder(ids: string[], positions: Record<string, Point2D> = {}, activeId?: string) {
  const ranks = new Map(Object.keys(positions).map((id, i) => [id, i + 1]));
  const rank = (id: string) => id === activeId ? Infinity : ranks.get(id) ?? 0;
  return [...ids].sort((a, b) => rank(a) - rank(b));
}

/** Invert the renderer's affine transform, including flipped/rotated plan views. */
export function screenLabelToWorld(p: Point2D, toScreen: (p: Point2D) => Point2D): Point2D {
  const o = toScreen({ x: 0, y: 0 }), a = toScreen({ x: 1, y: 0 }), b = toScreen({ x: 0, y: 1 });
  const ax = a.x - o.x, ay = a.y - o.y, bx = b.x - o.x, by = b.y - o.y, det = ax * by - ay * bx;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) throw new Error('Cannot move labels in a zero-scale view.');
  return { x: ((p.x - o.x) * by - (p.y - o.y) * bx) / det, y: (ax * (p.y - o.y) - ay * (p.x - o.x)) / det };
}
