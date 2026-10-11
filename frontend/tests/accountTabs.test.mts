import test from "node:test";
import assert from "node:assert/strict";
import { currentSession, AUTH_SESSION_CHANGED } from "../lib/commercialAuth.ts";

test("new account tabs acquire an ephemeral same-origin session and receive sign-out", async () => {
  const previous = Object.fromEntries(["window", "sessionStorage", "fetch"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL, previousKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const storage = new Map<string, string>();
  const events: string[] = [];
  const session = { access_token: "test-access", refresh_token: "test-refresh", expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "test-user" } };
  const channelHolder: { value?: Channel } = {};
  class Channel {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    listeners = new Set<(event: { data: unknown }) => void>();
    constructor(readonly name: string) { Object.assign(channelHolder, { value: this }); }
    addEventListener(_type: string, listener: (event: { data: unknown }) => void) { this.listeners.add(listener); }
    removeEventListener(_type: string, listener: (event: { data: unknown }) => void) { this.listeners.delete(listener); }
    send(data: unknown) { const event = { data }; this.onmessage?.(event); this.listeners.forEach(listener => listener(event)); }
    postMessage(data: { type: string; requestId?: string }) {
      if (data.type === "request") setTimeout(() => {
        this.send({ type: "response", requestId: "unrelated", session: { ...session, user: { id: "wrong-user" } } });
        assert.equal(storage.size, 0, "Unsolicited responses cannot overwrite a session");
        this.send({ type: "response", requestId: data.requestId, session });
      }, 750); // Simulate a throttled background planner tab.
    }
  }
  try {
    Object.defineProperty(globalThis, "window", { configurable: true, value: { BroadcastChannel: Channel, dispatchEvent: (event: Event) => { events.push(event.type); } } });
    Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) } });
    assert.deepEqual(await currentSession(), session);
    assert.equal(channelHolder.value!.name, "freefloorplan3d:account-tabs:v1");
    assert.ok(events.includes(AUTH_SESSION_CHANGED));
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://auth.example.test";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "mock-public-key";
    storage.set("freefloorplan3d:commercial-session:v1", JSON.stringify({ ...session, expires_at: 0 }));
    let completeRefresh: (response: Response) => void;
    let started: () => void;
    const began = new Promise<void>(resolve => { started = resolve; });
    globalThis.fetch = () => new Promise(resolve => { completeRefresh = resolve; started(); });
    const refreshing = currentSession(); await began;
    channelHolder.value!.send({ type: "changed", session: null });
    completeRefresh!(Response.json({ access_token: "late-access", refresh_token: "late-refresh", expires_in: 3600, user: { id: "test-user" } }));
    assert.equal(await refreshing, null, "A late refresh cannot sign the user back in after sign-out");
    assert.equal(storage.size, 0);
    assert.equal(await currentSession(), null, "Sign-out must not request and restore an old session from another tab");
  } finally {
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY; else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = previousKey;
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
