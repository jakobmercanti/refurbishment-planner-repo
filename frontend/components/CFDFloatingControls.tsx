"use client";

import type { ReactNode } from "react";

/** One compact disclosure overlays the plot instead of consuming plotting area. */
export function CFDFloatingControls({children,label="View controls"}:{children:ReactNode;label?:string}) {
  return <details className="cfx-floating-controls"><summary>{label}</summary><div className="cfx-floating-controls-body">{children}</div></details>;
}
