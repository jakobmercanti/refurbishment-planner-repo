import { commercialRequest } from "./commercialApi";
import { currentSession } from "./commercialAuth";

export function paidPlan(value: string | null): "starter" | "pro" | "studio" | null {
  return value === "starter" || value === "pro" || value === "studio" ? value : null;
}

export function stripeDestination(value: unknown): string {
  if (typeof value !== "string") throw new Error("Stripe did not return a checkout link. Please retry.");
  const url = new URL(value);
  if (url.protocol !== "https:" || !["checkout.stripe.com", "billing.stripe.com", "payments.stripe.com"].includes(url.hostname) || url.username || url.password) {
    throw new Error("The billing service returned an invalid Stripe link.");
  }
  return url.href;
}

export async function prepareBillingNavigation(plan: string | null, portal = false): Promise<string | null> {
  const selected = paidPlan(plan);
  if (!selected && !portal) throw new Error("Choose Starter, Pro or Studio from the plans page first.");
  if (!await currentSession()) return null;
  const summary = await commercialRequest<{ status: string }>("/summary");
  const active = summary.status === "active" || summary.status === "trialing";
  // Existing subscribers must change plans through the portal, not buy a second subscription.
  const result = await commercialRequest<{ url: string }>(portal || active ? "/billing/portal" : "/billing/checkout", {
    method: "POST",
    ...(portal || active ? {} : { body: JSON.stringify({ product_key: selected }) }),
  });
  return stripeDestination(result.url);
}
