"use client";
import { useEffect, useState } from "react";
import { useHvac } from "./HvacContext";
import { hvacErrorMessage } from "@/lib/hvacDocument";
import type { CFDReport } from "@/lib/climoptix";

/** Host loading is separate from full vent validation, so a late host response cannot replace it. */
export function useHvacHostReport(floorId?: string, roomId?: string) {
  const { ensureGeometry, geometryKey, apiUrl } = useHvac()!;
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([apiUrl, geometryKey, floorId, roomId, attempt]);
  const [result, setResult] = useState<{ key: string; report: CFDReport | null; error: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (floorId && roomId) void ensureGeometry({ floorId, roomId }).then(report => {
      if (!cancelled) setResult({ key, report, error: report ? "" : "Room geometry changed. Retry host checks." });
    }).catch(error => { if (!cancelled) setResult({ key, report: null, error: hvacErrorMessage(error) }); });
    return () => { cancelled = true; };
  }, [ensureGeometry, floorId, roomId, key]);
  const current = result?.key === key ? result : null;
  return { report: current?.report ?? null, loading: Boolean(floorId && roomId && !current), error: current?.error ?? "", retry: () => setAttempt(n => n + 1) };
}
