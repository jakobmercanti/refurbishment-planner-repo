import {mkdir,readFile,writeFile,readdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {pages,origin} from './site.mjs';
const out=new URL('./dist/',import.meta.url);
await mkdir(out,{recursive:true});
const site=pages();
const files={};
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.txt':'text/plain; charset=utf-8','.xml':'application/xml; charset=utf-8'};
async function record(path,data,type){files[path]={data:Buffer.from(data).toString('base64'),type,etag:'"'+createHash('sha256').update(data).digest('hex').slice(0,20)+'"'};}
for(const [path,html] of Object.entries(site)) {
  const relative=path==='/'?'index.html':path.endsWith('/')?path.slice(1)+'index.html':path.slice(1);
  const target=new URL(relative,out);await mkdir(new URL('.',target),{recursive:true});await writeFile(target,html);
  await record(path,html,types['.html']);
}
async function assets(dir,prefix=''){
 for(const e of await readdir(dir,{withFileTypes:true})){
  const relative=prefix+e.name;
  if(e.isDirectory()){await assets(join(dir,e.name),relative+'/');continue;}
  const target=new URL(relative,out);await mkdir(new URL('.',target),{recursive:true});await copyFile(join(dir,e.name),target);
  await record('/'+relative,await readFile(target),types[extname(e.name)]||'application/octet-stream');
 }
}
await assets(fileURLToPath(new URL('./public/',import.meta.url)));
const sitemap='<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+Object.keys(site).filter(p=>p!='/404.html').map(p=>`<url><loc>${origin}${p}</loc></url>`).join('')+'</urlset>\n';
const robots=`User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`;
for(const [path,data] of [['/sitemap.xml',sitemap],['/robots.txt',robots]]){await writeFile(new URL(path.slice(1),out),data);await record(path,data,types[extname(path)]);}
if(!files['/assets/home-3d.webp']) throw new Error('Required hero artwork is missing');
const worker=await readFile(new URL('./worker.mjs',import.meta.url),'utf8');
await writeFile(new URL('./worker.generated.mjs',import.meta.url),worker+'\nconst files='+JSON.stringify(files)+';\nexport default createWorker(files);\n');
console.log(`Built ${Object.keys(site).length} HTML pages and ${Object.keys(files).length} total routes; Worker ${(Buffer.byteLength(worker)+Buffer.byteLength(JSON.stringify(files)))/1024|0} KB.`);
