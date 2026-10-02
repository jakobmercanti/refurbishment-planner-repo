import {chromium} from 'file:///C:/Users/Dell/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const __dirname=import.meta.dirname;
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const output=path.resolve(__dirname,'../out');const screenshots=path.resolve(__dirname,'../../.local-logs/compact-header');fs.mkdirSync(screenshots,{recursive:true});
 try{for(const width of [320,390,700,768,800,1024,1440]){
  const context=await browser.newContext({viewport:{width,height:1000},hasTouch:true});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  if(!process.env.QA_LIVE)await page.route('https://plannerbuild.com/planner/**',async route=>{
   const url=new URL(route.request().url());let asset=path.resolve(output,'.'+decodeURIComponent(url.pathname.slice('/planner'.length)));
   if(!asset.startsWith(output+path.sep)&&asset!==output)return route.abort();
   if(fs.existsSync(asset)&&fs.statSync(asset).isDirectory())asset=path.join(asset,'index.html');
   if(route.request().method()==='GET'&&fs.existsSync(asset)&&fs.statSync(asset).isFile())return route.fulfill({path:asset});
   return route.continue();
  });
  await page.goto('https://plannerbuild.com/planner/?workspace=plannerbuild&standalone=1');
  const workspace=page.getByRole('combobox',{name:'Workspace',exact:true});await page.getByRole('button',{name:'Gantt',exact:true}).waitFor({timeout:60000});
  let height;
  for(const mode of ['PLANNERBUILD','FLOORPLAN','PLANNERBUILD']){
   await workspace.selectOption(mode);await page.waitForTimeout(200);
   const header=await page.locator('.topbar').boundingBox();height??=header.height;assert.equal(header.height,height,width+' mode changed header height');assert.equal(height,width<=1024?48:68);
   for(const control of [workspace,page.locator('.app-nav-entry'),...await page.locator('.app-nav-modes button').all()]){
    const box=await control.boundingBox();assert(box.x>=0&&box.x+box.width<=width+1,'control offscreen '+width);assert(box.y>=header.y&&box.y+box.height<=header.y+header.height+1,'control outside header');
   }
   const identity=await page.locator('.app-identity').boundingBox(),navigation=await page.locator('.app-nav').boundingBox();assert(identity.x+identity.width<=navigation.x+1,'overlapping menu and views '+width);
   if(width<=700){await page.getByRole('button',{name:'Menu',exact:true}).tap();assert.equal(await page.getByRole('button',{name:'Menu',exact:true}).getAttribute('aria-expanded'),'true');}
   await page.getByRole('button',{name:'File',exact:true}).tap();await page.getByRole('button',{name:'Save as…',exact:true}).waitFor();await page.keyboard.press('Escape');
   if(width<=700){assert.equal(await page.getByRole('button',{name:'Menu',exact:true}).getAttribute('aria-expanded'),'false');await page.getByRole('button',{name:'Menu',exact:true}).tap();}
   await page.getByRole('button',{name:'Settings',exact:true}).tap();await page.getByRole('button',{name:'Privacy and local saving…',exact:true}).waitFor();await page.keyboard.press('Escape');
   if(mode==='PLANNERBUILD'){await page.getByRole('button',{name:'Overview',exact:true}).tap();assert.equal((await page.locator('.topbar').boundingBox()).height,height);await page.getByRole('button',{name:'Gantt',exact:true}).tap();}
   if(width===390||width===800)await page.screenshot({path:path.join(screenshots,width+'-'+mode+'.png')});
  }
  assert.deepEqual(errors,[]);console.log(width+'px: stable '+height+'px header, no overlap, reachable menus and views');await context.close();
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
