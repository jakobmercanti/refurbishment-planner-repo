"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { newCFDScenario } from "@/lib/climoptixDocument";
import { prepareCFD, preparationInput, preparationRevision, type CFDPatch, type CFDReport } from "@/lib/climoptix";
import type { ProjectDocument } from "@/lib/projectDocument";

/** Measured host preparation is shared by both floorplan viewers and the vent editor. */
export function useHvacHosts(project: ProjectDocument, apiUrl: string, geometryKey: string) {
  const sourceKey = JSON.stringify([apiUrl, geometryKey]);
  const current = useRef({ project, sourceKey });
  useEffect(() => { current.current = { project, sourceKey }; }, [project, sourceKey]);
  const cache = useRef(new Map<string, CFDReport>()), pending = useRef(new Map<string, { controller: AbortController; task: Promise<CFDReport | null> }>());
  const controllers = useRef(new Set<AbortController>());
  const [hosts, setHosts] = useState<{ key: string; patches: CFDPatch[] }>({ key: sourceKey, patches: [] });
  const ensureGeometry = useCallback((seed: { floorId: string; roomId: string }) => {
    const key = JSON.stringify([sourceKey, seed]);
    const cached = cache.current.get(key); if (cached) return Promise.resolve(cached);
    const running = pending.current.get(key); if (running && !running.controller.signal.aborted) return running.task;
    const controller = new AbortController(); controllers.current.add(controller);
    const snapshot = current.current.project;
    const scenario = { ...newCFDScenario(snapshot.projectId, "Vent placement hosts"), id: "hvac-hosts", seed };
    const task = (async () => {
      try {
        const report = await prepareCFD(apiUrl, snapshot, scenario, await preparationRevision(preparationInput(snapshot, scenario)), controller.signal);
        if (controller.signal.aborted || current.current.sourceKey !== sourceKey) return null;
        cache.current.set(key, report);
        if (cache.current.size > 8) cache.current.delete(cache.current.keys().next().value!);
        setHosts(previous => {
          const patches = new Map((previous.key === sourceKey ? previous.patches : []).map(p => [p.id, p]));
          for (const patch of report.patches) if (patch.hostable && patch.host) patches.set(patch.id, patch);
          return { key: sourceKey, patches: [...patches.values()] };
        });
        return report;
      } finally { if (pending.current.get(key)?.controller === controller) pending.current.delete(key); controllers.current.delete(controller); }
    })();
    pending.current.set(key, { controller, task }); return task;
  }, [apiUrl, sourceKey]);
  const deviceRooms = JSON.stringify([...new Map((project.hvac?.devices ?? []).map(d => [`${d.floorId}:${d.roomId}`, { floorId: d.floorId, roomId: d.roomId }])).values()]);
  useEffect(() => {
    let cancelled = false;
    void (async () => { for (const seed of JSON.parse(deviceRooms)) { if (cancelled) break; try { await ensureGeometry(seed); } catch { /* The editor exposes retry and diagnostics. */ } } })();
    return () => { cancelled = true; };
  }, [deviceRooms, ensureGeometry]);
  useEffect(() => {
    const active = controllers.current, reports = cache.current;
    return () => { active.forEach(c => c.abort()); reports.clear(); };
  }, [sourceKey]);
  return { ensureGeometry, geometryPatches: hosts.key === sourceKey ? hosts.patches : [] };
}
