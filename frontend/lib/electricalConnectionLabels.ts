import type { ElectricalConnection } from "./electricalLayout";
import { isLightingFixture, switchGangCount } from "./electricalSimulation";

export interface ElectricalNamedFitting { id: string; label: string; representation_key?: string | null }

/** UI references only; never change stored identities, geometry or circuit logic. */
export function electricalFittingReferences(fittings: readonly { id: string; representation_key?: string | null }[]): Record<string, string> {
  let switches = 0, lights = 0;
  return Object.fromEntries([...fittings].sort((a, b) => a.id.localeCompare(b.id)).flatMap(fitting => switchGangCount(fitting.representation_key)
    ? [[fitting.id, `S${++switches}`]] : isLightingFixture(fitting.representation_key) ? [[fitting.id, `L${++lights}`]] : []));
}

export function electricalEndpointLabel(connection: ElectricalConnection, endpoint: "from" | "to", fittings: readonly ElectricalNamedFitting[], references = electricalFittingReferences(fittings)): string {
  const fitting = fittings.find(item => item.id === (endpoint === "from" ? connection.fromId : connection.toId));
  if (!fitting) return "Missing fitting";
  const reference = references[fitting.id];
  const gang = switchGangCount(fitting.representation_key) > 1 ? ` · Gang ${connection[endpoint === "from" ? "fromSwitchGang" : "toSwitchGang"] ?? 1}` : "";
  return `${reference ? reference + " · " : ""}${fitting.label}${gang}`;
}

/** Both connection directions count, but only the explicitly assigned rocker. */
export function electricalGangConnections(connections: readonly ElectricalConnection[], fittingId: string, gang: number): { connection: ElectricalConnection; otherEndpoint: "from" | "to" }[] {
  return connections.flatMap<{ connection: ElectricalConnection; otherEndpoint: "from" | "to" }>(connection => connection.fromId === fittingId && (connection.fromSwitchGang ?? 1) === gang
    ? [{ connection, otherEndpoint: "to" as const }]
    : connection.toId === fittingId && (connection.toSwitchGang ?? 1) === gang ? [{ connection, otherEndpoint: "from" as const }] : []);
}
