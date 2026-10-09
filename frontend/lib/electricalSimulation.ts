import type { ElectricalLayoutData } from "./electricalLayout";
import type { Obstacle } from "./types";

export function switchGangCount(key?: string | null): number {
  if (!key?.startsWith("electrical-switch-")) return 0;
  if (key.endsWith("quadruple")) return 4;
  if (key.endsWith("triple")) return 3;
  if (key.endsWith("double")) return 2;
  return 1;
}
export function isLightingFixture(key?: string | null): boolean {
  return Boolean(key && /^(electrical-ceiling-|electrical-pendant-|electrical-wall-)/.test(key));
}
export const switchTestKey = (circuitId: string, fixtureId: string, gang = 1) => JSON.stringify([circuitId, fixtureId, gang]);
export interface LightingTestGroup { id: string; circuitId: string; switchKeys: string[]; lightIds: string[]; on: boolean }
export interface LightingTestResult { groups: LightingTestGroup[]; lights: Record<string, boolean>; warnings: string[] }

/** Logical control networks, not electrical continuity, terminal wiring or safety validation.
 * Each gang is a separate control. Toggling any controller in a shared network flips
 * the lamps (two-way / multi-location parity); directions and duplicate edges do not matter.
 * POWER relationships are intentionally not interpreted as switch controls.
 */
export function simulateLighting(layout: ElectricalLayoutData, fixtures: readonly Obstacle[], positions: Readonly<Record<string, boolean>>): LightingTestResult {
  const devices = new Map(fixtures.map(item => [item.id, item]));
  const groups: LightingTestGroup[] = [], warnings: string[] = [];
  const lights: Record<string, boolean> = Object.fromEntries(fixtures.filter(item => isLightingFixture(item.representation_key)).map(item => [item.id, false]));
  const controlled = new Set<string>();
  for (const circuit of layout.circuits) {
    const graph = new Map<string, Set<string>>(), nodes = new Map<string, { id: string; isSwitch: boolean }>();
    for (const connection of layout.connections) {
      if (connection.circuitId !== circuit.id || connection.type === "POWER") continue;
      const from = devices.get(connection.fromId), to = devices.get(connection.toId);
      if (!from || !to) { warnings.push(`${circuit.name}: a connection refers to a missing fitting.`); continue; }
      // Do not conduct control logic through sockets, alarms, fans or other unrelated loads.
      if (![from, to].every(item => switchGangCount(item.representation_key) || isLightingFixture(item.representation_key))) continue;
      const endpoint = (item: Obstacle, gang: number | undefined) => {
        const count = switchGangCount(item.representation_key), selectedGang = gang ?? 1;
        if (count && selectedGang > count) { warnings.push(`${item.name}: gang ${selectedGang} is unavailable; edit this connection.`); return null; }
        const key = count ? switchTestKey(circuit.id, item.id, selectedGang) : JSON.stringify([circuit.id, item.id, 0]);
        nodes.set(key, { id: item.id, isSwitch: Boolean(count) });
        if (!graph.has(key)) graph.set(key, new Set());
        return key;
      };
      const a = endpoint(from, connection.fromSwitchGang), b = endpoint(to, connection.toSwitchGang);
      if (a && b) { graph.get(a)!.add(b); graph.get(b)!.add(a); }
    }
    const visited = new Set<string>();
    for (const root of graph.keys()) {
      if (visited.has(root)) continue;
      const queue = [root], switchKeys: string[] = [], lightIds: string[] = [];
      visited.add(root);
      for (let cursor = 0; cursor < queue.length; cursor++) {
        const key = queue[cursor], node = nodes.get(key)!;
        if (node.isSwitch) switchKeys.push(key); else lightIds.push(node.id);
        for (const neighbour of graph.get(key)!) if (!visited.has(neighbour)) { visited.add(neighbour); queue.push(neighbour); }
      }
      if (!lightIds.length) { warnings.push(`${circuit.name}: a switch group has no connected light.`); continue; }
      if (!switchKeys.length) continue;
      const on = switchKeys.reduce((state, key) => state !== Boolean(positions[key]), false);
      groups.push({ id: root, circuitId: circuit.id, switchKeys, lightIds, on });
      for (const id of lightIds) {
        if (controlled.has(id)) warnings.push(`${devices.get(id)!.name}: controlled from multiple circuits; review the schematic.`);
        controlled.add(id); lights[id] ||= on;
      }
    }
  }
  for (const id of Object.keys(lights)) if (!controlled.has(id)) warnings.push(`${devices.get(id)!.name}: no supported switch control; connect it using Generic or Control.`);
  if (!Object.keys(lights).length) warnings.push("Add a lighting fitting to test the layout.");
  return { groups, lights, warnings: [...new Set(warnings)] };
}
