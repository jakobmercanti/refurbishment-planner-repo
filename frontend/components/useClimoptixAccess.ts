"use client";

import { useEffect, useState } from "react";
import { AUTH_SESSION_CHANGED, currentSession } from "@/lib/commercialAuth";
import { workerCapabilitiesSchema, workerJSON } from "@/lib/railwayCFDWorker";

/** Public verified-account access; exhausted compute quota must not hide saved work. */
export function useClimoptixAccess(base: string, onDenied: () => void) {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let controller: AbortController | undefined;
    const deny = () => { setEnabled(false); onDenied(); };
    const check = async () => {
      controller?.abort();
      const request = new AbortController(); controller = request;
      try {
        const session = await currentSession();
        if (request.signal.aborted) return;
        if (!session) { deny(); return; }
        const capabilities = workerCapabilitiesSchema.parse(await workerJSON(base, "/capabilities", request.signal));
        if (request.signal.aborted) return;
        // Access is independent of whether the solver runtime is ready.
        if (capabilities.connected && capabilities.namespace === session.user.id) setEnabled(true);
        else deny();
      } catch {
        if (!request.signal.aborted) deny();
      }
    };
    const refresh = () => { void check(); };
    const authChanged = () => { controller?.abort(); deny(); refresh(); };
    window.addEventListener(AUTH_SESSION_CHANGED, authChanged);
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(refresh, 60_000);
    refresh();
    return () => {
      controller?.abort(); window.clearInterval(timer);
      window.removeEventListener(AUTH_SESSION_CHANGED, authChanged);
      window.removeEventListener("focus", refresh);
    };
  }, [base, onDenied]);
  return enabled;
}
