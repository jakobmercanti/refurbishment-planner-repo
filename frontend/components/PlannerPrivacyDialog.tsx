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
    <h2 id="planner-privacy-title">Privacy and project storage</h2>
    <p>The free planner saves projects in this browser. Download a .floorplan3d backup before clearing browser data. Room geometry is sent to our calculation service when validation or layout checks run. Creating an account does not upload a project by itself: cloud backup is an explicit action in your workspace.</p>
    <p>If you choose cloud features, account and project data are processed by Supabase and private model/render files are stored in Cloudflare R2. Stripe handles checkout and subscription billing. If you request an AI concept render, the selected reference image and prompt are sent to OpenAI; your project document and geometry are not. AI imagery and processed model bounds are visual-only and never decide fit. You can delete cloud projects and assets from your workspace; local copies are not removed by that action.</p>
    <p>If you request an AI 3D asset, the photo(s) you select are sent to Tripo to generate the model. They are held in private temporary storage only to deliver the job and are deleted after Tripo accepts it or the job fails; temporary objects are also covered by a one-day storage expiry rule. The dimensions you enter are stored separately as intended physical dimensions and are not sent as exact size controls to Tripo. Generated mesh bounds remain visual-only and never decide fit.</p>
    <p>Aggregate action counts are <strong>{allowed ? "on" : "off"}</strong> in this browser. We count the first validated floorplan for a local project and each completed export or download (including its format). We do not count visitors, page views or editing activity. We send no drawings, dimensions, filenames or visitor identifier. Our server relays the event to PostHog US without forwarding your IP address or browser headers; Cloudflare and our hosting provider still process technical request data.</p>
    <p>We do not send account, project, billing or image data with these aggregate action counts. There are no advertising profiles or session recordings. Counts are on by default; you can turn them off here at any time without losing planner features.</p>
    <p><a href="/privacy/#analytics" target="_blank" rel="noopener noreferrer">Read the privacy policy</a> · <a href="/cookies/" target="_blank" rel="noopener noreferrer">Cookies and device storage</a></p>
    {error && <p role="alert">{error}</p>}
    <div className="planner-privacy-actions"><button type="button" onClick={() => choose(false)}>Turn counts off</button><button type="button" onClick={() => choose(true)}>Turn counts on</button><button type="button" onClick={onClose}>Close</button></div>
  </dialog>;
}
