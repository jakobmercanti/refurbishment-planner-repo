"use client";

import type { ReactNode } from "react";

/** One compact disclosure overlays the plot instead of consuming plotting area. */
export function CFDViewerControls({children,label="View controls"}:{children:ReactNode;label?:string}) {
  return <details className="cfx-viewer-controls"><summary>{label}</summary><div className="cfx-viewer-controls-body">{children}</div></details>;
}
