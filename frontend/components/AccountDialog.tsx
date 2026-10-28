"use client";

import { useEffect, useRef, useState } from "react";
import { WindowHelpButton } from "@/components/WindowHelpButton";
import { AccountExperience } from "@/components/AccountExperience";

export function AccountDialog({ onClose, initialSection = "account", notice }: { onClose: () => void; initialSection?: "account" | "plans"; notice?: string }) {
  const dialog = useRef<HTMLElement>(null);
  const [section, setSection] = useState<"account" | "plans">(initialSection);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (dialog.current?.hasAttribute("data-window-maximized") || dialog.current?.querySelector(".window-help-host")) return;
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
        {section === "plans" && <nav className="account-dialog-tabs" aria-label="Account links"><button type="button" onClick={() => setSection("account")}>Back to account</button></nav>}
        <div className="window-header-actions"><WindowHelpButton title="Account & plans" /><button type="button" className="modal-close" onClick={onClose} aria-label="Close account window">×</button></div>
      </header>
      {notice && <p className="commercial-status" role="status">{notice}</p>}
      <AccountExperience embedded onClose={onClose} embeddedSection={section} onEmbeddedSectionChange={setSection} />
    </section>
  </div>;
}
