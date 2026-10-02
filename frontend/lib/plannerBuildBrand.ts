export function isPlannerBuildHost(): boolean {
  return typeof window !== "undefined" && ["plannerbuild.com", "www.plannerbuild.com"].includes(window.location.hostname);
}

export function plannerBuildConsent(): boolean {
  if (!isPlannerBuildHost()) return false;
  try {
    const choice = JSON.parse(localStorage.getItem("plannerbuild-privacy-v2") || "null");
    return choice?.analytics === true && choice.expires > Date.now();
  } catch { return false; }
}

export function capturePlannerBuildEvent(event: "project_started" | "project_created", projectId: string): void {
  if (!plannerBuildConsent()) return;
  try {
    const marker = `plannerbuild-event:${event}:${projectId}`;
    if (localStorage.getItem(marker)) return;
    const properties = JSON.parse(localStorage.getItem("plannerbuild-attribution") || "{}");
    // Mark locally before dispatch. The local project ID is never transmitted.
    localStorage.setItem(marker, "1");
    void fetch("/api/events", {method:"POST",headers:{"Content-Type":"application/json"},credentials:"omit",referrerPolicy:"no-referrer",keepalive:true,body:JSON.stringify({event,consent:true,properties})}).catch(() => undefined);
  } catch { /* Counting never affects editing or saving. */ }
}
