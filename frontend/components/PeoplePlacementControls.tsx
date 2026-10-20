"use client";

import { useState } from "react";
import { DisplayNumberInput } from "./DisplayNumberInput";
import { WindowHelpButton } from "./WindowHelpButton";
import { obstacleFitsInRoom, type PlacementWall } from "@/lib/elementPlacement";
import { PERSON_MODELS, STATURE_PRESETS, nominalSupportHeight, personSpec, placePersonOnSupport, supportsPerson, withPersonSpec, type CataloguePerson, type PersonPosture } from "@/lib/people";
import { formatLength, UNIT_LABEL, type DisplayUnits } from "@/lib/units";
import type { Obstacle, Room } from "@/lib/types";

export function PeoplePlacementControls({ value, room, walls, displayUnits, onChange }: { value: Obstacle; room: Room; walls: PlacementWall[]; displayUnits: DisplayUnits; onChange: (value: Obstacle) => void }) {
  const [supportId, setSupportId] = useState(value.person_spec?.support?.obstacle_id ?? "");
  const [contactHeight, setContactHeight] = useState(value.person_spec?.support?.surface_height_mm ?? 450);
  const [side, setSide] = useState(0), [error, setError] = useState("");
  const spec = personSpec(value);
  if (!spec) return null;
  const hosts = room.obstacles.filter(item => item.id !== value.id && supportsPerson(item, spec.posture));
  const host = hosts.find(item => item.id === supportId);
  const apply = (next: Obstacle) => {
    if (!obstacleFitsInRoom(next, room, walls) || next.base_z_mm + next.dimensions.height.value > room.wall_height.value) { setError("This pose would cross a wall or the room height. Choose another position or smaller stature."); return; }
    setError(""); onChange(next);
  };
  const configure = (next: CataloguePerson) => {
    try {
      let item = withPersonSpec(value, next);
      if (next.support) {
        const support = room.obstacles.find(item => item.id === next.support!.obstacle_id);
        if (support) item = placePersonOnSupport(item, support, next.support.surface_height_mm, next.support.lateral_offset_mm);
      }
      if (spec.posture !== next.posture) item.base_z_mm = 0;
      apply(item);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Review the person's dimensions."); }
  };
  return <section className="people-placement-controls" aria-label="People and furniture">
    <div className="people-controls-heading"><strong>People &amp; furniture</strong><WindowHelpButton title="People & furniture" /></div>
    <div className="fixture-fields two-columns">
      <label className="field"><span>Posture</span><select value={spec.posture} onChange={event => configure({ ...spec, posture: event.target.value as PersonPosture, support: undefined })}>{PERSON_MODELS.map(model => <option value={model.posture} key={model.key}>{model.label}</option>)}</select></label>
      <label className="field"><span>Display style</span><select value={spec.style} onChange={event => configure({ ...spec, style: event.target.value as CataloguePerson["style"] })}><option value="CASUAL">Casual</option><option value="SMART">Smart</option><option value="MANNEQUIN">Mannequin</option></select></label>
      <label className="field"><span>Stature preset</span><select value={STATURE_PRESETS.some(height => Math.abs(height - spec.stature_mm) < .01) ? Math.round(spec.stature_mm) : ""} onChange={event => { if (event.target.value) { const stature_mm = Number(event.target.value); configure({ ...spec, stature_mm, ...(!spec.support ? { seat_height_mm: .245 * stature_mm } : {}) }); } }}><option value="">Custom</option>{STATURE_PRESETS.map(height => <option key={height} value={height}>{formatLength(height, displayUnits)}</option>)}</select></label>
      <label className="field"><span>Standing stature {UNIT_LABEL[displayUnits]}</span><DisplayNumberInput minMm={600} maxMm={2300} units={displayUnits} valueMm={spec.stature_mm} onMmChange={stature_mm => configure({ ...spec, stature_mm, ...(!spec.support ? { seat_height_mm: .245 * stature_mm } : {}) })} /></label>
    </div>
    <p className="people-control-note">Stature is standing height. Pose envelope: {formatLength(value.dimensions.width.value, displayUnits)} × {formatLength(value.dimensions.depth.value, displayUnits)} × {formatLength(value.dimensions.height.value, displayUnits)}.</p>
    {spec.posture !== "STANDING" && <div className="people-support-controls">
      <label className="field"><span>{spec.posture === "LYING" ? "Bed" : "Seat or bed"}</span><select aria-label="Supporting furniture" value={host?.id ?? ""} onChange={event => { setSupportId(event.target.value); const item = hosts.find(item => item.id === event.target.value); if (item) setContactHeight(nominalSupportHeight(item)); setSide(0); }}><option value="">Choose furniture in this room</option>{hosts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <div className="fixture-fields two-columns">
        <label className="field"><span>Surface above furniture base {UNIT_LABEL[displayUnits]}</span><DisplayNumberInput minMm={0} units={displayUnits} valueMm={contactHeight} onMmChange={setContactHeight} /></label>
        <label className="field"><span>Position on furniture</span><select value={side} onChange={event => setSide(Number(event.target.value))}><option value={0}>Centre</option>{host && host.dimensions.width.value > 800 && <><option value={-1}>Left</option><option value={1}>Right</option></>}</select></label>
      </div>
      <button type="button" disabled={!host} onClick={() => { try { if (host) apply(placePersonOnSupport(value, host, contactHeight, side * host.dimensions.width.value * .28)); } catch (reason) { setError(reason instanceof Error ? reason.message : "Review the support."); } }}>Align to furniture</button>
      <p className="people-control-note">Surface height starts as a nominal estimate—check the actual cushion or mattress. Attached people follow furniture; dragging a person detaches it.</p>
      {spec.support && <p role="status">Attached to {room.obstacles.find(item => item.id === spec.support!.obstacle_id)?.name ?? "furniture"}.</p>}
      <button type="button" onClick={() => { setSupportId(""); apply(withPersonSpec({ ...value, base_z_mm: 0 }, { ...spec, support: undefined, seat_height_mm: .245 * spec.stature_mm })); }}>Detach from furniture</button>
    </div>}
    {error && <p className="inline-error" role="alert">{error}</p>}
  </section>;
}
