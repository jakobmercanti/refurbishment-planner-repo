import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { previewServer } from './preview.mjs';

test('release preview serves extensionless Plans as HTML and refuses sibling-path traversal', async t => {
  const folder = await mkdtemp(path.join(tmpdir(), 'cfd-preview-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const root = path.join(folder, 'out');
  await mkdir(root); await mkdir(path.join(folder, 'out-sibling'));
  await writeFile(path.join(root, 'plans'), '<!doctype html><title>Plans</title>');
  await writeFile(path.join(root, 'index.html'), '<title>Planner</title>');
  await writeFile(path.join(folder, 'out-sibling', 'secret.html'), 'must not escape root');
  const server = previewServer({ root });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const route of ['/planner-test/plans/', '/planner-test/plans']) {
    const response = await fetch(origin + route);
    assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /^text\/html/);
    assert.match(await response.text(), /<title>Plans<\/title>/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal((await fetch(origin + '/planner-test/')).status, 200);
  assert.equal((await fetch(origin + '/planner-test/%2e%2e%2fout-sibling/secret.html')).status, 404);
});
