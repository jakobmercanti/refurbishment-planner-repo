import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { currentSession, sendPasswordReset, signIn, signOut, signUp, updatePassword } from "../lib/commercialAuth.ts";

const sessionKey = "freefloorplan3d:commercial-session:v1";
const storage = new Map<string, string>();
const session = { access_token: "test-access", refresh_token: "test-refresh", expires_in: 3600, user: { id: "test-user" } };
const globals = ["window", "sessionStorage", "navigator", "fetch"] as const;
const savedGlobals = Object.fromEntries(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const envNames = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_BASE_PATH"];
const savedEnv = Object.fromEntries(envNames.map(key => [key, process.env[key]]));

beforeEach(() => {
  storage.clear();
  Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { origin: "http://localhost:3000" }, dispatchEvent() {} } });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: true } });
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) } });
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://auth.example.test";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  process.env.NEXT_PUBLIC_BASE_PATH = "";
});
afterEach(() => {
  for (const key of globals) {
    const descriptor = savedGlobals[key];
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  }
  for (const key of envNames) { if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key]; }
});

test("local and production sign-in use same-origin auth, without cookies or caching", async () => {
  for (const base of ["", "/planner"]) {
    process.env.NEXT_PUBLIC_BASE_PATH = base;
    globalThis.fetch = async (url, init) => {
      assert.equal(url, base + "/auth-api/token?grant_type=password");
      assert.equal(init?.credentials, "omit"); assert.equal(init?.cache, "no-store");
      assert.equal(init?.redirect, "error"); assert.ok(init?.signal);
      assert.equal(new Headers(init?.headers).get("apikey"), "sb_publishable_test");
      assert.deepEqual(JSON.parse(String(init?.body)), { email: "test@example.invalid", password: "not-a-real-password" });
      return Response.json(session);
    };
    assert.equal((await signIn(" test@example.invalid ", "not-a-real-password")).user.id, "test-user");
  }
});

test("sign-up keeps the account return URL and requires a valid provider response", async () => {
  process.env.NEXT_PUBLIC_BASE_PATH = "/planner";
  globalThis.fetch = async url => {
    const request = new URL(String(url), "http://localhost:3000");
    assert.equal(request.pathname, "/planner/auth-api/signup");
    assert.equal(request.searchParams.get("redirect_to"), "http://localhost:3000/planner/account/");
    return Response.json({ user: { id: "verification-pending" } });
  };
  assert.equal(await signUp("test@example.invalid", "not-a-real-password"), null);
  globalThis.fetch = async () => new Response("<html>upstream unavailable</html>", { status: 200 });
  await assert.rejects(signUp("test@example.invalid", "not-a-real-password"), /unexpected response/);
});

test("network failures are actionable and never automatically repeat sign-up", async () => {
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new TypeError("Failed to fetch"); };
  await assert.rejects(signUp("test@example.invalid", "not-a-real-password"), error => {
    assert.ok(error instanceof Error); assert.match(error.message, /Cannot reach account services/);
    assert.match(error.message, /check your email first/); assert.doesNotMatch(error.message, /Failed to fetch|not-a-real-password/); return true;
  });
  assert.equal(requests, 1);
});

test("offline and timed-out account requests have distinct useful messages", async () => {
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: false } });
  globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
  await assert.rejects(signIn("test@example.invalid", "password"), /You are offline/);
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: true } });
  globalThis.fetch = async () => { throw new DOMException("request aborted", "TimeoutError"); };
  await assert.rejects(signIn("test@example.invalid", "password"), /timed out/);
});

test("provider credential errors remain visible; rate limits and outages are distinguished", async () => {
  globalThis.fetch = async () => Response.json({ error_description: "Invalid login credentials" }, { status: 400 });
  await assert.rejects(signIn("test@example.invalid", "password"), /Invalid login credentials/);
  globalThis.fetch = async () => Response.json({}, { status: 429 });
  await assert.rejects(signIn("test@example.invalid", "password"), /Too many account requests/);
  globalThis.fetch = async () => new Response("bad gateway", { status: 502 });
  await assert.rejects(signIn("test@example.invalid", "password"), /temporarily unavailable/);
});

test("transient refresh failures preserve the session but rejected refresh credentials clear it", async () => {
  storage.set(sessionKey, JSON.stringify({ ...session, expires_at: 0 }));
  globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
  await assert.rejects(currentSession(), /Cannot reach/);
  assert.ok(storage.has(sessionKey));
  globalThis.fetch = async () => Response.json({ msg: "Invalid refresh token" }, { status: 400 });
  assert.equal(await currentSession(), null); assert.equal(storage.has(sessionKey), false);
});

test("password updates use the same bounded transport; sign-out remains local on outages", async () => {
  storage.set(sessionKey, JSON.stringify({ ...session, expires_at: Math.floor(Date.now() / 1000) + 3600 }));
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "/auth-api/user"); assert.equal(init?.method, "PUT"); assert.ok(init?.signal);
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-access");
    return Response.json(session.user);
  };
  await updatePassword("not-a-real-new-password");
  globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
  await signOut(); assert.equal(storage.size, 0);
});

test("password reset uses the same-origin endpoint and preserves the account email return URL", async () => {
  globalThis.fetch = async (url, init) => {
    const target = new URL(String(url), "http://localhost:3000");
    assert.equal(target.pathname, "/auth-api/recover");
    assert.equal(target.searchParams.get("redirect_to"), "http://localhost:3000/account/");
    assert.deepEqual(JSON.parse(String(init?.body)), { email: "test@example.invalid" });
    return Response.json({});
  };
  await sendPasswordReset("test@example.invalid");
});

test("missing public configuration still fails before any network request", async () => {
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  globalThis.fetch = async () => { assert.fail("No request should be made"); };
  await assert.rejects(signIn("test@example.invalid", "password"), /not configured/);
});

test("passwords are never sent through a plain-HTTP LAN proxy", async () => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { origin: "http://192.168.1.20:3000" } } });
  globalThis.fetch = async () => { assert.fail("Credentials must not leave an insecure LAN page"); };
  await assert.rejects(signIn("test@example.invalid", "password"), /use HTTPS or open this app at http:\/\/localhost:3000/);
});
