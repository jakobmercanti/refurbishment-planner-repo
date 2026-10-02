"use client";

import { useEffect, useRef } from "react";
import type { PlanKey } from "@/lib/commercialCatalogue";

export function PlansRedirect({ selectedPlanKey }: { selectedPlanKey?: PlanKey | null }) {
  const form = useRef<HTMLFormElement>(null);
  const submitted = useRef(false);
  useEffect(() => {
    if (submitted.current || !form.current) return;
    submitted.current = true;
    form.current.requestSubmit();
  }, []);
  return <div className="commercial-panel">
    <p role="status">Opening plans and billing…</p>
    <form ref={form} action={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/plans/`} method="get" data-plans-redirect="true">
      {selectedPlanKey && selectedPlanKey !== "free" && <input type="hidden" name="plan" value={selectedPlanKey} />}
      <button className="commercial-primary" type="submit">Open plans and billing</button>
    </form>
  </div>;
}
