import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './planner-worker.mjs';

const origin = 'https://www.freefloorplan3d.com';
test('only the isolated test prefix serves assets and admin routes stay blocked', async () => {
  const requested = [];
  const env = { ASSETS: { fetch: async request => { requested.push(new URL(request.url).pathname); return new Response('planner'); } } };
  assert.equal((await worker.fetch(new Request(origin + '/'), env)).status, 404);
  assert.equal((await worker.fetch(new Request(origin + '/planner-test'), env)).status, 308);
  const response = await worker.fetch(new Request(origin + '/planner-test/'), env);
  assert.equal(await response.text(), 'planner');
  assert.match(response.headers.get('X-Robots-Tag'), /noindex/);
  assert.deepEqual(requested, ['/index.html']);
  assert.equal((await worker.fetch(new Request(origin + '/planner-test/fixture-studio/'), env)).status, 404);
  for (const path of ['/catalog/items', '/settings', '/projects']) {
    assert.equal((await worker.fetch(new Request(origin + '/planner-test/engineering-api' + path, { method: 'POST', body: '{}' }), env)).status, 403);
  }
});
test('engineering proxy rejects foreign origins and strips credentials', async () => {
  const env = { ENGINEERING_API_ORIGIN: 'https://example.up.railway.app' };
  const endpoint = origin + '/planner-test/engineering-api/rooms/validate';
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
