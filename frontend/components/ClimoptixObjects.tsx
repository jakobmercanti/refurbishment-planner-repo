"use client";

import { useRef, useState, type ReactNode } from "react";
import type { CFDObject } from "@/lib/climoptix";
import type { CFDScenario } from "@/lib/climoptixDocument";
import { DEFAULT_OBJECT_GROUP, deleteObjectEntry, duplicateObjectEntry, moveObject, objectEntries, objectGroups, objectMembers, type CFDObjectEntry } from "@/lib/climoptixObjectGroups";
import { uniqueGroupName } from "@/lib/climoptixGroups";
import { insertAtBoundary } from "@/lib/climoptixStudies";
import { CFDReorderList } from "./CFDReorderList";
import { CFDRowMenu } from "./CFDRowMenu";
import { CFDEditorWindow } from "./CFDEditorWindow";
import { CFDConfirmAction } from "./CFDConfirmAction";
import { CFDCollapseAll } from "./CFDCollapseAll";
import { useHvac } from "./HvacContext";
import { hvacBoundaryPackage } from "@/lib/hvacBridge";
import { hvacErrorMessage, removeVent, resolveHvacVents } from "@/lib/hvacDocument";
import { EquipmentListRow, equipmentListStyles } from "./EquipmentListRow";

export function ClimoptixObjects({ scenario, objects, selected, onSelect, onChange, onAdd, onPick, onEditVent, onEditSource, renderObject, canAdd, canPlace, checked }: {
  scenario: CFDScenario; objects: CFDObject[]; selected: string | null; onSelect: (id: string) => void; onChange: (scenario: CFDScenario) => void;
  onAdd: (role: "supply" | "extract", group: string) => void; onPick: () => void; onEditVent?: (id: string) => void;
  onEditSource: () => void; renderObject: (id: string) => ReactNode; canAdd: boolean; canPlace: boolean; checked: boolean;
}) {
  const hvac = useHvac();
  const shared = hvac?.project.hvac;
  const link = shared?.bindings[scenario.id];
  const heatingSources = hvac && link ? hvacBoundaryPackage(hvac.project, scenario).heaters.filter(h => h.kind === "radiator") : [];
  const sharedHeaters = new Set(heatingSources.map(h => h.id));
  const groups = objectGroups(scenario, objects);
  const heaterDetail = (entry: CFDObjectEntry): CFDObjectEntry => {
    const heater = heatingSources.find(h => h.id === entry.sourceId);
    return heater ? { ...entry, detail: `Heater · ${!heater.enabled ? "Off" : heater.watts === null ? "Output unavailable" : `${heater.watts.toFixed(1)} W`}` } : entry;
  };
  const entries = objectEntries(scenario, objects).map(heaterDetail);
  const hidden = new Set(scenario.hiddenObjectIds);
  const hiddenKey = (entry: CFDObjectEntry) => entry.type === "vent" ? entry.id : entry.sourceId;
  const removed = [
    ...objectEntries({ ...scenario, hiddenObjectIds: [], vents: hvac ? resolveHvacVents(hvac.project, scenario, true) : scenario.vents }, [])
      .filter(entry => hidden.has(hiddenKey(entry))),
    ...objects.filter(object => hidden.has(object.id) && (object.profile || sharedHeaters.has(object.id)
      || scenario.assetOverrides.some(override => override.objectId === object.id && override.mode !== "none")))
      .map((object): CFDObjectEntry => heaterDetail({id: `object:${object.id}`, sourceId:object.id, type:"object", name:object.name, detail:"Excluded equipment"})),
  ];
  const [selectedGroup, setSelectedGroup] = useState(DEFAULT_OBJECT_GROUP);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const groupList = useRef<HTMLDetailsElement>(null);
  const [editing, setEditing] = useState<{ type: "object" | "group"; id: string } | null>(null);
  const [error, setError] = useState("");
  const excludeEntry = (entry: CFDObjectEntry) => {
    const key = hiddenKey(entry);
    if (hidden.size >= 2000 || key.length > 150) {
      setError("This equipment cannot be added to the simulation’s exclusion list.");
      return;
    }
    onChange({ ...scenario, hiddenObjectIds: [...hidden, key] });
    if (editing?.id === entry.sourceId) setEditing(null);
  };
  const sharedVent = (entry: CFDObjectEntry) => entry.type === "vent" && link
    ? shared?.devices.find(device => device.vent.id === entry.sourceId) : undefined;
  const openSource = (entry: CFDObjectEntry) => {
    if (!hvac || !shared) return;
    const vent = sharedVent(entry), heater = heatingSources.find(h => h.id === entry.sourceId);
    const source = vent ?? heater;
    if (!source) return;
    try {
      const operationId = link?.operatingScenarioId;
      if (operationId && shared.activeScenarioId !== operationId) hvac.commit({ ...shared, activeScenarioId: operationId });
      hvac.focusRoom(source, vent?.vent.id);
      hvac.setTab(vent ? "Ventilation" : "Heating");
      if (vent) hvac.editVent(vent.vent.id);
      hvac.requestHeating();
      onEditSource();
    } catch (cause) { setError(hvacErrorMessage(cause)); }
  };
  const deleteEntry = (entry: CFDObjectEntry) => {
    try {
      const heater = heatingSources.find(h => h.id === entry.sourceId);
      if (hvac && heater) hvac.removeRadiator(heater.floorId, heater.id);
      else if (hvac && shared && sharedVent(entry)) hvac.commit(removeVent(shared, entry.sourceId));
      else onChange(deleteObjectEntry(scenario, entry));
      if (editing?.id === entry.sourceId) setEditing(null);
      setError("");
    } catch (cause) { setError(hvacErrorMessage(cause)); }
  };
  const restoreEntry = (entry: CFDObjectEntry) => {
    onChange({ ...scenario, hiddenObjectIds: [...hidden].filter(value => value !== hiddenKey(entry)) });
    if (groupList.current) groupList.current.open = true;
    const group = groups.find(candidate => candidate.memberIds.includes(entry.id));
    if (group) setCollapsed(previous => new Set([...previous].filter(id => id !== group.id)));
  };
  const currentGroup = groups.find(g => g.id === selectedGroup) ?? groups[0];
  const addVent = (role: "supply" | "extract") => {
    const groupId = currentGroup?.id ?? DEFAULT_OBJECT_GROUP;
    if (groupList.current) groupList.current.open = true;
    setCollapsed(previous => new Set([...previous].filter(id => id !== groupId)));
    onAdd(role, groupId);
  };
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
  return <div className={`cfx-objects ${equipmentListStyles.collection}`} data-cfx-collapse-root>
    <div className="cfx-inline-toolbar">
      <h3>Objects &amp; occupants</h3>
      <CFDCollapseAll onToggle={open=>setCollapsed(new Set(open?[]:groups.map(group=>group.id)))}/>
      <div className="cfx-object-tools">
      <button disabled={!canAdd} onClick={() => addVent("supply")}>+ Supply</button>
      <button disabled={!canAdd} onClick={() => addVent("extract")}>+ Extract</button>
      <button disabled={!canPlace} title={!canPlace ? "Choose a seed room in Domain and resolve preparation checks to obtain validated host faces" : undefined} onClick={onPick}>Place on face…</button>
      <button disabled={groups.length >= 100} onClick={() => {
        const group = { id: crypto.randomUUID(), name: uniqueGroupName(groups.map(g => g.name)), memberIds: [] };
        onChange({ ...scenario, objectGroups: [...groups, group] }); setSelectedGroup(group.id);
      }}>Add object group</button>
      <CFDConfirmAction title="Clear all CFD objects?" disabled={!entries.length && !scenario.objectGroups?.length && !scenario.assetOverrides.length && !scenario.objectCopies?.length}
        description="Remove every vent, CFD copy and object treatment from this simulation. Source furniture and measured room geometry are kept, but excluded from this simulation. Undo can restore the previous setup."
        onConfirm={() => {
          const originals = objects.filter(o => !sharedHeaters.has(o.id) && !scenario.objectCopies?.some(copy => copy.id === o.id)).map(o => o.id);
          onChange({ ...scenario, vents: [], assetOverrides: [], objectCopies: [], objectGroups: [], hiddenObjectIds: [...new Set([...scenario.hiddenObjectIds ?? [], ...originals])] });
          setEditing(null); setSelectedGroup(DEFAULT_OBJECT_GROUP); setCollapsed(new Set());
        }} />
      </div>
    </div>
    {!canPlace && canAdd && <p className="cfx-caption" role="status">Supply / Extract can be added as drafts now. Face placement needs a seed room in Domain and validated host geometry; assign a host in Edit before running.</p>}
    {error && <p className="cfx-error" role="alert">{error}<button onClick={() => setError("")}>Dismiss</button></p>}
    <details ref={groupList} open><summary>Groups &amp; objects</summary><div className="cfx-group-tree">
      <CFDReorderList items={groups} label="Object groups" scope={`object-groups:${scenario.id}`} onMove={(id, at) => onChange({ ...scenario, objectGroups: insertAtBoundary(groups, id, at) })}>
        {group => {
          const members = objectMembers(group, groups, entries);
          return <section className={`cfx-study-group${currentGroup?.id === group.id ? " selected-group" : ""}`} aria-label={`Object group ${group.name}`} onClickCapture={() => setSelectedGroup(group.id)}>
            <CFDReorderList items={members} label={`${group.name} objects`} scope={`objects:${scenario.id}`} collapsed={collapsed.has(group.id)}
              onMove={(id, at) => { onChange(moveObject(scenario, id, group.id, at, objects)); setSelectedGroup(group.id); }}
              header={<header className="cfx-group-heading">
                <button className="cfx-collapse" aria-label={`${collapsed.has(group.id) ? "Expand" : "Collapse"} object group ${group.name}`} aria-expanded={!collapsed.has(group.id)} onClick={() => setCollapsed(previous => {
                  const next = new Set(previous); if (next.has(group.id)) next.delete(group.id); else next.add(group.id); return next;
                })}>{collapsed.has(group.id) ? "▸" : "▾"}</button>
                <button className="cfx-group-select" aria-pressed={currentGroup?.id === group.id} onClick={() => setSelectedGroup(group.id)}>{group.name}</button>
                <div className="cfx-group-actions">
                  <button aria-label={`Edit object group ${group.name}`} onClick={() => setEditing({ type: "group", id: group.id })}>Edit</button>
                  <button disabled={groups.length >= 100 || members.some(e => sharedHeaters.has(e.sourceId) || e.type === "object" && objects.find(o => o.id === e.sourceId)?.roomId === "unresolved")}
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
              {entry => <EquipmentListRow name={entry.name} detail={entry.detail} selected={selected === (entry.type === "vent" ? entry.id : entry.sourceId)}
                onSelect={() => onSelect(entry.type === "vent" ? entry.id : entry.sourceId)} onEdit={() => edit(entry)} onDuplicate={() => duplicate(entry, group.id)}
                duplicateTitle={sharedHeaters.has(entry.sourceId) ? "Duplicate measured heating devices in Heating, then they appear here automatically." : undefined}
                duplicateDisabled={sharedHeaters.has(entry.sourceId) || (entry.type === "vent" ? scenario.vents.length >= 500 : objects.find(o => o.id === entry.sourceId)?.roomId === "unresolved")}
                onDelete={() => deleteEntry(entry)}
                menu={<CFDRowMenu label={`Move ${entry.name}`}>
                  {(sharedHeaters.has(entry.sourceId) || sharedVent(entry)) && <button onClick={event => {
                    event.currentTarget.closest("details")!.open = false;
                    openSource(entry);
                  }}>{entry.type === "vent" ? "Edit in ventilation" : "Edit in heating"}</button>}
                  <button onClick={event => { event.currentTarget.closest("details")!.open = false; excludeEntry(entry); }}>
                    Remove from this simulation
                  </button>
                  <label>Move to group<select aria-label={`Move ${entry.name} to group`} value={group.id} onChange={e => {
                  const target = groups.find(g => g.id === e.target.value)!;
                  onChange(moveObject(scenario, entry.id, target.id, objectMembers(target, groups, entries).length, objects));
                  setSelectedGroup(target.id); e.currentTarget.closest("details")!.open = false;
                }}>{groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label></CFDRowMenu>} />}
            </CFDReorderList>
          </section>;
        }}
      </CFDReorderList>
    </div>
    </details>
    {!!removed.length && <details><summary>Removed from this simulation ({removed.length})</summary>
      <div className="cfx-removed-device-list">
        {removed.map(entry => <EquipmentListRow key={entry.id} name={entry.name} detail={entry.detail} selected={false} selectLabel={`Restore ${entry.name} to this simulation`}
          onSelect={() => restoreEntry(entry)} onRestore={() => restoreEntry(entry)} onDelete={() => deleteEntry(entry)} />)}
      </div>
    </details>}
    {checked && (scenario.assetOverrides.some(o => !objects.some(obj => obj.id === o.objectId)) || scenario.objectCopies?.some(o => !objects.some(obj => obj.id === o.id))) &&
      <details><summary>Unavailable object inputs</summary>
        {scenario.objectCopies?.filter(o => !objects.some(obj => obj.id === o.id)).map(copy => <button key={copy.id} onClick={() => onChange(deleteObjectEntry(scenario, { id: `object:${copy.id}`, sourceId: copy.id, name: copy.name, type: "object", detail: "" }))}>Delete unavailable copy · {copy.name}</button>)}
        {scenario.assetOverrides.filter(o => !objects.some(obj => obj.id === o.objectId)).map((override, index) => <button key={override.objectId} onClick={() => onChange({ ...scenario, assetOverrides: scenario.assetOverrides.filter(o => o.objectId !== override.objectId) })}>Remove unavailable override {index + 1}</button>)}
      </details>}
    {editing?.type === "object" && <CFDEditorWindow title="Edit CFD object" defaultPosition={{ x: 250, y: 100 }} initialSize={{ width: 620, height: 640 }} maxHeight={850} bringToFront onClose={() => setEditing(null)}
      helpSteps={[{ heading: "Objects and shared devices", text: "Treatments and object copies belong to this simulation. Deleting a shared radiator or vent removes it from the project and its source workbench. Use the row menu to open that source workbench. Copies reuse measured source dimensions with separate millimetre offsets. Count multiplies emissions. Undo restores changes." }]}>
      {renderObject(editing.id)}
    </CFDEditorWindow>}
    {editingGroup && <CFDEditorWindow title="Edit object group" sectionTitle="Group settings" defaultPosition={{ x: 240, y: 100 }} initialSize={{ width: 420 }} onClose={() => setEditing(null)} bringToFront>
      <label>Group name<input key={`${editingGroup.id}:${editingGroup.name}`} aria-label="Object group name" defaultValue={editingGroup.name} maxLength={80} onBlur={event => {
        const name = event.target.value.trim();
        if (!name || groups.some(g => g.id !== editingGroup.id && g.name.toLowerCase() === name.toLowerCase())) { setError("Choose a unique, non-empty object group name."); event.target.value = editingGroup.name; return; }
        onChange({ ...scenario, objectGroups: groups.map(g => g.id === editingGroup.id ? { ...g, name } : g) });
      }} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} /></label>
    </CFDEditorWindow>}
  </div>;
}
