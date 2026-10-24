"use client";

import { useState, type ReactNode } from "react";
import type { CFDObject } from "@/lib/climoptix";
import type { CFDScenario } from "@/lib/climoptixDocument";
import { DEFAULT_OBJECT_GROUP, deleteObjectEntry, duplicateObjectEntry, moveObject, objectEntries, objectGroups, objectMembers, type CFDObjectEntry } from "@/lib/climoptixObjectGroups";
import { uniqueGroupName } from "@/lib/climoptixGroups";
import { insertAtBoundary } from "@/lib/climoptixStudies";
import { CFDReorderList } from "./CFDReorderList";
import { CFDEditorWindow } from "./CFDEditorWindow";

export function ClimoptixObjects({ scenario, objects, selected, onSelect, onChange, onAdd, onPick, onEditVent, onEditSource, renderObject, canAdd, checked }: {
  scenario: CFDScenario; objects: CFDObject[]; selected: string | null; onSelect: (id: string) => void; onChange: (scenario: CFDScenario) => void;
  onAdd: (role: "supply" | "extract", group: string) => void; onPick: () => void; onEditVent?: (id: string) => void;
  onEditSource: () => void; renderObject: (id: string) => ReactNode; canAdd: boolean; checked: boolean;
}) {
  const groups = objectGroups(scenario), entries = objectEntries(scenario, objects);
  const [selectedGroup, setSelectedGroup] = useState(DEFAULT_OBJECT_GROUP);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [editing, setEditing] = useState<{ type: "object" | "group"; id: string } | null>(null);
  const [error, setError] = useState("");
  const currentGroup = groups.find(g => g.id === selectedGroup) ?? groups[0];
  const edit = (entry: CFDObjectEntry) => {
    onSelect(entry.type === "vent" ? `vent:${entry.sourceId}` : entry.sourceId);
    if (entry.type === "vent") onEditVent?.(entry.sourceId); else setEditing({ type: "object", id: entry.sourceId });
  };
  const duplicate = (entry: CFDObjectEntry, groupId: string) => {
    const copy = duplicateObjectEntry(scenario, entry, objects);
    if (!copy) { setError("This object has no measured copy adapter, or the simulation has reached its object limit."); return; }
    const nextGroups = objectGroups(copy.scenario).map(g => g.id === groupId ? { ...g, memberIds: [...g.memberIds, copy.id] } : g);
    onChange({ ...copy.scenario, objectGroups: nextGroups });
    edit({ ...entry, id: copy.id, sourceId: copy.id.slice(copy.id.indexOf(":") + 1) });
  };
  const editingGroup = groups.find(g => editing?.type === "group" && g.id === editing.id);
  return <div className="cfx-objects">
    <header className="cfx-inline-toolbar"><h3>Objects &amp; occupants</h3><button onClick={onEditSource}>Edit source building &amp; assets</button></header>
    <div className="cfx-inline-toolbar">
      <button disabled={!canAdd} onClick={() => onAdd("supply", currentGroup.id)}>+ Supply</button>
      <button disabled={!canAdd} onClick={() => onAdd("extract", currentGroup.id)}>+ Extract</button>
      <button disabled={!canAdd} onClick={onPick}>Place on face…</button>
      <button disabled={groups.length >= 100} onClick={() => {
        const group = { id: crypto.randomUUID(), name: uniqueGroupName(groups.map(g => g.name)), memberIds: [] };
        onChange({ ...scenario, objectGroups: [...groups, group] }); setSelectedGroup(group.id);
      }}>Add object group</button>
    </div>
    {error && <p className="cfx-error" role="alert">{error}<button onClick={() => setError("")}>Dismiss</button></p>}
    <div className="cfx-group-tree">
      <CFDReorderList items={groups} label="Object groups" scope={`object-groups:${scenario.id}`} onMove={(id, at) => onChange({ ...scenario, objectGroups: insertAtBoundary(groups, id, at) })}>
        {group => {
          const members = objectMembers(group, groups, entries);
          return <section className={`cfx-study-group${currentGroup.id === group.id ? " selected-group" : ""}`} aria-label={`Object group ${group.name}`} onClickCapture={() => setSelectedGroup(group.id)}>
            <CFDReorderList items={members} label={`${group.name} objects`} scope={`objects:${scenario.id}`} collapsed={collapsed.has(group.id)}
              onMove={(id, at) => { onChange(moveObject(scenario, id, group.id, at, objects)); setSelectedGroup(group.id); }}
              header={<header className="cfx-group-heading">
                <button className="cfx-collapse" aria-label={`${collapsed.has(group.id) ? "Expand" : "Collapse"} object group ${group.name}`} aria-expanded={!collapsed.has(group.id)} onClick={() => setCollapsed(previous => {
                  const next = new Set(previous); if (next.has(group.id)) next.delete(group.id); else next.add(group.id); return next;
                })}>{collapsed.has(group.id) ? "▸" : "▾"}</button>
                <button className="cfx-group-select" aria-pressed={currentGroup.id === group.id} onClick={() => setSelectedGroup(group.id)}>{group.name}</button><small>{members.length} objects</small>
                <div className="cfx-group-actions">
                  <button aria-label={`Edit object group ${group.name}`} onClick={() => setEditing({ type: "group", id: group.id })}>Edit</button>
                  <button disabled={groups.length >= 100 || members.some(e => e.type === "object" && objects.find(o => o.id === e.sourceId)?.roomId === "unresolved")}
                    aria-label={`Duplicate object group ${group.name}`} onClick={() => {
                      const copy = { id: crypto.randomUUID(), name: uniqueGroupName(groups.map(g => g.name), group.name.slice(0, 70) + " copy"), memberIds: [] as string[] };
                      let next = scenario;
                      for (const entry of members) {
                        const result = duplicateObjectEntry(next, entry, objects);
                        if (!result) { setError("The whole group could not be copied within the measured-object limits. Nothing was changed."); return; }
                        next = result.scenario; copy.memberIds.push(result.id);
                      }
                      onChange({ ...next, objectGroups: [...groups, copy] }); setSelectedGroup(copy.id);
                    }}>Duplicate</button>
                  <button className="cfx-danger" disabled={group.id === DEFAULT_OBJECT_GROUP} aria-label={`Delete object group ${group.name}`} title="Keep the objects in General" onClick={() => {
                    onChange({ ...scenario, objectGroups: groups.filter(g => g.id !== group.id) }); setSelectedGroup(DEFAULT_OBJECT_GROUP);
                  }}>Delete</button>
                </div>
              </header>}>
              {entry => <article className={`cfx-device-row${selected === (entry.type === "vent" ? entry.id : entry.sourceId) ? " selected" : ""}`}>
                <button className="cfx-device-name" aria-label={`Select ${entry.name}`} onClick={() => onSelect(entry.type === "vent" ? entry.id : entry.sourceId)}><strong>{entry.name}</strong><small>{entry.detail}</small></button>
                <div className="cfx-device-actions">
                  <button aria-label={`Edit ${entry.name}`} onClick={() => edit(entry)}>Edit</button>
                  <button aria-label={`Duplicate ${entry.name}`} disabled={entry.type === "object" && objects.find(o => o.id === entry.sourceId)?.roomId === "unresolved"} onClick={() => duplicate(entry, group.id)}>Duplicate</button>
                  <button className="cfx-danger" aria-label={`Delete ${entry.name}`} onClick={() => { onChange(deleteObjectEntry(scenario, entry)); if (editing?.id === entry.sourceId) setEditing(null); }}>Delete</button>
                </div>
                <details className="cfx-row-menu"><summary aria-label={`Move ${entry.name}`}>⋯</summary><div><label>Move to group<select aria-label={`Move ${entry.name} to group`} value={group.id} onChange={e => {
                  const target = groups.find(g => g.id === e.target.value)!;
                  onChange(moveObject(scenario, entry.id, target.id, objectMembers(target, groups, entries).length, objects));
                  setSelectedGroup(target.id); e.currentTarget.closest("details")!.open = false;
                }}>{groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label></div></details>
              </article>}
            </CFDReorderList>
          </section>;
        }}
      </CFDReorderList>
    </div>
    {!!scenario.hiddenObjectIds?.length && <details><summary>Removed from this simulation ({scenario.hiddenObjectIds.length})</summary>
      {scenario.hiddenObjectIds.map(id => <button key={id} onClick={() => onChange({ ...scenario, hiddenObjectIds: scenario.hiddenObjectIds!.filter(value => value !== id) })}>Restore {objects.find(o => o.id === id)?.name ?? id}</button>)}
    </details>}
    {checked && (scenario.assetOverrides.some(o => !objects.some(obj => obj.id === o.objectId)) || scenario.objectCopies?.some(o => !objects.some(obj => obj.id === o.id))) &&
      <details><summary>Unavailable object inputs</summary>
        {scenario.objectCopies?.filter(o => !objects.some(obj => obj.id === o.id)).map(copy => <button key={copy.id} onClick={() => onChange(deleteObjectEntry(scenario, { id: `object:${copy.id}`, sourceId: copy.id, name: copy.name, type: "object", detail: "" }))}>Delete unavailable copy · {copy.name}</button>)}
        {scenario.assetOverrides.filter(o => !objects.some(obj => obj.id === o.objectId)).map(override => <button key={override.objectId} onClick={() => onChange({ ...scenario, assetOverrides: scenario.assetOverrides.filter(o => o.objectId !== override.objectId) })}>Remove override · {override.objectId}</button>)}
      </details>}
    {editing?.type === "object" && <CFDEditorWindow title="Edit CFD object" defaultPosition={{ x: 250, y: 100 }} initialSize={{ width: 620, height: 640 }} maxHeight={850} bringToFront onClose={() => setEditing(null)}
      helpSteps={[{ heading: "Simulation-only objects", text: "Treatments, copies and Delete affect this simulation only. Source furniture and the measured building remain unchanged. Copies reuse measured source dimensions, with separate millimetre offsets; use Offset mm to position them. Preparation reports overlaps and out-of-domain objects. Count multiplies emissions, not geometry. Groups are only organization metadata. Undo restores changes." }]}>
      {renderObject(editing.id)}
    </CFDEditorWindow>}
    {editingGroup && <CFDEditorWindow title="Edit object group" defaultPosition={{ x: 240, y: 100 }} initialSize={{ width: 420 }} onClose={() => setEditing(null)} bringToFront>
      <label>Group name<input key={`${editingGroup.id}:${editingGroup.name}`} aria-label="Object group name" defaultValue={editingGroup.name} maxLength={80} onBlur={event => {
        const name = event.target.value.trim();
        if (!name || groups.some(g => g.id !== editingGroup.id && g.name.toLowerCase() === name.toLowerCase())) { setError("Choose a unique, non-empty object group name."); event.target.value = editingGroup.name; return; }
        onChange({ ...scenario, objectGroups: groups.map(g => g.id === editingGroup.id ? { ...g, name } : g) });
      }} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} /></label>
    </CFDEditorWindow>}
  </div>;
}
