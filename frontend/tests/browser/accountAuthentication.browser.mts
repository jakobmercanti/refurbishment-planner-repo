import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { eventually, startBrowserHarness } from "./harness.mjs";

let harness;
before(async () => { harness = await startBrowserHarness(); });
after(async () => { await harness?.close(); });

test("exported sign-up works with direct provider access blocked and recovers from a network failure without duplicate submission", async t => {
  const session = await harness.session(); t.after(() => session.close());
  const { page, context } = session;
  let requests = 0, directRequests = 0, available = false;
  page.on("request", request => { if (request.url().includes("supabase.co")) directRequests++; });
  await context.route("**/planner/auth-api/signup?**", async route => {
    requests++;
    assert.equal(route.request().method(), "POST");
    const url = new URL(route.request().url());
    assert.equal(url.searchParams.get("redirect_to"), harness.origin + "/planner/account/");
    if (!available) return route.abort("failed");
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { id: "pending-verification" } }) });
  });
  await page.goto(harness.origin + "/planner/account/");
  await page.getByRole("tab", { name: "Create account", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill("auth-test@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("not-a-real-password");
  const submit = page.getByRole("button", { name: "Create account", exact: true });
  await submit.click();
  await eventually(() => page.locator(".commercial-error").innerText(), text => text.includes("Cannot reach account services"));
  assert.match(await page.locator(".commercial-error").innerText(), /check your email first/);
  assert.equal(await submit.isEnabled(), true); assert.equal(requests, 1);
  available = true;
  await submit.click();
  await page.getByText(/Account request accepted\. If this is a new account/).waitFor();
  assert.match(await page.locator(".commercial-status").innerText(), /does not confirm that an email was sent/);
  assert.equal(await page.getByLabel("Password", { exact: true }).inputValue(), "");
  assert.equal(await page.getByRole("button", { name: "Resend available after 60 seconds", exact: true }).isEnabled(), false);
  await page.getByRole("button", { name: "Use existing account · Sign in", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Sign in", exact: true }).isEnabled(), true);
  assert.equal(requests, 2); assert.equal(directRequests, 0);
});

test("unverified sign-in exposes an explicit password-free resend, throttles repeats and never promises delivery", async t => {
  const session = await harness.session(); t.after(() => session.close());
  const { page, context } = session;
  let sends = 0;
  await context.route("**/planner/auth-api/token?grant_type=password", route => route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error_code: "email_not_confirmed", msg: "Email not confirmed" }) }));
  await context.route("**/planner/auth-api/resend?**", async route => {
    sends++;
    assert.deepEqual(route.request().postDataJSON(), { type: "signup", email: "auth-test@example.invalid" });
    assert.equal(new URL(route.request().url()).searchParams.get("redirect_to"), harness.origin + "/planner/account/");
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.goto(harness.origin + "/planner/account/");
  await page.getByLabel("Email", { exact: true }).fill("auth-test@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("not-a-real-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByText(/This account needs email verification/).waitFor();
  // Resending must not require the password to remain filled or valid.
  await page.getByLabel("Password", { exact: true }).fill("");
  await page.getByRole("button", { name: "Resend verification email", exact: true }).click();
  await page.getByText(/Verification requested\. If this address has an unverified account/).waitFor();
  assert.match(await page.locator(".commercial-status").innerText(), /Delivery is not guaranteed/);
  assert.equal(sends, 1);
  assert.equal(await page.getByRole("button", { name: "Resend available after 60 seconds", exact: true }).isEnabled(), false);
});

test("exported sign-in distinguishes rate limiting and permits explicit retry over same-origin transport", async t => {
  const session = await harness.session(); t.after(() => session.close());
  const { page, context } = session;
  let requests = 0;
  await context.route("**/planner/auth-api/token?grant_type=password", async route => {
    requests++;
    const body = requests === 1 ? {} : { access_token: "mock-access", refresh_token: "mock-refresh", expires_in: 3600, user: { id: "test-user" } };
    return route.fulfill({ status: requests === 1 ? 429 : 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto(harness.origin + "/planner/account/");
  await page.getByLabel("Email", { exact: true }).fill("auth-test@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("not-a-real-password");
  const submit = page.getByRole("button", { name: "Sign in", exact: true });
  await submit.click();
  await eventually(() => page.locator(".commercial-error").innerText(), text => text.includes("Too many account requests"));
  assert.equal(requests, 1); assert.equal(await submit.isEnabled(), true);
  await submit.click();
  await page.getByRole("button", { name: "Open plans and billing", exact: true }).waitFor();
  assert.equal(requests, 2);
  assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem("freefloorplan3d:commercial-session:v1")!).user.id), "test-user");
});
