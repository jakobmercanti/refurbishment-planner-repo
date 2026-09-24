const OPT_OUT_KEY = "ffp3d_analytics_opt_out";
const LEGACY_KEY = "freefloorplan3d:analytics";
const LEGACY_EXPIRY_KEY = "freefloorplan3d:analytics-expires";

export function analyticsEnabled() {
  try {
    return localStorage.getItem(OPT_OUT_KEY) !== "true" && localStorage.getItem(LEGACY_KEY) !== "no";
  } catch { return false; }
}

export function setAnalyticsEnabled(enabled: boolean) {
  try {
    if (enabled) localStorage.removeItem(OPT_OUT_KEY);
    else localStorage.setItem(OPT_OUT_KEY, "true");
    localStorage.removeItem(LEGACY_KEY);
    localStorage.removeItem(LEGACY_EXPIRY_KEY);
    return true;
  } catch { return false; }
}
