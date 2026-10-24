"use client";

import { useEffect, useRef, useState } from "react";
import { downloadCFD } from "@/lib/climoptix";
import {
  checkVTKText,
  VTK_MAX_BYTES,
  VTK_MAX_POINTS,
  renderableVTKValues,
  prepareVTKXML,
} from "@/lib/climoptixVTK";
import type vtkPolyData from "@kitware/vtk.js/Common/DataModel/PolyData";
import type vtkXMLReader from "@kitware/vtk.js/IO/XML/XMLReader";

interface Field {
  key: string;
  name: string;
  cell: boolean;
  range: [number, number];
  components: number;
}
interface View {
  select: (key: string) => void;
  fit: () => void;
  zoom: (factor: number) => void;
}

export function ClimoptixVTKViewer({
  file,
  onClose,
  provenance,
}: {
  file: File;
  onClose: () => void;
  provenance?: string;
}) {
  const host = useRef<HTMLDivElement>(null),
    view = useRef<View | null>(null);
  const [fields, setFields] = useState<Field[]>([]),
    [selected, setSelected] = useState("");
  const [status, setStatus] = useState("Loading local result…"),
    [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | undefined;
    void (async () => {
      if (file.size > VTK_MAX_BYTES)
        throw new Error("VTK files must be at most 25 MB.");
      const text = await file.text(),
        xml = file.name.toLowerCase().endsWith(".vtp");
      const prepared = xml
        ? prepareVTKXML(text)
        : { text: checkVTKText(text, false), warnings: [] };
      const [
        windowModule,
        mapperModule,
        actorModule,
        colourModule,
        readerModule,
      ] = await Promise.all([
        import("@kitware/vtk.js/Rendering/Misc/GenericRenderWindow"),
        import("@kitware/vtk.js/Rendering/Core/Mapper"),
        import("@kitware/vtk.js/Rendering/Core/Actor"),
        import("@kitware/vtk.js/Rendering/Core/ColorTransferFunction"),
        xml
          ? import("@kitware/vtk.js/IO/XML/XMLPolyDataReader")
          : import("@kitware/vtk.js/IO/Legacy/PolyDataReader"),
        import("@kitware/vtk.js/Rendering/Profiles/Geometry"),
      ]);
      if (cancelled || !host.current) return;
      const reader = readerModule.default.newInstance();
      const owned: { delete: () => void }[] = [reader];
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        for (const item of owned.reverse()) item.delete();
      };
      dispose = release;
      let data: vtkPolyData;
      try {
        // The published XML reader declares parseAsText, but its runtime entry
        // point is parseAsArrayBuffer. Legacy POLYDATA uses the text reader.
        if (xml)
          (reader as vtkXMLReader).parseAsArrayBuffer(
            new TextEncoder().encode(prepared.text).buffer,
          );
        else reader.parseAsText(prepared.text);
        data = reader.getOutputData() as vtkPolyData;
        if (
          !data?.isA("vtkPolyData") ||
          data.getNumberOfPoints() < 1 ||
          data.getNumberOfCells() < 1
        )
          throw new Error("No displayable PolyData geometry was found.");
        if (
          data.getNumberOfPoints() > VTK_MAX_POINTS ||
          data.getNumberOfCells() > VTK_MAX_POINTS
        )
          throw new Error("VTK geometry exceeds the display limit.");
        if (!renderableVTKValues(data.getPoints().getData()))
          throw new Error(
            "VTK coordinates must be finite and within the WebGL numeric range.",
          );
        for (const cells of [
          data.getPolys(),
          data.getLines(),
          data.getStrips(),
          data.getVerts(),
        ]) {
          const values = cells.getData();
          for (let offset = 0; offset < values.length; ) {
            const count = values[offset++];
            if (
              !Number.isInteger(count) ||
              count < 1 ||
              offset + count > values.length
            )
              throw new Error("Invalid VTK cell connectivity.");
            for (let i = 0; i < count; i++) {
              const id = values[offset++];
              if (
                !Number.isInteger(id) ||
                id < 0 ||
                id >= data.getNumberOfPoints()
              )
                throw new Error("VTK cells reference a missing point.");
            }
          }
        }
      } catch (e) {
        release();
        throw e;
      }
      const choices: Field[] = [];
      const omitted: string[] = [...prepared.warnings];
      for (const cell of [false, true]) {
        const attributes = cell ? data.getCellData() : data.getPointData();
        for (const array of attributes.getArrays()) {
          if (
            array.getNumberOfTuples() !==
            (cell ? data.getNumberOfCells() : data.getNumberOfPoints())
          ) {
            omitted.push(
              `${array.getName()} (value count does not match the geometry)`,
            );
            continue;
          }
          if (!renderableVTKValues(array.getData())) {
            omitted.push(
              `${array.getName()} (non-finite values or outside WebGL numeric range)`,
            );
            continue;
          }
          const components = array.getNumberOfComponents();
          const range = array.getRange(components > 1 ? -1 : 0);
          if (!renderableVTKValues(range)) {
            omitted.push(
              `${array.getName()} (magnitude range cannot be displayed safely)`,
            );
            continue;
          }
          choices.push({
            key: `${cell ? "cell" : "point"}:${array.getName()}`,
            name: array.getName(),
            cell,
            range: [range[0], range[1]],
            components,
          });
        }
      }
      const window = windowModule.default.newInstance({
        listenWindowResize: false,
      });
      owned.push(
        window.getRenderWindow(),
        window.getRenderer(),
        window.getInteractor(),
        window,
      );
      const mapper = mapperModule.default.newInstance(),
        actor = actorModule.default.newInstance(),
        colours = colourModule.default.newInstance();
      owned.push(mapper, actor, colours);
      const container = host.current;
      window.setContainer(container);
      const renderer = window.getRenderer();
      const background = getComputedStyle(container)
        .backgroundColor.match(/[\d.]+/g)
        ?.slice(0, 3)
        .map(Number) ?? [235, 240, 237];
      renderer.setBackground(
        background[0] / 255,
        background[1] / 255,
        background[2] / 255,
      );
      renderer.getActiveCamera().setViewUp(0, 0, 1);
      renderer.getActiveCamera().setPosition(1, -1, 1);
      mapper.setInputData(data);
      actor.setMapper(mapper);
      renderer.addActor(actor);
      const render = () => window.getRenderWindow().render();
      const select = (key: string) => {
        const field = choices.find((f) => f.key === key);
        // Lighting must not change scalar colours relative to their legend.
        actor.getProperty().setLighting(!field);
        if (!field) mapper.setScalarVisibility(false);
        else {
          const [low, originalHigh] = field.range,
            high =
              originalHigh === low
                ? low + Math.max(1, Math.abs(low)) * 1e-6
                : originalHigh;
          colours.removeAllPoints();
          colours.addRGBPoint(low, 0.15, 0.3, 0.75);
          colours.addRGBPoint((low + high) / 2, 0.1, 0.8, 0.65);
          colours.addRGBPoint(high, 0.9, 0.25, 0.1);
          colours.setVectorModeToMagnitude();
          mapper.setLookupTable(colours);
          mapper.setColorByArrayName(field.name);
          if (field.cell) mapper.setScalarModeToUseCellFieldData();
          else mapper.setScalarModeToUsePointFieldData();
          mapper.setScalarRange(low, high);
          mapper.setColorModeToMapScalars();
          mapper.setScalarVisibility(true);
        }
        render();
      };
      const observer = new ResizeObserver(() => window.resize());
      observer.observe(container);
      const theme = new MutationObserver(() => {
        const rgb = getComputedStyle(container)
          .backgroundColor.match(/[\d.]+/g)
          ?.slice(0, 3)
          .map(Number);
        if (rgb)
          renderer.setBackground(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);
        render();
      });
      theme.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme", "class", "style"],
      });
      view.current = {
        select,
        fit: () => {
          renderer.resetCamera();
          render();
        },
        zoom: (factor) => {
          renderer.getActiveCamera().zoom(factor);
          render();
        },
      };
      dispose = () => {
        if (released) return;
        view.current = null;
        observer.disconnect();
        theme.disconnect();
        renderer.removeActor(actor);
        release();
      };
      renderer.resetCamera();
      window.resize();
      select(choices[0]?.key ?? "");
      setFields(choices);
      setWarnings(omitted);
      setSelected(choices[0]?.key ?? "");
      setStatus(
        `${data.getNumberOfPoints().toLocaleString()} points · ${data.getNumberOfCells().toLocaleString()} ${data.getNumberOfCells() === 1 ? "cell" : "cells"}`,
      );
    })().catch((e) => {
      dispose?.();
      if (!cancelled) {
        setError(
          e instanceof Error ? e.message : "Cannot inspect this VTK file.",
        );
        setStatus("File not loaded");
      }
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [file]);
  const field = fields.find((f) => f.key === selected);
  return (
    <section
      className="cfx-viewer cfx-vtk-viewer"
      aria-label="VTK results viewer"
    >
      <header>
        <strong>VTK · {file.name}</strong>
        <button onClick={onClose}>Back to geometry</button>
      </header>
      <p className="cfx-stale">
        {provenance || "External file · simulation provenance and physical units unverified"}
      </p>
      <div className="cfx-inline cfx-vtk-toolbar">
        <label>
          Result field
          <select
            aria-label="VTK result field"
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value);
              view.current?.select(e.target.value);
            }}
          >
            <option value="">Geometry only</option>
            {fields.map((f) => (
              <option key={f.key} value={f.key}>
                {f.name}
                {f.components > 1 ? " · magnitude" : ""} ·{" "}
                {f.cell ? "cell" : "point"}
              </option>
            ))}
          </select>
        </label>
        <button
          aria-label="Zoom VTK out"
          onClick={() => view.current?.zoom(1 / 1.2)}
        >
          −
        </button>
        <button
          aria-label="Zoom VTK in"
          onClick={() => view.current?.zoom(1.2)}
        >
          +
        </button>
        <button onClick={() => view.current?.fit()}>Fit</button>
      </div>
      {error && (
        <p role="alert" className="cfx-error">
          {error}
        </p>
      )}
      {warnings.length > 0 && (
        <div
          className="cfx-notice"
          role="status"
          aria-label="VTK field warnings"
        >
          Some arrays were not displayed: {warnings.join("; ")}. The original
          download is unchanged.
        </div>
      )}
      <div
        ref={host}
        className="cfx-vtk-canvas"
        aria-label="Interactive VTK 3D field"
      />
      <footer>
        <span role="status">{status}</span>
        {field && (
          <span>
            <i className="cfx-colour-scale" />
            {field.name}: {field.range.map((v) => v.toPrecision(5)).join(" → ")}{" "}
            · file units
          </span>
        )}
        <button onClick={() => downloadCFD(file, file.name)}>
          Download full original data
        </button>
      </footer>
    </section>
  );
}
