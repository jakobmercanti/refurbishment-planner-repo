export const PLANS_TEST_VERSION = 'plans-test-20261002-v1';

export function plansTestPage() {
  const choices = [['starter', 'Starter'], ['pro', 'Pro'], ['studio', 'Studio']];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Plans checkout test</title>
<style>body{margin:0;background:#f3f6f4;color:#172d26;font:17px/1.5 system-ui,sans-serif}main{max-width:800px;margin:24px auto;padding:20px}section{padding:20px;margin:18px 0;border:1px solid #b7cac0;border-radius:12px;background:#fff}h1,h2{margin-top:0}a,button{display:inline-block;margin:5px 8px 5px 0;padding:12px 18px;border:1px solid #183d34;border-radius:8px;background:#183d34;color:white;font:700 16px system-ui,sans-serif;text-decoration:none;cursor:pointer}button[data-click-test]{background:#fff;color:#183d34}form{margin:8px 0}code{overflow-wrap:anywhere}.status{padding:12px;background:#e6f3eb;border-radius:8px}a:focus-visible,button:focus-visible{outline:3px solid #1582c2;outline-offset:3px}</style></head><body><main>
<h1>Plans checkout test page</h1>
<p><strong>Version: <code>${PLANS_TEST_VERSION}</code></strong><br>Generated at ${new Date().toISOString()} (UTC).</p>
<p>This page is served directly, without the planner, React, 3D canvases or cached app scripts. It is not cached. No payment is taken here.</p>
<p id="script-status" class="status" role="status">JavaScript has not started. The checkout links and form buttons below still work without it.</p>
<p id="click-status" class="status" role="status" aria-live="polite">No test button clicked yet.</p>
${choices.map(([key, label]) => `<section><h2>${label}</h2>
<button type="button" data-click-test="${label}">Test ${label} click only</button>
<p>Two separate ways to open the same checkout page:</p>
<a href="/planner/checkout/?plan=${key}">Open ${label} using a link</a>
<form action="/planner/checkout/" method="get"><input type="hidden" name="plan" value="${key}"><button type="submit">Open ${label} using a button</button></form>
<small>Destination: <code>/planner/checkout/?plan=${key}</code></small></section>`).join('')}
<p>The click-only tests stay here and make no network request. Checkout links may ask you to sign in. Payment is confirmed only on Stripe.</p>
<a href="/planner/account/?tab=plans&amp;diagnostic=${PLANS_TEST_VERSION}">Open the normal Plans page</a>
<p>Please report the version shown above, whether a click-only test changes the green message, and whether the link or form button opens checkout.</p>
</main><script>document.getElementById('script-status').textContent='JavaScript is running on this plain test page.';document.addEventListener('click',function(event){var button=event.target.closest('[data-click-test]');if(button)document.getElementById('click-status').textContent=button.dataset.clickTest+' click received at '+new Date().toLocaleTimeString()+'. No checkout request was made.';});</script></body></html>`;
}
