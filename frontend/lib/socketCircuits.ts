import { createElectricalConnection, type ElectricalCircuit, type ElectricalConnection, type ElectricalLayoutData } from "./electricalLayout";

type Device = { id: string; representation_key?: string | null };
export const isSocket = (device: Device) => Boolean(device.representation_key?.startsWith("electrical-socket-"));
export const isConsumerUnit = (device: Device) => Boolean(device.representation_key?.startsWith("electrical-board-"));
export interface SocketTest {
  socketId: string; circuitId: string | null; connected: boolean; passed: boolean; message: string;
}

/** Construct actual POWER edges, including the return to the board for rings. */
export function buildSocketCircuit(circuit: ElectricalCircuit, devices: readonly Device[], existing: readonly ElectricalConnection[]): ElectricalConnection[] {
  const board = devices.find(d => d.id === circuit.consumerUnitId && isConsumerUnit(d));
  const ids = circuit.socketIds ?? [];
  if (!board) throw new Error("Choose a consumer unit on this floor.");
  if (!circuit.socketTopology) throw new Error("Choose radial or ring.");
  if (!ids.length || (circuit.socketTopology === "RING" && ids.length < 2)) throw new Error("Select at least one socket for a radial, or two for a ring.");
  if (new Set(ids).size !== ids.length || ids.some(id => !devices.some(d => d.id === id && isSocket(d)))) throw new Error("Review the selected sockets; a fitting is missing or repeated.");
  if (existing.some(c => c.circuitId !== circuit.id && c.type === "POWER" && ids.some(id => c.fromId === id || c.toId === id))) throw new Error("A selected socket is already linked to another power circuit.");
  const retained = existing.filter(c => c.circuitId !== circuit.id || c.type !== "POWER");
  const path = [board.id, ...ids, ...(circuit.socketTopology === "RING" ? [board.id] : [])];
  const result = [...retained];
  for (let i = 1; i < path.length; i++) {
    const edge = createElectricalConnection({ fromId: path[i - 1], toId: path[i], circuitId: circuit.id, type: "POWER", color: circuit.color, colorOverride: false }, result);
    if (!edge) throw new Error("Could not create a socket connection.");
    result.push(edge);
  }
  return result;
}

/** Schematic connectivity only. No assumption of real terminal wiring or safety. */
export function testSocketCircuits(layout: ElectricalLayoutData, devices: readonly Device[]): SocketTest[] {
  return devices.filter(isSocket).map(socket => {
    const circuits = layout.circuits.filter(c => c.socketIds?.includes(socket.id) || layout.connections.some(e => e.type === "POWER" && e.circuitId === c.id && [e.fromId, e.toId].includes(socket.id)));
    const base = { socketId: socket.id, circuitId: circuits[0]?.id ?? null, connected: false, passed: false };
    if (circuits.length !== 1) return { ...base, message: circuits.length ? "Linked to multiple power circuits" : "Not assigned to a socket circuit" };
    const circuit = circuits[0], board = devices.find(d => d.id === circuit.consumerUnitId && isConsumerUnit(d));
    if (!board || !circuit.socketTopology) return { ...base, message: "Choose a circuit type and consumer unit" };
    const members = circuit.socketIds ?? [];
    const allowed = new Set([board.id, ...members]);
    const graph = new Map([...allowed].map(id => [id, new Set<string>()]));
    const pairs = new Set<string>();
    let invalid = !members.includes(socket.id) || members.some(id => !devices.some(d => d.id === id && isSocket(d)));
    const powerIds = new Set(layout.connections.filter(e => e.circuitId === circuit.id && e.type === "POWER").map(e => e.id));
    const powerJunction = layout.junctions?.some(j => j.connectionIds.filter(id => powerIds.has(id)).length > 1);
    if (powerJunction) invalid = true;
    for (const edge of layout.connections.filter(e => e.circuitId === circuit.id && e.type === "POWER")) {
      if (!allowed.has(edge.fromId) || !allowed.has(edge.toId) || edge.fromId === edge.toId) { invalid = true; continue; }
      const pair = JSON.stringify([edge.fromId, edge.toId].sort());
      if (pairs.has(pair)) { invalid = true; continue; }
      pairs.add(pair); graph.get(edge.fromId)!.add(edge.toId); graph.get(edge.toId)!.add(edge.fromId);
    }
    const reached = new Set([board.id]), queue = [board.id];
    for (let i = 0; i < queue.length; i++) for (const next of graph.get(queue[i]) ?? []) if (!reached.has(next)) { reached.add(next); queue.push(next); }
    const connected = reached.has(socket.id);
    if (!connected) return { ...base, message: "No power path to the selected consumer unit" };
    const allConnected = reached.size === allowed.size;
    const topologyOK = circuit.socketTopology === "RING"
      ? members.length >= 2 && [...graph.values()].every(edges => edges.size === 2) && pairs.size === allowed.size
      : members.length > 0 && pairs.size === allowed.size - 1;
    // Shared sockets on another circuit are a conflict even for their neighbours.
    const shared = members.some(id => layout.circuits.some(c => c.id !== circuit.id && c.socketIds?.includes(id)) || layout.connections.some(e => e.circuitId !== circuit.id && e.type === "POWER" && [e.fromId, e.toId].includes(id)));
    const passed = allConnected && topologyOK && !invalid && !shared;
    return { ...base, connected, passed, message: passed ? `${circuit.socketTopology === "RING" ? "Closed ring" : "Radial"} connected to consumer unit` : shared ? "Socket shared with another circuit" : powerJunction ? "Review power junctions; define branches with explicit fitting connections" : circuit.socketTopology === "RING" ? "Ring incomplete or branched; review connections" : "Radial has missing, cyclic or unexpected connections" };
  });
}
