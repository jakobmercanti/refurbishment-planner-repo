"use client";

import { useMemo, useState } from "react";
import { EditableNumberInput } from "@/components/EditableNumberInput";
import {
  fixtureKindForObstacle,
  modelForObstacle,
  modelsForKind,
  type FixtureKind,
  type FixtureModel,
} from "@/lib/fixtureCatalog";
import type { Measurement, Obstacle, Room } from "@/lib/types";

interface FixtureEditorProps {
  room: Room;
  onChange: (obstacles: Obstacle[]) => void;
}

function measured(value: number): Measurement {
  return {
    value,
    uncertainty_mm: 5,
    verified: false,
    source_type: "USER_MEASURED",
  };
}

function roomCentre(room: Room) {
  const minX = Math.min(...room.vertices.map((vertex) => vertex.x));
  const maxX = Math.max(...room.vertices.map((vertex) => vertex.x));
  const minY = Math.min(...room.vertices.map((vertex) => vertex.y));
  const maxY = Math.max(...room.vertices.map((vertex) => vertex.y));
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

export function FixtureEditor({ room, onChange }: FixtureEditorProps) {
  const initialModel = modelsForKind("SHOWER")[0];
  const centre = useMemo(() => roomCentre(room), [room]);
  const fixtures = room.obstacles.filter((obstacle) => fixtureKindForObstacle(obstacle) !== "FIXED");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [kind, setKind] = useState<FixtureKind>("SHOWER");
  const [modelId, setModelId] = useState(initialModel.id);
  const [name, setName] = useState(initialModel.name);
  const [x, setX] = useState(centre.x);
  const [y, setY] = useState(centre.y);
  const [rotation, setRotation] = useState(0);
  const [width, setWidth] = useState(initialModel.width);
  const [depth, setDepth] = useState(initialModel.depth);
  const [height, setHeight] = useState(initialModel.height);
  const [error, setError] = useState<string | null>(null);

  const availableModels = modelsForKind(kind);

  function applyModel(model: FixtureModel) {
    setModelId(model.id);
    setName(model.name);
    setWidth(model.width);
    setDepth(model.depth);
    setHeight(model.height);
    setError(null);
  }

  function changeKind(nextKind: FixtureKind) {
    setKind(nextKind);
    applyModel(modelsForKind(nextKind)[0]);
  }

  function resetForm() {
    const model = modelsForKind("SHOWER")[0];
    setEditingId(null);
    setKind("SHOWER");
    applyModel(model);
    setX(centre.x);
    setY(centre.y);
    setRotation(0);
    setError(null);
  }

  function editFixture(obstacle: Obstacle) {
    const inferredKind = fixtureKindForObstacle(obstacle);
    if (inferredKind === "FIXED") return;
    const model = modelForObstacle(obstacle) ?? modelsForKind(inferredKind)[0];
    setEditingId(obstacle.id);
    setKind(inferredKind);
    setModelId(model.id);
    setName(obstacle.name);
    setX(obstacle.center.x);
    setY(obstacle.center.y);
    setRotation(obstacle.rotation_deg);
    setWidth(obstacle.dimensions.width.value);
    setDepth(obstacle.dimensions.depth.value);
    setHeight(obstacle.dimensions.height.value);
    setError(null);
  }

  function saveFixture() {
    const values = [x, y, rotation, width, depth, height];
    if (!values.every(Number.isFinite)) {
      setError("Position, rotation and dimensions must be valid numbers.");
      return;
    }
    if (width <= 0 || depth <= 0 || height <= 0) {
      setError("Width, depth and height must be greater than zero.");
      return;
    }

    const current = editingId ? room.obstacles.find((obstacle) => obstacle.id === editingId) : undefined;
    const fixture: Obstacle = {
      ...current,
      id: editingId ?? `fixture-${crypto.randomUUID().slice(0, 8)}`,
      name,
      kind: "BOX",
      center: { x, y },
      dimensions: {
        width: measured(width),
        depth: measured(depth),
        height: measured(height),
      },
      base_z_mm: 0,
      rotation_deg: rotation,
      source_type: "USER_MEASURED",
      verified: false,
      fixture_kind: kind,
      model_id: modelId,
    };
    onChange(editingId
      ? room.obstacles.map((obstacle) => obstacle.id === editingId ? fixture : obstacle)
      : [...room.obstacles, fixture]);
    resetForm();
  }

  function removeFixture(id: string) {
    onChange(room.obstacles.filter((obstacle) => obstacle.id !== id));
    if (editingId === id) resetForm();
  }

  return (
    <section className="fixture-editor" aria-label="Bathroom fixture editor">
      <div className="fixture-heading">
        <div><span className="eyebrow">Bathroom elements</span><h2>{editingId ? "Update fixture" : "Add fixture"}</h2></div>
        <span>{fixtures.length} placed</span>
      </div>

      {editingId && <p className="editing-notice">Editing the selected item. Update its model, position, rotation or dimensions below.</p>}

      <div className="fixture-selectors">
        <label className="field"><span>Element</span><select value={kind} onChange={(event) => changeKind(event.target.value as FixtureKind)}><option value="SHOWER">Shower enclosure</option><option value="BASIN">Basin</option><option value="TOILET">Toilet</option></select></label>
        <label className="field"><span>Model</span><select value={modelId} onChange={(event) => { const model = availableModels.find((item) => item.id === event.target.value); if (model) applyModel(model); }}>{availableModels.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label>
      </div>

      <div className="fixture-field-group">
        <span>Position</span>
        <div className="fixture-fields three-columns">
          <label className="field"><span>X <small>mm</small></span><EditableNumberInput value={x} onValueChange={setX} /></label>
          <label className="field"><span>Y <small>mm</small></span><EditableNumberInput value={y} onValueChange={setY} /></label>
          <label className="field"><span>Rotation <small>°</small></span><EditableNumberInput step="90" value={rotation} onValueChange={setRotation} /></label>
        </div>
      </div>

      <div className="fixture-field-group">
        <span>Dimensions</span>
        <div className="fixture-fields three-columns">
          <label className="field"><span>Width <small>mm</small></span><EditableNumberInput min="1" value={width} onValueChange={setWidth} /></label>
          <label className="field"><span>Depth <small>mm</small></span><EditableNumberInput min="1" value={depth} onValueChange={setDepth} /></label>
          <label className="field"><span>Height <small>mm</small></span><EditableNumberInput min="1" value={height} onValueChange={setHeight} /></label>
        </div>
      </div>

      {error && <p className="inline-error">{error}</p>}
      <div className="fixture-form-actions">
        {editingId && <button onClick={resetForm}>Cancel edit</button>}
        <button className="fixture-save" onClick={saveFixture}>{editingId ? "Update fixture" : "Add fixture"}</button>
      </div>

      {fixtures.length > 0 && (
        <div className="fixture-list">
          {fixtures.map((fixture) => {
            const fixtureKind = fixtureKindForObstacle(fixture);
            return (
              <article key={fixture.id} className={editingId === fixture.id ? "editing" : ""}>
                <span className={`fixture-kind fixture-${fixtureKind.toLowerCase()}`}>{fixtureKind}</span>
                <div><strong>{fixture.name}</strong><p>{fixture.dimensions.width.value.toFixed(0)} × {fixture.dimensions.depth.value.toFixed(0)} mm · X {fixture.center.x.toFixed(0)}, Y {fixture.center.y.toFixed(0)}</p></div>
                <button className="edit-fixture" onClick={() => editFixture(fixture)}>Edit</button>
                <button className="remove-fixture" onClick={() => removeFixture(fixture.id)} aria-label={`Remove ${fixture.name}`}>×</button>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
