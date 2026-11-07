import test from 'node:test';
import assert from 'node:assert/strict';
import { authProxy } from './auth-proxy.mjs';
import { PasswordAttempts } from './password-attempts.mjs';
import worker from './planner-worker.mjs';

const origin = 'https://www.freefloorplan3d.com';
const baseEnv = { SUPABASE_URL: 'https://auth.example.test', AUTH_RATE_LIMIT: { limit: async () => ({ success: true }) } };
function testEnv() {
  const objects = new Map();
  return { ...baseEnv, PASSWORD_ATTEMPTS: { getByName(name) {
    if (!objects.has(name)) {
      const values = new Map();
      const storage = { get: async key => values.get(key), put: async (key, value) => values.set(key, value),
        delete: async key => values.delete(key), setAlarm: async () => {} };
      const counter = new PasswordAttempts({ storage }, baseEnv);
      objects.set(name, { fetch: (url, init) => counter.fetch(new Request(url, init)) });
    }
    return objects.get(name);
  } } };
}
const env = testEnv();
const request = (path, options = {}) => new Request(origin + '/planner/auth-api' + path, {
  method: 'POST', body: path.includes('grant_type=password') ? JSON.stringify({ email: 'test@example.invalid', password: 'mock-password' }) : '{}', ...options,
  headers: { Origin: origin, apikey: 'sb_publishable_test', 'Content-Type': 'application/json', ...options.headers },
});

test('production routes same-origin auth to the fixed provider, without forwarding cookies or browser headers', async () => {
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), env.SUPABASE_URL + '/auth/v1/token?grant_type=password');
      assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'manual'); assert.ok(init.signal);
      assert.deepEqual(init.headers, { apikey: 'sb_publishable_test', 'Content-Type': 'application/json' });
      assert.deepEqual(JSON.parse(new TextDecoder().decode(init.body)), { email: 'test@example.invalid', password: 'mock-password' });
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

test('verification resend allows only signup email and preserves the safe account return URL', async () => {
  const previous = globalThis.fetch;
  try {
    const path = '/resend?redirect_to=' + encodeURIComponent(origin + '/planner/account/');
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), env.SUPABASE_URL + '/auth/v1' + path);
      assert.deepEqual(JSON.parse(new TextDecoder().decode(init.body)), { type: 'signup', email: 'test@example.invalid' });
      return Response.json({});
    };
    assert.equal((await authProxy(request(path, { body: JSON.stringify({ type: 'signup', email: 'test@example.invalid' }) }), '/resend', env)).status, 200);
    globalThis.fetch = async () => assert.fail('Invalid resend requests must not reach the provider');
    for (const body of ['{}', '{', JSON.stringify({ type: 'email_change', email: 'test@example.invalid' }), JSON.stringify({ type: 'signup', email: 'test@example.invalid', password: 'not-forwarded' })]) {
      assert.equal((await authProxy(request(path, { body }), '/resend', env)).status, 400);
    }
    const foreign = '/resend?redirect_to=https://evil.example/planner/account/';
    assert.equal((await authProxy(request(foreign), '/resend', env)).status, 400);
  } finally { globalThis.fetch = previous; }
});

test('five failed password attempts are shared across case variants, IPs and simultaneous requests', async () => {
  const environment = testEnv(), previous = globalThis.fetch;
  let providerCalls = 0;
  const login = (email, ip = '203.0.113.7', password = 'wrong') => authProxy(request('/token?grant_type=password', {
    body: JSON.stringify({ email, password }), headers: { 'CF-Connecting-IP': ip },
  }), '/token', environment);
  try {
    globalThis.fetch = async (_url, init) => {
      providerCalls++;
      const input = JSON.parse(new TextDecoder().decode(init.body));
      assert.equal(input.email, input.email.trim().toLowerCase());
      return input.password === 'correct' ? Response.json({ access_token: 'fixture' }) : Response.json({ message: 'provider details' }, { status: 400 });
    };
    const attempts = await Promise.all(Array.from({ length: 8 }, (_, index) => login(index % 2 ? ' TEST@Example.invalid ' : 'test@example.invalid', `203.0.113.${index}`)));
    assert.equal(providerCalls, 5);
    assert.deepEqual(attempts.map(result => result.status).sort(), [400, 400, 400, 400, 429, 429, 429, 429]);
    const blocked = await login('test@example.invalid', '203.0.113.23', 'correct');
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('Retry-After')) > 0);
    assert.equal((await blocked.json()).error_code, 'password_attempt_limit');
    assert.equal(providerCalls, 5);
    for (let round = 0; round < 2; round++) {
      for (let n = 0; n < 4; n++) assert.equal((await login('other@example.invalid')).status, 400);
      assert.equal((await login('other@example.invalid', undefined, 'correct')).status, 200);
    }
  } finally { globalThis.fetch = previous; }
});
