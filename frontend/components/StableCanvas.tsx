"use client";

import { Canvas, type CanvasProps } from "@react-three/fiber";
import { useCallback, useState } from "react";

/**
 * Mount the event host before creating R3F's async canvas root.
 *
 * R3F connects its pointer events after renderer setup. During a concurrent
 * remount the default internal wrapper can already be gone, which makes the
 * event manager call addEventListener on null. Keeping a concrete host
 * element in state means the event source passed to R3F is never a nullable
 * ref, including while the canvas is being replaced or unmounted.
 */
export function StableCanvas({ children, ...props }: CanvasProps) {
  const [eventSource, setEventSource] = useState<HTMLDivElement | null>(null);
  const captureEventSource = useCallback((element: HTMLDivElement | null) => {
    setEventSource((current) => current === element ? current : element);
  }, []);

  return (
    <div ref={captureEventSource} className="stable-canvas-host">
      {eventSource && <Canvas {...props} eventSource={eventSource}>{children}</Canvas>}
    </div>
  );
}
