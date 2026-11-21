const OPT_OUT_KEY = "ffp3d_analytics_opt_out";
const LEGACY_KEY = "freefloorplan3d:analytics";
const LEGACY_EXPIRY_KEY = "freefloorplan3d:analytics-expires";
const OPT_IN_KEY = "ffp3d_analytics_consent_v1";

export function analyticsEnabled() {
  try {
    const consent = JSON.parse(localStorage.getItem(OPT_IN_KEY) ?? "null") as {version?:number;expiresAt?:number} | null;
    return localStorage.getItem(OPT_OUT_KEY) !== "true" && localStorage.getItem(LEGACY_KEY) !== "no"
      && consent?.version === 1 && typeof consent.expiresAt === "number" && consent.expiresAt > Date.now();
  } catch { return false; }
}

export function setAnalyticsEnabled(enabled: boolean) {
  try {
    if (enabled) {
      localStorage.setItem(OPT_IN_KEY, JSON.stringify({version:1,expiresAt:Date.now()+180*24*60*60*1000}));
      localStorage.removeItem(OPT_OUT_KEY);
    } else { localStorage.setItem(OPT_OUT_KEY, "true"); localStorage.removeItem(OPT_IN_KEY); }
    localStorage.removeItem(LEGACY_KEY);
    localStorage.removeItem(LEGACY_EXPIRY_KEY);
    return true;
  } catch { return false; }
}
