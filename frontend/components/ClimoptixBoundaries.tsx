"use client";

import { CFDReorderList } from "./CFDReorderList";
import { CFDConfirmAction } from "./CFDConfirmAction";
import { CFDRowMenu } from "./CFDRowMenu";
import { insertAtBoundary } from "@/lib/climoptixStudies";
import { assignBoundarySurfaces, boundaryGroups, boundaryMembership, BOUNDARY_COLOURS, DEFAULT_BOUNDARY_GROUP, effectiveBoundary, moveBoundary, uniqueGroupName } from "@/lib/climoptixGroups";
import { useState, type ReactNode } from "react";
import { CFDEditorWindow } from "./CFDEditorWindow";
import { boundarySchema, type CFDBoundary, type CFDScenario, type PatchKind, PATCH_KINDS } from "@/lib/climoptixDocument";
import type { CFDReport } from "@/lib/climoptix";
import { projectFloors } from "@/lib/buildingDocument";
import type { ProjectDocument } from "@/lib/projectDocument";
import { CFDNumber, CFDText, Parameters, labelFor } from "./CFDFields";

function BoundaryEditor({
  value,
  onChange,
  solid = false,
}: {
  value: CFDBoundary;
  onChange: (v: CFDBoundary) => void;
  solid?: boolean;
}) {
  const flowUnits: Record<string, string> = {
    velocity: "m/s",
    volumeFlow: "m³/s",
    massFlow: "kg/s",
    pressure: "Pa",
    opening: "Pa",
  };
  return (
    <>
      <div className="cfx-grid">
        <label>
          Flow condition
          <select
            aria-label="Boundary flow condition"
            value={value.flow.type}
            onChange={(e) =>
              onChange({
                ...value,
                flow: {
                  ...value.flow,
                  type: e.target.value as CFDBoundary["flow"]["type"],
                },
              })
            }
          >
            {[
              "noSlip",
              "slip",
              "velocity",
              "volumeFlow",
              "massFlow",
              "pressure",
              "opening",
              "symmetry",
            ].map((t) => (
              <option key={t} value={t} disabled={solid && !["noSlip", "slip", "symmetry"].includes(t)}>
                {labelFor(t)}
              </option>
            ))}
          </select>
        </label>
        {flowUnits[value.flow.type] && (
          <CFDNumber
            label={`Boundary flow value (${flowUnits[value.flow.type]})`}
            value={value.flow.value}
            onChange={(v) =>
              onChange({ ...value, flow: { ...value.flow, value: v } })
            }
          />
        )}
        <label>
          Thermal condition
          <select
            aria-label="Boundary thermal condition"
            value={value.thermal.type}
            onChange={(e) => {
              const type = e.target.value as CFDBoundary["thermal"]["type"];
              onChange({
                ...value,
                thermal: {
                  ...value.thermal,
                  type,
                  value: type === "temperature" ? 293.15 : 0,
                },
              });
            }}
          >
            {["adiabatic", "temperature", "heatFlux", "heatTransfer"].map(
              (t) => (
                <option key={t} value={t}>
                  {labelFor(t)}
                </option>
              ),
            )}
          </select>
        </label>
        {value.thermal.type !== "adiabatic" && (
          <CFDNumber
            label={
              value.thermal.type === "temperature"
                ? "Boundary temperature (K)"
                : value.thermal.type === "heatFlux"
                  ? "Heat flux into air (W/m²)"
                  : "Heat-transfer coefficient (W/m²·K)"
            }
            value={value.thermal.value}
            onChange={(v) =>
              onChange({ ...value, thermal: { ...value.thermal, value: v } })
            }
          />
        )}
      </div>
      {solid && <p className="cfx-caption">Solid surfaces cannot be inlets or outlets. Add a Supply or Extract vent in Objects to let air pass through a wall.</p>}
      {value.thermal.type === "heatTransfer" && (
        <CFDNumber
          label="Ambient temperature (K)"
          value={value.thermal.ambientK}
          onChange={(ambientK) =>
            onChange({ ...value, thermal: { ...value.thermal, ambientK } })
          }
        />
      )}
      <Parameters
        value={value}
        omit={["flow", "thermal"]}
        onChange={(v) => onChange(v as CFDBoundary)}
      />
    </>
  );
}
export function BoundariesPanel({
  project,
  scenario,
  report,
  selected,
  onSelect,
  onChange,
  selectedGroup,
  onSelectGroup,
  checked,
  navigation,
}: {
  project: ProjectDocument;
  scenario: CFDScenario;
  report: CFDReport | null;
  selected: string | null;
  onSelect: (id: string) => void;
  onChange: (s: CFDScenario) => void;
  selectedGroup: string;
  onSelectGroup: (id: string) => void;
  checked: boolean;
  navigation?: ReactNode;
}) {
  const [search, setSearch] = useState(""),
    [group, setGroup] = useState<PatchKind>("wall");
  const [groupNameError, setGroupNameError] = useState<{ id: string; text: string } | null>(null);
  const [actionGroupId, setActionGroupId] = useState<string | null>(null);
  const [editing, setEditing] = useState<"group" | "surface" | null>(null);
  const [assignment, setAssignment] = useState<{ groupId: string; ids: string[]; editConditions?: boolean } | null>(null);
  const [surfaceKind, setSurfaceKind] = useState("all");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const patch = report?.patches.find(
    (p) =>
      p.id === selected || (p.kind === "object" && p.sourceId === selected),
  );
  const roomNames = new Map(report?.domain.regions.map((r) => [r.id, r.name]));
  const query = search.trim().toLowerCase();
  const rows =
    report?.patches.filter((p) =>
      `${p.kind} ${p.label ?? ""} ${roomNames.get(p.roomId) ?? ""} ${p.roomId} ${p.sourceId} ${p.id}`
        .toLowerCase()
        .includes(query),
    ) ?? [];
  const groupValue =
    scenario.boundaries.groups[group] ?? boundarySchema.parse({});
  const updateGroup = (v: CFDBoundary) =>
    onChange({
      ...scenario,
      boundaries: {
        ...scenario.boundaries,
        groups: { ...scenario.boundaries.groups, [group]: v },
      },
    });
  const collections = boundaryGroups(scenario);
  const currentGroup = collections.find(g => g.id === selectedGroup) ?? collections[0];
  const allPatches = report?.patches ?? [];
  const membership = boundaryMembership(collections, allPatches);
  const patchOwners = new Map(collections.flatMap(g => (membership.get(g.id) ?? []).map(p => [p.id, g.name] as const)));
  const matchingIds = new Set(rows.map(p => p.id));
  const availablePatchIds = new Set(allPatches.map(p => p.id));
  const updateCollections = (next: typeof collections) => onChange({ ...scenario, boundaries: { ...scenario.boundaries, collections: next } });
  const newGroup = (patchId?: string) => {
    if (collections.length >= 100) return;
    const patch = allPatches.find(p => p.id === patchId);
    const added = { id: crypto.randomUUID(), name: uniqueGroupName(collections.map(g => g.name)), patchIds: patchId ? [patchId] : [],
      boundary: patch && patch.kind !== "supply" && patch.kind !== "extract" ? effectiveBoundary(scenario, patch) : null };
    updateCollections([...collections.map(g => ({ ...g, patchIds: g.patchIds.filter(id => id !== patchId) })), added]);
    onSelectGroup(added.id);
    return added;
  };
  return (
    <>
      <div className="cfx-inline-toolbar cfx-boundary-tools">{navigation}
        <button disabled={collections.length >= 100} onClick={() => newGroup()}>Add boundary group</button>
        <CFDConfirmAction title="Clear all boundary customizations?"
          description="Remove boundary groups, type defaults and surface overrides. Existing building surfaces and vents are kept. Solid surfaces return to no-slip, adiabatic defaults. Undo can restore the previous conditions."
          disabled={!collections.length && !Object.keys(scenario.boundaries.groups).length && !Object.keys(scenario.boundaries.patches).length}
          onConfirm={() => { onChange({ ...scenario, boundaries: { groups: {}, collections: [], patches: {}, hideDefaultGroup: true } }); onSelectGroup(DEFAULT_BOUNDARY_GROUP); setCollapsed(new Set()); setEditing(null); setAssignment(null); setActionGroupId(null); }} />
        <input type="search" aria-label="Find a CFD patch" value={search} maxLength={500} onChange={e => setSearch(e.target.value)} placeholder="Find surface · room, surface or source" />
      </div>
      {scenario.boundaries.hideDefaultGroup && <details className="cfx-ungrouped-surfaces"><summary>Ungrouped building surfaces · {rows.filter(p => !patchOwners.has(p.id)).length}</summary>
        <p className="cfx-caption">All boundary groups were removed. Physical surfaces remain; their default conditions still apply. Add a boundary group to assign them.</p>
        {rows.filter(p => !patchOwners.has(p.id)).map(p => <button key={p.id} aria-label={`Edit surface ${p.id}`} onClick={() => { onSelect(p.id); setEditing("surface"); }}>{p.label ?? labelFor(p.kind)} · {roomNames.get(p.roomId) ?? p.roomId}</button>)}
      </details>}
      {!scenario.seed && <label>Choose the room whose connected surfaces you want to configure
        <select aria-label="Boundary seed room" value="" onChange={event => {
          const [floorId, roomId] = JSON.parse(event.target.value) as [string, string];
          onChange({ ...scenario, seed: { floorId, roomId } });
        }}><option value="">Choose a room…</option>{projectFloors(project).flatMap(floor => floor.content.rooms.map(room =>
          <option key={`${floor.id}:${room.id}`} value={JSON.stringify([floor.id, room.id])}>{floor.name} · {room.name}</option>))}</select>
      </label>}
      <div className="cfx-boundary-tree cfx-group-tree">
        <CFDReorderList items={collections} label="Boundary groups" scope={`boundary-groups:${scenario.id}`}
          onMove={(id, at) => updateCollections(insertAtBoundary(collections, id, at))}>
        {(collection, index) => {
          const allMembers = membership.get(collection.id) ?? [];
          const members = allMembers.filter(p => matchingIds.has(p.id));
          return <section className={`cfx-boundary-group${currentGroup?.id === collection.id ? " selected" : ""}`} key={collection.id}
            aria-label={`Boundary group ${collection.name}`} style={{ "--boundary-colour": BOUNDARY_COLOURS[index % BOUNDARY_COLOURS.length] } as import("react").CSSProperties}>
            <CFDReorderList items={members.map(p => ({ ...p, name: `${p.label ?? labelFor(p.kind)} · ${p.sourceId}` }))}
              label={`${collection.name} surfaces`} scope={`boundary-surfaces:${scenario.id}`} collapsed={collapsed.has(collection.id)}
              header={<header className="cfx-group-heading">
              <button className="cfx-collapse" aria-label={`${collapsed.has(collection.id) ? "Expand" : "Collapse"} boundary group ${collection.name}`} aria-expanded={!collapsed.has(collection.id)}
                onClick={() => setCollapsed(previous => { const next = new Set(previous); if (next.has(collection.id)) next.delete(collection.id); else next.add(collection.id); return next; })}>{collapsed.has(collection.id) ? "▸" : "▾"}</button>
              <button className="cfx-group-select" aria-pressed={currentGroup?.id === collection.id}
              onClick={() => onSelectGroup(collection.id)}><span className="cfx-level-swatch" aria-hidden="true" style={{ background: "var(--boundary-colour)" }} />{collection.name}</button>
              <small>{allMembers.length} {allMembers.length === 1 ? "surface" : "surfaces"}</small>
              <button className="cfx-boundary-actions-trigger" aria-label={`Actions for boundary group ${collection.name}`} aria-haspopup="dialog" aria-expanded={actionGroupId === collection.id}
                onClick={() => setActionGroupId(collection.id)}>…</button>
              {actionGroupId === collection.id && <CFDEditorWindow title={`Actions — ${collection.name}`} dialog initialSize={{ width: 380 }} defaultPosition={{ x: 260, y: 120 }}
                bringToFront onClose={() => setActionGroupId(null)}>
              <div className="cfx-boundary-action-list" onClick={event => {
                const button = (event.target as HTMLElement).closest("button");
                if (button && !button.disabled) setActionGroupId(null);
              }}>
              <button aria-label={`Add boundary conditions to ${collection.name}`} onClick={() => {
                const destination = collection.id === DEFAULT_BOUNDARY_GROUP ? newGroup() : collection;
                if (!destination) return;
                onSelectGroup(destination.id); setSurfaceKind("all");
                setAssignment({ groupId: destination.id, ids: destination.patchIds, editConditions: true });
              }}>Add boundary conditions…</button>
              <button aria-label={`Conditions for boundary group ${collection.name}`} onClick={() => {
                onSelectGroup(collection.id);
                if (!collection.boundary) updateCollections(collections.map(g => g.id === collection.id ? { ...g, boundary: boundarySchema.parse({}) } : g));
                setEditing("group");
              }}>{collection.boundary ? "Conditions" : "Add conditions"}</button>
              {collection.id !== DEFAULT_BOUNDARY_GROUP && <button aria-label={`Assign surfaces to ${collection.name}`} onClick={() => {
                onSelectGroup(collection.id);
                setAssignment({ groupId: collection.id, ids: allMembers.map(p => p.id) });
              }}>Assign surfaces…</button>}
              <button aria-label={`Edit boundary group ${collection.name}`} onClick={() => { onSelectGroup(collection.id); setEditing("group"); }}>Edit</button>
              <button aria-label={`Duplicate boundary group ${collection.name}`} disabled={collections.length >= 100}
                title="Copy conditions into a new empty group; physical surfaces stay unique" onClick={() => {
                  const copy = { ...structuredClone(collection), id: crypto.randomUUID(), name: uniqueGroupName(collections.map(g => g.name), collection.name.slice(0, 70) + " copy"), patchIds: [] };
                  updateCollections([...collections, copy]); onSelectGroup(copy.id);
                }}>Duplicate</button>
              <button disabled={collection.id === DEFAULT_BOUNDARY_GROUP} aria-label={`Delete boundary group ${collection.name}`} className="cfx-danger"
                title="Return its surfaces to the default group" onClick={() => { updateCollections(collections.filter(g => g.id !== collection.id)); onSelectGroup(DEFAULT_BOUNDARY_GROUP); }}>Delete</button>
              </div>
              </CFDEditorWindow>}
            </header>}
              onMove={(id, at) => {
                const anchor = members[at]?.id;
                onChange(moveBoundary(scenario, id, collection.id, anchor ? allMembers.findIndex(p => p.id === anchor) : allMembers.length, allPatches));
              }}>
              {p => <article className={`cfx-surface-row${patch?.id === p.id ? " selected" : ""}`}>
                <button className="cfx-surface-name" aria-label={`Select surface ${p.id}`} onClick={() => { onSelectGroup(collection.id); onSelect(p.id); }}>
                  <strong>{p.label ?? labelFor(p.kind)}</strong><small>{roomNames.get(p.roomId) ?? p.roomId} · {p.areaM2.toFixed(2)} m²{scenario.boundaries.patches[p.id] ? " · override" : ""}</small>
                </button>
                <div className="cfx-device-actions">
                  <button aria-label={`Edit surface ${p.id}`} onClick={() => { onSelectGroup(collection.id); onSelect(p.id); setEditing("surface"); }}>Edit</button>
                  <button aria-label={`Duplicate conditions for ${p.id}`} disabled={collections.length >= 100} title="Copy these conditions to a new empty group" onClick={() => {
                    const copy = { id: crypto.randomUUID(), name: uniqueGroupName(collections.map(g => g.name), "Surface conditions"), patchIds: [], boundary: structuredClone(effectiveBoundary(scenario, p)) };
                    updateCollections([...collections, copy]); onSelectGroup(copy.id);
                  }}>Duplicate</button>
                  <button className="cfx-danger" aria-label={`Delete assignment for ${p.id}`} disabled={collection.id === DEFAULT_BOUNDARY_GROUP && !scenario.boundaries.patches[p.id]}
                    title="Clear the assignment and return to Default surfaces; keep the physical surface" onClick={() => {
                      const next = moveBoundary(scenario, p.id, DEFAULT_BOUNDARY_GROUP, 0, allPatches);
                      const patches = { ...next.boundaries.patches }; delete patches[p.id];
                      onChange({ ...next, boundaries: { ...next.boundaries, patches } }); onSelectGroup(DEFAULT_BOUNDARY_GROUP);
                    }}>Delete</button>
                </div>
                <CFDRowMenu label={`Move surface ${p.id}`}>
                  <label>Move to group<select aria-label={`Group for surface ${p.id}`} value={collection.id} onChange={e => {
                    e.currentTarget.closest("details")!.open = false;
                    onChange(moveBoundary(scenario, p.id, e.target.value, 0, allPatches)); }}>
                    {collections.map(g => <option value={g.id} key={g.id}>{g.name}</option>)}
                  </select></label><button onClick={() => newGroup(p.id)}>New group from surface</button>
                </CFDRowMenu>
              </article>}
            </CFDReorderList>
          </section>;
        }}
        </CFDReorderList>
      </div>
      {!allPatches.length && <p className="cfx-caption" role="status">Choose a seed room in Domain and resolve preparation checks to assign existing surfaces. You can configure group conditions now; groups do not create new geometry.</p>}
      {assignment && <CFDEditorWindow title="Assign boundary surfaces" initialSize={{ width: 700 }} defaultPosition={{ x: 240, y: 100 }} maxHeight={750}
        bringToFront onClose={() => setAssignment(null)}>
        <section className="cfx-card">
          <h3>{collections.find(g => g.id === assignment.groupId)?.name ?? "Unavailable group"}</h3>
          <p className="cfx-caption">Checked surfaces move into this group. Unchecked members return to Default surfaces. Physical surfaces stay unique; per-surface overrides remain authoritative.</p>
          <label>Surface type<select aria-label="Boundary assignment surface type" value={surfaceKind} onChange={event => setSurfaceKind(event.target.value)}>
            <option value="all">All surfaces</option><option value="wall">Walls</option><option value="ceiling">Roofs / ceilings</option><option value="floor">Floors</option><option value="other">Openings &amp; other surfaces</option>
          </select></label>
          <div className="cfx-surface-assignment" role="group" aria-label="Surfaces to assign">
            {allPatches.filter(p => surfaceKind === "all" || p.kind === surfaceKind || surfaceKind === "other" && !["wall", "ceiling", "floor"].includes(p.kind)).map(p => {
              const device = p.kind === "supply" || p.kind === "extract";
              return <label className="cfx-check" key={p.id}>
                <input type="checkbox" aria-label={`Assign surface ${p.id}`} disabled={device || !checked} checked={assignment.ids.includes(p.id)}
                  onChange={e => setAssignment({ ...assignment, ids: e.target.checked ? [...assignment.ids, p.id] : assignment.ids.filter(id => id !== p.id) })} />
                <span>{p.label ?? labelFor(p.kind)} · {roomNames.get(p.roomId) ?? p.roomId}
                  <small>{p.sourceId} · {patchOwners.get(p.id) ?? "Default surfaces"}{device ? " · device conditions in Objects" : ""}</small>
                </span>
              </label>;
            })}
          </div>
          {!allPatches.length && <p>Choose a seed room in Domain and refresh preparation checks first.</p>}
          {!checked && <p role="status">Wait for current preparation checks before assigning surfaces.</p>}
          <div className="cfx-actions">
            <button onClick={() => setAssignment(null)}>Cancel</button>
            <button className="cfx-primary" disabled={!checked || !allPatches.length || !collections.some(g => g.id === assignment.groupId)} onClick={() => {
              const assigned = assignBoundarySurfaces(scenario, assignment.groupId, assignment.ids, allPatches);
              onChange(assignment.editConditions ? { ...assigned, boundaries: { ...assigned.boundaries, collections: boundaryGroups(assigned).map(g => g.id === assignment.groupId ? { ...g, boundary: g.boundary ?? boundarySchema.parse({}) } : g) } } : assigned);
              if (assignment.editConditions) setEditing("group");
              setAssignment(null);
            }}>{assignment.editConditions ? "Apply and edit conditions" : "Apply assignment"}</button>
          </div>
        </section>
      </CFDEditorWindow>}
      {editing === "group" && currentGroup && <CFDEditorWindow title="Edit boundary group" defaultPosition={{ x: 220, y: 90 }} initialSize={{ width: 620 }} maxHeight={850}
        bringToFront onClose={() => setEditing(null)} helpSteps={[{ heading: "Surface groups", text: "Each physical surface belongs to one group. Drag grips move groups or surfaces; Escape cancels. Duplicate copies conditions to a new empty group, not geometry. Delete returns surfaces to Default surfaces. Per-surface overrides take precedence over group conditions." }]}>
      <section className="cfx-card" aria-label="Boundary group conditions">
        <CFDText key={currentGroup.id} label="Group name" value={currentGroup.name} maxLength={80}
          onChange={name => {
            if (collections.some(g => g.id !== currentGroup.id && g.name.toLowerCase() === name.trim().toLowerCase())) {
              setGroupNameError({ id: currentGroup.id, text: "A boundary group already has that name." }); return;
            }
            setGroupNameError(null);
            updateCollections(collections.map(g => g.id === currentGroup.id ? { ...g, name } : g));
          }} />
        {groupNameError?.id === currentGroup.id && <small className="cfx-error" role="alert">{groupNameError.text}</small>}
        {report && currentGroup.id !== DEFAULT_BOUNDARY_GROUP && currentGroup.patchIds.some(id => !availablePatchIds.has(id)) &&
          <button disabled={!checked} title={checked ? undefined : "Wait for current preparation checks before removing references"} onClick={() => {
            updateCollections(collections.map(g => g.id === currentGroup.id ? { ...g, patchIds: g.patchIds.filter(id => availablePatchIds.has(id)) } : g));
          }}>Remove unavailable surface references</button>}
        <label className="cfx-check"><input type="checkbox" checked={currentGroup.boundary !== null} onChange={e => updateCollections(collections.map(g =>
          g.id === currentGroup.id ? { ...g, boundary: e.target.checked ? boundarySchema.parse({}) : null } : g))} />Use group conditions</label>
        {currentGroup.boundary ? <BoundaryEditor solid={(membership.get(currentGroup.id) ?? []).some(p => ["wall", "floor", "ceiling", "slabSide", "object"].includes(p.kind))} value={currentGroup.boundary} onChange={boundary => updateCollections(collections.map(g => g.id === currentGroup.id ? { ...g, boundary } : g))} /> :
          <small className="cfx-caption">Inherited / per-surface conditions</small>}
        {(membership.get(currentGroup.id) ?? []).some(p => !!scenario.boundaries.patches[p.id]) && <button onClick={() => {
          const ids = new Set((membership.get(currentGroup.id) ?? []).map(p => p.id));
          onChange({ ...scenario, boundaries: { ...scenario.boundaries, collections, patches: Object.fromEntries(Object.entries(scenario.boundaries.patches).filter(([id]) => !ids.has(id))) } });
        }}>Clear surface overrides in group</button>}
      </section>
      </CFDEditorWindow>}
      <details>
        <summary>Surface type defaults</summary>
        <label>
          Patch group
          <select
            aria-label="Boundary patch group"
            value={group}
            onChange={(e) => setGroup(e.target.value as PatchKind)}
          >
            {PATCH_KINDS.filter((k) => k !== "supply" && k !== "extract").map(
              (k) => (
                <option key={k} value={k}>
                  {labelFor(k)}
                </option>
              ),
            )}
          </select>
        </label>
        <BoundaryEditor solid={["wall", "floor", "ceiling", "slabSide", "object"].includes(group)} value={groupValue} onChange={updateGroup} />
        <button onClick={() => updateGroup(groupValue)}>
          Assign this group preset
        </button>
      </details>
      {report && !rows.length && (
        <p role="status" className="cfx-caption">
          No matching patches.
        </p>
      )}
      {patch && editing === "surface" && (
        <CFDEditorWindow title="Edit boundary surface" defaultPosition={{ x: 240, y: 110 }} initialSize={{ width: 600, height: 640 }} maxHeight={850} bringToFront onClose={() => setEditing(null)}>
        <section className="cfx-card">
          <h3>
            {patch.label ?? labelFor(patch.kind)} · {patch.sourceId}
          </h3>
          <small>{patch.id}</small>
          {patch.kind === "supply" || patch.kind === "extract" ? (
            <p>Controlled by the device in Equipment.</p>
          ) : (
            <>
              <BoundaryEditor
                solid={["wall", "floor", "ceiling", "slabSide", "object"].includes(patch.kind)}
                value={effectiveBoundary(scenario, patch)}
                onChange={(value) =>
                  onChange({
                    ...scenario,
                    boundaries: {
                      ...scenario.boundaries,
                      patches: {
                        ...scenario.boundaries.patches,
                        [patch.id]: value,
                      },
                    },
                  })
                }
              />
              <button
                disabled={!scenario.boundaries.patches[patch.id]}
                onClick={() => {
                  const next = { ...scenario.boundaries.patches };
                  delete next[patch.id];
                  onChange({
                    ...scenario,
                    boundaries: { ...scenario.boundaries, patches: next },
                  });
                }}
              >
                Clear override · inherit group
              </button>
            </>
          )}
        </section>
        </CFDEditorWindow>
      )}
      {!!report &&
        Object.keys(scenario.boundaries.patches).some(
          (id) => !report.patches.some((p) => p.id === id),
        ) && (
          <details>
            <summary>Unavailable patch overrides</summary>
            {Object.keys(scenario.boundaries.patches)
              .filter((id) => !report.patches.some((p) => p.id === id))
              .map((id) => (
                <button
                  key={id}
                  onClick={() => {
                    const patches = { ...scenario.boundaries.patches };
                    delete patches[id];
                    onChange({
                      ...scenario,
                      boundaries: { ...scenario.boundaries, patches },
                    });
                  }}
                >
                  Remove override · {id}
                </button>
              ))}
          </details>
        )}
    </>
  );
}
