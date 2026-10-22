"use client";

import { Fragment, useState, type DragEvent, type ReactNode } from "react";

const MIME = "application/x-climoptix-reorder";

/** Same grip/insert-boundary interaction as construction layers, with keyboard support. */
export function CFDReorderList<T extends { id: string; name: string }>({
  items,
  label,
  scope,
  onMove,
  children,
}: {
  items: T[];
  label: string;
  scope: string;
  onMove: (id: string, boundary: number) => void;
  children: (item: T, index: number) => ReactNode;
}) {
  const [boundary, setBoundary] = useState<number | null>(null);
  const hover = (event: DragEvent, at: number) => {
    if (!event.dataTransfer.types.includes(MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setBoundary(at);
  };
  const drop = (event: DragEvent, at: number) => {
    event.preventDefault();
    setBoundary(null);
    try {
      const data: unknown = JSON.parse(event.dataTransfer.getData(MIME));
      if (
        data &&
        typeof data === "object" &&
        "scope" in data &&
        data.scope === scope &&
        "id" in data &&
        typeof data.id === "string"
      )
        onMove(data.id, at);
    } catch {
      /* Ignore unrelated or malformed drops. */
    }
  };
  const slot = (at: number) => (
    <li
      aria-hidden="true"
      className="cfx-insertion"
      data-active={boundary === at}
      onDragOver={(e) => hover(e, at)}
      onDrop={(e) => drop(e, at)}
    />
  );
  return (
    <ol
      className="cfx-reorder-list"
      aria-label={label}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
          setBoundary(null);
      }}
    >
      {items.map((item, index) => (
        <Fragment key={item.id}>
          {slot(index)}
          <li
            className="cfx-reorder-item"
            data-item-id={item.id}
            onDragOver={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              hover(e, index + (e.clientY >= r.top + r.height / 2 ? 1 : 0));
            }}
            onDrop={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              drop(e, index + (e.clientY >= r.top + r.height / 2 ? 1 : 0));
            }}
          >
            <button
              type="button"
              className="cfx-grip"
              draggable
              aria-label={`Reorder ${item.name}`}
              title="Drag to reorder; Arrow Up/Down also moves this item"
              onDragStart={(e) => {
                e.dataTransfer.setData(
                  MIME,
                  JSON.stringify({ scope, id: item.id }),
                );
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragEnd={() => setBoundary(null)}
              onKeyDown={(e) => {
                if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
                e.preventDefault();
                if (e.key === "ArrowUp" && index > 0)
                  onMove(item.id, index - 1);
                if (e.key === "ArrowDown" && index < items.length - 1)
                  onMove(item.id, index + 2);
              }}
            >
              ⠿
            </button>
            {children(item, index)}
          </li>
        </Fragment>
      ))}
      {slot(items.length)}
    </ol>
  );
}
