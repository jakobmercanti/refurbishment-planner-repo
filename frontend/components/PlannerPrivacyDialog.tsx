"use client";
import { useEffect, useRef, useState } from "react";
import { WindowHelpButton } from "@/components/WindowHelpButton";
import { analyticsEnabled, setAnalyticsEnabled } from "@/lib/analyticsConsent";
import { CLOUD_RECOVERY_CHANGED, cloudRecoveryEnabled, setCloudRecoveryEnabled, deleteCloudRecovery, readCloudRecovery } from "@/lib/cloudResume";
import { storedAccountId } from "@/lib/commercialAuth";

export function PlannerPrivacyDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState("");
  const [allowed, setAllowed] = useState(false);
  const [recoveryEnabled, setRecoveryEnabled] = useState(() => cloudRecoveryEnabled());
  const [signedIn] = useState(() => !!storedAccountId());
  const [cloudBusy, setCloudBusy] = useState(false);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    const refresh = () => setAllowed(analyticsEnabled());
    const refreshRecovery = () => setRecoveryEnabled(cloudRecoveryEnabled());
    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener("storage", refreshRecovery);
    window.addEventListener(CLOUD_RECOVERY_CHANGED, refreshRecovery);
    return () => { window.removeEventListener("storage", refresh); window.removeEventListener("storage", refreshRecovery); window.removeEventListener(CLOUD_RECOVERY_CHANGED, refreshRecovery); element?.close(); };
  }, []);
  function choose(value: boolean) {
    if (!setAnalyticsEnabled(value)) { setError("Your browser could not save this choice. Usage counts remain off; check your site storage settings."); return; }
    onClose();
  }
  return <dialog className="planner-privacy-dialog" ref={dialog} aria-labelledby="planner-privacy-title" onCancel={onClose}>
    <h2 id="planner-privacy-title">Privacy and local saving <WindowHelpButton title="Privacy and local saving" /></h2>
    <p>Your project is saved in this browser. Download a .floorplan3d backup before clearing browser data. Room geometry is sent to our calculation service when validation or layout checks run.</p>
    {signedIn && <section><h3>CFD setup recovery</h3>
      <p>While signed in, the latest project containing CFD studies is automatically saved privately to your account. Cloud copies contain geometry, shared scenarios and technical heating/ventilation/insulation inputs. Quotes, customer/contact fields, free-text notes and annotations, electrical records, work programmes and historical HVAC packages stay local; downloaded full project packages can include them. Imported model files and result files stay separate. Recovery expires after 180 days without a save. Keep a downloaded project backup too.</p>
      <label><input type="checkbox" checked={recoveryEnabled} disabled={cloudBusy} onChange={async event => {
        const enabled = event.target.checked;
        setCloudBusy(true); setError("");
        try { await setCloudRecoveryEnabled(enabled); } catch { setError("Your account recovery preference could not be updated. Local saving continues."); }
        finally { setRecoveryEnabled(cloudRecoveryEnabled()); setCloudBusy(false); }
      }}/> Save my CFD setup to my account · all devices</label>
      <div className="planner-privacy-actions">
        <button type="button" disabled={cloudBusy} onClick={async () => {
          setCloudBusy(true); setError("");
          try { const saved = await readCloudRecovery(); if (!saved?.document) throw new Error("No cloud recovery copy is available.");
            const url=URL.createObjectURL(new Blob([JSON.stringify(saved.document,null,2)],{type:"application/json"}));
            const link=document.createElement("a"); link.href=url; link.download="cfd-setup-recovery.project.json"; document.body.appendChild(link); link.click(); link.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000);
          } catch (cause) { setError(cause instanceof Error ? cause.message : "Download failed."); } finally { setCloudBusy(false); }
        }}>Download cloud setup</button>
        <button type="button" disabled={cloudBusy} onClick={async () => {
          if (!window.confirm("Delete the account recovery copy? Your local project and paid cloud projects are kept.")) return;
          setCloudBusy(true); setError("");
          try { await deleteCloudRecovery(); setRecoveryEnabled(false); } catch (cause) { setRecoveryEnabled(cloudRecoveryEnabled()); setError(cause instanceof Error ? cause.message : "Cloud deletion failed."); } finally { setCloudBusy(false); }
        }}>Delete cloud recovery</button>
      </div>
    </section>}
    <p>Aggregate action counts are <strong>{allowed ? "on" : "off"}</strong> in this browser. Counts are off unless you opt in; permission lasts 180 days and can be withdrawn here. We count the first validated floorplan for a local project and each completed export or download (including its format). We do not count visitors, page views or editing activity. We send no drawings, dimensions, filenames or visitor identifier. Our server relays the event to PostHog US without forwarding your IP address or browser headers; Cloudflare and our hosting provider still process technical request data.</p>
    <p>We do not use action counts to build advertising profiles or record sessions. Advertising tags do not load inside the planner. You can manage optional advertising on the public website from its <a href="/cookies/#marketing-cookies" target="_blank" rel="noopener noreferrer">cookie controls</a>.</p>
    <p><a href="/privacy/#analytics" target="_blank" rel="noopener noreferrer">Read the privacy policy</a> · <a href="/cookies/#marketing-cookies" target="_blank" rel="noopener noreferrer">Cookies and Google Ads choices</a></p>
    {error && <p role="alert">{error}</p>}
    <div className="planner-privacy-actions"><button type="button" onClick={() => choose(false)}>Turn counts off</button><button type="button" onClick={() => choose(true)}>Turn counts on</button><button type="button" onClick={onClose}>Close</button></div>
  </dialog>;
}
