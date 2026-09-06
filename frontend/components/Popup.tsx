"use client";

interface PopupProps {
  open: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function Popup({ open, title, message, onConfirm, onCancel }: PopupProps) {
  if (!open) return null;
  return <div className="popup-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
    <section className="popup" role="dialog" aria-modal="true" aria-labelledby="popup-title" onMouseDown={(event) => event.stopPropagation()}>
      <header className="popup-titlebar"><span className="popup-drag" aria-hidden>⠿</span><strong id="popup-title">{title}</strong></header>
      <div className="popup-content"><p>{message}</p></div>
      <footer className="popup-actions"><button type="button" onClick={onCancel} autoFocus>Cancel</button><button type="button" className="primary" onClick={onConfirm}>Ok</button></footer>
    </section>
  </div>;
}
