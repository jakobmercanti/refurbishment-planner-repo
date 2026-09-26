const BASE = '/planner';
const googleDomainSources = 'com ad ae com.af com.ag al am co.ao com.ar as at com.au az ba com.bd be bf bg com.bh bi bj co.bw by com.bz ca cd cf cg ci co.ck cl cm cn com.co co.cr com.cy cz de dj dk dm com.do dz com.ec ee com.eg es com.et fi com.fj fm fr ga ge gg com.gh com.gi gl gm gr com.gt gy com.hk hn hr ht hu co.id ie co.il im co.in iq is it je com.jm jo co.jp co.ke com.kh ki kg co.kr com.kw kz la com.lb li lk co.ls lt lu lv com.ly co.ma md me mg mk ml com.mm mn com.mt mu mv mw com.mx com.my co.mz com.na com.ng ni ne nl no com.np nr nu co.nz com.om com.pa com.pe com.pg com.ph com.pk pl pn com.pr ps pt com.py com.qa ro ru rw com.sa com.sb sc se com.sg sh si sk com.sl sn so sm sr st com.sv td tg co.th com.tj tl tm tn to com.tr tt com.tw co.tz com.ua co.ug co.uk com.uy com.uz com.vc com.ve co.vi com.vn vu ws rs co.za co.zm co.zw cat'.split(' ').map(suffix => `https://www.google.${suffix}`).join(' ');
const googleAdsSources = 'https://www.googletagmanager.com https://www.googleadservices.com https://googleads.g.doubleclick.net https://pagead2.googlesyndication.com https://www.google.com';
const googleAdsScriptSources = 'https://www.googletagmanager.com https://www.googleadservices.com https://www.google.com';
const headers = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': `default-src 'self'; script-src 'self' 'unsafe-inline' ${googleAdsScriptSources}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: ${googleAdsSources} ${googleDomainSources}; connect-src 'self' blob: ${googleAdsSources} https://ad.doubleclick.net ${googleDomainSources}; worker-src 'self' blob:; font-src 'self' data:; frame-src https://www.googletagmanager.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`,
};
function respond(response) { const out = new Response(response.body, response); for (const [k, v] of Object.entries(headers)) out.headers.set(k, v); return out; }
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/planner-test' || url.pathname.startsWith('/planner-test/')) {
      url.pathname = BASE + url.pathname.slice('/planner-test'.length);
      if (url.pathname === BASE) url.pathname += '/';
      return Response.redirect(url, 308);
    }
    if (url.pathname === BASE) { url.pathname += '/'; return Response.redirect(url, 308); }
    if (url.pathname === BASE + '/index.html') { url.pathname = BASE + '/'; return Response.redirect(url, 308); }
    if (!url.pathname.startsWith(`${BASE}/`)) return new Response('Not found', { status: 404 });
    const path = url.pathname.slice(BASE.length);
    if (path.startsWith('/engineering-api/')) {
      const endpoint = path.slice('/engineering-api'.length);
      if (endpoint === '/analytics/event') {
        if (request.method !== 'POST') return respond(new Response('Method not allowed', { status: 405 }));
        if (request.headers.get('Origin') !== url.origin || url.hostname !== 'www.freefloorplan3d.com')
          return respond(new Response('Forbidden', { status: 403 }));
        if (request.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json')
          return respond(new Response('JSON required', { status: 415 }));
        if (!env.ANALYTICS_RATE_LIMIT?.limit) return respond(new Response('Unavailable', { status: 503 }));
        const rate = await env.ANALYTICS_RATE_LIMIT.limit({ key: 'freefloorplan3d:analytics:' + (request.headers.get('CF-Connecting-IP') || 'unknown') });
        if (!rate.success) return respond(new Response('Too many requests', { status: 429 }));
        if (Number(request.headers.get('Content-Length') || 0) > 256)
          return respond(new Response('Request too large', { status: 413 }));
        const reader = request.body?.getReader();
        if (!reader) return respond(new Response('JSON required', { status: 400 }));
        const chunks = [];
        let length = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > 256) { await reader.cancel(); return respond(new Response('Request too large', { status: 413 })); }
          chunks.push(value);
        }
        const body = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
        if (!env.ENGINEERING_API_ORIGIN) return respond(new Response('Unavailable', { status: 503 }));
        const upstream = new URL(env.ENGINEERING_API_ORIGIN);
        if (upstream.protocol !== 'https:') return respond(new Response('Unavailable', { status: 503 }));
        try {
          const result = await fetch(new URL('/analytics/event', upstream), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Origin': 'https://www.freefloorplan3d.com' },
            body,
            redirect: 'manual',
            signal: AbortSignal.timeout(5000),
          });
          return respond(new Response(null, { status: result.status === 204 ? 204 : 502, headers: { 'Cache-Control': 'no-store' } }));
        } catch {
          return respond(new Response('Unavailable', { status: 502, headers: { 'Cache-Control': 'no-store' } }));
        }
      }
      const readable = request.method === 'GET' && (/^\/(health|demo|settings|products)(\/[^/]+)?$/.test(endpoint) || /^\/catalog\/(categories|items|materials)(\/[^/]+)?(\/images\/\d+)?$/.test(endpoint));
      const calculable = request.method === 'POST' && ['/rooms/validate', '/layout-checks', '/fit-checks', '/placements'].includes(endpoint);
      if (!readable && !calculable) return respond(Response.json({ detail: 'This operation is unavailable publicly.' }, { status: 403 }));
      if (calculable && request.headers.get('Origin') !== url.origin) return respond(new Response('Forbidden', { status: 403 }));
      if (!env.ENGINEERING_API_ORIGIN) return respond(Response.json({ detail: 'Engineering service is not configured.' }, { status: 503 }));
      const origin = new URL(env.ENGINEERING_API_ORIGIN);
      if (origin.protocol !== 'https:') return respond(new Response('Invalid API configuration', { status: 503 }));
      const target = new URL(endpoint + url.search, origin);
      try {
        const body = calculable ? await request.arrayBuffer() : undefined;
        if (body && body.byteLength > 4 * 1024 * 1024) return respond(new Response('Request too large', { status: 413 }));
        const result = await fetch(target, { method: request.method, headers: { 'Content-Type': 'application/json' }, body, redirect: 'manual', signal: AbortSignal.timeout(25000) });
        if (result.status >= 300 && result.status < 400) throw new Error('Unexpected upstream redirect');
        const out = respond(result); out.headers.set('Cache-Control', 'no-store'); return out;
      } catch (error) { console.error('Engineering proxy failure:', error instanceof Error ? error.message : 'Unknown upstream error'); return respond(Response.json({ detail: 'Engineering service is temporarily unavailable. Your local project is safe.' }, { status: 502 })); }
    }
    if (!['GET', 'HEAD'].includes(request.method) || path.startsWith('/fixture-studio')) return respond(new Response('Not found', { status: 404 }));
    url.pathname = path === '/' ? '/index.html' : path;
    const result = await env.ASSETS.fetch(new Request(url, { method: request.method, headers: request.headers }));
    const out = respond(result);
    if (url.hostname !== 'www.freefloorplan3d.com' || result.status >= 400 || path !== '/') out.headers.set('X-Robots-Tag', 'noindex');
    if (path === '/' || path.endsWith('.html') || path.endsWith('.txt')) out.headers.set('Cache-Control', 'no-cache');
    return out;
  },
};
