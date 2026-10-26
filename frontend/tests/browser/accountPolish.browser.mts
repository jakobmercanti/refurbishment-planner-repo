import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { cfdProject } from '../climoptixFixtures';
import { eventually, startBrowserHarness } from './harness.mjs';

let harness;
before(async () => { harness = await startBrowserHarness(); });
after(async () => { await harness?.close(); });
const user = { id: '11111111-1111-4111-8111-111111111111', email: 'layout@example.invalid' };

for (const width of [1440, 390]) test(`Sign in opens the form immediately; a single submit and equal password utilities work at ${width}px`, async t => {
  const session = await harness.session(cfdProject(), { viewport: { width, height: 950 } }); t.after(() => session.close());
  const { page, context, saved } = session; let submissions = 0;
  await context.route('**/commercial/summary', route => route.fulfill({ json: { plan: 'pro' } }));
  await context.route('**/auth-api/token?grant_type=password', route => {
    submissions++; return route.fulfill({ json: { access_token: 'mock-account', refresh_token: 'mock-refresh', expires_in: 3600, user } });
  });
  const persisted = await eventually(saved, project => project.rooms.every(room => room.wall_thickness_overrides_mm && room.person_mockup === null));
  const rooms = structuredClone(persisted.rooms);
  await page.locator('.app-nav-entry').click();
  const dialog = page.getByRole('dialog', { name: 'Account & plans', exact: true });
  await dialog.getByLabel('Email', { exact: true }).waitFor();
  const bounds = await dialog.boundingBox(); assert.ok(bounds.width <= width && (width < 700 || bounds.width >= 640));
  assert.equal(await dialog.getByRole('button', { name: 'Sign in', exact: true }).count(), 1);
  assert.equal(await dialog.locator('form button[type="submit"]').count(), 1);
  assert.ok((await dialog.locator('.account-auth-tabs').boundingBox()).y > (await dialog.getByLabel('Password', {exact:true}).boundingBox()).y);
  const signIn = dialog.getByRole('button', { name: 'Sign in', exact: true });
  assert.equal(await signIn.getAttribute('type'), 'submit');
  const utilities = await dialog.locator('.account-utility-actions button').evaluateAll(nodes => nodes.map(node => { const r=node.getBoundingClientRect(); return {width:r.width,y:r.y,height:r.height}; }));
  assert.equal(utilities.length, 2); assert.ok(Math.abs(utilities[0].width-utilities[1].width)<1); assert.ok(Math.abs(utilities[0].y-utilities[1].y)<1);
  await dialog.getByLabel('Email', { exact: true }).fill(user.email);
  const password = dialog.getByLabel('Password', { exact: true }); await password.fill('Mock-Account-Password');
  let signups = 0;
  await context.route('**/auth-api/signup?**', route => { signups++; return route.fulfill({json:{user:{id:'pending'}}}); });
  await dialog.getByRole('button', {name:'Create account',exact:true}).click();
  assert.equal(signups,0); assert.equal(submissions,0);
  await signIn.click(); assert.equal(submissions,0,'Switching modes must never submit a populated form');
  await dialog.getByRole('button', { name: 'Show password', exact: true }).click(); assert.equal(await password.getAttribute('type'), 'text');
  if (process.env.BROWSER_ARTIFACTS) await page.screenshot({path:`${process.env.BROWSER_ARTIFACTS}/account-window-${width}.png`});
  await password.press('Enter');
  await eventually(() => dialog.count(), count => count === 0);
  await page.getByRole('button', { name: 'Signed in · Pro', exact: true }).waitFor();
  assert.equal(submissions, 1); assert.deepEqual((await saved()).rooms, rooms);
  assert.equal(new URL(page.url()).pathname, '/planner/');
  await page.getByRole('button', { name: 'Signed in · Pro', exact: true }).click();
  const ready=page.locator('.account-ready-actions');
  const grid=await ready.locator('a,button').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};}));
  assert.equal(grid.length,4); assert.equal(grid[0].y,grid[1].y); assert.equal(grid[2].y,grid[3].y); assert.ok(grid[2].y>grid[0].y);
  for(const rect of grid) assert.ok(Math.abs(rect.w-grid[0].w)<1);
  const billing=ready.getByRole('link',{name:'Open plans and billing ↗',exact:true}); assert.equal(await billing.getAttribute('target'),'_blank');
});

test('plan outages do not invent a Free plan and refresh recovers the verified plan', async t => {
  const session = await harness.session(cfdProject()); t.after(() => session.close());
  const { page, context } = session; let available = false, calls = 0;
  await context.route('**/commercial/summary', route => { calls++; return route.fulfill(available ? {json:{plan:'studio'}} : {status:503,json:{detail:'Temporary outage'}}); });
  await page.evaluate(user => {
    sessionStorage.setItem('freefloorplan3d:commercial-session:v1',JSON.stringify({access_token:'mock-account',refresh_token:'mock-refresh',expires_at:Date.now()/1000+3600,user}));
    window.dispatchEvent(new Event('freefloorplan3d:auth-session-changed'));
  }, user);
  const status = page.locator('.app-nav-entry');
  await eventually(() => status.textContent(), text => text === 'Signed in');
  assert.match(await status.getAttribute('title'), /no plan or permissions have been assumed/);
  available = true; await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await eventually(() => status.textContent(), text => text === 'Signed in · Studio');
  assert.ok(calls >= 2);
});
