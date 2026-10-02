"use client";
import { useEffect, useRef, useState } from "react";
import { analyticsEnabled, setAnalyticsEnabled } from "@/lib/analyticsConsent";
import { isPlannerBuildHost } from "@/lib/plannerBuildBrand";

export function PlannerPrivacyDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState("");
  const [allowed, setAllowed] = useState(false);
  const [plannerBuild, setPlannerBuild] = useState(false);
  const [googleAdsChoice, setGoogleAdsChoice] = useState("unset");
  useEffect(() => {
    const element = dialog.current;
    queueMicrotask(() => setPlannerBuild(isPlannerBuildHost()));
    element?.showModal();
    const refresh = () => setAllowed(analyticsEnabled());
    const refreshGoogleAds = () => {
      try {
        const choice = localStorage.getItem("ffp3d_google_ads_consent");
        setGoogleAdsChoice(choice === "accepted" || choice === "rejected" ? choice : "unset");
      } catch { setGoogleAdsChoice("unavailable"); }
    };
    refresh();
    refreshGoogleAds();
    window.addEventListener("storage", refresh);
    window.addEventListener("storage", refreshGoogleAds);
    window.addEventListener("freefloorplan3d:google-ads-consent-change", refreshGoogleAds);
    return () => { window.removeEventListener("storage", refresh); window.removeEventListener("storage", refreshGoogleAds); window.removeEventListener("freefloorplan3d:google-ads-consent-change", refreshGoogleAds); element?.close(); };
  }, []);
  function choose(value: boolean) {
    if (!setAnalyticsEnabled(value)) { setError("Your browser could not save this choice. Usage counts remain off; check your site storage settings."); return; }
    onClose();
  }
  return <dialog className="planner-privacy-dialog" ref={dialog} aria-labelledby="planner-privacy-title" onCancel={onClose}>
    <h2 id="planner-privacy-title">Privacy and local saving</h2>
    <p>Your project is saved in this browser. Download a .floorplan3d backup before clearing browser data. Room geometry is sent to our calculation service when validation or layout checks run.</p>
    {plannerBuild ? <p>Optional aggregate analytics are <strong>{allowed ? "on" : "off"}</strong>. With consent, we count planning page and CTA use, the first added construction activity and its first successful local save. The shared software can also count validated designs and exports. We send no project contents, account ID or unique visitor identifier. Events use an own-domain relay to PostHog US without forwarding your IP or browser headers. Cloudflare still processes connection data. Your choice expires after 180 days and can be changed here or in the website footer.</p> : <p>Aggregate action counts are <strong>{allowed ? "on" : "off"}</strong> in this browser. We count the first validated floorplan for a local project and each completed export or download (including its format). We do not count visitors, page views or editing activity. We send no drawings, dimensions, filenames or visitor identifier. Our server relays the event to PostHog US without forwarding your IP address or browser headers; Cloudflare and our hosting provider still process technical request data.</p>}
    <p>We do not use action counts to build advertising profiles or record sessions. {plannerBuild ? "PlannerBuild does not load an advertising tag." : "The separate Google Ads tag is off unless you accept optional advertising cookies; it may process page and ad-interaction signals as explained in the cookie notice."}</p>
    {!plannerBuild && <section aria-labelledby="planner-google-ads-choice"><h3 id="planner-google-ads-choice">Optional Google Ads cookies</h3><p data-google-ads-status role="status">Choice: {googleAdsChoice === "accepted" ? "accepted" : googleAdsChoice === "rejected" ? "rejected" : googleAdsChoice === "unavailable" ? "could not be read" : "not set; the tag is off"}.</p><div className="planner-privacy-actions"><button type="button" data-google-ads-reject>Reject Google Ads cookies</button><button type="button" data-google-ads-accept>Accept Google Ads cookies</button></div></section>}
    <p><a href={plannerBuild ? "/privacy/" : "/privacy/#analytics"} target="_blank" rel="noopener noreferrer">Read the privacy policy</a> · <a href={plannerBuild ? "/cookies/" : "/cookies/#marketing-cookies"} target="_blank" rel="noopener noreferrer">{plannerBuild ? "Cookies and analytics choices" : "Cookies and Google Ads choices"}</a></p>
    {error && <p role="alert">{error}</p>}
    <div className="planner-privacy-actions"><button type="button" onClick={() => choose(false)}>Turn counts off</button><button type="button" onClick={() => choose(true)}>Turn counts on</button><button type="button" onClick={onClose}>Close</button></div>
  </dialog>;
}
