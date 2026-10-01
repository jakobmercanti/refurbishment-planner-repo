"use client";

import { useEffect, useState } from "react";
import { AUTH_SESSION_CHANGED, currentSession } from "@/lib/commercialAuth";
import { commercialRequest } from "@/lib/commercialApi";

const planNames: Record<string, string> = { free: "Free", starter: "Starter", pro: "Pro", studio: "Studio" };

export function AccountStatusButton({ open, onOpen }: { open: boolean; onOpen: () => void }) {
  const [label, setLabel] = useState("Sign in");

  useEffect(() => {
    let active = true;
    let request = 0;
    const refresh = async () => {
      const revision = ++request;
      let signedIn = false;
      const update = (value: string) => { if (active && revision === request) setLabel(value); };
      try {
        const session = await currentSession();
        if (!session) { update("Sign in"); return; }
        signedIn = true;
        update("Signed in · Checking plan…");
        const summary = await commercialRequest<{ plan?: string }>("/summary");
        update(`Signed in · ${planNames[summary.plan ?? ""] ?? "Plan unavailable"}`);
      } catch {
        // Never mislabel a paid account as Free when the server is unavailable.
        update(signedIn ? "Signed in · Plan unavailable" : "Account unavailable");
      }
    };
    const refreshQuietly = () => { void refresh(); };
    refreshQuietly();
    window.addEventListener(AUTH_SESSION_CHANGED, refreshQuietly);
    window.addEventListener("focus", refreshQuietly);
    const timer = window.setInterval(refreshQuietly, 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener(AUTH_SESSION_CHANGED, refreshQuietly);
      window.removeEventListener("focus", refreshQuietly);
    };
  }, []);

  return <button type="button" className="app-nav-entry" aria-haspopup="dialog" aria-expanded={open} onClick={onOpen}>{label}</button>;
}
