import test from 'node:test';
import assert from 'node:assert/strict';
import {cfdWorkerProxy} from './cfd-worker-proxy.mjs';

test('CFD proxy requires a bearer token, exact routes and same-origin writes', async () => {
  const origin = 'https://worker.example';
  const read = new Request('https://planner.example/planner/engineering-api/climoptix/worker/capabilities');
  assert.equal((await cfdWorkerProxy(read,'/climoptix/worker/capabilities',origin)).status,401);
  const headers = {Authorization:'Bearer opaque-token','Content-Type':'application/json',Origin:'https://evil.example'};
  const post = new Request(read.url,{method:'POST',headers,body:'{}'});
  assert.equal((await cfdWorkerProxy(post,'/climoptix/worker/jobs',origin)).status,403);
  assert.equal((await cfdWorkerProxy(new Request(read.url,{headers}),'/climoptix/worker/execute',origin)).status,403);
  assert.equal((await cfdWorkerProxy(new Request(read.url,{headers}),'/climoptix/worker/jobs/../../admin',origin)).status,403);
});

test('CFD proxy preserves authenticated scope and does not follow redirects', async t => {
  const original = globalThis.fetch; t.after(() => {globalThis.fetch=original;});
  const headers = {Authorization:'Bearer opaque-token','Content-Type':'application/json',Origin:'https://planner.example'};
  const request = new Request('https://planner.example/planner/engineering-api/climoptix/worker/jobs',{method:'POST',headers,body:'{"x":1}'});
  globalThis.fetch = async (url, options) => {
    assert.equal(url.href,'https://worker.example/climoptix/worker/jobs');
    assert.equal(options.headers.Authorization,'Bearer opaque-token');
    assert.equal(options.redirect,'manual');
    assert.equal(new TextDecoder().decode(options.body),'{"x":1}');
    return Response.json({id:'job'});
  };
  const result = await cfdWorkerProxy(request,'/climoptix/worker/jobs','https://worker.example');
  assert.equal(result.headers.get('Cache-Control'),'no-store');
  assert.deepEqual(await result.json(),{id:'job'});
  globalThis.fetch = async () => new Response(null,{status:302,headers:{Location:'https://evil.example'}});
  assert.equal((await cfdWorkerProxy(new Request(request.url,{headers}),'/climoptix/worker/capabilities','https://worker.example')).status,503);
});
