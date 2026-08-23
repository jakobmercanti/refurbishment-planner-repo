"use client";

import { useState } from "react";
import { EditableNumberInput } from "@/components/EditableNumberInput";
import type { PersonMockup, PersonPosture, Room } from "@/lib/types";

interface PersonEditorProps {
  room: Room;
  onChange: (person: PersonMockup | null) => void;
}

const POSTURE_EYE_HEIGHT: Record<PersonPosture, number> = {
  STANDING: 1630,
  SEATED: 1180,
  CROUCHING: 900,
};

function roomCentre(room: Room) {
  return {
    x: room.vertices.reduce((total, point) => total + point.x, 0) / room.vertices.length,
    y: room.vertices.reduce((total, point) => total + point.y, 0) / room.vertices.length,
  };
}

function defaultPerson(room: Room): PersonMockup {
  return {
    id: "person-001",
    enabled: true,
    center: roomCentre(room),
    rotation_deg: 0,
    posture: "STANDING",
    height_mm: 1750,
    shoulder_width_mm: 460,
    body_depth_mm: 280,
    eye_height_mm: 1630,
    movement_clearance_mm: 300,
    include_in_analysis: true,
  };
}

export function PersonEditor({ room, onChange }: PersonEditorProps) {
  const person = room.person_mockup?.enabled ? room.person_mockup : null;
  const [draft, setDraft] = useState<PersonMockup>(() => person ?? defaultPerson(room));

  function set<K extends keyof PersonMockup>(key: K, value: PersonMockup[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function setPosture(posture: PersonPosture) {
    setDraft((current) => ({
      ...current,
      posture,
      eye_height_mm: Math.min(POSTURE_EYE_HEIGHT[posture], current.height_mm),
    }));
  }

  return (
    <section className="person-editor" aria-label="Human mock-up controls">
      <div className="person-editor-heading">
        <div><span className="eyebrow">Usability model</span><h2>Human mock-up</h2></div>
        <small>1 person maximum</small>
      </div>
      <label className="person-enable-choice">
        <input
          type="checkbox"
          checked={Boolean(person)}
          onChange={(event) => {
            if (event.target.checked) {
              const next = { ...draft, enabled: true };
              setDraft(next);
              onChange(next);
            } else onChange(null);
          }}
        />
        <span>Insert person in the 3D room</span>
      </label>

      {person && <div className="person-menu">
        <p>Set the body envelope and viewpoint, then update the model.</p>
        <label className="person-field person-posture"><span>Posture</span><select value={draft.posture} onChange={(event) => setPosture(event.target.value as PersonPosture)}><option value="STANDING">Standing</option><option value="SEATED">Seated</option><option value="CROUCHING">Crouching</option></select></label>
        <fieldset><legend>Position</legend><div className="person-field-grid">
          <label className="person-field"><span>X <small>mm</small></span><EditableNumberInput value={draft.center.x} onValueChange={(value) => set("center", { ...draft.center, x: value })} /></label>
          <label className="person-field"><span>Y <small>mm</small></span><EditableNumberInput value={draft.center.y} onValueChange={(value) => set("center", { ...draft.center, y: value })} /></label>
          <label className="person-field"><span>Rotation <small>°</small></span><EditableNumberInput value={draft.rotation_deg} onValueChange={(value) => set("rotation_deg", value)} /></label>
        </div></fieldset>
        <fieldset><legend>Body dimensions</legend><div className="person-field-grid">
          <label className="person-field"><span>Height <small>mm</small></span><EditableNumberInput min={501} max={2500} value={draft.height_mm} onValueChange={(value) => setDraft((current) => ({ ...current, height_mm: value, eye_height_mm: Math.min(current.eye_height_mm, value) }))} /></label>
          <label className="person-field"><span>Shoulders <small>mm</small></span><EditableNumberInput min={201} max={1000} value={draft.shoulder_width_mm} onValueChange={(value) => set("shoulder_width_mm", value)} /></label>
          <label className="person-field"><span>Body depth <small>mm</small></span><EditableNumberInput min={101} max={1000} value={draft.body_depth_mm} onValueChange={(value) => set("body_depth_mm", value)} /></label>
        </div></fieldset>
        <fieldset><legend>Usability</legend><div className="person-field-grid two-columns">
          <label className="person-field"><span>Eye height <small>mm</small></span><EditableNumberInput min={301} max={Math.min(2400, draft.height_mm)} value={draft.eye_height_mm} onValueChange={(value) => set("eye_height_mm", value)} /></label>
          <label className="person-field"><span>Clear space around body <small>mm</small></span><EditableNumberInput min={0} max={2000} value={draft.movement_clearance_mm} onValueChange={(value) => set("movement_clearance_mm", value)} /></label>
        </div></fieldset>
        <p className="person-clearance-note">Initial planning allowance: 300 mm around the body. Increase it where accessibility or a specific activity requires a larger clear floor zone.</p>
        <label className="person-enable-choice compact"><input type="checkbox" checked={draft.include_in_analysis} onChange={(event) => set("include_in_analysis", event.target.checked)} /><span>Include body and movement space in layout analysis</span></label>
        <button className="person-update" type="button" onClick={() => onChange({ ...draft, enabled: true })}>Update person</button>
      </div>}
    </section>
  );
}
