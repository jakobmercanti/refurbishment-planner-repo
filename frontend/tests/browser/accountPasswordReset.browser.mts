import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { startBrowserHarness } from "./harness.mjs";

let harness;
before(async () => { harness = await startBrowserHarness(); });
after(async () => { await harness?.close(); });

const user = { id: "recovery-test-user", email: "recovery-test@example.invalid" };
const recoveryHash = "#access_token=mock-recovery-access&refresh_token=mock-recovery-refresh&expires_in=3600&type=recovery";

test("recovery email shows the new-password form instead of the signed-in account, survives refresh, and finishes with sign-in", async t => {
  const session = await harness.session(); t.after(() => session.close());
  const { page, context } = session;
  let updates = 0, logouts = 0;
  await context.route("**/planner/auth-api/user", async route => {
    if (route.request().method() === "PUT") {
      updates++;
      assert.deepEqual(route.request().postDataJSON(), { password: "Mock-New-Password-2026" });
      assert.equal(route.request().headers().authorization, "Bearer mock-recovery-access");
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(user) });
  });
  await context.route("**/planner/auth-api/logout", async route => {
    logouts++; await route.fulfill({ status: 204 });
  });
  await context.route("**/planner/auth-api/token?grant_type=password", async route => {
    assert.deepEqual(route.request().postDataJSON(), { email: user.email, password: "Mock-New-Password-2026" });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ access_token: "mock-new-access", refresh_token: "mock-new-refresh", expires_in: 3600, user }) });
  });
  await page.goto(harness.origin + "/planner/account/" + recoveryHash);
  await page.getByRole("heading", { name: "Set a new password", exact: true }).waitFor();
  assert.equal(await page.getByRole("link", { name: "Open cloud workspace", exact: true }).count(), 0);
  assert.equal(new URL(page.url()).hash, "", "Accepted credentials must be removed from the URL");
  await page.reload();
  await page.getByRole("heading", { name: "Set a new password", exact: true }).waitFor();
  await page.getByLabel("New password", { exact: true }).fill("Mock-New-Password-2026");
  await page.getByLabel("Confirm new password", { exact: true }).fill("Different-Password-2026");
  await page.getByRole("button", { name: "Save new password", exact: true }).click();
  await page.getByText("The passwords do not match. Enter the same new password twice.", { exact: true }).waitFor();
  assert.equal(updates, 0);
  await page.getByLabel("Confirm new password", { exact: true }).fill("Mock-New-Password-2026");
  await page.getByRole("button", { name: "Save new password", exact: true }).click();
  await page.getByText("Password changed. Sign in below with your new password.", { exact: true }).waitFor();
  assert.equal(updates, 1); assert.equal(logouts, 1);
  assert.equal(await page.evaluate(() => sessionStorage.getItem("freefloorplan3d:commercial-session:v1")), null);
  assert.equal(await page.getByLabel("Email", { exact: true }).inputValue(), user.email);
  assert.equal(await page.getByLabel("Password", { exact: true }).inputValue(), "");
  await page.getByLabel("Password", { exact: true }).fill("Mock-New-Password-2026");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Open plans and billing", exact: true }).waitFor();
});

test("expired reset links explain how to request a new link rather than showing account ready", async t => {
  const session = await harness.session(); t.after(() => session.close());
  const { page, context } = session;
  let requests = 0;
  await context.route("**/planner/auth-api/recover?**", async route => { requests++; await route.fulfill({ status: 200, contentType: "application/json", body: "{}" }); });
  await page.goto(harness.origin + "/planner/account/#error=access_denied&error_code=otp_expired&error_description=Expired");
  await page.getByRole("heading", { name: "Reset your password", exact: true }).waitFor();
  await page.getByText(/This email link has expired or has already been used/).waitFor();
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByRole("button", { name: "Send reset link", exact: true }).click();
  await page.getByText(/Password reset requested/).waitFor();
  assert.equal(requests, 1);
});

test("the already-open signed-in account has a direct change-password action and does not claim success on an API failure", async t => {
  const session = await harness.session(); t.after(() => session.close());
  const { page, context } = session;
  await page.goto(harness.origin + "/planner/404.html");
  await page.evaluate(user => sessionStorage.setItem("freefloorplan3d:commercial-session:v1", JSON.stringify({ access_token: "mock-existing-access", refresh_token: "mock-existing-refresh", expires_at: Math.floor(Date.now() / 1000) + 3600, user })), user);
  let updates = 0;
  await context.route("**/planner/auth-api/user", async route => {
    assert.equal(route.request().method(), "PUT"); updates++;
    await route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  });
  await page.goto(harness.origin + "/planner/account/");
  await page.getByRole("heading", { name: "Account ready", exact: true }).waitFor();
  await page.getByRole("button", { name: "Change password", exact: true }).click();
  await page.getByRole("heading", { name: "Set a new password", exact: true }).waitFor();
  await page.getByLabel("New password", { exact: true }).fill("Mock-New-Password-2026");
  await page.getByLabel("Confirm new password", { exact: true }).fill("Mock-New-Password-2026");
  await page.getByRole("button", { name: "Save new password", exact: true }).click();
  await page.getByText("Account services are temporarily unavailable. Please try again in a moment.", { exact: true }).waitFor();
  assert.equal(updates, 1);
  assert.equal(await page.getByRole("button", { name: "Save new password", exact: true }).isEnabled(), true);
  assert.equal(await page.getByLabel("Confirm new password", { exact: true }).inputValue(), "Mock-New-Password-2026");
});
