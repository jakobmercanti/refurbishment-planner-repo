"use client";

import { useEffect } from "react";

const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const accountUrl = `${base}/account/?tab=plans`;

export default function BillingPage() {
  useEffect(() => {
    const query = new URLSearchParams({ tab: "plans" });
    const checkout = new URLSearchParams(window.location.search).get("checkout");
    if (checkout === "success" || checkout === "cancelled") query.set("checkout", checkout);
    window.location.replace(`${base}/account/?${query.toString()}`);
  }, []);

  return <main className="commercial-page"><div className="commercial-content">
    <section className="commercial-panel">
      <h1>Returning to your account…</h1>
      <p>If the page does not continue automatically, <a href={accountUrl}>open plans and billing</a>.</p>
    </section>
  </div></main>;
}
