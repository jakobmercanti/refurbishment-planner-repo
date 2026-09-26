"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ComponentColours } from "@/components/ComponentColours";
import { DisplayNumberInput } from "@/components/DisplayNumberInput";
import { OpeningPreview, openingPreviewObstacle } from "@/components/OpeningPreview";
import { doorModel } from "@/lib/doorModels";
import { closestValidOpeningOffset, cornerOffsetsOnWallSegment } from "@/lib/openingPlacement";
import { openingCatalogueCategoryLabel, openingCatalogueDefaultDimensions } from "@/lib/openingCatalogue";
import type { PlacementCandidate, PlacementRequest, PlacementWall } from "@/lib/elementPlacement";
import type { CatalogueItem, Measurement, Obstacle, Opening, Room } from "@/lib/types";
import { formatLength, UNIT_LABEL, type DisplayUnits } from "@/lib/units";

type OpeningKind = "DOOR" | "WINDOW";
type OpeningCategory = { id: string; label: string; items: CatalogueItem[] };

function measurement(value: number): Measurement {
  return { value, uncertainty_mm: 5, verified: false, source_type: "USER_MEASURED" };
}

function liesOnWallSegment(point: { x: number; y: number }, wall: PlacementWall): boolean {
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const squared = dx * dx + dy * dy;
  if (!squared) return false;
  const along = Math.max(0, Math.min(1, ((point.x - wall.start.x) * dx + (point.y - wall.start.y) * dy) / squared));
  return Math.hypot(point.x - wall.start.x - along * dx, point.y - wall.start.y - along * dy) <= 1;
}

export function ViewerOpeningEditor({
  kind, room, apiUrl, displayUnits, onRoomChange, onBeginPlacement, onEditOpening, placementWalls = [], refreshKey = 0,
}: {
  kind: OpeningKind;
  room: Room;
  apiUrl: string;
  displayUnits: DisplayUnits;
  onRoomChange: (room: Room) => void;
  onBeginPlacement: (request: PlacementRequest) => void;
  onEditOpening: (selection: { id: string; roomId: string }) => void;
  placementWalls?: PlacementWall[];
  refreshKey?: number;
}) {
  const [items, setItems] = useState<CatalogueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [catalogueError, setCatalogueError] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [itemId, setItemId] = useState("");
  const [width, setWidth] = useState(800);
  const [height, setHeight] = useState(2040);
  const [sill, setSill] = useState(900);
  const [colour, setColour] = useState("#5b4330");
  const [componentColours, setComponentColours] = useState<Record<string, string>>({});
  const [hingeSide, setHingeSide] = useState<"START" | "END">("START");
  const [opensInward, setOpensInward] = useState(true);
  const [selectorOpen, setSelectorOpen] = useState<"category" | "object" | null>(null);
  const [selectorExpanded, setSelectorExpanded] = useState(true);
  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null);
  const [positionExpanded, setPositionExpanded] = useState(false);
  const [listExpanded, setListExpanded] = useState(true);
  const [wallChoice, setWallChoice] = useState("AUTO");
  const [offset, setOffset] = useState(100);
  const [error, setError] = useState("");
  const initializedItem = useRef("");
  const selectorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${apiUrl}/catalog/items`, { signal: controller.signal, cache: "no-store" })
      .then(response => {
        if (!response.ok) throw new Error("Object catalogue is unavailable.");
        return response.json() as Promise<CatalogueItem[]>;
      })
      .then(records => { setItems(records); setCatalogueError(""); setLoading(false); })
      .catch(reason => { if (!controller.signal.aborted) { setCatalogueError(reason instanceof Error ? reason.message : "Object catalogue is unavailable."); setLoading(false); } });
    const refresh = () => {
      void fetch(`${apiUrl}/catalog/items`, { signal: controller.signal, cache: "no-store" })
        .then(response => { if (!response.ok) throw new Error("Object catalogue is unavailable."); return response.json() as Promise<CatalogueItem[]>; })
        .then(records => { setItems(records); setCatalogueError(""); setLoading(false); })
        .catch(reason => { if (!controller.signal.aborted) { setCatalogueError(reason instanceof Error ? reason.message : "Object catalogue is unavailable."); setLoading(false); } });
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("catalogue-changed", refresh);
    return () => { controller.abort(); window.removeEventListener("focus", refresh); window.removeEventListener("catalogue-changed", refresh); };
  }, [apiUrl, refreshKey]);

  const categories = useMemo<OpeningCategory[]>(() => {
    const grouped = new Map<string, OpeningCategory>();
    items.filter(item => item.fixture_kind === kind).forEach(item => {
      const label = openingCatalogueCategoryLabel(item);
      const id = `${item.category_id}:${label}`;
      const current = grouped.get(id);
      if (current) current.items.push(item);
      else grouped.set(id, { id, label, items: [item] });
    });
    return [...grouped.values()];
  }, [items, kind]);
  const activeCategory = categories.find(category => category.id === categoryId)
    ?? categories.find(category => category.items.some(item => item.id === itemId))
    ?? categories.find(category => category.items.some(item => item.is_default))
    ?? categories[0];
  const selected = activeCategory?.items.find(item => item.id === itemId)
    ?? activeCategory?.items.find(item => item.is_default)
    ?? activeCategory?.items[0];
  const doorTypeFor = (item?: CatalogueItem): "SINGLE" | "DOUBLE" => item?.fixture_kind === "DOOR"
    && (doorModel(item.representation_key)?.leaves ?? (item.subcategory.toLowerCase().includes("double") ? 2 : 1)) > 1 ? "DOUBLE" : "SINGLE";
  const doorType = doorTypeFor(selected);
  const hoveredItem = hoveredItemId ? items.find(item => item.id === hoveredItemId && item.fixture_kind === kind) : undefined;
  const previewItem = hoveredItem && hoveredItem.id !== selected?.id ? hoveredItem : selected;
  const previewingHover = Boolean(previewItem && previewItem.id !== selected?.id);
  const previewDoorType = doorTypeFor(previewItem);

  useEffect(() => {
    if (!selected || initializedItem.current === selected.id) return;
    initializedItem.current = selected.id;
    const defaults = openingCatalogueDefaultDimensions(selected);
    setItemId(selected.id);
    setWidth(selected.width_mm);
    setHeight(defaults.height);
    setSill(defaults.sill);
    setColour(selected.color_hex);
    setComponentColours({});
    setHingeSide("START");
    setOpensInward(true);
    setError("");
  }, [selected]);

  useEffect(() => {
    if (!selectorOpen) return;
    const closeOutside = (event: PointerEvent) => { if (!selectorRef.current?.contains(event.target as Node)) { setSelectorOpen(null); setHoveredItemId(null); } };
    const closeEscape = (event: KeyboardEvent) => { if (event.key === "Escape") { setSelectorOpen(null); setHoveredItemId(null); } };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeEscape);
    return () => { document.removeEventListener("pointerdown", closeOutside); document.removeEventListener("keydown", closeEscape); };
  }, [selectorOpen]);

  const dimensionsContent = <div className="appearance-dimensions-fields coordinate-fields opening-dimensions-fields" aria-label="Dimensions">
    <label className="field"><span>Width {UNIT_LABEL[displayUnits]}</span><DisplayNumberInput minMm={1} valueMm={width} units={displayUnits} onMmChange={setWidth} /></label>
    <label className="field"><span>Height {UNIT_LABEL[displayUnits]}</span><DisplayNumberInput minMm={1} valueMm={height} units={displayUnits} onMmChange={setHeight} /></label>
    {kind === "WINDOW" && <label className="field"><span>Sill {UNIT_LABEL[displayUnits]}</span><DisplayNumberInput minMm={0} valueMm={sill} units={displayUnits} onMmChange={setSill} />
    </label>}
  </div>;

  function resetDimensions() {
    if (!selected) return;
    const defaults = openingCatalogueDefaultDimensions(selected);
    setWidth(selected.width_mm);
    setHeight(defaults.height);
    if (kind === "WINDOW") setSill(defaults.sill);
  }

  function beginPlacement() {
    if (!selected) return;
    if (![width, height, sill, offset].every(Number.isFinite) || width <= 0 || height <= 0 || sill < 0
      || (kind === "WINDOW" ? sill : 0) + height > room.wall_height.value) {
      setError("Enter positive opening dimensions that fit within the wall height.");
      return;
    }
    const candidateWalls = room.vertices.flatMap((start, index) => {
      const end = room.vertices[(index + 1) % room.vertices.length];
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const id = `wall-${String(index + 1).padStart(3, "0")}`;
      const length = Math.hypot(dx, dy);
      if (!length || (wallChoice !== "AUTO" && wallChoice !== id)) return [];
      const requestedOffset = wallChoice === "AUTO" ? 0 : offset;
      const occupied = room.openings.filter(opening => opening.parent_wall_id === id).map(opening => ({ offset: opening.offset_mm, width: opening.width.value }));
      const validOffset = closestValidOpeningOffset(requestedOffset, width, length, cornerOffsetsOnWallSegment(start, end, room.vertices), occupied, 50);
      if (validOffset === null) return [];
      const openingStart = { x: start.x + dx * validOffset / length, y: start.y + dy * validOffset / length };
      const openingEnd = { x: openingStart.x + dx * width / length, y: openingStart.y + dy * width / length };
      const fitsFloorplanSegment = !room.source_floorplan_room_id || (placementWalls.length > 0
        && placementWalls.some(wall => liesOnWallSegment(openingStart, wall) && liesOnWallSegment(openingEnd, wall)));
      return fitsFloorplanSegment ? [id] : [];
    });
    if (!candidateWalls.length) {
      setError("There is no wall with enough clear length for this opening. Choose another wall or reduce its width.");
      return;
    }
    const id = crypto.randomUUID();
    const previewObstacle = openingPreviewObstacle({ item: selected, kind, doorType, width, height, colorHex: colour, componentColors: componentColours });
    const obstacle: Obstacle = { ...previewObstacle, id: "opening-preview", base_z_mm: kind === "WINDOW" ? sill : 0 };
    const request: PlacementRequest = {
      id,
      obstacle,
      opening: { kind, doorType, hingeSide, opensInward },
      resolve: point => {
        const candidates = room.vertices.flatMap((start, index) => {
          const end = room.vertices[(index + 1) % room.vertices.length];
          const dx = end.x - start.x;
          const dy = end.y - start.y;
          const length = Math.hypot(dx, dy);
          const currentWallId = `wall-${String(index + 1).padStart(3, "0")}`;
          if (!length || (wallChoice !== "AUTO" && wallChoice !== currentWallId)) return [];
          const projectedAlong = wallChoice === "AUTO"
            ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (length * length)))
            : 0;
          const requestedOffset = wallChoice === "AUTO" ? projectedAlong * length - width / 2 : offset;
          const blockers = room.openings.filter(opening => opening.parent_wall_id === currentWallId)
            .map(opening => ({ offset: opening.offset_mm, width: opening.width.value }));
          const validOffset = closestValidOpeningOffset(requestedOffset, width, length,
            cornerOffsetsOnWallSegment(start, end, room.vertices), blockers, 50);
          if (validOffset === null) return [];
          const openingStart = { x: start.x + dx * validOffset / length, y: start.y + dy * validOffset / length };
          const openingEnd = { x: openingStart.x + dx * width / length, y: openingStart.y + dy * width / length };
          if (room.source_floorplan_room_id && (!placementWalls.length
            || !placementWalls.some(wall => liesOnWallSegment(openingStart, wall) && liesOnWallSegment(openingEnd, wall)))) return [];
          const centre = {
            x: start.x + dx * (validOffset + width / 2) / length,
            y: start.y + dy * (validOffset + width / 2) / length,
          };
          const distance = Math.hypot(centre.x - point.x, centre.y - point.y);
          if (distance > Math.max(400, width * .6)) return [];
          if ((kind === "WINDOW" ? sill : 0) + height > room.wall_height.value) return [];
          const opening: Opening = {
            id,
            kind,
            parent_wall_id: currentWallId,
            offset_mm: validOffset,
            width: measurement(width),
            height: measurement(height),
            sill_height_mm: kind === "WINDOW" ? sill : 0,
            reveal_depth_mm: room.wall_thickness_overrides_mm?.[currentWallId] ?? room.wall_thickness.value,
            ...(kind === "DOOR" ? { hinge_side: hingeSide, door_type: doorType, swing_angle_deg: 90, opens_inward: opensInward } : {}),
            metadata: {
              catalogue_item_id: selected.id,
              representation_key: previewObstacle.representation_key,
              window_depth_mm: selected.depth_mm,
              color_hex: colour,
              component_colors: { ...componentColours },
            },
          };
          const candidateObstacle: Obstacle = {
            ...obstacle,
            center: centre,
            rotation_deg: Math.atan2(dy, dx) * 180 / Math.PI,
          };
          return [{
            obstacle: candidateObstacle,
            roomId: room.id,
            opening: {
              wallId: currentWallId,
              segmentIndex: 0,
              offset: validOffset,
              start,
              end,
              thickness: opening.reveal_depth_mm ?? room.wall_thickness.value,
            },
            openingModel: { room, opening },
            distance,
          }];
        });
        return candidates.sort((a, b) => a.distance - b.distance)[0] ?? null;
      },
      commit: (candidate: PlacementCandidate) => {
        const opening = candidate.openingModel?.opening;
        if (!opening || candidate.roomId !== room.id || room.openings.some(existing => existing.id === opening.id)) return false;
        onRoomChange({ ...room, version: room.version + 1, openings: [...room.openings, opening] });
        return true;
      },
    };
    setError("");
    onBeginPlacement(request);
  }

  function removeOpening(openingId: string) {
    onRoomChange({ ...room, version: room.version + 1, openings: room.openings.filter(opening => opening.id !== openingId) });
  }

  return <section className="tool-section full-plan-openings-panel viewer-opening-editor" aria-label={`Add ${kind === "DOOR" ? "doors" : "windows"}`}>
    <p className="tool-note">Choose a catalogue model and size, then click the wall in the 3D view to place it. Openings keep clear of corners and existing doors or windows.</p>
    {catalogueError && <p role="alert" className="inline-error">{catalogueError}</p>}
    {categories.length > 0 && <>
      <div className="fixture-cascading-menu" ref={selectorRef}>
        {!selectorExpanded ? <div className="fixture-cascading-collapsed"><strong>{selected?.name.replace(/^Default /i, "") ?? "Select object"}</strong><button type="button" aria-label={`Expand ${kind === "DOOR" ? "door" : "window"} selector`} aria-expanded={false} onClick={() => setSelectorExpanded(true)}>▾</button></div>
          : <div className="fixture-cascading-selector" aria-label={`${kind === "DOOR" ? "Door" : "Window"} catalogue selector`}>
            <div className="fixture-cascading-menu-header"><strong>{selected?.name.replace(/^Default /i, "") ?? "Select object"}</strong><button type="button" aria-label={`Collapse ${kind === "DOOR" ? "door" : "window"} selector`} aria-expanded={true} onClick={() => { setSelectorOpen(null); setHoveredItemId(null); setSelectorExpanded(false); }}>▴</button></div>
            <div className="fixture-cascading-level">
              <button type="button" className="fixture-cascading-trigger" aria-expanded={selectorOpen === "category"} aria-controls="viewer-opening-category-options" onClick={() => setSelectorOpen(current => current === "category" ? null : "category")}>
                <span className="fixture-cascading-trigger-copy"><span>Category</span><strong>{activeCategory?.label ?? "Select category"}</strong></span><span className="fixture-cascading-chevron" aria-hidden>{selectorOpen === "category" ? "▴" : "▾"}</span>
              </button>
              {selectorOpen === "category" && <div id="viewer-opening-category-options" className="fixture-cascading-options" role="listbox" aria-label={`${kind === "DOOR" ? "Door" : "Window"} categories`}>
                {categories.map(category => <button type="button" role="option" aria-selected={category.id === activeCategory?.id} className={category.id === activeCategory?.id ? "selected" : undefined} key={category.id} onClick={() => { setCategoryId(category.id); setItemId(""); initializedItem.current = ""; setHoveredItemId(null); setSelectorOpen(null); }}>{category.label}</button>)}
              </div>}
            </div>
            <div className="fixture-cascading-level">
              <button type="button" className="fixture-cascading-trigger" disabled={!activeCategory?.items.length} aria-expanded={selectorOpen === "object"} aria-controls="viewer-opening-object-options" onClick={() => setSelectorOpen(current => current === "object" ? null : "object")}>
                <span className="fixture-cascading-trigger-copy"><span>Object</span><strong className={!selected ? "placeholder" : undefined}>{selected?.subcategory || selected?.name.replace(/^Default /i, "") || "Select object"}</strong></span><span className="fixture-cascading-chevron" aria-hidden>{selectorOpen === "object" ? "▴" : "▾"}</span>
              </button>
              {selectorOpen === "object" && <div id="viewer-opening-object-options" className="fixture-cascading-options" role="listbox" aria-label={`${kind === "DOOR" ? "Door" : "Window"} objects`}>
                {activeCategory?.items.map(item => <button type="button" role="option" aria-selected={item.id === selected?.id} className={item.id === selected?.id ? "selected" : undefined} key={item.id} onMouseEnter={() => setHoveredItemId(item.id)} onMouseLeave={() => setHoveredItemId(null)} onFocus={() => setHoveredItemId(item.id)} onBlur={() => setHoveredItemId(null)} onClick={() => { setItemId(item.id); initializedItem.current = ""; setHoveredItemId(null); setSelectorOpen(null); setSelectorExpanded(false); }}>{item.subcategory || item.name.replace(/^Default /i, "")}</button>)}
              </div>}
            </div>
          </div>}
      </div>
      {selected && <>
        <ComponentColours compact dimensionsContent={dimensionsContent} onResetDimensions={resetDimensions}
          previewObstacle={openingPreviewObstacle({ item: selected, kind, doorType, width, height, colorHex: colour, componentColors: componentColours })}
          source={{ ...selected, color_hex: colour, component_colors: componentColours }}
          onChange={setComponentColours} />
        {previewItem && <OpeningPreview item={previewItem} kind={kind} doorType={previewDoorType} width={previewingHover ? previewItem.width_mm : width} height={previewingHover ? openingCatalogueDefaultDimensions(previewItem).height : height} colorHex={previewingHover ? previewItem.color_hex : colour} componentColors={previewingHover ? {} : componentColours} />}
        <section className="fixture-add-section" aria-label="Position">
          <button type="button" className="fixture-section-toggle" aria-expanded={positionExpanded} onClick={() => setPositionExpanded(value => !value)}>
            <span><strong>Position</strong><small>{wallChoice === "AUTO" ? "Choose a wall in the 3D view" : `Wall ${Number(wallChoice.split("-")[1])} · Offset ${formatLength(offset, displayUnits)}`}</small></span><span aria-hidden>{positionExpanded ? "−" : "›"}</span>
          </button>
          {positionExpanded && <div className="fixture-section-content">
            <div className="coordinate-fields opening-fields">
              <label className="field"><span>Parent wall</span><select value={wallChoice} onChange={event => setWallChoice(event.target.value)}><option value="AUTO">Choose in 3D view</option>{room.vertices.map((_, index) => { const id = `wall-${String(index + 1).padStart(3, "0")}`; return <option key={id} value={id}>Wall {index + 1}</option>; })}</select></label>
              {wallChoice !== "AUTO" && <label className="field"><span>Offset {UNIT_LABEL[displayUnits]}</span><DisplayNumberInput minMm={0} valueMm={offset} units={displayUnits} onMmChange={setOffset} /></label>}
            </div>
            {kind === "DOOR" && <div className="coordinate-fields opening-fields">
              <label className="field"><span>Hinge side</span><select disabled={doorType === "DOUBLE"} value={hingeSide} onChange={event => setHingeSide(event.target.value as "START" | "END")}><option value="START">Wall start</option><option value="END">Wall end</option></select></label>
              <label className="field"><span>Direction</span><select value={opensInward ? "IN" : "OUT"} onChange={event => setOpensInward(event.target.value === "IN")}><option value="IN">Into room</option><option value="OUT">Out of room</option></select></label>
            </div>}
          </div>}
        </section>
        {error && <p className="inline-error" role="alert">{error}</p>}
        <button type="button" className="primary-small" onClick={beginPlacement}>Add {kind === "DOOR" ? "door" : "window"}</button>
      </>}
    </>}
    {loading && <p>Loading object catalogue…</p>}
    {!loading && !catalogueError && !categories.length && <p>No {kind === "DOOR" ? "door" : "window"} models are available in the catalogue.</p>}
    {room.openings.length > 0 && <section className="fixture-add-section elements-list-section" aria-label="Elements list">
      <button type="button" className="fixture-section-toggle" aria-expanded={listExpanded} onClick={() => setListExpanded(value => !value)}><span><strong>Elements list</strong></span><span aria-hidden>{listExpanded ? "−" : "›"}</span></button>
      {listExpanded && <div className="fixture-section-content elements-list-content"><div className="full-opening-list">
        {room.openings.map(opening => {
          const item = items.find(candidate => candidate.id === opening.metadata?.catalogue_item_id);
          const name = item?.name.replace(/^Default /i, "") ?? `${opening.kind === "WINDOW" ? "Window" : "Door"} · Wall ${Number(opening.parent_wall_id.split("-")[1])}`;
          return <div key={opening.id}>
            <span className={`opening-chip ${opening.kind.toLowerCase()}`}>{opening.kind}</span><small title={name}>{name} · {formatLength(opening.width.value, displayUnits)}</small>
            <button type="button" className="edit-opening" onClick={() => onEditOpening({ id: opening.id, roomId: room.id })}>Edit</button>
            <button type="button" aria-label={`Remove ${opening.kind.toLowerCase()}`} onClick={() => removeOpening(opening.id)}>×</button>
          </div>;
        })}
      </div></div>}
    </section>}
  </section>;
}
