"use client";

import { useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { Quaternion, Vector3 } from "three";

const axes = [
  { label: "X", colour: "#be382c", direction: [1, 0, 0] },
  { label: "Y", colour: "#187847", direction: [0, 0, -1] },
  { label: "Z", colour: "#285bb4", direction: [0, 1, 0] },
] as const;

function orientationFrame() {
  return {
    inverse: new Quaternion(),
    previous: new Quaternion(),
    lines: axes.map(axis => ({ ...axis, projected: new Vector3() })),
    ready: false,
  };
}

/** The result-to-scene transform is (X, Z, −Y). Draw the positive CFD axes. */
export function CFDOrientation({ target }: { target: RefObject<HTMLCanvasElement | null> }) {
  const state = useRef<ReturnType<typeof orientationFrame>>(null);
  useFrame(({ camera }) => {
    const frame = state.current ??= orientationFrame();
    const context = target.current?.getContext("2d");
    if (!context || frame.ready && frame.previous.equals(camera.quaternion)) return;
    frame.previous.copy(camera.quaternion);
    frame.inverse.copy(camera.quaternion).invert();
    frame.ready = true;
    context.setTransform(2, 0, 0, 2, 0, 0);
    context.clearRect(0, 0, 96, 96);
    context.font = "600 12px sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.lineCap = "round";
    for (const line of frame.lines) {
      const [x, y, z] = line.direction;
      line.projected.set(x, y, z).applyQuaternion(frame.inverse);
    }
    for (const {label, colour, projected: {x, y}} of frame.lines.sort((a, b) => a.projected.z - b.projected.z)) {
      const endX = 48 + x * 29, endY = 48 - y * 29;
      context.beginPath();
      context.moveTo(48, 48);
      context.lineTo(endX, endY);
      context.strokeStyle = colour;
      context.lineWidth = 2;
      context.stroke();
      context.beginPath();
      context.arc(endX, endY, 2.5, 0, Math.PI * 2);
      context.fillStyle = colour;
      context.fill();
      const labelX = 48 + x * 40, labelY = 48 - y * 40;
      context.strokeStyle = "#ffffff";
      context.lineWidth = 3;
      context.strokeText(label, labelX, labelY);
      context.fillText(label, labelX, labelY);
    }
  });
  return null;
}
