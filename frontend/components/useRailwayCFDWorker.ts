"use client";

import { useEffect, useState } from "react";
import { AUTH_SESSION_CHANGED } from "@/lib/commercialAuth";
import { CFDWorkerError, railwayCFDWorker, workerCapabilitiesSchema, workerJSON, type RailwayCFDWorker } from "@/lib/railwayCFDWorker";

export function useRailwayCFDWorker(active: boolean, base: string) {
  const [adapter, setAdapter] = useState<RailwayCFDWorker | null>(null);
  const [reason, setReason] = useState("Sign in to connect the enabled OpenFOAM account.");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      try {
        const capabilities = workerCapabilitiesSchema.parse(await workerJSON(base, "/capabilities", controller.signal));
        if (!controller.signal.aborted) {
          setAdapter(previous => previous && JSON.stringify(previous.capabilities) === JSON.stringify(capabilities) ? previous : railwayCFDWorker(base, capabilities));
          setReason(capabilities.reason);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          const message = error instanceof Error ? error.message : "Worker unavailable.";
          // A transient outage must not erase an ambiguous submission's immutable
          // retry payload. Clear private state only on an actual auth rejection.
          setAdapter(previous => error instanceof CFDWorkerError && [401,403].includes(error.status) ? null :
            previous ? railwayCFDWorker(base, {...previous.capabilities, connected:false, mesh:false, run:false, reason:message}) : null);
          setReason(message);
        }
      }
      if (!controller.signal.aborted) timer = setTimeout(() => void check(), 15000);
    };
    const authChanged = () => { setAdapter(null); setRetry(v => v+1); };
    window.addEventListener(AUTH_SESSION_CHANGED, authChanged); void check();
    return () => { controller.abort(); clearTimeout(timer); window.removeEventListener(AUTH_SESSION_CHANGED, authChanged); };
  }, [active, base, retry]);
  return {adapter, reason, refresh: () => setRetry(v => v+1)};
}
