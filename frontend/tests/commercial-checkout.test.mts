import assert from "node:assert/strict";
import test from "node:test";
import { createCheckout } from "../lib/commercialApi.ts";
import { paidPlan, prepareBillingNavigation, stripeDestination } from "../lib/billingNavigation.ts";
import { readFileSync } from "node:fs";

test("plan choices submit native browser GET forms without client click handling", () => {
  const source = readFileSync(new URL("../components/PlansAndBillingPanel.tsx", import.meta.url), "utf8");
  assert.ok(source.includes('/checkout/`} method="get"'));
  assert.ok(source.includes('type="hidden" name="plan" value={plan.plan_key}'));
  assert.ok(!source.includes("createCheckout"));
  assert.ok(!source.includes("canUsePaidActions"));
});

test("only paid plans and HTTPS Stripe destinations are accepted", () => {
  for (const plan of ["starter", "pro", "studio"]) assert.equal(paidPlan(plan), plan);
  for (const plan of [null, "free", "evil", "https://example.com"]) assert.equal(paidPlan(plan), null);
  assert.equal(stripeDestination("https://checkout.stripe.com/c/pay/test"), "https://checkout.stripe.com/c/pay/test");
  for (const url of [undefined, "http://checkout.stripe.com/", "https://checkout.stripe.com.evil.test/", "https://evil.test/", "https://user@checkout.stripe.com/"]) {
    assert.throws(() => stripeDestination(url));
  }
});

test("dedicated checkout handles signed-out, each paid plan, existing subscriptions and API failures", async () => {
  const saved = Object.fromEntries(["window", "sessionStorage", "fetch"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let session: string | null = null;
  let status = "free";
  let failure = false;
  const requests: string[] = [];
  try {
    Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
    Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: { getItem: () => session } });
    globalThis.fetch = async (url, init) => {
      const path = String(url);
      assert.ok(init?.signal, "Network requests must have a timeout");
      requests.push(path);
      if (path.endsWith("/summary")) return Response.json({ status });
      if (failure) return Response.json({ detail: "Stripe configuration needs attention" }, { status: 503 });
      if (path.endsWith("/billing/checkout")) {
        assert.ok(["starter", "pro", "studio"].includes(JSON.parse(String(init?.body)).product_key));
        return Response.json({ url: "https://checkout.stripe.com/c/pay/test" });
      }
      assert.ok(path.endsWith("/billing/portal"));
      return Response.json({ url: "https://billing.stripe.com/p/session/test" });
    };
    assert.equal(await prepareBillingNavigation("starter"), null);
    assert.equal(requests.length, 0, "Guests cannot create checkout sessions");
    await assert.rejects(prepareBillingNavigation("free"), /Choose Starter/);
    session = JSON.stringify({ access_token: "test-token", refresh_token: "test-refresh", expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "test-user" } });
    for (const plan of ["starter", "pro", "studio"]) assert.equal(await prepareBillingNavigation(plan), "https://checkout.stripe.com/c/pay/test");
    status = "active";
    assert.equal(await prepareBillingNavigation("studio"), "https://billing.stripe.com/p/session/test");
    status = "trialing";
    assert.equal(await prepareBillingNavigation("pro"), "https://billing.stripe.com/p/session/test");
    status = "free";
    failure = true;
    await assert.rejects(prepareBillingNavigation("starter"), /Stripe configuration needs attention/);
  } finally {
    for (const key of Object.keys(saved)) {
      const descriptor = saved[key];
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

test("checkout continues in the current tab when a pop-up is blocked", async () => {
  const saved = Object.fromEntries(["window", "sessionStorage", "fetch"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let destination = "";
  let requested = false;
  const session = JSON.stringify({ access_token: "test-token", refresh_token: "test-refresh", expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "test-user" } });
  try {
    Object.defineProperty(globalThis, "window", { configurable: true, value: { open: () => null, location: { assign: (url: string) => { destination = url; } } } });
    Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: { getItem: () => session } });
    globalThis.fetch = async (url, init) => {
      assert.ok(String(url).endsWith("/commercial/billing/checkout"));
      assert.equal(init?.method, "POST");
      assert.equal(init?.body, JSON.stringify({ product_key: "starter" }));
      requested = true;
      return Response.json({ url: "https://checkout.stripe.com/c/pay/test-session" });
    };
    await createCheckout("starter", true);
    assert.equal(requested, true);
    assert.equal(destination, "https://checkout.stripe.com/c/pay/test-session");
  } finally {
    for (const key of Object.keys(saved)) {
      const descriptor = saved[key];
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
