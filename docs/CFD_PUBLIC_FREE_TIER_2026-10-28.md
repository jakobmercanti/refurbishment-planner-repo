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
  A parallel failure leaves validated serial execution available, advertises
  only one processor and rejects new unvalidated parallel submissions. The
  absolute infrastructure ceiling remains two CPU / 4 GB.
- Publishes the previously local workbench polish, 250-plane allowance,
  geometric plane sampling correction, results/2D/delta/probe/navigation changes
  and local native development tooling. Native adjoint execution remains
  unimplemented and gated off; ordinary worker availability does not enable it.

## Verification

- All 774 backend tests passed against a fresh real two-processor native archive
  (one existing Starlette/httpx deprecation warning).
- All 645 frontend unit and 19 persistence tests passed. Production Webpack
  export, frontend lint/source-usage and TypeScript checks passed. Backend Ruff
  checks passed. Build-generated next-env.d.ts imports restored.
- Local real native acceptance passed for laminar, kEpsilon and kOmegaSST on
  each of one and two processors. A separate fresh parallel case also verified
  strict X/Y/Z physical planes, finite U/p sampling, probes and conservation.
- All seven public discovery/access/quota browser checks passed, including
  exhausted-quota access and a definite 429 race response clearing the pending
  dispatch journal. Eight current-layout workbench/slice/probe checks also
  passed. Historical follow-up selectors for the removed Thermal window and
  five old View controls were updated for embedded Thermal and seven controls.
  The broader historical run was **not all-pass**: five old tests still expect
  controls to be visible before expanding the newer floating disclosures. Their
  timeouts are recorded in `cfd-public-browser-verified.log`; those tests need
  further selector migration. An earlier broad run was interrupted. Neither is
  presented as a fully passed browser suite.
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

Source release commit: `a7c54b7`, pushed to `origin/master`. API deployment above
is SUCCESS. Cloudflare planner version
`85543ae0-f957-47fd-a8fd-c52ea9ec164f` is deployed (final onboarding copy).
An isolated production browser confirmed hydration, public discovery, the
free-tier prompt and anonymous/invalid-token rejection without signing in,
submitting credentials or starting a simulation.

Worker upload `52b703b9-c4bd-42f8-b5b2-3532a49a6867` failed in BUILD_IMAGE
after snapshot unpacking, without a useful Docker error or runtime logs. The
redundant initializing retry `9c01da48-4229-4cf1-9c9b-28095a8e5b3e` was
cancelled explicitly; the healthy old service was not stopped. A dedicated
packaged `railway.json` now selects the bundle's root worker Dockerfile, and
the worker-only `RAILWAY_DOCKERFILE_PATH` is `Dockerfile` (changed with deploys
skipped). Corrected upload: `b078d9b7-56d1-4557-a631-aa49e487ee9f`.
This is a diagnostic packaging correction, not proof of the original failure's
cause. The corrected image built and deployment reached SUCCESS; its native
startup acceptance is checked separately before claiming execution readiness.

The first deployed native parallel check failed with
`pmix_progress_thread_start failed` despite all local native cases passing.
No parallel capability was claimed from the local result alone. The subsequent
runtime correction separates mandatory serial acceptance from optional parallel
acceptance, rejects unvalidated CPU requests after immutable retry lookup, and
keeps serial availability if MPI is unavailable. It also disables unnecessary
OpenCL topology probing and allows 512 bounded native helper processes/threads.
All 35 focused quota/worker/profile tests passed, including serial failure staying
fail-closed and all three types of parallel failure advertising only serial.
Corrected runtime deployment: `04097b6b-93a8-4ea8-b1c0-bdfa63434d68`.
The complete final backend run passed 774 tests after this correction. A fresh
local two-processor solve and backend Ruff also passed again.
The final frontend rerun also passed all 645 unit and 19 persistence tests.
Runtime safeguards and packaging/onboarding corrections are pushed in
`9b7f8c6` on `origin/master`.

The first runtime-correction upload above failed in the Railway image-build
stage with only builder-start messages and no Docker error. Its byte-identical
retry is `7d44c8d5-770a-406e-a0c6-4626572d8730`. No additional CPU, memory,
service, credential, volume or account-plan change was used as a workaround.
Execution is not declared ready until this corrected release passes native
acceptance and `/health` returns `executionReady: true`.

## Final release state — public compute launch incomplete

Both corrected-worker uploads `04097b6b-93a8-4ea8-b1c0-bdfa63434d68` and
`7d44c8d5-770a-406e-a0c6-4626572d8730` failed in Railway's build stage; the
retry produced no Docker build logs. Connector logs, CLI logs, deployment
diagnostics and the dashboard did not supply a specific actionable Docker
error. No additional resource, credential or new-service workaround was made.

The initially deployed public worker `b078d9b7-56d1-4557-a631-aa49e487ee9f`
failed MPI acceptance and left execution disabled. To restore the previous
working service, the last verified **private preview** image from
`d636ed28-3f79-4972-b0be-05a5b448aaf4` was rolled back explicitly, without an
image build. The preceding redeploy attempt
`4a0ce51f-cbf7-48ba-815f-957102a6de86` unexpectedly requested a build and was
cancelled. Actual rollback deployment:
`a4d8cbcf-d98b-4659-8863-87c96b99b272` (SUCCESS).

The rollback logged all three native serial acceptance cases passing and
`/health` returned `{"status":"ok","executionReady":true}` at approximately
10:00 UTC. The original email-restricted preview is restored. **Public
simulation execution and the new lifetime allowance are NOT released on that
old worker.** The public entry/onboarding, audited planner and preparation API
remain online; public compute must not be described as available yet.

All requested policy code, tested runtime safeguards, deployment helper and
onboarding changes are pushed to master (`9b7f8c6`, following `a7c54b7`). The
remaining action is to deploy the corrected worker bundle using
`deployment/package-openfoam.ps1`, wait for native startup acceptance, and
verify both the deployed processor profile and public verified-account access.
Preserve the current volume/database. No user simulation was started for QA,
no user data was removed, and no credentials or billing plan were changed.
Unrelated website and attachment changes remain untouched.

The current Railway CLI warns that legacy railway.json configuration is
supported until 1 December 2026. Migration to its newer infrastructure format
is a separate follow-up; no unrelated platform migration was performed here.
