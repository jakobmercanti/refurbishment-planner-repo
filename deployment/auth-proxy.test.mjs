import test from 'node:test';
import assert from 'node:assert/strict';
import { authProxy } from './auth-proxy.mjs';
import worker from './planner-worker.mjs';

const origin = 'https://www.freefloorplan3d.com';
const env = { SUPABASE_URL: 'https://auth.example.test', AUTH_RATE_LIMIT: { limit: async () => ({ success: true }) } };
const request = (path, options = {}) => new Request(origin + '/planner/auth-api' + path, {
  method: 'POST', body: '{}', ...options,
  headers: { Origin: origin, apikey: 'sb_publishable_test', 'Content-Type': 'application/json', ...options.headers },
});

test('production routes same-origin auth to the fixed provider, without forwarding cookies or browser headers', async () => {
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), env.SUPABASE_URL + '/auth/v1/token?grant_type=password');
      assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'manual'); assert.ok(init.signal);
      assert.deepEqual(init.headers, { apikey: 'sb_publishable_test', 'Content-Type': 'application/json' });
      assert.equal(new TextDecoder().decode(init.body), '{}');
      return Response.json({ access_token: 'mock-session' }, { headers: { 'Set-Cookie': 'unsafe=1', 'Cache-Control': 'public' } });
    };
    const response = await worker.fetch(request('/token?grant_type=password', { headers: { Cookie: 'private=1', Referer: 'https://private.example/' } }), env);
    assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('Set-Cookie'), null); assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
    assert.ok(response.headers.has('Content-Security-Policy'));
    assert.deepEqual(await response.json(), { access_token: 'mock-session' });
  } finally { globalThis.fetch = previous; }
});

test('auth proxy rejects unlisted routes, methods, cross-origin writes and redirect injection before sending credentials', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => assert.fail('Rejected requests must not reach the provider');
  try {
    for (const [path, options, status] of [
      ['/admin/users', {}, 403], ['/token?grant_type=client_credentials', {}, 400],
      ['/token?grant_type=password&grant_type=refresh_token', {}, 400],
      ['/token?grant_type=password', { method: 'DELETE' }, 403],
      ['/token?grant_type=password', { headers: { Origin: 'https://evil.example' } }, 403],
      ['/token?grant_type=password', { headers: { Origin: '', 'Sec-Fetch-Site': 'cross-site' } }, 403],
      ['/signup?redirect_to=https://evil.example/planner/account/', {}, 400],
      ['/signup?redirect_to=' + encodeURIComponent(origin + '/planner/account/?next=https://evil.example'), {}, 400],
      ['/signup?redirect_to=' + encodeURIComponent(origin + '/other/'), {}, 400],
      ['/signup?unknown=1', {}, 400], ['/logout', {}, 401],
      ['/user', { method: 'PUT' }, 401], ['/token?grant_type=password', { headers: { apikey: 'sb_secret_never_forward' } }, 503],
      ['/token?grant_type=password', { headers: { 'Content-Type': 'text/plain' } }, 415],
    ]) assert.equal((await authProxy(request(path, options), path.split('?')[0], env)).status, status, path);
  } finally { globalThis.fetch = previous; }
});

test('auth return URLs and authenticated password updates are forwarded exactly', async () => {
  const previous = globalThis.fetch;
  try {
    const path = '/signup?redirect_to=' + encodeURIComponent(origin + '/planner/account/');
    globalThis.fetch = async url => { assert.equal(String(url), env.SUPABASE_URL + '/auth/v1' + path); return Response.json({ user: { id: 'pending' } }); };
    assert.equal((await authProxy(request(path), '/signup', env)).status, 200);
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), env.SUPABASE_URL + '/auth/v1/user'); assert.equal(init.method, 'PUT');
      assert.equal(init.headers.Authorization, 'Bearer mock-access'); return Response.json({ id: 'test-user' });
    };
    assert.equal((await authProxy(request('/user', { method: 'PUT', headers: { Authorization: 'Bearer mock-access' } }), '/user', env)).status, 200);
  } finally { globalThis.fetch = previous; }
});

test('public-only provider configuration, edge rate limiting and bounded request bodies fail closed', async () => {
  for (const SUPABASE_URL of ['http://auth.example.test', 'https://user:password@auth.example.test', 'https://auth.example.test/other', 'https://auth.example.test/?x=1']) {
    assert.equal((await authProxy(request('/token?grant_type=password'), '/token', { ...env, SUPABASE_URL })).status, 503);
  }
  assert.equal((await authProxy(request('/token?grant_type=password'), '/token', { ...env, AUTH_RATE_LIMIT: undefined })).status, 503);
  assert.equal((await authProxy(request('/token?grant_type=password'), '/token', { ...env, AUTH_RATE_LIMIT: { limit: async () => ({ success: false }) } })).status, 429);
  assert.equal((await authProxy(request('/signup', { body: 'x'.repeat(16385) }), '/signup', env)).status, 413);
  assert.equal((await authProxy(request('/signup', { headers: { 'Content-Length': '16385' } }), '/signup', env)).status, 413);
});

test('provider outages and redirects return safe uncached errors; rate limits remain visible', async () => {
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new Error('sensitive upstream details'); };
    const outage = await authProxy(request('/token?grant_type=password'), '/token', env);
    assert.equal(outage.status, 503); assert.equal(outage.headers.get('Cache-Control'), 'no-store');
    assert.doesNotMatch(await outage.text(), /sensitive/);
    globalThis.fetch = async () => new Response(null, { status: 307, headers: { Location: 'https://evil.example' } });
    const redirect = await authProxy(request('/token?grant_type=password'), '/token', env);
    assert.equal(redirect.status, 503); assert.equal(redirect.headers.get('Location'), null);
    globalThis.fetch = async () => Response.json({ msg: 'rate limited' }, { status: 429, headers: { 'Retry-After': '60' } });
    const limited = await authProxy(request('/token?grant_type=password'), '/token', env);
    assert.equal(limited.status, 429); assert.equal(limited.headers.get('Retry-After'), '60');
  } finally { globalThis.fetch = previous; }
});
