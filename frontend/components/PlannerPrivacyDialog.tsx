"use client";

import { useEffect, useState } from "react";
import { FloatingToolbar } from "@/components/FloatingToolbar";
import { analyticsEnabled, setAnalyticsEnabled } from "@/lib/analyticsConsent";

const POLICY_UPDATED = "26 September 2026";

export function PlannerPrivacyDialog({ onClose }: { onClose: () => void }) {
  const [error, setError] = useState("");
  const [allowed, setAllowed] = useState(() => analyticsEnabled());

  useEffect(() => {
    const refresh = () => setAllowed(analyticsEnabled());
    refresh();
    window.addEventListener("storage", refresh);
    return () => window.removeEventListener("storage", refresh);
  }, []);

  function choose(value: boolean) {
    if (!setAnalyticsEnabled(value)) {
      setError("Your browser could not save this choice. Usage counts remain off; check your site storage settings.");
      setAllowed(analyticsEnabled());
      return;
    }
    setError("");
    setAllowed(value);
  }

  return (
    <FloatingToolbar title="Privacy & local saving" className="planner-privacy-window" defaultPosition={{ x: 150, y: 52 }} initialSize={{ width: 780 }} maxHeight={760} bringToFront onClose={onClose}>
      <article className="planner-privacy">
        <header className="planner-privacy-heading">
          <span className="eyebrow">YOUR SPACE. YOUR INFORMATION.</span>
          <h1>Privacy policy</h1>
          <p className="planner-privacy-lead">How JKM property investments handles information when you use FreeFloorplan3D, browse the website, or contact us.</p>
          <p className="planner-privacy-date">Last updated: {POLICY_UPDATED}</p>
        </header>

        <section>
          <h2>The short version</h2>
          <p>You can create and download a floorplan without registering. Projects are stored in your browser unless you explicitly choose a cloud feature. Room geometry is sent to our calculation service when you request validation or layout checks. We count only a first validated floorplan and exports or downloads; we do not count visitors or page views. You can turn action counts off here without losing planner features.</p>
        </section>

        <section>
          <h2>1. Who is responsible?</h2>
          <p>JKM property investments operates FreeFloorplan3D and is responsible for personal information processed for the purposes described in this policy.</p>
          <address>71–75 Shelton Street, Covent Garden, London, United Kingdom, WC2H 9JQ<br /><a href="mailto:info@freefloorplan3d.com">info@freefloorplan3d.com</a></address>
          <p>This policy covers the public website, the planner and its optional features, and our contact form.</p>
        </section>

        <section>
          <h2>2. Floorplans, calculations and device storage</h2>
          <p>The planner stores project geometry, room settings, placed objects, display preferences and locally imported models in your browser. Creating, editing and downloading a local project do not require an account. Clearing browser data or storage can remove local work; keep a downloaded project backup.</p>
          <p>When you request validation or a layout calculation, the relevant room dimensions, openings and object geometry are sent through Cloudflare to our calculation service hosted on Railway. These requests support the calculations you ask the planner to perform. The calculation service does not retain projects in a project database; hosting providers may separately process technical request records.</p>
          <p>Account-based cloud backup is a separate, explicit action. If you use cloud features, account and project data are processed by Supabase and private model or render files are stored in Cloudflare R2. Stripe handles checkout and subscription billing. Creating an account by itself does not upload a local project.</p>
        </section>

        <section id="analytics">
          <h2>3. Limited aggregate action counts</h2>
          <p>We count <code>floorplan_generated</code> once when a project first has a validated floorplan and is saved locally, and <code>floorplan_downloaded</code> after each export or download, with a fixed format label. These counts are approximate and do not prove that a file was saved to disk. We do not count visitors, page views, clicks, room edits or browsing history.</p>
          <p>The planner sends only the event name and (for a download) its format to a same-origin Cloudflare endpoint. Our backend relays a fixed event to PostHog US with one constant aggregate identifier, without forwarding your IP address, cookies, browser headers, URL, project ID, filename, drawing, geometry, dimensions, name or email address. We do not use the PostHog browser SDK, autocapture or session recording. Cloudflare, Railway and PostHog still process technical information needed to deliver and secure their services; we do not describe the whole service as anonymous.</p>
          <p>We use these limited counts to understand whether plans and downloads are useful, relying on legitimate interests where applicable and respecting your right to object. The counts are not for advertising, profiling or individual decisions. Where the UK PECR statistical-purpose exception applies, it is subject to its conditions; this is not a claim of a worldwide exemption.</p>
          <div className="planner-privacy-choice" aria-labelledby="planner-privacy-choice-title">
            <h3 id="planner-privacy-choice-title">Your analytics choice</h3>
            <p>Action counts are <strong>{allowed ? "on" : "off"}</strong> in this browser. Either choice leaves all floorplan tools available.</p>
            <div className="planner-privacy-actions">
              <button type="button" onClick={() => choose(false)}>Turn counts off</button>
              <button type="button" onClick={() => choose(true)}>Turn counts on</button>
            </div>
            {error && <p className="planner-privacy-error" role="alert">{error}</p>}
          </div>
        </section>

        <section>
          <h2>4. Optional advertising cookies on the website</h2>
          <p>The public website’s Google Ads tag is off unless you accept its optional cookies. If accepted, Google may process page and advertising-interaction signals, including the page URL, referrer, IP address, browser/network details, timestamps and advertising click identifiers. We do not send floorplan drawings, room dimensions, filenames, account details or contact messages through that tag. The planner’s action counts described above are separate and are not used for advertising. See the <a href="/cookies/" target="_blank" rel="noopener noreferrer">cookies and device-storage notice</a> for the website’s controls and details.</p>
        </section>

        <section>
          <h2>5. Website use and enquiries</h2>
          <p>Cloudflare delivers and protects the website and planner and processes technical information such as IP address, requested URL, request time, browser information and security signals. The secure contact form loads Cloudflare Turnstile only after you enable it to reduce spam.</p>
          <p>If you contact us, we receive the details and message you choose to provide. Please do not submit passwords, payment details or sensitive personal information. We do not store unfinished messages, keep a separate enquiry database or add you to a mailing list.</p>
        </section>

        <section>
          <h2>6. AI features and generated content</h2>
          <p>If you request an AI concept render, the selected reference image and prompt are sent to OpenAI. Your project document and geometry are not sent as part of that request. The reference image is a visual input and does not determine whether an object fits.</p>
          <p>If you request an AI 3D asset, the photos you select are sent to Tripo through private temporary storage to generate the model. Temporary files are removed after Tripo accepts the job or it fails, and are also covered by a one-day storage expiry rule. Dimensions you enter are stored separately as intended physical dimensions and are not sent as exact size controls to Tripo. Generated mesh bounds remain visual-only and never decide fit.</p>
          <p>AI-assisted or generated imagery is not necessarily a photograph, measured drawing or buildability assessment. We do not use your project files to train an AI model through these features.</p>
        </section>

        <section>
          <h2>7. Purposes and lawful bases</h2>
          <p>We process information to provide the planner and calculations, respond to enquiries and secure the service, based on our legitimate interests in operating a useful, reliable tool and preventing abuse. Limited aggregate action counts support service measurement with data minimisation and a free, immediate opt-out. Optional advertising processing on the website relies on consent where required. We process information for legal obligations and rights requests where applicable. We do not sell personal information.</p>
        </section>

        <section>
          <h2>8. Providers and international processing</h2>
          <p>Depending on the feature you use, providers include Cloudflare (hosting, delivery, security and storage), Railway (calculation and event relay), PostHog (aggregate action counts), Supabase (account and cloud services), Stripe (billing), OpenAI (requested concept renders), Tripo (requested 3D asset generation) and Google (the optional website advertising tag). Authorised people working for JKM property investments may access enquiry correspondence and aggregate reports.</p>
          <p>These providers may process information outside the UK or EEA, including in the United States. Applicable safeguards depend on the provider’s terms and transfer and may include adequacy arrangements or standard contractual clauses with applicable UK provisions. Contact us for information about safeguards relevant to your information. Providers may also process technical records for their own security, service or legal obligations.</p>
          <p>Provider notices: <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noopener noreferrer">Cloudflare</a>, <a href="https://railway.com/legal/privacy" target="_blank" rel="noopener noreferrer">Railway</a>, <a href="https://posthog.com/privacy" target="_blank" rel="noopener noreferrer">PostHog</a>, <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Google</a>.</p>
        </section>

        <section>
          <h2>9. How long information is kept</h2>
          <p>Local projects and preferences remain in your browser until you remove them, replace them or your browser clears them. Temporary AI asset uploads are subject to the deletion process and one-day expiry described above. Enquiries are retained for 30 days from receipt, including associated reply copies under our control; an ongoing conversation does not reset an earlier message’s deadline. Information required by law may be retained longer for that purpose.</p>
          <p>Usage-event retention follows the active PostHog account settings and reporting needs. Events do not contain an end-user identifier, so it may not be possible to isolate one person’s event. Provider security, service and backup records may have different retention periods. Data already received by a provider cannot necessarily be recalled when you delete a local or cloud copy.</p>
        </section>

        <section>
          <h2>10. Your choices, rights and complaints</h2>
          <p>Depending on the circumstances, you may request access, correction, erasure, restriction or a portable copy of personal information. You may object to processing based on legitimate interests, including the action counts, and withdraw consent to optional advertising at any time. Turning counts off does not restrict the planner.</p>
          <p>Contact us at <a href="mailto:info@freefloorplan3d.com">info@freefloorplan3d.com</a>. We may need proportionate information to verify your identity and locate relevant records. We normally respond within one month and explain any lawful extension. You can complain to the <a href="https://ico.org.uk/make-a-complaint/" target="_blank" rel="noopener noreferrer">UK Information Commissioner’s Office</a> or, where EU GDPR applies, your relevant supervisory authority.</p>
        </section>

        <section>
          <h2>11. Security, automated checks and children</h2>
          <p>Spam checks may reject contact-form submissions; if that happens, email us instead. Planner calculations evaluate geometry and do not make decisions about people with legal or similarly significant effects. The service is for general space planning and is not intended to collect children’s personal information. Contact us if a child has supplied information that should be removed.</p>
        </section>

        <section>
          <h2>12. AI transparency and policy changes</h2>
          <p>AI has helped create parts of the website, including code, written content and labelled concept artwork. Website illustrations are conceptual and not to scale. Planner AI features are described above; generated imagery does not establish whether an object fits or a design is buildable.</p>
          <p>We update this policy when our processing changes. New purposes requiring consent need an appropriate choice before activation. Read the <a href="/privacy/" target="_blank" rel="noopener noreferrer">website privacy policy</a> and <a href="/cookies/" target="_blank" rel="noopener noreferrer">cookies notice</a> for the canonical website notices and further detail.</p>
        </section>
      </article>
    </FloatingToolbar>
  );
}
