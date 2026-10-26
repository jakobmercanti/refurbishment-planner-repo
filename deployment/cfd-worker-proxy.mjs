/** Narrow authenticated proxy to the separate bounded worker, never the public API. */
export async function cfdWorkerProxy(request, endpoint, workerOrigin) {
  const url = new URL(request.url);
  const id = '[a-f0-9-]{36}';
  const allowed = request.method === 'GET'
    ? new RegExp(`^/climoptix/worker/(capabilities|jobs(?:/${id}(?:/(?:logs|result|slices|artifacts/(?:native-case|postprocessing|slice-\\d+)))?)?)$`).test(endpoint)
    : request.method === 'POST' && new RegExp(`^/climoptix/worker/(slice-data|jobs(?:/${id}/cancel)?)$`).test(endpoint);
  if (!allowed) return new Response('Forbidden', {status: 403});
  const authorization = request.headers.get('Authorization') || '';
  if (authorization.length > 8200 || !/^Bearer\s+\S+$/i.test(authorization)) return new Response('Authentication required', {status: 401});
  if (request.method === 'POST' && request.headers.get('Origin') !== url.origin) return new Response('Forbidden', {status: 403});
  try {
    const upstream = new URL(workerOrigin);
    if (upstream.protocol !== 'https:' || upstream.username || upstream.password || upstream.pathname !== '/') throw new Error('Invalid worker origin');
    let body;
    if (request.method === 'POST') {
      if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') return new Response('JSON required', {status: 415});
      const reader = request.body?.getReader(); const chunks = []; let size = 0;
      if (reader) while (true) {
        const part = await reader.read(); if (part.done) break;
        size += part.value.byteLength;
        if (size > 4*1024**2) { await reader.cancel(); return new Response('Request too large', {status: 413}); }
        chunks.push(part.value);
      }
      body = new Uint8Array(size); let at = 0;
      for (const chunk of chunks) {body.set(chunk, at); at += chunk.byteLength;}
    }
    const result = await fetch(new URL(endpoint + url.search, upstream), {method: request.method,
      headers: {'Content-Type': 'application/json', Authorization: authorization}, body,
      redirect: 'manual', signal: AbortSignal.timeout(endpoint.includes('/artifacts/') ? 120000 : 25000)});
    if (result.status >= 300 && result.status < 400) throw new Error('Unexpected worker redirect');
    const headers = new Headers({'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
    for (const key of ['Content-Type', 'Content-Disposition', 'Content-Length']) if (result.headers.has(key)) headers.set(key, result.headers.get(key));
    return new Response(result.body, {status: result.status, headers});
  } catch {
    return Response.json({detail: 'The CFD worker is temporarily unavailable. Your local study is safe.'}, {status: 503, headers: {'Cache-Control': 'no-store'}});
  }
}
