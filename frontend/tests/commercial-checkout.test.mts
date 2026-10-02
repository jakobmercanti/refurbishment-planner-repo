import assert from "node:assert/strict";
import test from "node:test";
import { createCheckout } from "../lib/commercialApi.ts";

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
