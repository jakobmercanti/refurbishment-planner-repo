"use client";

import type { PlanKey } from "@/lib/commercialCatalogue";

export function PlansRedirect({ selectedPlanKey }: { selectedPlanKey?: PlanKey | null }) {
  return <div className="commercial-panel">
    <p>Open plans and billing in a new tab. Your current project stays open here.</p>
    <form target="_blank" rel="noopener noreferrer" action={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/plans/`} method="get" data-plans-redirect="true">
      {selectedPlanKey && selectedPlanKey !== "free" && <input type="hidden" name="plan" value={selectedPlanKey} />}
      <button className="commercial-primary" type="submit">Open plans and billing</button>
    </form>
  </div>;
}
