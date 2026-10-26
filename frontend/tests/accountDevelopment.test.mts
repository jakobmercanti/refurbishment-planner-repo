import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';
import configModule from '../next.config';
// Node/tsx loads Next's TS config through CommonJS interop; Next itself unwraps it.
const config: NextConfig = (configModule as unknown as { default?: NextConfig }).default ?? configModule;

test('Turbopack can resolve shared deployment modules from the repository root', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  assert.equal(path.resolve(config.turbopack!.root!), path.resolve(root));
});

test('local plan reads have their own authoritative route without enabling catalogue billing flags or proxying writes', async () => {
  const routes = await config.rewrites!();
  assert.ok(Array.isArray(routes));
  const account = routes.find(route => route.source === '/engineering-api/commercial/summary');
  assert.ok(account);
  assert.equal(account.destination, 'https://freefloorplan3d-api-production.up.railway.app/commercial/summary');
  assert.ok(routes.indexOf(account) < routes.findIndex(route => route.source === '/engineering-api/:path*'));
  assert.ok(!account.source.includes(':path*'));
  assert.ok(!account.source.includes('billing'));
  assert.ok(!account.source.includes('catalogue'));
});
