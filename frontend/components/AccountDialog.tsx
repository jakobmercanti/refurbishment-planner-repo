"use client";

import { useEffect, useRef, useState } from "react";
import { AccountExperience } from "@/components/AccountExperience";

export function AccountDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLElement>(null);
  const [section, setSection] = useState<"account" | "plans">("account");

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", closeOnEscape, true);
    dialog.current?.querySelector<HTMLButtonElement>(".modal-close")?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape, true);
      previousFocus?.focus();
    };
  }, [onClose]);

  return <div className="modal-backdrop account-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialog} className="settings-dialog local-assets account-dialog" role="dialog" aria-modal="true" aria-labelledby="account-dialog-title">
      <header className="local-assets-header account-dialog-header">
        <div><span className="eyebrow">YOUR WORKSPACE</span><h2 id="account-dialog-title">Account &amp; plans</h2></div>
        <nav className="commercial-tabs account-dialog-tabs" role="tablist" aria-label="Account sections">
          <button id="account-section-tab" type="button" role="tab" aria-controls="account-section-panel" aria-selected={section === "account"} className={section === "account" ? "selected" : ""} onClick={() => setSection("account")}>Account</button>
          <button id="plans-section-tab" type="button" role="tab" aria-controls="plans-section-panel" aria-selected={section === "plans"} className={section === "plans" ? "selected" : ""} onClick={() => setSection("plans")}>Plans</button>
        </nav>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close account window">×</button>
      </header>
      <AccountExperience embedded onClose={onClose} embeddedSection={section} onEmbeddedSectionChange={setSection} />
    </section>
  </div>;
}
