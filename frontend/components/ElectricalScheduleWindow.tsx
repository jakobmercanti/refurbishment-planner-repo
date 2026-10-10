"use client";

import { useEffect, useMemo, useState } from "react";
import { getElectricalImage, storeElectricalImage } from "@/lib/electricalAttachments";
import { electricalBomRows, electricalConnectionRows, electricalPlacedItems, formatDrawingLength } from "@/lib/electricalSchedule";
import type { ElectricalAttachmentRelation, ElectricalLayoutData, ElectricalManualBomItem } from "@/lib/electricalLayout";
import type { AssetDefinition, AssetInstance } from "@/lib/projectDocument";
import type { Room } from "@/lib/types";
import type { CurrencyCode } from "@/lib/appPreferences";

type Tab = "BOM" | "CIRCUITS";
type Props = {
  rooms: readonly Room[];
  assets: readonly AssetDefinition[];
  instances: readonly AssetInstance[];
  layout: ElectricalLayoutData;
  projectName: string;
  defaultCurrency?: CurrencyCode;
  onLayoutChange: (next: ElectricalLayoutData) => void;
};

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  const safe = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

function downloadCsv(name: string, rows: unknown[][]) {
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
  const safeName = name.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim() || "electrical-schedule.csv";
  const link = document.createElement("a"); link.href = url; link.download = safeName; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function makeId(prefix: string) { return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`; }
function formatMoney(value: number, currency = "GBP") {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(value); }
  catch { return `${currency} ${value.toFixed(2)}`; }
}

export function ElectricalScheduleWindow({ rooms, assets, instances, layout, projectName, defaultCurrency = "GBP", onLayoutChange }: Props) {
  const [tab, setTab] = useState<Tab>("BOM");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [manualDescription, setManualDescription] = useState("");
  const [manualQuantity, setManualQuantity] = useState("1");
  const [bomRoomFilter, setBomRoomFilter] = useState("");
  const [bomCategoryFilter, setBomCategoryFilter] = useState("");
  const [bomSourceFilter, setBomSourceFilter] = useState("ALL");
  const [bomSort, setBomSort] = useState("ITEM");
  const [connectionTypeFilter, setConnectionTypeFilter] = useState("");
  const [connectionRoomFilter, setConnectionRoomFilter] = useState("");
  const [connectionSort, setConnectionSort] = useState("NUMBER");
  const documentation = layout.documentation;
  const placed = useMemo(() => electricalPlacedItems(rooms, assets, instances), [rooms, assets, instances]);
  const bom = useMemo(() => electricalBomRows(rooms, layout, assets, instances), [rooms, layout, assets, instances]);
  const connectionRows = useMemo(() => electricalConnectionRows(layout, rooms), [layout, rooms]);
  const totalDrawingLength = connectionRows.reduce((sum, row) => sum + (row.drawingLengthMm ?? 0), 0);
  const searchTerm = search.trim().toLocaleLowerCase();
  const bomRooms = [...new Set(bom.flatMap((row) => row.roomNames))].sort();
  const bomCategories = [...new Set(bom.map((row) => row.category))].sort();
  const filteredBom = bom.filter((row) => !documentation.hiddenBomKeys.includes(row.bomKey)
    && (bomRoomFilter === "" || row.roomNames.includes(bomRoomFilter))
    && (bomCategoryFilter === "" || row.category === bomCategoryFilter)
    && bomSourceFilter !== "MANUAL"
    && `${row.name} ${row.category} ${row.roomNames.join(" ")} ${row.circuitNames.join(" ")} ${JSON.stringify(documentation.bomOverrides[row.bomKey] ?? {})}`.toLocaleLowerCase().includes(searchTerm));
  const visibleBom = [...filteredBom].sort((a, b) => {
    if (bomSort === "QUANTITY") return b.quantity - a.quantity || a.name.localeCompare(b.name);
    if (bomSort === "ROOM") return a.roomNames.join(", ").localeCompare(b.roomNames.join(", ")) || a.name.localeCompare(b.name);
    if (bomSort === "CIRCUIT") return a.circuitNames.join(", ").localeCompare(b.circuitNames.join(", ")) || a.name.localeCompare(b.name);
    if (bomSort === "COST") return (documentation.bomOverrides[a.bomKey]?.unitCost ?? Infinity) - (documentation.bomOverrides[b.bomKey]?.unitCost ?? Infinity) || a.name.localeCompare(b.name);
    return a.name.localeCompare(b.name);
  });
  const visibleManual = bomSourceFilter === "CALCULATED" ? [] : documentation.manualBomItems.filter((row) => `${row.description} ${row.manufacturer ?? ""} ${row.model ?? ""} ${row.partNumber ?? ""} ${row.supplier ?? ""} ${row.notes ?? ""}`.toLocaleLowerCase().includes(searchTerm));
  const connectionRooms = [...new Set(connectionRows.flatMap((row) => row.roomNames))].sort();
  const visibleConnections = [...connectionRows.filter((row) => (connectionTypeFilter === "" || row.connection.type === connectionTypeFilter)
    && (connectionRoomFilter === "" || row.roomNames.includes(connectionRoomFilter))
    && `${row.number} ${row.fromName} ${row.toName} ${row.circuitName} ${row.connection.type} ${row.roomNames.join(" ")} ${JSON.stringify(documentation.connectionNotes[row.connection.id] ?? {})}`.toLocaleLowerCase().includes(searchTerm))].sort((a, b) => {
      if (connectionSort === "FROM") return a.fromName.localeCompare(b.fromName);
      if (connectionSort === "TO") return a.toName.localeCompare(b.toName);
      if (connectionSort === "CIRCUIT") return a.circuitName.localeCompare(b.circuitName);
      if (connectionSort === "TYPE") return a.connection.type.localeCompare(b.connection.type);
      if (connectionSort === "LENGTH") return (a.drawingLengthMm ?? Infinity) - (b.drawingLengthMm ?? Infinity);
      return a.number.localeCompare(b.number);
    });
  const costTotals = new Map<string, number>();
  let pricedItemCount = 0;
  for (const row of bom.filter((item) => !documentation.hiddenBomKeys.includes(item.bomKey))) {
    const item = documentation.bomOverrides[row.bomKey];
    if (item?.unitCost !== undefined) { const currency = item.currency ?? defaultCurrency; costTotals.set(currency, (costTotals.get(currency) ?? 0) + (item.orderQuantity ?? row.quantity) * item.unitCost); pricedItemCount += 1; }
  }
  for (const item of documentation.manualBomItems) if (item.unitCost !== undefined) { const currency = item.currency ?? defaultCurrency; costTotals.set(currency, (costTotals.get(currency) ?? 0) + (item.orderQuantity ?? item.quantity) * item.unitCost); pricedItemCount += 1; }
  const materialTotalLabel = [...costTotals].sort(([a], [b]) => a.localeCompare(b)).map(([currency, value]) => formatMoney(value, currency)).join(" · ");
  const circuits = layout.circuits.map((circuit) => {
    const rows = connectionRows.filter((row) => row.connection.circuitId === circuit.id);
    const itemIds = new Set(rows.flatMap((row) => [row.connection.fromId, row.connection.toId]));
    return { circuit, rows, itemIds, roomNames: [...new Set(rows.flatMap((row) => row.roomNames))].sort() };
  });
  const relationKey = (relation: ElectricalAttachmentRelation) => relation.kind === "LAYOUT" ? "LAYOUT:" : `${relation.kind}:${relation.id}`;
  const attachmentRelations: ElectricalAttachmentRelation[] = [
    { kind: "LAYOUT" },
    ...bom.map((row) => ({ kind: "BOM" as const, id: row.bomKey })),
    ...documentation.manualBomItems.map((row) => ({ kind: "BOM" as const, id: row.bomRowId })),
    ...placed.map((item) => ({ kind: "ASSET" as const, id: item.id })),
    ...connectionRows.map((row) => ({ kind: "CONNECTION" as const, id: row.connection.id })),
    ...layout.circuits.map((circuit) => ({ kind: "CIRCUIT" as const, id: circuit.id })),
  ];
  const knownAttachmentRelations = new Set(attachmentRelations.map(relationKey));
  const orphanAttachments = documentation.attachments.filter((attachment) => attachment.relation.kind !== "LAYOUT" && !knownAttachmentRelations.has(relationKey(attachment.relation)));

  useEffect(() => {
    let active = true;
    const urls: string[] = [];
    void Promise.all(documentation.attachments.map(async (attachment) => {
      try { const blob = await getElectricalImage(attachment.attachmentId); const url = URL.createObjectURL(blob); if (!active) { URL.revokeObjectURL(url); return [attachment.attachmentId, ""] as const; } urls.push(url); return [attachment.attachmentId, url] as const; }
      catch { return [attachment.attachmentId, ""] as const; }
    })).then((entries) => { if (active) setPreviews(Object.fromEntries(entries)); });
    return () => { active = false; urls.forEach((url) => URL.revokeObjectURL(url)); };
  }, [documentation.attachments]);

  function changeDocumentation(patch: Partial<typeof documentation>) {
    onLayoutChange({ ...layout, documentation: { ...documentation, ...patch } });
  }
  function updateBom(bomKey: string, patch: Record<string, unknown>) {
    changeDocumentation({ bomOverrides: { ...documentation.bomOverrides, [bomKey]: { ...documentation.bomOverrides[bomKey], ...patch } } });
  }
  function updateManual(bomRowId: string, patch: Partial<ElectricalManualBomItem>) {
    changeDocumentation({ manualBomItems: documentation.manualBomItems.map((row) => row.bomRowId === bomRowId ? { ...row, ...patch } : row) });
  }
  function exportBomCsv() {
    const rows: unknown[][] = [["Item", "Category", "Calculated quantity", "Order quantity", "Unit", "Rooms", "Circuits", "Manufacturer", "Model", "Part number", "Supplier", "Currency", "Unit cost", "Line total", "Notes", "Status"]];
    for (const row of bom.filter((item) => !documentation.hiddenBomKeys.includes(item.bomKey))) {
      const override = documentation.bomOverrides[row.bomKey] ?? {};
      rows.push([override.description || row.name, row.category, row.quantity, override.orderQuantity ?? row.quantity, override.unit ?? "item", row.roomNames.join("; "), row.circuitNames.join("; "), override.manufacturer, override.model, override.partNumber, override.supplier, override.currency ?? defaultCurrency, override.unitCost, override.unitCost === undefined ? "" : (override.orderQuantity ?? row.quantity) * override.unitCost, override.notes, "Calculated"]);
    }
    for (const row of documentation.manualBomItems) rows.push([row.description, "Manual", row.quantity, row.orderQuantity ?? row.quantity, row.unit ?? "item", "", "", row.manufacturer, row.model, row.partNumber, row.supplier, row.currency ?? defaultCurrency, row.unitCost, row.unitCost === undefined ? "" : (row.orderQuantity ?? row.quantity) * row.unitCost, row.notes, "Manual"]);
    downloadCsv(`${projectName || "project"}-electrical-bom.csv`, rows);
  }
  function exportConnectionsCsv(segments = false) {
    const rows: unknown[][] = segments ? [["Connection", "Segment", "Orientation", "Drawing length (m)"]] : [["No.", "From", "To", "Circuit", "Type", "Line style", "Route", "Segments", "Drawing length (m)", "User cable allowance (m)", "Notes"]];
    for (const row of connectionRows) {
      const note = documentation.connectionNotes[row.connection.id];
      if (segments) row.segments?.forEach((segment, index) => rows.push([row.number, index + 1, segment.orientation, (segment.lengthMm / 1000).toFixed(1)]));
      else rows.push([row.number, row.fromName, row.toName, row.circuitName, row.connection.type, row.connection.lineStyle, row.connection.routing, row.segments?.length ?? "", row.drawingLengthMm === null ? "" : (row.drawingLengthMm / 1000).toFixed(1), note?.cableAllowanceM ?? "", [note?.description, note?.reference, note?.notes, note?.installationNote].filter(Boolean).join("; ")]);
    }
    downloadCsv(`${projectName || "project"}-electrical-connections${segments ? "-segments" : ""}.csv`, rows);
  }
  function exportCircuitsCsv() {
    downloadCsv(`${projectName || "project"}-electrical-circuits.csv`, [["Circuit", "Description", "Connected items", "Connections", "Rooms", "Colour", "Notes"], ...circuits.map(({ circuit, rows, itemIds, roomNames }) => [circuit.name, circuit.description ?? "", itemIds.size, rows.length, roomNames.join("; "), circuit.color, documentation.circuitNotes[circuit.id] ?? ""])]);
  }
  async function addPicture(file: File, relation: ElectricalAttachmentRelation = { kind: "LAYOUT" }) {
    setError(null); setMessage(null);
    if (documentation.attachments.length >= 30) { setError("A layout can include up to 30 reference pictures."); return; }
    const attachmentId = makeId("electrical-photo");
    try {
      const stored = await storeElectricalImage(attachmentId, file);
      changeDocumentation({ attachments: [...documentation.attachments, { attachmentId, fileName: stored.fileName, mediaType: stored.mediaType, sizeBytes: stored.sizeBytes, title: file.name.replace(/\.[^.]+$/, "").slice(0, 200), caption: "", notes: "", includeInExport: false, relation }] });
      setMessage("Reference picture added.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The picture could not be added."); }
  }
  function updateAttachment(id: string, patch: Partial<(typeof documentation.attachments)[number]>) {
    changeDocumentation({ attachments: documentation.attachments.map((item) => item.attachmentId === id ? { ...item, ...patch } : item) });
  }
  function renderAttachmentCard(attachment: (typeof documentation.attachments)[number]) {
    const value = relationKey(attachment.relation);
    return <article key={attachment.attachmentId} className="electrical-photo-card">
      {/* Local object URLs cannot be processed by the Next.js image optimizer. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {previews[attachment.attachmentId] && <img src={previews[attachment.attachmentId]} alt={attachment.title || "Electrical reference"} />}
      <div className="electrical-photo-fields">
        <label>Title<input defaultValue={attachment.title} onBlur={(event) => updateAttachment(attachment.attachmentId, { title: event.target.value })} /></label>
        <label>Caption<input defaultValue={attachment.caption} onBlur={(event) => updateAttachment(attachment.attachmentId, { caption: event.target.value })} /></label>
        <label>Notes<textarea defaultValue={attachment.notes} onBlur={(event) => updateAttachment(attachment.attachmentId, { notes: event.target.value })} /></label>
        <label>Relates to<select value={value} onChange={(event) => { const relation = attachmentRelations.find((item) => relationKey(item) === event.target.value); if (relation) updateAttachment(attachment.attachmentId, { relation }); }}>
          {attachmentRelations.map((relation) => <option key={relationKey(relation)} value={relationKey(relation)}>{relation.kind === "LAYOUT" ? "Electrical layout" : relation.kind === "BOM" ? `BOM · ${bom.find((row) => row.bomKey === relation.id)?.name ?? documentation.manualBomItems.find((row) => row.bomRowId === relation.id)?.description ?? "Manual item"}` : relation.kind === "ASSET" ? `Fitting · ${placed.find((item) => item.id === relation.id)?.name ?? "Electrical fitting"}` : relation.kind === "CONNECTION" ? `Connection · ${connectionRows.find((row) => row.connection.id === relation.id)?.number ?? "Connection"}` : `Circuit · ${layout.circuits.find((circuit) => circuit.id === relation.id)?.name ?? "Circuit"}`}</option>)}
        </select></label>
        <label className="electrical-inline-check"><input type="checkbox" checked={attachment.includeInExport} onChange={(event) => updateAttachment(attachment.attachmentId, { includeInExport: event.target.checked })} /> Include in export</label>
        <button type="button" className="danger-button" onClick={() => changeDocumentation({ attachments: documentation.attachments.filter((item) => item.attachmentId !== attachment.attachmentId) })}>Remove picture</button>
      </div>
    </article>;
  }
  function renderEntryPhotos(relations: ElectricalAttachmentRelation[]) {
    const attachments = documentation.attachments.filter((attachment) => relations.some((relation) => relationKey(relation) === relationKey(attachment.relation)));
    const relation = relations[0];
    return <section className="electrical-entry-photos">
      <header><strong>Notes &amp; photos</strong><label className="review-style-button electrical-photo-upload">Add picture<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void addPicture(file, relation); event.target.value = ""; }} /></label></header>
      <small>JPEG, PNG or WEBP · up to 5 MB each · stored privately in this browser/project.</small>
      {attachments.length ? attachments.map(renderAttachmentCard) : <p>No pictures attached to this entry.</p>}
    </section>;
  }
  function renderConnectionEntry(row: (typeof connectionRows)[number]) {
    const note = documentation.connectionNotes[row.connection.id] ?? {};
    const saveNote = (patch: Partial<typeof note>) => changeDocumentation({ connectionNotes: { ...documentation.connectionNotes, [row.connection.id]: { ...note, ...patch } } });
    return <details className="electrical-schedule-connection" key={row.connection.id}>
      <summary><span><strong>{row.number}</strong> · {row.fromName} → {row.toName}<small>{row.connection.type} · {row.connection.routing.toLowerCase()} · {row.connection.lineStyle.toLowerCase()}</small></span><strong>{formatDrawingLength(row.drawingLengthMm)} · {row.segments?.length ?? "—"} segments</strong></summary>
      <div className="electrical-connection-segments">
        {row.segments ? row.segments.map((segment, index) => <div key={index}><span>Segment {index + 1} · {segment.orientation}</span><strong>{formatDrawingLength(segment.lengthMm)}</strong></div>) : <p>Endpoint position is unavailable.</p>}
        <strong>Total drawing length: {formatDrawingLength(row.drawingLengthMm)}</strong>
        <label>Description<input defaultValue={note.description ?? ""} onBlur={(event) => saveNote({ description: event.target.value || undefined })} /></label>
        <label>Reference<input defaultValue={note.reference ?? ""} onBlur={(event) => saveNote({ reference: event.target.value || undefined })} /></label>
        <label>Installation notes<textarea defaultValue={note.installationNote ?? note.notes ?? ""} onBlur={(event) => saveNote({ installationNote: event.target.value || undefined })} /></label>
        <label>User cable allowance (m) · manual<input type="number" min="0" step="0.1" placeholder="Not specified" defaultValue={note.cableAllowanceM ?? ""} onBlur={(event) => { const raw = event.target.value.trim(); const value = raw ? Number(raw) : undefined; if (value === undefined || (Number.isFinite(value) && value >= 0)) saveNote({ cableAllowanceM: value }); }} /></label>
        {renderEntryPhotos([{ kind: "CONNECTION", id: row.connection.id }])}
      </div>
    </details>;
  }

  return <section className="electrical-schedule-panel" aria-label="Electrical BOM and schedule">
    <div className="electrical-schedule-stats" aria-label="Electrical layout summary">
      <div><small>Electrical assets</small><strong>{placed.length}</strong></div>
      <div><small>Unique BOM items</small><strong>{bom.length + documentation.manualBomItems.length}</strong></div>
      <div><small>Connections</small><strong>{connectionRows.length}</strong></div>
      <div><small>Circuits</small><strong>{layout.circuits.length}</strong></div>
      <div><small>Total drawing-line length</small><strong>{formatDrawingLength(totalDrawingLength)}</strong></div>
      {pricedItemCount > 0 && <div><small>Electrical materials · priced items</small><strong>{materialTotalLabel}</strong></div>}
    </div>
    <p className="electrical-schedule-disclaimer">Drawing-line lengths describe schematic lines on this plan. They are not physical cable lengths or cable quantities.</p>
    {error && <p className="inline-error" role="alert">{error}</p>}{message && <p className="electrical-layout-status" role="status">{message}</p>}
    <nav className="electrical-schedule-tabs" aria-label="Electrical schedule sections">
      {([["BOM", "BOM"], ["CIRCUITS", "Circuits"]] as const).map(([id, label]) => <button key={id} type="button" aria-pressed={tab === id} onClick={() => { setTab(id); setSearch(""); }}>{label}</button>)}
    </nav>
    {(tab === "BOM" || tab === "CIRCUITS") && <label className="electrical-schedule-search">Search <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Description, room, circuit, notes…" /></label>}
    {tab === "BOM" && <div className="electrical-schedule-filters" aria-label="BOM filters and sorting">
      <label>Room<select value={bomRoomFilter} onChange={(event) => setBomRoomFilter(event.target.value)}><option value="">All rooms</option>{bomRooms.map((roomName) => <option key={roomName}>{roomName}</option>)}</select></label>
      <label>Category<select value={bomCategoryFilter} onChange={(event) => setBomCategoryFilter(event.target.value)}><option value="">All categories</option>{bomCategories.map((category) => <option key={category}>{category}</option>)}</select></label>
      <label>Source<select value={bomSourceFilter} onChange={(event) => setBomSourceFilter(event.target.value)}><option value="ALL">Calculated & manual</option><option value="CALCULATED">Calculated only</option><option value="MANUAL">Manual only</option></select></label>
      <label>Sort by<select value={bomSort} onChange={(event) => setBomSort(event.target.value)}><option value="ITEM">Item</option><option value="QUANTITY">Quantity</option><option value="ROOM">Room</option><option value="CIRCUIT">Circuit</option><option value="COST">Unit cost</option></select></label>
    </div>}
    {tab === "CIRCUITS" && <div className="electrical-schedule-filters" aria-label="Connection filters and sorting">
      <label>Type<select value={connectionTypeFilter} onChange={(event) => setConnectionTypeFilter(event.target.value)}><option value="">All types</option><option value="CONTROL">Control</option><option value="POWER">Power</option><option value="GENERIC">Generic</option></select></label>
      <label>Room<select value={connectionRoomFilter} onChange={(event) => setConnectionRoomFilter(event.target.value)}><option value="">All rooms</option>{connectionRooms.map((roomName) => <option key={roomName}>{roomName}</option>)}</select></label>
      <label>Sort by<select value={connectionSort} onChange={(event) => setConnectionSort(event.target.value)}><option value="NUMBER">No.</option><option value="FROM">From</option><option value="TO">To</option><option value="CIRCUIT">Circuit</option><option value="TYPE">Type</option><option value="LENGTH">Drawing length</option></select></label>
    </div>}
    {tab === "BOM" && <details className="electrical-project-documentation electrical-bom-section">
      <summary>Bill of materials · {visibleBom.length + visibleManual.length} items</summary>
      <div className="electrical-schedule-tab-content">
      <div className="electrical-schedule-toolbar"><p>Calculated quantities stay linked to placed fittings. Order quantities and commercial details are editable.</p><button type="button" className="review-style-button" onClick={exportBomCsv}>Export BOM CSV</button></div>
      <div className="electrical-schedule-table-scroll"><table className="electrical-schedule-table electrical-bom-table"><thead><tr><th>Item</th><th>Type</th><th>Calculated</th><th>Order qty</th><th>Rooms / circuits</th><th>Unit cost</th><th>Line total</th><th>Details</th></tr></thead><tbody>
        {visibleBom.map((row) => { const override = documentation.bomOverrides[row.bomKey] ?? {}; const cost = override.unitCost; const orderQuantity = override.orderQuantity ?? row.quantity; return <tr key={row.bomKey}>
          <th scope="row">{override.description || row.name}<small>{row.category}</small></th><td>Calculated</td><td>{row.quantity} {override.unit ?? "item"}{row.quantity === 1 ? "" : "s"}</td>
          <td><input aria-label={`Order quantity for ${row.name}`} type="number" min="0" step="1" defaultValue={orderQuantity} onBlur={(event) => { const value = Number(event.target.value); if (Number.isFinite(value) && value >= 0) updateBom(row.bomKey, { orderQuantity: value }); }} /></td>
          <td>{row.roomNames.join(", ") || "—"}<small>{row.circuitNames.join(", ") || "No circuit assigned"}</small></td>
          <td><input aria-label={`Unit cost for ${row.name} (${override.currency ?? defaultCurrency})`} type="number" min="0" step="0.01" placeholder="—" defaultValue={cost ?? ""} onBlur={(event) => { const raw = event.target.value.trim(); const value = raw === "" ? undefined : Number(raw); if (value === undefined || (Number.isFinite(value) && value >= 0)) updateBom(row.bomKey, { unitCost: value }); }} /></td>
          <td>{cost === undefined ? "—" : formatMoney(orderQuantity * cost, override.currency ?? defaultCurrency)}</td>
          <td><details className="electrical-bom-detail"><summary>Edit · notes &amp; photos</summary><div className="electrical-bom-fields">
            {(["description", "manufacturer", "model", "partNumber", "supplier", "unit", "currency"] as const).map((key) => <label key={key}>{({ description: "Description", manufacturer: "Manufacturer", model: "Model", partNumber: "Part / catalogue no.", supplier: "Supplier", unit: "Unit", currency: "Currency" })[key]}<input defaultValue={override[key] ?? (key === "currency" ? defaultCurrency : "")} onBlur={(event) => updateBom(row.bomKey, { [key]: event.target.value || undefined })} /></label>)}
            <label className="wide">User notes<textarea defaultValue={override.notes ?? ""} maxLength={2000} onBlur={(event) => updateBom(row.bomKey, { notes: event.target.value || undefined })} /></label>
            {renderEntryPhotos([{ kind: "BOM", id: row.bomKey }, ...row.objectIds.map((id) => ({ kind: "ASSET" as const, id }))])}
            <label className="electrical-inline-check"><input type="checkbox" checked={documentation.hiddenBomKeys.includes(row.bomKey)} onChange={(event) => changeDocumentation({ hiddenBomKeys: event.target.checked ? [...documentation.hiddenBomKeys, row.bomKey] : documentation.hiddenBomKeys.filter((key) => key !== row.bomKey) })} /> Hide this calculated row from exports</label>
          </div></details></td></tr>; })}
        {visibleManual.map((row) => <tr key={row.bomRowId} className="electrical-manual-row"><th scope="row"><input aria-label="Manual item description" defaultValue={row.description} onBlur={(event) => updateManual(row.bomRowId, { description: event.target.value })} /><small>Manual item</small></th><td>Manual</td><td>{row.quantity}</td><td><input aria-label={`Order quantity for ${row.description}`} type="number" min="0" step="1" defaultValue={row.orderQuantity ?? row.quantity} onBlur={(event) => { const value = Number(event.target.value); if (Number.isFinite(value) && value >= 0) updateManual(row.bomRowId, { orderQuantity: value }); }} /></td><td>—</td><td><input aria-label={`Unit cost for ${row.description} (${row.currency ?? defaultCurrency})`} type="number" min="0" step="0.01" placeholder="—" defaultValue={row.unitCost ?? ""} onBlur={(event) => { const raw = event.target.value.trim(); const value = raw ? Number(raw) : undefined; if (value === undefined || (Number.isFinite(value) && value >= 0)) updateManual(row.bomRowId, { unitCost: value }); }} /></td><td>{row.unitCost === undefined ? "—" : formatMoney((row.orderQuantity ?? row.quantity) * row.unitCost, row.currency ?? defaultCurrency)}</td><td><details className="electrical-bom-detail"><summary>Edit · notes &amp; photos</summary><div className="electrical-bom-fields">{(["manufacturer", "model", "partNumber", "supplier", "unit", "currency"] as const).map((key) => <label key={key}>{key}<input defaultValue={row[key] ?? (key === "currency" ? defaultCurrency : "")} onBlur={(event) => updateManual(row.bomRowId, { [key]: event.target.value || undefined })} /></label>)}<label className="wide">Notes<textarea defaultValue={row.notes ?? ""} onBlur={(event) => updateManual(row.bomRowId, { notes: event.target.value || undefined })} /></label>{renderEntryPhotos([{ kind: "BOM", id: row.bomRowId }])}<button type="button" className="danger-button" onClick={() => changeDocumentation({ manualBomItems: documentation.manualBomItems.filter((item) => item.bomRowId !== row.bomRowId) })}>Delete manual row</button></div></details></td></tr>)}
        {!visibleBom.length && !visibleManual.length && <tr><td colSpan={8}>No matching BOM items.</td></tr>}
      </tbody></table></div>
      <form className="electrical-manual-bom-add" onSubmit={(event) => { event.preventDefault(); const description = manualDescription.trim(); const quantity = Number(manualQuantity); if (!description || !Number.isFinite(quantity) || quantity < 0) return; changeDocumentation({ manualBomItems: [...documentation.manualBomItems, { bomRowId: makeId("bom-row"), description, quantity }] }); setManualDescription(""); setManualQuantity("1"); }}>
        <strong>+ Add manual BOM item</strong><input aria-label="Manual BOM description" value={manualDescription} onChange={(event) => setManualDescription(event.target.value)} placeholder="e.g. back boxes, cable clips, fixings" maxLength={500} required /><input aria-label="Manual BOM quantity" type="number" min="0" step="1" value={manualQuantity} onChange={(event) => setManualQuantity(event.target.value)} /><button type="submit" className="review-style-button">Add item</button>
      </form>
    </div></details>}
    {tab === "CIRCUITS" && <div className="electrical-schedule-tab-content">
      <div className="electrical-schedule-toolbar"><p>Each circuit contains its connections. Breaker ratings, cable sizes and loads are not inferred.</p><div><button type="button" className="review-style-button" onClick={() => exportConnectionsCsv()}>Export connections CSV</button><button type="button" className="review-style-button" onClick={() => exportConnectionsCsv(true)}>Export segment CSV</button><button type="button" className="review-style-button" onClick={exportCircuitsCsv}>Export circuits CSV</button></div></div>
      <div className="electrical-schedule-breakdown">{(["CONTROL", "POWER", "GENERIC"] as const).map((type) => <span key={type}>{type === "POWER" ? "Power" : type === "CONTROL" ? "Control" : "Generic"}: <strong>{connectionRows.filter((row) => row.connection.type === type).length}</strong></span>)}<span><strong>{connectionRows.length} connections</strong> · {formatDrawingLength(totalDrawingLength)} total drawing-line length</span></div>
      <div className="electrical-schedule-circuits">
        {circuits.map(({ circuit, rows, itemIds, roomNames }) => {
          const matchingRows = visibleConnections.filter((row) => row.connection.circuitId === circuit.id);
          return <details className="electrical-schedule-circuit" key={circuit.id}>
            <summary><span><i className="electrical-circuit-colour" style={{ backgroundColor: circuit.color }} />{circuit.name}</span><small>{rows.length} connections · {itemIds.size} items · {roomNames.join(", ") || "No rooms"}</small></summary>
            <div className="electrical-schedule-circuit-content">
              <div className="electrical-schedule-circuit-fields">
                <label>Circuit name<input defaultValue={circuit.name} onBlur={(event) => { const name = event.target.value.trim(); if (name) onLayoutChange({ ...layout, circuits: layout.circuits.map((item) => item.id === circuit.id ? { ...item, name } : item) }); }} /></label>
                <label>Description<input defaultValue={circuit.description ?? ""} placeholder="Description" onBlur={(event) => onLayoutChange({ ...layout, circuits: layout.circuits.map((item) => item.id === circuit.id ? { ...item, description: event.target.value || undefined } : item) })} /></label>
                <label>Colour<input aria-label={`Colour for ${circuit.name}`} type="color" value={circuit.color} onChange={(event) => onLayoutChange({ ...layout, circuits: layout.circuits.map((item) => item.id === circuit.id ? { ...item, color: event.target.value } : item) })} /></label>
                <label className="wide">Circuit notes<textarea defaultValue={documentation.circuitNotes[circuit.id] ?? ""} onBlur={(event) => changeDocumentation({ circuitNotes: { ...documentation.circuitNotes, [circuit.id]: event.target.value } })} /></label>
              </div>
              {renderEntryPhotos([{ kind: "CIRCUIT", id: circuit.id }])}
              <section className="electrical-circuit-connection-list"><h3>Connections ({rows.length})</h3>
                {matchingRows.length ? matchingRows.map(renderConnectionEntry) : <p>{rows.length ? "No connections match these filters." : "No connections assigned to this circuit yet."}</p>}
              </section>
            </div>
          </details>;
        })}
        {!circuits.length && <p className="electrical-schedule-empty">No circuits are available.</p>}
      </div>
      <p className="electrical-schedule-disclaimer">Schematic route length is calculated from the line drawn between item centres and its waypoints. It is not a physical cable route or cable allowance.</p>
    </div>}
    <details className="electrical-project-documentation">
      <summary>Project-wide notes, photos &amp; document details</summary>
      <div className="electrical-project-documentation-content">
        <label className="field"><span>General electrical notes</span><textarea key={documentation.generalNotes} defaultValue={documentation.generalNotes} maxLength={10000} rows={4} placeholder="For example: confirm socket heights on site." onBlur={(event) => changeDocumentation({ generalNotes: event.target.value })} /></label>
        <fieldset className="electrical-export-metadata"><legend>Document details</legend><div>{(["drawingTitle", "revision", "preparedBy", "checkedBy"] as const).map((key) => <label key={key}>{({ drawingTitle: "Drawing title", revision: "Revision", preparedBy: "Prepared by", checkedBy: "Checked by" })[key]}<input defaultValue={documentation.exportMetadata[key] ?? (key === "drawingTitle" ? `${projectName} — Electrical layout` : "")} onBlur={(event) => changeDocumentation({ exportMetadata: { ...documentation.exportMetadata, [key]: event.target.value || undefined } })} /></label>)}<label className="wide">Document notes<textarea defaultValue={documentation.exportMetadata.notes ?? ""} onBlur={(event) => changeDocumentation({ exportMetadata: { ...documentation.exportMetadata, notes: event.target.value || undefined } })} /></label></div></fieldset>
        {renderEntryPhotos([{ kind: "LAYOUT" }])}
        {orphanAttachments.length > 0 && <section className="electrical-entry-photos"><h3>Pictures needing a new link</h3>{orphanAttachments.map(renderAttachmentCard)}</section>}
      </div>
    </details>
  </section>;
}
