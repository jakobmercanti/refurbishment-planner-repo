"use client";

import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";

export type AnnotationToolName = "LINE" | "ARROW" | "POLYLINE" | "TEXT" | "CALLOUT" | "MARKER" | "MEASUREMENT";
export type AnnotationLineStyle = "SOLID" | "DASHED" | "DOTTED";
export type AnnotationArrowEndStyle = "CLASSIC" | "OPEN" | "CIRCLE" | "SQUARE";
export type AnnotationStyle = { lineStyle: AnnotationLineStyle; thickness: number; textSize: number; color?: string; arrowEndStyle?: AnnotationArrowEndStyle };
export type AnnotationPanelSelection = { type: "LINE" | "ARROW" | "POLYLINE" | "TEXT" | "CALLOUT" | "MARKER"; text?: string } | null;

interface AnnotationsPanelProps {
  tool: AnnotationToolName | null;
  style: AnnotationStyle;
  selection: AnnotationPanelSelection;
  onToolChange: (tool: AnnotationToolName) => void;
  onStyleChange: (style: Partial<AnnotationStyle>) => void;
  onTextChange: (text: string) => void;
  onDeleteSelected: () => void;
  measurementMode: "ADD" | "REMOVE" | null;
  onAddMeasurement: () => void;
  onRemoveMeasurement: () => void;
  onClearToolSelection: () => void;
}

const ARROW_END_OPTIONS: Array<{ value: AnnotationArrowEndStyle; label: string }> = [
  { value: "CLASSIC", label: "Classic" },
  { value: "OPEN", label: "Open" },
  { value: "CIRCLE", label: "Circle" },
  { value: "SQUARE", label: "Square" },
];

function ArrowEndPreview({ style }: { style: AnnotationArrowEndStyle }) {
  return <svg className="annotation-arrow-end-preview" viewBox="0 0 34 18" aria-hidden>
    <line x1="2" y1="9" x2="29" y2="9" vectorEffect="non-scaling-stroke" />
    {style === "OPEN" && <polyline points="21.2,4.5 29,9 21.2,13.5" fill="none" vectorEffect="non-scaling-stroke" />}
    {style === "CIRCLE" && <circle cx="29" cy="9" r="4" />}
    {style === "SQUARE" && <rect x="25" y="5" width="8" height="8" rx=".5" />}
    {style === "CLASSIC" && <polygon points="29,9 21.2,4.5 23,9 21.2,13.5" />}
  </svg>;
}

function ArrowEndStyleSelect({ value, onChange }: { value: AnnotationArrowEndStyle; onChange: (value: AnnotationArrowEndStyle) => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ left: number; top: number; width: number } | null>(null);
  const selectedIndex = Math.max(0, ARROW_END_OPTIONS.findIndex((option) => option.value === value));
  const selected = ARROW_END_OPTIONS[selectedIndex];

  useEffect(() => {
    if (!open) return;
    const updateMenuPosition = () => {
      const button = buttonRef.current;
      if (!button) return;
      const rect = button.getBoundingClientRect();
      setMenuPosition({ left: rect.left, top: rect.bottom + 3, width: rect.width });
    };
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    updateMenuPosition();
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    const focusTimer = window.setTimeout(() => optionRefs.current[selectedIndex]?.focus(), 0);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [open, selectedIndex]);

  const toggleMenu = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    setMenuPosition({ left: rect.left, top: rect.bottom + 3, width: rect.width });
    setOpen(true);
  };

  const choose = (next: AnnotationArrowEndStyle) => {
    onChange(next);
    setOpen(false);
    buttonRef.current?.focus();
  };

  const handleOptionKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      optionRefs.current[(index + 1) % ARROW_END_OPTIONS.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      optionRefs.current[(index + ARROW_END_OPTIONS.length - 1) % ARROW_END_OPTIONS.length]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      optionRefs.current[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      optionRefs.current[ARROW_END_OPTIONS.length - 1]?.focus();
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(ARROW_END_OPTIONS[index].value);
    }
  };

  const menu = open && menuPosition ? createPortal(
    <div ref={menuRef} id="annotation-arrow-end-options" className="annotation-arrow-end-options" role="listbox" aria-label="Arrow end style options" style={{ left: menuPosition.left, top: menuPosition.top, width: menuPosition.width }}>
      {ARROW_END_OPTIONS.map((option, index) => <button key={option.value} ref={(element) => { optionRefs.current[index] = element; }} type="button" role="option" aria-selected={option.value === value} className={option.value === value ? "selected" : ""} onClick={() => choose(option.value)} onKeyDown={(event) => handleOptionKeyDown(event, index)}><span>{option.label}</span><ArrowEndPreview style={option.value} /></button>)}
    </div>,
    document.body,
  ) : null;

  return <div ref={rootRef} className="annotation-arrow-end-select">
    <button ref={buttonRef} type="button" className="annotation-arrow-end-trigger" aria-haspopup="listbox" aria-expanded={open} aria-controls="annotation-arrow-end-options" onClick={toggleMenu}>
      <span>{selected.label}</span>
      <ArrowEndPreview style={selected.value} />
      <span className="annotation-arrow-end-chevron" aria-hidden>{open ? "^" : "v"}</span>
    </button>
    {menu}
  </div>;
}

const toolButton = (current: AnnotationToolName | null, value: AnnotationToolName, onToolChange: (tool: AnnotationToolName) => void, label: string) => (
  <button type="button" className={current === value ? "active" : ""} aria-pressed={current === value} onClick={() => onToolChange(value)}>{label}</button>
);

export function AnnotationsPanel({ tool, style, selection, onToolChange, onStyleChange, onTextChange, onDeleteSelected, measurementMode, onAddMeasurement, onRemoveMeasurement, onClearToolSelection }: AnnotationsPanelProps) {
  return <div className="annotations-panel" onPointerDown={(event) => {
    const target = event.target;
    if (target instanceof Element && target.closest("button, select, textarea, input")) return;
    onClearToolSelection();
  }}>
    <div className="annotation-panel-group">
      <span className="annotation-panel-label">Draw</span>
      <div className="annotation-tool-grid">
        {toolButton(tool, "LINE", onToolChange, "Line")}
        {toolButton(tool, "ARROW", onToolChange, "Arrow")}
        {toolButton(tool, "POLYLINE", onToolChange, "Polyline")}
      </div>
    </div>
    <div className="annotation-panel-group">
      <span className="annotation-panel-label">Annotate</span>
      <div className="annotation-tool-grid">
        {toolButton(tool, "TEXT", onToolChange, "Text")}
        {toolButton(tool, "CALLOUT", onToolChange, "Callout")}
        {toolButton(tool, "MARKER", onToolChange, "Marker")}
      </div>
    </div>
    <div className="annotation-panel-group">
      <span className="annotation-panel-label">Measure</span>
      <div className="annotation-tool-grid annotation-measure-grid">
        <button type="button" className={measurementMode === "ADD" ? "active" : ""} aria-pressed={measurementMode === "ADD"} onClick={onAddMeasurement}>Add measurement</button>
        <button type="button" className={measurementMode === "REMOVE" ? "active danger-button" : "danger-button"} aria-pressed={measurementMode === "REMOVE"} onClick={onRemoveMeasurement}>Remove measurement</button>
      </div>
      {measurementMode && <p className="annotation-panel-hint measurement-tool-hint">Select two walls, corners, objects, or points inside a room.</p>}
    </div>
    <div className="annotation-panel-group annotation-style-group">
      <span className="annotation-panel-label">Style</span>
      <label className="annotation-style-row"><span>Line style</span><select value={style.lineStyle} onChange={(event) => onStyleChange({ lineStyle: event.target.value as AnnotationLineStyle })}><option value="SOLID">Solid</option><option value="DASHED">Dashed</option><option value="DOTTED">Dotted</option></select></label>
      <label className="annotation-style-row"><span>Thickness</span><select value={style.thickness} onChange={(event) => onStyleChange({ thickness: Number(event.target.value) })}><option value="1">Thin - 1 px</option><option value="2">Normal - 2 px</option><option value="3">Thick - 3 px</option></select></label>
      <label className="annotation-style-row"><span>Text size</span><select value={style.textSize} onChange={(event) => onStyleChange({ textSize: Number(event.target.value) })}><option value="10">10 px</option><option value="12">12 px</option><option value="14">14 px</option><option value="18">18 px</option><option value="24">24 px</option></select></label><label className="annotation-style-row"><span>Colour</span><input aria-label="Annotation colour" type="color" value={style.color ?? "#287fb8"} onChange={(event) => onStyleChange({ color: event.target.value })} /></label>{selection?.type === "ARROW" && <div className="annotation-style-row"><span>Arrow end style</span><ArrowEndStyleSelect value={style.arrowEndStyle ?? "CLASSIC"} onChange={(arrowEndStyle) => onStyleChange({ arrowEndStyle })} /></div>}
    </div>
    {selection && (selection.type === "TEXT" || selection.type === "CALLOUT") && <label className="annotation-text-editor"><span>{selection.type === "CALLOUT" ? "Callout text" : "Text"}</span><textarea value={selection.text ?? ""} rows={2} onChange={(event) => onTextChange(event.target.value)} /></label>}
    <button type="button" className="annotation-delete-button" disabled={!selection} onClick={onDeleteSelected}>Delete selected</button>
    {tool === "POLYLINE" && <p className="annotation-panel-hint">Click points; double-click or press Enter to finish. Escape cancels.</p>}
    {tool === "TEXT" && <p className="annotation-panel-hint">Click the plan, then enter the label.</p>}
    {tool === "CALLOUT" && <p className="annotation-panel-hint">Click the target, then the label position.</p>}
  </div>;
}
