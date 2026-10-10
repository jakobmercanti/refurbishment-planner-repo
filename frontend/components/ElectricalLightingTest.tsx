"use client";
import type { ElectricalLayoutData } from "@/lib/electricalLayout";
import { switchGangCount, switchTestKey, type LightingTestResult } from "@/lib/electricalSimulation";
import type { Obstacle } from "@/lib/types";

export function ElectricalLightingTest({ layout, fixtures, result, positions, onToggle, onReset }: {
  layout: ElectricalLayoutData; fixtures: Obstacle[]; result: LightingTestResult; positions: Record<string, boolean>;
  onToggle: (key: string) => void; onReset: () => void;
}) {
  const switches = fixtures.filter(item => switchGangCount(item.representation_key));
  const name = (id: string) => fixtures.find(item => item.id === id)?.name ?? "Missing fitting";
  return <div className="electrical-layout-panel electrical-test-panel" role="region" aria-label="Lighting layout test">
    <div className="electrical-test-summary"><strong role="status">{Object.values(result.lights).filter(Boolean).length} / {Object.keys(result.lights).length} lights on</strong><button type="button" className="review-style-button" onClick={onReset}>Reset test</button></div>
    <p className="electrical-layout-hint">Click an individual rocker on the plan, or use its control below. Test positions are temporary.</p>
    {layout.circuits.map(circuit => {
      const groups = result.groups.filter(group => group.circuitId === circuit.id);
      const linkedSwitches = switches.filter(item => layout.connections.some(link => link.circuitId === circuit.id && [link.fromId, link.toId].includes(item.id)));
      const lightIds = [...new Set(groups.flatMap(group => group.lightIds))];
      return <details key={circuit.id} className="electrical-layout-section electrical-test-circuit" open={groups.length > 0}>
        <summary><span>{circuit.name}</span><small>{lightIds.filter(id => result.lights[id]).length}/{lightIds.length} lights on</small></summary>
        <div className="electrical-test-controls">{linkedSwitches.map(item => <section key={item.id} className="electrical-test-fitting"><strong>{item.name}</strong><div className="electrical-test-gangs">{Array.from({ length: switchGangCount(item.representation_key) }, (_, index) => {
          const gang = index + 1, key = switchTestKey(circuit.id, item.id, gang), linked = groups.filter(group => group.switchKeys.includes(key));
          const on = linked.some(group => group.on), position = Boolean(positions[key] ?? result.contacts[key]);
          return <button type="button" className="review-style-button" key={key} disabled={!linked.length} aria-label={`${item.name} · Gang ${gang}`} aria-pressed={position} onClick={() => onToggle(key)}>
            <span>{switchGangCount(item.representation_key) > 1 ? `Gang ${gang}` : "Switch"} · {linked.length ? `Position ${position ? "B" : "A"}` : "Not connected"}</span>
            {linked.length > 0 && <strong className={on ? "electrical-test-on" : ""}>{on ? "On" : "Off"}</strong>}
          </button>;
        })}</div></section>)}</div>
        {lightIds.length > 0 ? <ul className="electrical-test-lights">{lightIds.map(id => <li key={id}><span>{name(id)}</span><strong className={result.lights[id] ? "electrical-test-on" : ""}>{result.lights[id] ? "On" : "Off"}</strong></li>)}</ul> : <p className="electrical-layout-hint">No supported connected lights yet.</p>}
        {groups.some(group => group.switchKeys.length === 2) && <details className="electrical-test-explanation"><summary>Two-way control details</summary>{groups.filter(group => group.switchKeys.length === 2).map(group => <div key={group.id}><p>{group.lightIds.map(name).join(", ")} — {group.on ? "On" : "Off"}</p><svg viewBox="0 0 340 100" role="img" aria-label={`Two-way contact demonstration: ${group.on ? "On" : "Off"}`}><path d="M90,30H250M90,65H250" stroke="#64748b" strokeWidth="3" /><path d={`M40,47L90,${result.contacts[group.switchKeys[0]] ? 65 : 30}M250,${result.contacts[group.switchKeys[1]] ? 65 : 30}L300,47`} stroke={group.on ? "#ca8a04" : "#64748b"} strokeWidth="4" /><circle cx="320" cy="47" r="12" fill={group.on ? "#facc15" : "#d1d5db"} /><text x="30" y="92" fill="currentColor">Switch 1</text><text x="245" y="92" fill="currentColor">Switch 2</text></svg></div>)}</details>}
      </details>;
    })}
    {result.warnings.length > 0 && <details className="electrical-layout-section"><summary>Review feedback ({result.warnings.length})</summary><ul>{result.warnings.map(message => <li key={message}>{message}</li>)}</ul></details>}
    <details className="electrical-layout-section"><summary>How to test your layout</summary><p>Each rocker of a double, triple or quadruple switch is independent. Select the rocker when connecting on the plan, or assign the gang in the connection editor. An unconnected gang cannot turn on a light.</p><p>Two switches connected to the same light model two SPDT contacts: A/A and B/B are On; A/B and B/A are Off. Either switch changes the light. A double-gang fitting is not automatically a two-way pair.</p><p>Dimmer testing is on/off only. Generic and Control links carry logical control; Power links do not. A crossing bridge is not a connection; a junction dot represents an explicit join.</p><p><strong>Schematic simulation only.</strong> This does not verify wiring terminals, protective devices, cable sizes, supply continuity or electrical safety. Have the installation checked by a qualified electrician.</p></details>
  </div>;
}
