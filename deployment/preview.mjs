import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../frontend/out/', import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.txt': 'text/plain' };
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1:4176');
    if (!url.pathname.startsWith('/planner-test/')) { res.writeHead(404); res.end(); return; }
    const resource = decodeURIComponent(url.pathname.slice('/planner-test'.length));
    if (resource.startsWith('/engineering-api/')) {
      const chunks = []; for await (const c of req) chunks.push(c);
      const upstream = await fetch('http://127.0.0.1:8011' + resource.slice('/engineering-api'.length) + url.search, { method: req.method, headers: { 'Content-Type': 'application/json' }, ...(req.method !== 'GET' ? { body: Buffer.concat(chunks) } : {}) });
      res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') || 'application/json' }); res.end(Buffer.from(await upstream.arrayBuffer())); return;
    }
    const resolved = path.resolve(root, '.' + resource + (resource.endsWith('/') ? 'index.html' : ''));
    if (!resolved.startsWith(root)) { res.writeHead(404); res.end(); return; }
    const bytes = await readFile(resolved); res.writeHead(200, { 'Content-Type': types[path.extname(resolved)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(bytes);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(4176, '127.0.0.1', () => console.log('Release preview: http://127.0.0.1:4176/planner-test/'));
