"use client";
import { useEffect, useRef, useState } from "react";
import { analyticsEnabled, setAnalyticsEnabled } from "@/lib/analyticsConsent";

export function PlannerPrivacyDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState("");
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    const refresh = () => setAllowed(analyticsEnabled());
    refresh();
    window.addEventListener("storage", refresh);
    return () => { window.removeEventListener("storage", refresh); element?.close(); };
  }, []);
  function choose(value: boolean) {
    if (!setAnalyticsEnabled(value)) { setError("Your browser could not save this choice. Usage counts remain off; check your site storage settings."); return; }
    onClose();
  }
  return <dialog className="planner-privacy-dialog" ref={dialog} aria-labelledby="planner-privacy-title" onCancel={onClose}>
    <h2 id="planner-privacy-title">Privacy and local saving</h2>
    <p>Your project is saved in this browser. Download a .floorplan3d backup before clearing browser data. Room geometry is sent to our calculation service when validation or layout checks run.</p>
    <p>Aggregate action counts are <strong>{allowed ? "on" : "off"}</strong> in this browser. We count the first validated floorplan for a local project and each completed export or download (including its format). We do not count visitors, page views or editing activity. We send no drawings, dimensions, filenames or visitor identifier. Our server relays the event to PostHog US without forwarding your IP address or browser headers; Cloudflare and our hosting provider still process technical request data.</p>
    <p>No account, advertising profiles or session recordings. Counts are on by default; you can turn them off here at any time without losing planner features.</p>
    <p><a href="/privacy/#analytics" target="_blank" rel="noopener noreferrer">Read the privacy policy</a> · <a href="/cookies/" target="_blank" rel="noopener noreferrer">Cookies and device storage</a></p>
    {error && <p role="alert">{error}</p>}
    <div className="planner-privacy-actions"><button type="button" onClick={() => choose(false)}>Turn counts off</button><button type="button" onClick={() => choose(true)}>Turn counts on</button><button type="button" onClick={onClose}>Close</button></div>
  </dialog>;
}
