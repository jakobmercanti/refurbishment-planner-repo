"use client";

import { currentSession } from "./commercialAuth";

const baseUrl = (process.env.NEXT_PUBLIC_COMMERCIAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "/engineering-api").replace(/\/$/, "");

export class CommercialApiError extends Error {
  constructor(message: string, readonly status: number, readonly detail?: unknown) {
    super(message);
    this.name = "CommercialApiError";
  }
}

export async function commercialRequest<T>(path: string, init: RequestInit = {}, requireAuth = true): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (requireAuth) {
    const session = await currentSession();
    if (!session) throw new CommercialApiError("Sign in to continue.", 401);
    headers.set("Authorization", `Bearer ${session.access_token}`);
  }
  const response = await fetch(`${baseUrl}/commercial${path}`, { ...init, headers, cache: "no-store" });
  const result = await response.json().catch(() => ({})) as { detail?: unknown; message?: string };
  if (!response.ok) {
    const detail = result.detail;
    const message = typeof detail === "string" ? detail : typeof detail === "object" && detail && "message" in detail && typeof detail.message === "string" ? detail.message : result.message ?? `Request failed (${response.status}).`;
    throw new CommercialApiError(message.slice(0, 500), response.status, detail);
  }
  return result as T;
}

export async function uploadSignedFile(url: string, headers: Record<string, string>, file: Blob): Promise<void> {
  const response = await fetch(url, { method: "PUT", headers, body: file });
  if (!response.ok) throw new Error("The private upload failed. Start the upload again.");
}

export async function createCheckout(productKey: string, keepPlannerOpen = false): Promise<void> {
  const checkoutWindow = keepPlannerOpen ? window.open("about:blank", "_blank") : null;
  if (keepPlannerOpen && !checkoutWindow) throw new Error("Allow pop-ups to open secure Stripe checkout without closing your planner.");
  if (checkoutWindow) checkoutWindow.opener = null;
  try {
    const result = await commercialRequest<{ url: string }>("/billing/checkout", {
      method: "POST", body: JSON.stringify({ product_key: productKey }),
    });
    if (checkoutWindow) checkoutWindow.location.replace(result.url);
    else window.location.assign(result.url);
  } catch (cause) {
    checkoutWindow?.close();
    throw cause;
  }
}

export async function openBillingPortal(keepPlannerOpen = false): Promise<void> {
  const portalWindow = keepPlannerOpen ? window.open("about:blank", "_blank") : null;
  if (keepPlannerOpen && !portalWindow) throw new Error("Allow pop-ups to open the billing portal without closing your planner.");
  if (portalWindow) portalWindow.opener = null;
  try {
    const result = await commercialRequest<{ url: string }>("/billing/portal", { method: "POST" });
    if (portalWindow) portalWindow.location.replace(result.url);
    else window.location.assign(result.url);
  } catch (cause) {
    portalWindow?.close();
    throw cause;
  }
}
