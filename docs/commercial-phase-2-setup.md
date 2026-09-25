# Commercial Phase 2 setup

Phase 2 adds optional accounts, paid cloud backup, private model storage, render-credit billing, and asynchronous concept renders. The planner remains usable without an account. Its deterministic millimetre geometry and fit results remain authoritative; model bounds and generated images are visual-only.

## Services and deployment

The Next.js account, workspace, and billing routes are client-side pages suitable for the existing static export. They call the FastAPI service through the existing `/engineering-api` proxy. The API and the queue worker use the same backend image, but run as separate services:

- API: keep the existing `uvicorn backend.app.main:app` command.
- Worker: run `uv run python -m backend.app.worker` with `COMMERCIAL_WORKER_ENABLED=true` only on this dedicated worker service.
- Frontend: configure `NEXT_PUBLIC_BASE_PATH`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_COMMERCIAL_API_URL`, and the two public Supabase settings at build time. Never expose a Supabase service-role key, Stripe secret, R2 secret, or OpenAI key through a `NEXT_PUBLIC_` variable.

See the root and `frontend/.env.example` for the full variable names. Leave blank integrations disabled; local planning remains available.

## Supabase

1. Create or select the production Supabase project, configure email delivery, verification, password recovery, and the exact planner account redirect URL (for example `https://www.freefloorplan3d.com/planner/account/`). Add the local development URL only to a non-production project.
2. Back up the database, then apply `database/migrations/202609240001_phase2_commercial.sql` followed by `database/migrations/202609250001_ai_3d_generation.sql` using the Supabase SQL editor or the project’s migration workflow.
3. Set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` on the API and worker. Keep the service-role key server-only. Keep `REQUIRE_VERIFIED_EMAIL=true` for paid features.
4. Confirm the new tables have RLS enabled, public clients can read only active plan/pack catalogue rows, and all account-owned records remain inaccessible to other users. The API uses the service key only after it verifies the caller’s bearer token against Supabase Auth.

## Private R2 bucket

Create a private bucket; do not enable public reads. Create an S3-compatible credential scoped to that bucket and set `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY` only on the API and worker. Add browser CORS for the exact planner origin with `PUT`, `GET`, and `HEAD`, allow the `Content-Type` request header, and expose `ETag` if operational monitoring needs it. The application issues short-lived, object-specific signed URLs.

Add bucket lifecycle rules expiring objects with the prefixes `temporary/render-references/` and `temporary/ai-3d-references/` after one day. Those objects are short-lived reference images; successful jobs delete them sooner. Do not apply those rules to `users/`, which contains permanent model assets and generated results.

## Stripe test mode

Create GBP prices matching the catalogue rows seeded by the migration: Starter £9.90/month, Pro £19.99/month, Studio £29.99/month; medium packs £0.50/£4.49/£19.99/£34.99 and high packs £0.99/£8.99/£39.99/£69.99 for quantities 1/10/50/100. Set each `STRIPE_PRICE_*` to its matching Stripe Price ID and configure `STRIPE_SECRET_KEY` with a test key. Set `STRIPE_WEBHOOK_SECRET` from a webhook endpoint pointed at:

`https://www.freefloorplan3d.com/planner/engineering-api/commercial/stripe/webhook`

Subscribe to checkout-session completion/async payment success, subscription created/updated/deleted, and invoice paid/payment failed events. Keep `STRIPE_ALLOW_LIVE=false` during setup. The Stripe customer portal must be configured in Stripe before users can manage or cancel a subscription.

The checkout integration enables Stripe Managed Payments for both subscription checkouts and one-time render-credit purchases (`managed_payments[enabled]=true`). Confirm Managed Payments is enabled for the Stripe account and review its terms and eligibility before testing. Stripe becomes merchant of record for those transactions and handles indirect tax in supported jurisdictions, fraud, disputes, and transaction-level support. The Managed Payments fee is 3.5% per successful transaction on top of standard Stripe processing and any Stripe Billing fees. This does not replace advice about other business or income-tax obligations. Keep live billing disabled until staging checks and business review are complete.

## Image worker

Set `OPENAI_API_KEY` only on the worker. The worker accepts bounded PNG/JPEG/WebP reference images, uses the selected medium/high image model, normalizes output to WebP, and does not send project JSON or geometry. It records only safe provider usage fields, and refunds a render credit on failure. Verify model access, spend limits, retention policy, and rate limits in the provider account before enabling it.

## AI 3D asset generation

The AI 3D feature uses the authenticated commercial API for short-lived R2 photo uploads and the existing queue worker for Tripo task submission, polling, validation, and private model storage. Set `TRIPO_API_KEY` only on the dedicated worker service. `TRIPO_GENERATION_MODEL` may be set on both API and worker; the default is `v3.1-20260211`. Set `AI_3D_GENERATION_ENABLED=true` on the API only after the worker key and private R2 storage are configured and the feature is approved for staging. The browser never receives provider credentials.

The migration adds `ai_3d_generations_per_period` to each plan with a default of zero. Keep it at zero until generation costs, included allowances, and any packs/pricing are approved; the API rejects photo uploads and generation jobs without remaining entitlement. No AI 3D Stripe product or price is created by this migration. Tripo image generation does not accept exact physical dimension controls; entered dimensions are stored separately with the asset, while the generated mesh remains visual-only.

## Before live launch

Complete staging end-to-end checks for sign-up/verification/recovery, subscription checkout and cancellation, every credit pack, webhook retries/out-of-order events, cloud project conflict handling, signed GLB/STL upload/download/deletion, worker retry/refund behavior, storage quotas, and render retention. Confirm the public privacy/terms and support/refund contacts with the business owner. Do not set `STRIPE_ALLOW_LIVE=true` or enable paid checkout until the business answers the pending pricing/VAT/legal/support questions and all staging checks pass. No production credentials or external services are configured by this code change.
