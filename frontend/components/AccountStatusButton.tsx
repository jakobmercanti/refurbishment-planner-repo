"use client";

import { useEffect, useState } from "react";
import { AUTH_SESSION_CHANGED, currentSession } from "@/lib/commercialAuth";
import { commercialRequest } from "@/lib/commercialApi";

const planNames: Record<string, string> = { free: "Free", starter: "Starter", pro: "Pro", studio: "Studio" };

export function AccountStatusButton({ onOpen }: { onOpen?: () => void } = {}) {
  const [label, setLabel] = useState("Sign in");
  const [detail, setDetail] = useState("Open your account");

  useEffect(() => {
    let active = true;
    let request = 0;
    const refresh = async () => {
      const revision = ++request;
      let signedIn = false;
      const update = (value: string) => { if (active && revision === request) setLabel(value); };
      const explain = (value: string) => { if (active && revision === request) setDetail(value); };
      try {
        const session = await currentSession();
        if (!session) { update("Sign in"); explain("Sign in to your account; your floorplan stays open."); return; }
        signedIn = true;
        update("Signed in · Checking plan…");
        const summary = await commercialRequest<{ plan?: string }>("/summary");
        const name = Object.hasOwn(planNames, summary.plan ?? "") ? planNames[summary.plan!] : undefined;
        if (!name) throw new Error("Account service returned an unknown plan.");
        update(`Signed in · ${name}`); explain(`Your verified account plan is ${name}. Open account settings.`);
      } catch {
        // Never mislabel a paid account as Free when the server is unavailable.
        update(signedIn ? "Signed in" : "Account unavailable");
        explain(signedIn ? "You are signed in. Plan status could not be refreshed; no plan or permissions have been assumed. Try again when account services recover." : "Account status could not be checked. Open your account to retry.");
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

  return onOpen ? <button className="app-nav-entry" type="button" onClick={onOpen} title={detail}>{label}</button>
    : <a className="app-nav-entry" href={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/account/`} target="_blank" rel="noopener noreferrer" title={detail}>{label} ↗</a>;
}
