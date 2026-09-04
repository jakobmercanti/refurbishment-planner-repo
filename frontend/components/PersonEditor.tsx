"use client";

import { useState } from "react";
import { DisplayNumberInput } from "@/components/DisplayNumberInput";
import { bodyDimensions, normalizePerson } from "@/lib/person";
import { UNIT_LABEL, type DisplayUnits } from "@/lib/units";
import type { PersonMockup, PersonPosture, Room } from "@/lib/types";

interface PersonEditorProps {
  room: Room;
  displayUnits: DisplayUnits;
  onChange: (person: PersonMockup | null) => void;
  onVisibilityChange: (showClearance: boolean) => void;
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
    show_clearance: true,
  };
}

export function PersonEditor({ room, displayUnits, onChange, onVisibilityChange }: PersonEditorProps) {
  const person = room.person_mockup?.enabled ? room.person_mockup : null;
  const [draft, setDraft] = useState<PersonMockup>(() => normalizePerson(person) ?? defaultPerson(room));

  function set<K extends keyof PersonMockup>(key: K, value: PersonMockup[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function setPosture(posture: PersonPosture) {
    setDraft((current) => ({
      ...current,
      posture,
      eye_height_mm: Math.min(POSTURE_EYE_HEIGHT[posture], current.height_mm),
      ...bodyDimensions(current.height_mm),
    }));
  }

  return (
    <section className="person-editor" aria-label="Human mock-up controls">
      <div className="person-editor-heading">
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
        <p>Set the person height, then drag the model in the 3D viewer to position it.</p>
        <label className="person-field person-posture"><span>Posture</span><select value={draft.posture} onChange={(event) => setPosture(event.target.value as PersonPosture)}><option value="STANDING">Standing</option><option value="SEATED">Seated</option><option value="CROUCHING">Crouching</option></select></label>
        <fieldset><legend>Body dimensions</legend><div className="person-field-grid">
          <label className="person-field"><span>Height <small>{UNIT_LABEL[displayUnits]}</small></span><DisplayNumberInput minMm={501} maxMm={2500} valueMm={draft.height_mm} units={displayUnits} onMmChange={(value) => setDraft((current) => ({ ...current, height_mm: value, eye_height_mm: Math.min(current.eye_height_mm, value), ...bodyDimensions(value) }))} /></label>
        </div></fieldset>
        <fieldset><legend>Usability</legend><div className="person-field-grid">
          <label className="person-field"><span>Clear space around body <small>{UNIT_LABEL[displayUnits]}</small></span><DisplayNumberInput minMm={0} maxMm={2000} valueMm={draft.movement_clearance_mm} units={displayUnits} onMmChange={(value) => set("movement_clearance_mm", value)} /></label>
          <label className="person-show-clearance"><input type="checkbox" checked={draft.show_clearance !== false} onChange={(event) => { const showClearance = event.target.checked; setDraft((current) => ({ ...current, show_clearance: showClearance })); onVisibilityChange(showClearance); }} /><span>Show clearance</span></label>
        </div></fieldset>
        <button className="person-update" type="button" onClick={() => onChange({ ...draft, enabled: true })}>Update person</button>
      </div>}
    </section>
  );
}
