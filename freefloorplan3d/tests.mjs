import test from 'node:test';
import assert from 'node:assert/strict';
import {pages,origin} from './site.mjs';
import worker from './worker.generated.mjs';
const site=pages();
test('all public pages have unique metadata, one heading and valid structured data',async()=>{
 const titles=new Set();
 for(const [path,html] of Object.entries(site)){
  assert.equal((html.match(/<h1>/g)||[]).length,1,path);
  const title=html.match(/<title>(.*?)<\/title>/s)[1];assert(!titles.has(title));titles.add(title);
  assert(html.includes(`rel="canonical" href="${origin}${path}"`));
  assert(JSON.parse(html.match(/application\/ld\+json">(.*?)<\/script>/s)[1])['@graph']);
  const response=await worker.fetch(new Request(origin+path));assert.equal(response.status,200,path);
  assert.equal(response.headers.get('content-type'),'text/html; charset=utf-8');
 }
});
test('every local link, image, script and fragment resolves',async()=>{
 for(const [path,html] of Object.entries(site)){
  for(const [,ref] of html.matchAll(/(?:href|src)="([^"]+)"/g)){
   if(!ref.startsWith('/')&&!ref.startsWith('#'))continue;
   const url=new URL(ref,origin+path);const response=await worker.fetch(new Request(url));
   assert.equal(response.status,200,`${path}: ${ref}`);
   if(url.hash){const target=site[url.pathname];assert(target?.includes(`id="${url.hash.slice(1)}"`),`${path}: missing ${ref}`);}
  }
 }
});
test('canonical redirects, real 404s, HEAD and unsupported methods',async()=>{
 for(const url of ['http://www.freefloorplan3d.com/guides/?x=1','https://freefloorplan3d.com/guides/?x=1']){
  const r=await worker.fetch(new Request(url));assert.equal(r.status,301);assert.equal(r.headers.get('location'),origin+'/guides/?x=1');
 }
 for(const path of ['/guides','/guides/index.html']){const r=await worker.fetch(new Request(origin+path));assert.equal(r.status,301);assert.equal(r.headers.get('location'),origin+'/guides/');}
 const missing=await worker.fetch(new Request(origin+'/not-a-real-page'));assert.equal(missing.status,404);assert.equal(missing.headers.get('x-robots-tag'),'noindex');
 const head=await worker.fetch(new Request(origin+'/',{method:'HEAD'}));assert.equal(head.status,200);assert.equal(await head.text(),'');
 assert.equal((await worker.fetch(new Request(origin+'/',{method:'POST'}))).status,405);
});
test('sitemap, robots, downloaded checklist, branded icons and caching',async()=>{
 const sitemap=await (await worker.fetch(new Request(origin+'/sitemap.xml'))).text();
 assert(!sitemap.includes('404.html'));assert.equal((sitemap.match(/<loc>/g)||[]).length,8);
 const robots=await (await worker.fetch(new Request(origin+'/robots.txt'))).text();assert(robots.includes(origin+'/sitemap.xml'));
 const download=await worker.fetch(new Request(origin+'/downloads/measurement-checklist.txt'));assert(download.headers.get('content-disposition').startsWith('attachment;'));assert((await download.text()).includes('MEASUREMENT CHECKLIST'));
 for(const path of ['/favicon-48.png','/favicon-192.png','/apple-touch-icon.png','/assets/brand-icon.png']){const r=await worker.fetch(new Request(origin+path));assert.equal(r.headers.get('content-type'),'image/png');assert((await r.arrayBuffer()).byteLength>500);}
 const first=await worker.fetch(new Request(origin+'/styles.css'));const cached=await worker.fetch(new Request(origin+'/styles.css',{headers:{'if-none-match':first.headers.get('etag')}}));assert.equal(cached.status,304);
});
