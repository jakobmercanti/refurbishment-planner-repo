import { analyticsEnabled } from "./analyticsConsent";

export type DownloadFormat = "floorplan3d" | "pdf" | "png" | "jpg" | "svg" | "json";
export type PlannerAnalyticsEvent = "floorplan_generated" | "floorplan_downloaded";

export const analytics = {
  capture(event: PlannerAnalyticsEvent, format?: DownloadFormat) {
    try {
      if (!analyticsEnabled()) return;
      const body = event === "floorplan_downloaded" && format ? { event, format } : { event };
      // Only the same-origin proxy sees this request. No browser PostHog SDK,
      // identifier, drawing, page URL, or user-supplied text is transmitted.
      void fetch("/planner/engineering-api/analytics/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "omit",
        referrerPolicy: "no-referrer",
        keepalive: true,
        body: JSON.stringify(body),
      }).catch(() => undefined);
    } catch { /* Counting never interrupts the planner. */ }
  },
};

export function exported(format: DownloadFormat) {
  try { analytics.capture("floorplan_downloaded", format); } catch { /* A download must never depend on analytics. */ }
}
// Keep the historic helper name available to existing project integrations.
export function downloaded(format: DownloadFormat) { exported(format); }
