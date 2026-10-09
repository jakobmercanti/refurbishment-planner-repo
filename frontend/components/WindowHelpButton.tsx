"use client";
export const WINDOW_HELP_EVENT = "plannerbuild:window-help";
export function WindowHelpButton({ title }: { title: string }) {
  return <button type="button" className="window-help-button" aria-label={`Help for ${title}`} title={`How to use ${title}`} onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onClick={event => {
    event.stopPropagation();
    const section = event.currentTarget.closest("section, [role='dialog']");
    const controls = section ? Array.from(section.querySelectorAll("button:not(.window-help-button):not(.floating-toolbar-resize), label")).map(item => item.textContent?.trim() ?? "").filter(Boolean).slice(0, 18) : [];
    window.dispatchEvent(new CustomEvent(WINDOW_HELP_EVENT, { detail: { title, controls, opener: event.currentTarget } }));
  }}>?</button>;
}
