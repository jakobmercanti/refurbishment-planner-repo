import { buildPlanComparison, formatPounds, resolveCommercialCatalogue } from '../frontend/lib/commercialCatalogue.ts';

export const PLANS_PAGE_VERSION = 'plans-20261002-v3';
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export function plansPage(catalogueValue, query = new URLSearchParams()) {
  const catalogue = resolveCommercialCatalogue(catalogueValue);
  const selected = ['starter', 'pro', 'studio'].includes(query.get('plan')) ? query.get('plan') : null;
  const result = query.get('checkout');
  const notice = result === 'success' ? 'Success! Checkout completed. We are confirming your subscription. You can return to the planner below.'
    : result === 'cancelled' ? 'Checkout cancelled. No plan change was made. You can return to the planner below.'
    : query.get('billing') === 'updated' ? 'Welcome back. We are checking your updated subscription.'
    : selected ? `Your ${selected} selection is kept. Choose it below to continue.` : '';
  const highlights = plan => plan.plan_key === 'free'
    ? ['Unlimited local floorplans', 'Browser saving and portable files', 'Full furniture & electrical catalogue', 'PlannerBuild: up to 5 activities']
    : [`${Math.round(plan.storage_limit_bytes / 1024 ** 3)} GB private cloud`, `${plan.asset_limit.toLocaleString('en-GB')} private assets`, `${plan.project_limit.toLocaleString('en-GB')} cloud projects`, `${plan.included_medium} Medium renders / month${plan.included_high ? ` + ${plan.included_high} High renders / month` : ''}`, 'Full Electrical Layout module', plan.plan_key === 'studio' ? 'Unlimited PlannerBuild activities' : 'PlannerBuild: up to 5 activities'];
  const comparison = buildPlanComparison(catalogue.plans, catalogue.packs.length > 0);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Plans &amp; billing | FreeFloorplan3D</title>
<script>try{var preference=JSON.parse(localStorage.getItem('freefloorplan3d:appearance-preferences:v1')||'null');document.documentElement.dataset.theme=(preference&&preference.theme==='dark')||((!preference||preference.theme==='system')&&matchMedia('(prefers-color-scheme:dark)').matches)?'dark':'light';}catch{}</script>
<style>
:root{color-scheme:light;--bg:#f3f6f4;--panel:#fff;--ink:#183d34;--muted:#63756e;--border:#cbd8d1;--accent:#183d34;--on-accent:#fff;--status:#e6f3eb;--success:#23583c}
html[data-theme=dark]{color-scheme:dark;--bg:#172432;--panel:#203244;--ink:#e5eef6;--muted:#b6c8d5;--border:#41576a;--accent:#2b628b;--on-accent:#fff;--status:#193c2c;--success:#91e0b1}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,sans-serif}header,main{max-width:1280px;margin:auto;padding:20px}header{display:flex;align-items:center;justify-content:space-between;gap:16px}nav{display:flex;gap:18px;flex-wrap:wrap}a{color:var(--ink)}h1{font-size:clamp(28px,4vw,42px);line-height:1.15;max-width:850px}h2{margin:8px 0}.lede{max-width:850px;color:var(--muted)}.status{padding:14px;background:var(--status);color:var(--success);border-radius:10px}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}.card{display:flex;flex-direction:column;padding:22px;border:1px solid var(--border);border-radius:14px;background:var(--panel)}.card.featured{border:2px solid #408563}.eyebrow,.description,small{color:var(--muted)}.description{min-height:66px}.price{font-size:32px;font-weight:800;margin:10px 0}.price small{font-size:14px;font-weight:400}ul{padding-left:20px;flex:1}li{margin:10px 0}.actions{margin-top:auto}form{margin:0}button,.button{display:block;width:100%;padding:13px 18px;border:1px solid var(--border);border-radius:9px;background:var(--accent);color:var(--on-accent);font:700 16px system-ui,sans-serif;text-align:center;text-decoration:none;cursor:pointer;touch-action:manipulation}.checkout-link{display:block;margin-top:10px;text-align:center;font-size:14px}.badge{font-size:13px;color:var(--success);min-height:22px}.comparison{overflow-x:auto;margin:28px 0;border:1px solid var(--border);border-radius:12px;background:var(--panel)}table{border-collapse:collapse;width:100%;min-width:720px}th,td{padding:12px;border-bottom:1px solid var(--border);text-align:center}th:first-child{text-align:left}tr.group th{background:var(--bg)}footer{margin:24px 0;color:var(--muted)}details{margin:16px 0;padding:16px;border:1px solid var(--border);border-radius:10px}summary{cursor:pointer}a:focus-visible,button:focus-visible,summary:focus-visible{outline:3px solid #1582c2;outline-offset:3px}@media(max-width:950px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:550px){.grid{grid-template-columns:1fr}header{align-items:start;flex-direction:column}.description{min-height:0}}
</style></head><body><header><a href="/planner/"><strong>FreeFloorplan3D</strong></a><nav><a id="account-link" href="/planner/account/">Sign in / account</a><a href="/planner/">Back to planner</a></nav></header><main>
<p class="eyebrow">PLANS &amp; BILLING</p><h1>Keep planning free. Add cloud when you need it.</h1>
<p class="lede">Every plan includes the full floorplan editor and furniture/electrical catalogue. Paid plans add private cloud storage, electrical layouts and rendering allowances. Studio includes unlimited PlannerBuild activities. Cancel your subscription anytime.</p>
<p id="account-status" class="status" role="status">Choose a plan below. Sign-in is required before paid checkout.</p>
${notice ? `<section class="status" aria-label="Billing update"><p id="billing-notice" role="status">${escapeHtml(notice)}</p><a class="button" href="/planner/">Back to planner</a></section>` : ''}
${!catalogue.serviceAvailable || !catalogue.billingEnabled ? '<p class="lede">Checkout availability will be verified on the next page. No payment is taken here.</p>' : ''}
<section class="grid" aria-label="Monthly plans">${catalogue.plans.map(plan => `<article class="card${plan.plan_key === 'pro' ? ' featured' : ''}" data-plan="${plan.plan_key}">
<span class="eyebrow">${plan.plan_key === 'free' ? 'FREE FOREVER' : plan.plan_key === 'pro' ? 'RECOMMENDED · PAID MONTHLY' : 'PAID MONTHLY'}</span>
<h2>${escapeHtml(plan.name)}</h2><span class="badge" data-current-plan></span><p class="description">${escapeHtml(plan.description)}</p>
<p class="price">${plan.monthly_price_pence ? escapeHtml(formatPounds(plan.monthly_price_pence)) : '£0'}<small>${plan.monthly_price_pence ? ' / month' : ' · Free forever'}</small></p>
<ul>${highlights(plan).map(text => `<li>${escapeHtml(text)}</li>`).join('')}</ul>
<div class="actions"><form action="${plan.plan_key === 'free' ? '/planner/' : '/planner/checkout/'}" method="get">${plan.plan_key === 'free' ? '' : `<input type="hidden" name="plan" value="${plan.plan_key}">`}<button type="submit">${plan.plan_key === 'free' ? 'Continue free' : selected === plan.plan_key ? `Continue with ${escapeHtml(plan.name)}` : `Choose ${escapeHtml(plan.name)}`}</button></form>
</div></article>`).join('')}</section>
<section id="subscription" hidden><h2>Your subscription</h2><a class="button" href="/planner/checkout/?action=portal">Manage or cancel plan</a></section>
<p id="cancellation-status" class="status" role="status" hidden></p>
<h2>Compare plans</h2><div class="comparison"><table><thead><tr><th scope="col">Feature</th>${catalogue.plans.map(plan => `<th scope="col">${escapeHtml(plan.name)}</th>`).join('')}</tr></thead><tbody>${comparison.map(group => `<tr class="group"><th colspan="5">${escapeHtml(group.title)}</th></tr>${group.rows.map(row => `<tr><th scope="row">${escapeHtml(row.label)}</th>${catalogue.plans.map(plan => `<td>${escapeHtml(row.values[plan.plan_key])}</td>`).join('')}</tr>`).join('')}`).join('')}</tbody></table></div>
<details><summary>About cloud storage and rendering</summary><p>Local saving is free. Cloud storage counts private projects, uploaded assets and saved renders. AI renders are visual aids; they never change dimensions or fit calculations.</p>${catalogue.packs.length ? `<p>Additional render packs:</p><ul>${catalogue.packs.map(pack => `<li>${pack.quality_class === 'high' ? 'High' : 'Medium'} · ${pack.quantity} render${pack.quantity === 1 ? '' : 's'} · ${escapeHtml(formatPounds(pack.price_pence))}</li>`).join('')}</ul>` : ''}</details>
<footer><p><a class="button" href="/planner/">Back to planner</a></p>Cancel anytime. Payments are securely processed by Stripe. Taxes and final totals are shown at checkout. No payment is taken until you confirm it on Stripe.</footer>
</main><script>
(async function(){
  var status=document.getElementById('account-status');
  try{
    var session=JSON.parse(sessionStorage.getItem('freefloorplan3d:commercial-session:v1')||'null');
    if(!session||typeof session.access_token!=='string'||!session.user||typeof session.user.id!=='string')return;
    status.textContent='Signed in · Checking your plan…';
    var response=await fetch('/planner/engineering-api/commercial/billing/sync',{method:'POST',headers:{Authorization:'Bearer '+session.access_token},cache:'no-store',signal:AbortSignal.timeout(25000)});
    if(response.status===404||response.status===403)response=await fetch('/planner/engineering-api/commercial/summary',{headers:{Authorization:'Bearer '+session.access_token},cache:'no-store',signal:AbortSignal.timeout(10000)});
    if(!response.ok){status.textContent=response.status===401?'Sign in again to refresh your session before checkout.':'Signed in · Plan information is temporarily unavailable. Checkout will check again.';return;}
    var summary=await response.json();var names={free:'Free',starter:'Starter',pro:'Pro',studio:'Studio'};
    var returned=new URLSearchParams(location.search);
    // A new subscription can arrive just after the checkout return. Never grant access from query parameters.
    for(var attempt=0;returned.get('checkout')==='success'&&summary.plan==='free'&&attempt<5;attempt++){
      await new Promise(function(resolve){setTimeout(resolve,2000);});
      var retry=await fetch('/planner/engineering-api/commercial/billing/sync',{method:'POST',headers:{Authorization:'Bearer '+session.access_token},cache:'no-store',signal:AbortSignal.timeout(25000)});
      if(!retry.ok)break;summary=await retry.json();
    }
    status.textContent='Signed in · '+(names[summary.plan]||'Plan unavailable');
    document.getElementById('account-link').textContent='Account';
    var active=summary.status==='active'||summary.status==='trialing';
    document.getElementById('subscription').hidden=!active;
    var ending=document.getElementById('cancellation-status');
    if(active&&summary.cancel_at_period_end){ending.hidden=false;var end=new Date(summary.current_period_end);ending.textContent='Cancellation confirmed. Your subscription will not renew. '+(Number.isFinite(end.getTime())?'Paid access ends on '+end.toLocaleDateString()+', then your account returns to Free.':'Your account returns to Free at the end of the paid period.');}
    document.querySelectorAll('[data-plan]').forEach(function(card){var key=card.dataset.plan;var current=key===summary.plan&&(active||summary.status==='free');if(current)card.querySelector('[data-current-plan]').textContent='Current plan';if(key!=='free')card.querySelector('button').textContent=active&&current&&!summary.cancel_at_period_end?'Manage plan':'Change plan';});
    var notice=document.getElementById('billing-notice');
    if(notice&&returned.get('checkout')==='success'&&active)notice.textContent='Success! Your '+(names[summary.plan]||'paid')+' subscription is active. Return to the planner to use your plan.';
    if(notice&&returned.get('billing')==='updated')notice.textContent=summary.plan==='free'?'Your subscription has ended. You are back on Free. Return to the planner whenever you are ready.':summary.cancel_at_period_end?'Cancellation confirmed. Your subscription will not renew; see your access end date below.':'Your subscription is up to date. Return to the planner whenever you are ready.';
  }catch{status.textContent='Account status could not be checked. You can still select a plan; checkout will check again.';}
})();
</script></body></html>`;
}
