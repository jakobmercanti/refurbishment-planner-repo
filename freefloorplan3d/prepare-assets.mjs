// One-time asset preparation. Standard resizing/compression only; artwork is
// preserved. Pass the installed sharp module and original input paths.
import {mkdir} from 'node:fs/promises';
import {pathToFileURL,fileURLToPath} from 'node:url';
const [sharpPath,homePath,logoPath]=process.argv.slice(2);
const {default:sharp}=await import(pathToFileURL(sharpPath));
await mkdir(new URL('./public/assets/',import.meta.url),{recursive:true});
await sharp(homePath).resize({width:1536,withoutEnlargement:true}).webp({quality:82}).toFile(fileURLToPath(new URL('./public/assets/home-3d.webp',import.meta.url)));
for(const [name,size] of [['assets/brand-icon.png',144],['favicon-48.png',48],['favicon-192.png',192],['apple-touch-icon.png',180]]) {
 const target=new URL('./public/'+name,import.meta.url);
 await sharp(logoPath).resize(size,size,{fit:'contain',background:{r:0,g:0,b:0,alpha:0}}).png({compressionLevel:9}).toFile(fileURLToPath(target));
}
console.log('Optimised hero, site logo, favicons and touch icon.');
