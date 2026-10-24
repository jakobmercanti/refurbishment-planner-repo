const unavailable = 'Account services are temporarily unavailable. Please try again in a moment.';
const json = (message, status) => Response.json({ message }, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });

/** Same-origin, public-key-only auth transport. Never log credentials or tokens. */
export async function authProxy(request, endpoint, env) {
  const url = new URL(request.url);
  const allowed = { GET: ['/settings', '/user'], POST: ['/token', '/signup', '/otp', '/recover', '/logout'], PUT: ['/user'] };
  if (!allowed[request.method]?.includes(endpoint)) return json('This account operation is unavailable.', 403);
  const origin = request.headers.get('Origin');
  if ((origin && origin !== url.origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site' || (request.method !== 'GET' && origin !== url.origin)) return json('Same-origin account request required.', 403);
  const keys = [...url.searchParams.keys()];
  if (endpoint === '/token') {
    if (keys.length !== 1 || keys[0] !== 'grant_type' || !['password', 'refresh_token'].includes(url.searchParams.get('grant_type'))) return json('Invalid account request.', 400);
  } else if (['/signup', '/otp', '/recover'].includes(endpoint)) {
    if (keys.length > 1 || keys.some(key => key !== 'redirect_to')) return json('Invalid account request.', 400);
    if (keys.length) {
      try {
        const redirect = new URL(url.searchParams.get('redirect_to'));
        if (redirect.origin !== url.origin || redirect.pathname !== '/planner/account/' || redirect.search || redirect.hash || redirect.username || redirect.password) return json('Invalid account return address.', 400);
      } catch { return json('Invalid account return address.', 400); }
    }
  } else if (keys.length) return json('Invalid account request.', 400);
  const key = request.headers.get('apikey') || '';
  if (key.length > 1024 || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return json('Public account configuration is unavailable.', 503);
  const authorization = request.headers.get('Authorization');
  if ((endpoint === '/user' || endpoint === '/logout') && (!authorization || authorization.length > 8200 || !/^Bearer\s+\S+$/i.test(authorization))) return json('Sign in to continue.', 401);
  try {
    const upstream = new URL(env.SUPABASE_URL);
    if (upstream.protocol !== 'https:' || upstream.username || upstream.password || upstream.pathname !== '/' || upstream.search || upstream.hash) return json(unavailable, 503);
    // Fail closed if production's edge rate limiter is not configured. Provider
    // limits still apply; no secret/service-role key is used to bypass them.
    if (!env.AUTH_RATE_LIMIT?.limit) return json(unavailable, 503);
    const rate = await env.AUTH_RATE_LIMIT.limit({ key: 'auth:' + (request.headers.get('CF-Connecting-IP') || 'unknown') });
    if (!rate.success) return json('Too many account requests. Please wait a little before trying again.', 429);
    let body;
    if (request.method !== 'GET') {
      if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return json('JSON account request required.', 415);
      if (Number(request.headers.get('Content-Length') || 0) > 16 * 1024) return json('Account request too large.', 413);
      const reader = request.body?.getReader(), chunks = []; let size = 0;
      if (reader) while (true) {
        const part = await reader.read(); if (part.done) break;
        size += part.value.byteLength;
        if (size > 16 * 1024) { await reader.cancel(); return json('Account request too large.', 413); }
        chunks.push(part.value);
      }
      body = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    }
    const forwarded = { apikey: key, 'Content-Type': 'application/json' };
    if (authorization) forwarded.Authorization = authorization;
    const response = await fetch(new URL('/auth/v1' + endpoint + url.search, upstream), {
      method: request.method, headers: forwarded, body, redirect: 'manual', signal: AbortSignal.timeout(15000),
    });
    if (response.status >= 300 && response.status < 400) return json(unavailable, 503);
    // Do not forward cookies, redirects, browser headers or cacheable sessions.
    const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    const retry = response.headers.get('Retry-After');
    if (response.status === 429 && retry && /^\d{1,6}$/.test(retry)) headers.set('Retry-After', retry);
    return new Response(response.body, { status: response.status, headers });
  } catch { return json(unavailable, 503); }
}
