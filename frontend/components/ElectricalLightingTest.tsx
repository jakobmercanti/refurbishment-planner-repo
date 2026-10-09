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
    <p>Two switches connected to the same light model two SPDT contacts: with straight travellers, A/A and B/B are On; A/B and B/A are Off. Either switch changes the light. A double-gang fitting is two independent controls, not a two-way pair.</p>
    <p className="electrical-layout-hint">For double/triple/quadruple switches, assign the gang in each connection’s edit panel. Dimmer testing is on/off only. Generic and Control links represent lighting control; Power links do not.</p>
    {layout.circuits.map(circuit => <section key={circuit.id}><h3>{circuit.name}</h3><div className="electrical-layout-display">{switches.flatMap(item => Array.from({ length: switchGangCount(item.representation_key) }, (_, index) => {
      const key = switchTestKey(circuit.id, item.id, index + 1), linked = result.groups.filter(group => group.switchKeys.includes(key));
      if (!linked.length) return [];
      return <button type="button" className="review-style-button" key={key} aria-pressed={Boolean(positions[key] ?? result.contacts[key])} onClick={() => onToggle(key)}>{item.name}{switchGangCount(item.representation_key) > 1 ? ` · Gang ${index + 1}` : ""} · Position {(positions[key] ?? result.contacts[key]) ? "B" : "A"} · {linked.some(g => g.on) ? "On" : "Off"}</button>;
    }))}</div>{result.groups.filter(group => group.circuitId === circuit.id && group.switchKeys.length === 2).map(group => <svg key={group.id} viewBox="0 0 340 100" role="img" aria-label={`Two-way contact demonstration: ${group.on ? "On" : "Off"}`} style={{ width: "100%", maxWidth: 340 }}><text x="8" y="16" fill="currentColor">Logical two-way contact demonstration</text><path d="M90,40H250M90,75H250" stroke="#64748b" strokeWidth="3" /><path d={`M40,57L90,${result.contacts[group.switchKeys[0]] ? 75 : 40}M250,${result.contacts[group.switchKeys[1]] ? 75 : 40}L300,57`} stroke={group.on ? "#ca8a04" : "#64748b"} strokeWidth="4" /><circle cx="320" cy="57" r="12" fill={group.on ? "#facc15" : "#d1d5db"} /><text x="30" y="96" fill="currentColor">Switch 1</text><text x="245" y="96" fill="currentColor">Switch 2</text></svg>)}{result.groups.filter(group => group.circuitId === circuit.id).map(group => <p key={group.id}>{group.lightIds.map(id => fixtures.find(item => item.id === id)?.name).join(", ")}: <strong>{group.on ? "On" : "Off"}</strong> · {group.switchKeys.length === 2 ? "Two-way control" : `${group.switchKeys.length} control(s)`}</p>)}</section>)}
    <p role="status">{Object.values(result.lights).filter(Boolean).length} of {Object.keys(result.lights).length} lights on.</p>
    {result.warnings.length > 0 && <section><h3>Review feedback</h3><ul>{result.warnings.map(message => <li key={message}>{message}</li>)}</ul></section>}
    <button type="button" className="review-style-button" onClick={onReset}>Reset test — all lights off</button>
    <p><strong>Schematic simulation only.</strong> This does not verify wiring terminals, protective devices, cable sizes, supply continuity or electrical safety. Have the installation checked by a qualified electrician.</p>
  </div>;
}
