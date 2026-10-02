import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './planner-worker.mjs';

const origin = 'https://www.freefloorplan3d.com';
test('plain plans test bypasses app assets, disables caching and wires every tier', async () => {
  const env = { ASSETS: { fetch: async () => { throw new Error('Diagnostic page must not depend on app assets'); } } };
  const response = await worker.fetch(new Request(origin + '/planner/plans-test/'), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store, max-age=0');
  assert.equal(response.headers.get('X-Plans-Test-Version'), 'plans-test-20261002-v1');
  assert.equal(response.headers.get('X-Robots-Tag'), 'noindex');
  const html = await response.text();
  assert.ok(!html.includes('/_next/'));
  assert.ok(html.includes('plans-test-20261002-v1'));
  for (const tier of ['starter', 'pro', 'studio']) {
    assert.ok(html.includes(`href="/planner/checkout/?plan=${tier}"`));
    assert.ok(html.includes(`name="plan" value="${tier}"`));
  }
  assert.equal((html.match(/action="\/planner\/checkout\/" method="get"/g) ?? []).length, 3);
  const head = await worker.fetch(new Request(origin + '/planner/plans-test/', { method: 'HEAD' }), env);
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
});
test('exported account pages and explicit provider CSP origins work', async () => {
  const env = { SUPABASE_URL: 'https://project.supabase.co', R2_ORIGIN: 'https://account.r2.cloudflarestorage.com', ASSETS: { fetch: async request => new Response(new URL(request.url).pathname) } };
  const response = await worker.fetch(new Request(origin + '/planner/account/'), env);
  assert.equal(await response.text(), '/account/index.html');
  assert(response.headers.get('Content-Security-Policy').includes(env.SUPABASE_URL));
  assert(response.headers.get('Content-Security-Policy').includes(env.R2_ORIGIN));
  env.SUPABASE_URL = 'http://unsafe.example';
  assert(!(await worker.fetch(new Request(origin + '/planner/'), env)).headers.get('Content-Security-Policy').includes('unsafe.example'));
});
test('commercial proxy forwards only bearer credentials and exact webhook bytes', async () => {
  const env = { ENGINEERING_API_ORIGIN: 'https://example.up.railway.app' };
  const base = origin + '/planner/engineering-api/commercial';
  assert.equal((await worker.fetch(new Request(base + '/summary'), env)).status, 401);
  assert.equal((await worker.fetch(new Request(base + '/admin', { headers: { Authorization: 'Bearer jwt' } }), env)).status, 403);
  assert.equal((await worker.fetch(new Request(base + '/billing/portal', { method: 'POST', headers: { Authorization: 'Bearer jwt', Origin: 'https://foreign.example' }, body: '{}' }), env)).status, 403);
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = async (target, options) => {
      assert.equal(String(target), env.ENGINEERING_API_ORIGIN + '/commercial/summary');
      assert.deepEqual(options.headers, { 'Content-Type': 'application/json', Authorization: 'Bearer jwt' });
      return Response.json({ plan: 'free' });
    };
    const response = await worker.fetch(new Request(base + '/summary', { headers: { Authorization: 'Bearer jwt', Cookie: 'private=value' } }), env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    globalThis.fetch = async (target, options) => {
      assert.equal(String(target), env.ENGINEERING_API_ORIGIN + '/commercial/stripe/webhook');
      assert.deepEqual(options.headers, { 'Content-Type': 'application/json', 'Stripe-Signature': 'signed' });
      assert.equal(new TextDecoder().decode(options.body), '{ "raw": true }');
      return Response.json({ status: 'processed' });
    };
    assert.equal((await worker.fetch(new Request(base + '/stripe/webhook', { method: 'POST', headers: { 'Stripe-Signature': 'signed' }, body: '{ "raw": true }' }), env)).status, 200);
    assert.equal((await worker.fetch(new Request(base + '/stripe/webhook', { method: 'POST', headers: { 'Stripe-Signature': 'signed', 'Content-Length': '1000001' }, body: '{}' }), env)).status, 413);
  } finally { globalThis.fetch = previous; }
});
test('the canonical planner path serves assets, legacy paths redirect, and admin routes stay blocked', async () => {
  const requested = [];
  const env = { ASSETS: { fetch: async request => { requested.push(new URL(request.url).pathname); return new Response('planner'); } } };
  assert.equal((await worker.fetch(new Request(origin + '/'), env)).status, 404);
  const legacy = await worker.fetch(new Request(origin + '/planner-test/'), env);
  assert.equal(legacy.status, 308);
  assert.equal(legacy.headers.get('location'), origin + '/planner/');
  const response = await worker.fetch(new Request(origin + '/planner/'), env);
  assert.equal(await response.text(), 'planner');
  const csp = response.headers.get('Content-Security-Policy');
  for (const host of ['www.googletagmanager.com', 'www.googleadservices.com', 'googleads.g.doubleclick.net', 'pagead2.googlesyndication.com', 'www.google.co.uk']) assert(csp.includes(host), host);
  assert.deepEqual(requested, ['/index.html']);
  assert.equal((await worker.fetch(new Request(origin + '/planner/fixture-studio/'), env)).status, 404);
  for (const path of ['/catalog/items', '/settings', '/projects']) {
    assert.equal((await worker.fetch(new Request(origin + '/planner/engineering-api' + path, { method: 'POST', body: '{}' }), env)).status, 403);
  }
});
test('engineering proxy rejects foreign origins and strips credentials', async () => {
  const env = { ENGINEERING_API_ORIGIN: 'https://example.up.railway.app' };
  const endpoint = origin + '/planner/engineering-api/rooms/validate';
  assert.equal((await worker.fetch(new Request(endpoint, { method: 'POST', headers: { Origin: 'https://foreign.example' }, body: '{}' }), env)).status, 403);
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(String(url), 'https://example.up.railway.app/rooms/validate');
      assert.deepEqual(options.headers, { 'Content-Type': 'application/json' });
      return Response.json({ valid: true });
    };
    const response = await worker.fetch(new Request(endpoint, { method: 'POST', headers: { Origin: origin, Cookie: 'private=value', Authorization: 'Bearer private' }, body: '{}' }), env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  } finally { globalThis.fetch = originalFetch; }
});
