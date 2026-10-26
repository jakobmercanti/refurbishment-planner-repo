# New FreeFloorplan API — 25 October 2026

## Current status — replacement cancelled by user

The user clarified that the requirement was to rotate a Railway account/deployment
API token following an attack, not to replace the backend service. The replacement
deployment `c47c0655-74d7-4e2f-b7d8-8d97439cdc5d` was removed using a command scoped
to service `a680ebe4-8ec9-4f97-9240-ca000a984d2d`, the production environment and this
project. Railway confirms status REMOVED; it can be redeployed/rolled back. The
service, configuration and domain were retained, not deleted. Do not run the
replacement upload helper or reactivate this service without a new user request.

The original `freefloorplan3d-api` deployment remains SUCCESS and `/health` returns
`ok`. The live Cloudflare planner version `4dd7fba0-c356-4c9c-9413-46d3fe9c7a0a`
has 100% traffic and its ENGINEERING_API_ORIGIN still names the original backend.
No routing change or original-service restart was necessary. The worker, data,
auth/billing variables, Git history and unrelated work were not changed.

Local CLI access recovery is verified. The account-token list was reported empty;
the project Tokens page was also visibly empty before the user reported creating
`freefloorplan-production`, scoped to production. The token was never read by the
agent and remains unused: no RAILWAY_TOKEN or RAILWAY_API_TOKEN was configured in
the process, user or machine environment, and no local .github/workflows directory
exists. Existing local deployment scripts use a saved Railway CLI login instead.
External CI/other machines have not been audited.

The user completed logout/login using the already installed Railway executable
after ordinary PowerShell could not find pnpm. A subsequent read-only whoami
authenticated successfully and the original backend health returned `ok`. The
new project token was not installed in code, service variables or local files.
Do not request it in chat or read it from the browser. No credential was created,
revoked or directly rotated by the agent, and token revocation/attack exposure
has not been independently audited. Do not report a complete security incident
remediation. Existing manual-release/source-disconnect settings remain in place;
no deployment, source push, worker update or backend restart occurred here.

The service-creation record below is historical, superseded by this cancellation.

The new service is created and deployed in the existing freefloorplan3D Railway
project. It is intended to replace the old API after testing while retaining
that service as a fallback.

- Project: `45ec36d9-5b66-437c-a1b3-d85bdfb5a97f`.
- Production environment: `e1e7e064-a93e-4c5d-8f96-fa21dcc00e2b`.
- New service: `freefloorplan-api`, `a680ebe4-8ec9-4f97-9240-ca000a984d2d`.
- Origin: <https://freefloorplan-api-production.up.railway.app>.
- Health: <https://freefloorplan-api-production.up.railway.app/health>.
- Successful deployment: `c47c0655-74d7-4e2f-b7d8-8d97439cdc5d`.
- Image: `sha256:8b532db7e112854b78192b139e2d4df494d0573000203632fe7ac9aa8bab536f`.
- Root Dockerfile, port 8080, `/health` acceptance, 120-second health timeout,
  one SFO replica, restart-on-failure with three retries.
- No GitHub source: manual releases preserve the later master-only/offline push.

## Configuration and fallback

Seventeen account/billing variables reference existing Railway shared variables.
Allowed origins, public application URL, planner base path and the additional
medium credit-pack identifier reference the old API's configuration. No secret
values were displayed or written into source. Public deployment mode is on,
programmer tools are disabled, and the API listens on port 8080.

The old `freefloorplan3d-api` service (`31789d11-d7e6-471c-81bf-665edfb634c2`)
remains online with deployment `77e185ea-d3f8-4a60-bbc8-083b93f8e389`.
Its GitHub source was disconnected in the preceding step with explicit user
approval. Do not delete it: four configuration references depend on it.
The OpenFOAM service and its persistent volume were not changed here.
No database migration, payment, account mutation or provider-webhook change
was performed. Account/billing providers remain the existing ones.

## Validation

- Focused local API/CFD/deployment regressions: **160 passed**.
- Live stateless checks passed: health, 43 catalogue categories, settings,
  capabilities, public commercial catalogue, missing-auth rejection (401),
  private prototype exclusion (404), public mutation rejection (403), coarse
  two-vent defaults, zero-error/exportable geometry preparation, thermal-envelope
  preparation, a valid seven-file settings ZIP, non-finite input rejection (422).
- New and old public commercial catalogue, catalogue categories and settings
  responses were identical after canonical JSON comparison; both health checks
  returned `ok`.
- No native simulation, login, checkout, saved-project write or email was run.
  Preparation and settings export do not represent an OpenFOAM solve.
- The upload contains only allowlisted API runtime files, including the two new
  runtime modules, not credentials, local databases, browser projects or unrelated
  nested repositories.

Reproduce upload: `deployment/package-api.ps1 -Deploy` (new service only).
From the repository root, reproduce stateless checks with:
`uv run python -m deployment.check-api https://freefloorplan-api-production.up.railway.app`.

## Cutover status

The API is live and independently tested. Public planner routing is NOT switched
yet; it still uses the old API. No Cloudflare/frontend release or Git commit/push
was made for this service-creation step. Initial planner cutover remains part of
the earlier release stage. The outstanding canvas visibility regression must
not be reported as passed or published as finished. Preserve the old origin as
the rollback target after cutover.

Railway's CLI warns that legacy `railway.json` configuration remains supported
until 1 December 2026. Migrate before that date; no automatic migration was
performed here.
