import { isPlannerBuildHost, plannerBuildConsent } from "./plannerBuildBrand";

const OPT_OUT_KEY = "ffp3d_analytics_opt_out";
const LEGACY_KEY = "freefloorplan3d:analytics";
const LEGACY_EXPIRY_KEY = "freefloorplan3d:analytics-expires";

export function analyticsEnabled() {
  try {
    if (isPlannerBuildHost() && !plannerBuildConsent()) return false;
    return localStorage.getItem(OPT_OUT_KEY) !== "true" && localStorage.getItem(LEGACY_KEY) !== "no";
  } catch { return false; }
}

export function setAnalyticsEnabled(enabled: boolean) {
  try {
    if (isPlannerBuildHost()) {
      localStorage.setItem("plannerbuild-privacy-v2", JSON.stringify({analytics:enabled,expires:Date.now()+180*86400000}));
      if (!enabled) for (const key of Object.keys(localStorage)) if (key === "plannerbuild-attribution" || key.startsWith("plannerbuild-event:")) localStorage.removeItem(key);
      window.dispatchEvent(new Event("plannerbuild-consent-changed"));
      if (window.parent !== window) window.parent.dispatchEvent(new Event("plannerbuild-consent-changed"));
    }
    if (enabled) localStorage.removeItem(OPT_OUT_KEY);
    else localStorage.setItem(OPT_OUT_KEY, "true");
    localStorage.removeItem(LEGACY_KEY);
    localStorage.removeItem(LEGACY_EXPIRY_KEY);
    return true;
  } catch { return false; }
}
