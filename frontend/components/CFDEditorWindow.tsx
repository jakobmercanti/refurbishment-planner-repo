"use client";

import { useLayoutEffect, useRef, useState, type ComponentProps } from "react";
import { createPortal } from "react-dom";
import { FloatingToolbar } from "./FloatingToolbar";

/** Editor windows must not live inside a scrolling/hidden phase panel. Keep
 * their owning workspace (and docking context), without clipping their chrome. */
export function CFDEditorWindow(props: ComponentProps<typeof FloatingToolbar>) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [host, setHost] = useState<Element | null>(null);
  useLayoutEffect(() => {
    const workspace = anchor.current?.closest(".cfx-workspace") ?? null;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setHost(workspace);
    return () => {
      const target = opener?.isConnected && opener.getClientRects().length ? opener : workspace?.querySelector<HTMLElement>(".cfx-setup-window .floating-toolbar-titlebar");
      target?.focus({ preventScroll: true });
    };
  }, []);
  return <><span hidden ref={anchor} />{host && createPortal(<FloatingToolbar {...props} />, host)}</>;
}
