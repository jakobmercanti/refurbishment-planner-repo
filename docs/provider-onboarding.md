# Setting up accounts, storage and subscriptions

Keep Stripe in test mode until a full checkout/cancellation/refund rehearsal passes.
Never paste secret keys into chat, Git, browser build settings, or screenshots.

## 1. Supabase first

Create a project at https://supabase.com/dashboard (or select your existing project).
Keep the database password in your password manager. In project settings, find
the project URL and API keys. The URL and publishable key are public; the legacy
service-role key is secret and bypasses row-level security.

Open https://railway.com/project/45ec36d9-5b66-437c-a1b3-d85bdfb5a97f,
select production, then freefloorplan3d-api → Variables → New Variable. Set:

- `SUPABASE_URL`: your project URL.
- `SUPABASE_PUBLISHABLE_KEY`: your publishable key.
- `SUPABASE_SERVICE_ROLE_KEY`: your legacy service-role key (server only).
- `REQUIRE_VERIFIED_EMAIL`: `true`.

Before deployment, apply the five SQL migrations in the exact order listed in
`commercial-phase-2-setup.md`. For a new project, use SQL Editor → New query,
paste one migration, run it, check for errors, then proceed to the next. For an
existing project, back it up and inspect previously applied migrations first.
Do not repeatedly rerun migrations or disable RLS to bypass an error.

In Authentication → URL Configuration set the Site URL to
`https://www.freefloorplan3d.com/planner/` and add the redirect URL
`https://www.freefloorplan3d.com/planner/account/`. Configure a production SMTP
provider and verified sender; the built-in email service is not a launch solution.

Tell the deployment assistant the public project URL/publishable key, or configure
them securely on the local build host, so it can rebuild with
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
The Cloudflare planner Worker also needs `SUPABASE_URL` for its browser CSP.

## 2. Private files in Cloudflare R2

In the existing Cloudflare account, open R2 and create a private bucket.
Do not enable public access. Create a bucket-scoped S3 Object Read & Write token.
Copy its account ID, access key and secret to Railway API Variables:
`R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.

In bucket Settings → CORS allow only `https://www.freefloorplan3d.com`, methods
GET/PUT/HEAD, and the Content-Type header. Set one-day lifecycle expiration only
for `temporary/render-references/` and `temporary/ai-3d-references/`, not `users/`.
The planner Worker needs `R2_ORIGIN=https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com`.

## 3. Stripe test mode

In https://dashboard.stripe.com select test mode (or a sandbox).
Create the three monthly GBP plan prices and eight one-off render pack prices
listed in `commercial-phase-2-setup.md`. Use the `price_...` IDs, not product IDs.
Add each to its matching `STRIPE_PRICE_*` Railway variable.

Add the test secret as `STRIPE_SECRET_KEY`; keep `STRIPE_ALLOW_LIVE=false`.
Create a webhook destination for
`https://www.freefloorplan3d.com/planner/engineering-api/commercial/stripe/webhook`,
with the seven events listed in the setup document, then add its signing secret
as `STRIPE_WEBHOOK_SECRET`. Configure the test customer portal for cancellation
and switching only between these plan prices.

The current checkout requires Stripe Managed Payments. Confirm account
eligibility/enablement before checkout testing; ordinary Stripe account activation
alone is not enough. If unavailable, ask the developer to discuss a standard
Stripe integration and the associated tax/refund responsibilities.

## 4. Background worker

Once Supabase and R2 are ready, deploy the same master Docker image as a separate
Railway worker. Start command: `.venv/bin/python -m backend.app.worker`.
Use a worker-specific Railway config without the API's `/health` HTTP check.
Set `COMMERCIAL_WORKER_ENABLED=true` only there and share Supabase/R2 settings.
Put `OPENAI_API_KEY` only on the worker; after verifying it works, set
`AI_RENDERING_ENABLED=true` on the API. Keep Tripo/AI 3D disabled until its
provider access, cost and plan allowances are approved.

## 5. Go-live gate

Rebuild/redeploy the frontend with its two public Supabase values; configure the
Worker's exact Supabase and R2 origins. Verify email signup/recovery, private file
access, queue processing, test checkout, portal plan changes/cancellation,
webhook retries and credits. Then confirm support/refund contacts and legal terms.
Live Stripe uses separate keys, price IDs and webhook secrets; change these
deliberately, and enable `STRIPE_ALLOW_LIVE=true` only after the launch review.
