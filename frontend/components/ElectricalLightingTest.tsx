"use client";
import type { ElectricalLayoutData } from "@/lib/electricalLayout";
import { switchGangCount, switchTestKey, type LightingTestResult } from "@/lib/electricalSimulation";
import type { Obstacle } from "@/lib/types";

export function ElectricalLightingTest({ layout, fixtures, result, positions, onToggle, onReset }: {
  layout: ElectricalLayoutData; fixtures: Obstacle[]; result: LightingTestResult; positions: Record<string, boolean>;
  onToggle: (key: string) => void; onReset: () => void;
}) {
  const switches = fixtures.filter(item => switchGangCount(item.representation_key));
  return <div className="electrical-layout-panel" role="region" aria-label="Lighting layout test">
    <p>Click a switch on the plan or use the controls below. Lights show <strong>On</strong> / <strong>Off</strong>. Test positions are temporary and do not change your layout.</p>
    <p>Two switches connected to the same light form a two-way logical control: either switch changes the light, regardless of the other switch’s position. Connected lamp groups share that control.</p>
    <p className="electrical-layout-hint">For double/triple/quadruple switches, assign the gang in each connection’s edit panel. Dimmer testing is on/off only. Generic and Control links represent lighting control; Power links do not.</p>
    {layout.circuits.map(circuit => <section key={circuit.id}><h3>{circuit.name}</h3><div className="electrical-layout-display">{switches.flatMap(item => Array.from({ length: switchGangCount(item.representation_key) }, (_, index) => {
      const key = switchTestKey(circuit.id, item.id, index + 1), linked = result.groups.filter(group => group.switchKeys.includes(key));
      if (!linked.length) return [];
      return <button type="button" className="review-style-button" key={key} aria-pressed={Boolean(positions[key])} onClick={() => onToggle(key)}>{item.name}{switchGangCount(item.representation_key) > 1 ? ` · Gang ${index + 1}` : ""} · Position {positions[key] ? "B" : "A"}</button>;
    }))}</div>{result.groups.filter(group => group.circuitId === circuit.id).map(group => <p key={group.id}>{group.lightIds.map(id => fixtures.find(item => item.id === id)?.name).join(", ")}: <strong>{group.on ? "On" : "Off"}</strong> · {group.switchKeys.length === 2 ? "Two-way control" : `${group.switchKeys.length} control(s)`}</p>)}</section>)}
    <p role="status">{Object.values(result.lights).filter(Boolean).length} of {Object.keys(result.lights).length} lights on.</p>
    {result.warnings.length > 0 && <section><h3>Review feedback</h3><ul>{result.warnings.map(message => <li key={message}>{message}</li>)}</ul></section>}
    <button type="button" className="review-style-button" onClick={onReset}>Reset test — all lights off</button>
    <p><strong>Schematic simulation only.</strong> This does not verify wiring terminals, protective devices, cable sizes, supply continuity or electrical safety. Have the installation checked by a qualified electrician.</p>
  </div>;
}
