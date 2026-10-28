# Climoptix public free tier — 28 October 2026

Requested release: make Climoptix public, with five completed simulations per
user, 500,000 cells, two processors and 4 GB RAM maximum; publish accumulated
workbench updates and push master. The allowance is lifetime, not monthly.
Existing commercial/render plans and credits are unchanged.

## Implementation

- Public Workspace discovery and account/verified-email onboarding. Server
  Supabase verification is still required for compute, jobs and artifacts. The
  old one-email allowlist is removed from authentication, not moved client-side.
- Durable, owner-scoped SQLite completion ledger, with retained completed/run
  backfill. Only accepted solver runs reaching Completed count. Mesh-only,
  failed/nonconverged, cancelled and administrator acceptance jobs do not count.
  Cleanup, retry, scenario duplication, projects, tabs and restart cannot reset
  the new ledger. Historical already-purged private-preview payloads cannot be
  reconstructed; unknown history is not fabricated as successful simulations.
- Atomic admission/completion and one active job per owner prevent concurrent
  requests spending the last slot twice. Sixth new run: HTTP 429. Immutable
  retries still resolve their original job. Quota exhaustion preserves setup,
  mesh access and unexpired owned results. Definitive 429 responses clear the
  browser pending-dispatch journal; ambiguous timeouts do not.
- Server and measured-mesh gates enforce 500,000 cells, two requested processors
  and 4 GB requested memory. Existing Railway container limits are 2 CPU /
  4,000,000,000 bytes; volume/database are retained. One job executes at a time.
  Existing queue, daily submission, storage and retention bounds remain.
- Native parallel acceptance is restored. The final solver residuals are read
  before reconstructPar appends another `Time = ...` section. Child address-space
  budgets are divided by processor count; no serial substitution is performed.
  Startup acceptance now exercises all three models at both processor counts.
- Publishes the previously local workbench polish, 250-plane allowance,
  geometric plane sampling correction, results/2D/delta/probe/navigation changes
  and local native development tooling. Native adjoint execution remains
  unimplemented and gated off; ordinary worker availability does not enable it.

## Verification

- All 768 backend tests passed against a fresh real two-processor native archive
  (one existing Starlette/httpx deprecation warning).
- All 645 frontend unit and 19 persistence tests passed. Production Webpack
  export, frontend lint/source-usage and TypeScript checks passed. Backend Ruff
  checks passed. Build-generated next-env.d.ts imports restored.
- Local real native acceptance passed for laminar, kEpsilon and kOmegaSST on
  each of one and two processors. A separate fresh parallel case also verified
  strict X/Y/Z physical planes, finite U/p sampling, probes and conservation.
- Public discovery/access/exhausted-quota browser checks passed; final quota-race
  check and bounded current-layout workbench checks are recorded in the release
  logs. Historical follow-up selectors for the removed Thermal window and five
  old View controls were updated for embedded Thermal and seven View controls.
  An initial broad historical browser run was interrupted, not claimed passed.
- 31 authentication/worker/planner proxy tests passed. Anonymous/invalid bearer
  rejection and deployed execution readiness are checked separately from build
  status. No production user is impersonated and no user simulation is started
  as release verification.

Evidence: `.local-logs/cfd-public-*`. Test screenshots are in
`.local-logs/cfd-public-qa/`.

## Release targets

- Existing API: `31789d11-d7e6-471c-81bf-665edfb634c2`, uploaded deployment
  `18dc01bd-e79b-47ea-b920-d013acefd307`.
- Existing CFD worker: `535fa69d-bd31-4595-bec3-b2a00c1f66b1`, uploaded
  deployment `52b703b9-c4bd-42f8-b5b2-3532a49a6867`.
- Existing Cloudflare planner Worker: `freefloorplan3d-planner-test`, public
  `/planner/` routes. The cancelled replacement API and separate marketing
  website are untouched.

Deployment completion, Cloudflare version and master commit are recorded after
live verification. User data and unrelated work remain preserved.
