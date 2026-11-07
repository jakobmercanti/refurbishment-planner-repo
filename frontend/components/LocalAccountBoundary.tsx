"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { AUTH_SESSION_CHANGED, storedAccountId } from "@/lib/commercialAuth";
import { bindLocalStorageAccount } from "@/lib/localDatabase";

function subscribe(listener: () => void) {
  window.addEventListener(AUTH_SESSION_CHANGED, listener);
  window.addEventListener("pageshow", listener);
  return () => {
    window.removeEventListener(AUTH_SESSION_CHANGED, listener);
    window.removeEventListener("pageshow", listener);
  };
}

const snapshot = () => storedAccountId() ?? "";
const serverSnapshot = () => null;

export function LocalAccountBoundary({ children }: { children: ReactNode }) {
  const account = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const [bound, setBound] = useState<string | null>(null);
  useEffect(() => {
    if (account === null) return;
    // A reload disposes prior account views and keeps outstanding saves bound
    // to their original database. The subtree is hidden before reloading.
    if (!bindLocalStorageAccount(account || null)) {
      window.location.reload();
      return;
    }
    const frame = requestAnimationFrame(() => setBound(account));
    return () => cancelAnimationFrame(frame);
  }, [account]);
  return bound !== null && bound === account ? children : <main role="status">Opening workspace…</main>;
}
