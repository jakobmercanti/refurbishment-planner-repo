# Climoptix private access — pause checkpoint

Resumed on 25 October 2026 at the user's request, including the previously
authorized publication and `cfd` to `master` merge. The notes below retain the
historical pause snapshot; they are not a current deployment-status report.

Resume validation finished on 25 October: 29 access/worker/workflow/window browser
checks passed, and the complete thermal suite passed 12/12 after its viewport
assertion was made to wait for the existing asynchronous window clamping. Lint
and typecheck passed again. No product-layout assertion was relaxed. The prior
609 unit, 19 project, 672 backend and 26 proxy checks remain the verified baseline.

Paused at the user's explicit request on 24 October 2026, **before publishing**.
No commit, push, merge or deployment was performed for this change. Do not resume
publication until the user requests it. All source changes remain saved locally.

## Requested outcome

Only signed-in, server-enabled accounts (initially the existing verified owner)
may see/open Climoptix. Hide it completely for guests and non-enabled accounts,
including free-plan users. Enabled access is independent of plan tier. The user
previously requested publishing everything and merging `cfd` into `master`;
that work is now paused, not completed.

## Git and preservation

- Workspace: `C:/Users/Dell/Documents/ChatGPT/Online refurbishment planner`.
- Branch `cfd`, HEAD and origin/cfd:
  `af98a76b1e5f3d251c49d2ce6d1c37c9d11dc40d`.
- Fetch completed. `origin/master...HEAD` is 0 commits left / 22 right.
  Local master matches origin/master, at `626edb5`.
- Preserve the pre-existing dirty `freefloorplan3d-website` nested checkout/gitlink
  and untracked `.codex-remote-attachments/` directory. Do not stage either.
- Root and frontend AGENTS.md were read. Single-agent workflow; no Luna request.
- Use apply_patch for edits. No secrets are recorded in this checkpoint.

## Implemented but uncommitted

- New `frontend/components/useClimoptixAccess.ts` checks authenticated worker
  capabilities and matches the verified namespace to the current session user.
  It does not trust an email/plan flag in browser storage. It fails closed on
  errors, rechecks on focus/every 60 seconds, and aborts stale requests.
- `frontend/app/planner-client.tsx` hides the Climoptix dropdown option, unmounts
  its content, guards workspace setters and hides the source-editor return link
  until access is verified. Account-change/sign-out immediately closes Climoptix
  and returns to Floorplan without removing saved studies.
- `frontend/next.config.ts` adds a scoped local same-origin rewrite to the
  separate existing Railway worker, optionally overridden by server-only
  `CFD_WORKER_ORIGIN`. Every actual worker request remains server authorized.
- `frontend/.env.example` and `docs/OPENFOAM_WORKER.md` document this behavior.
- `tests/test_openfoam_worker.py` adds five verified/enabled account capability
  cases, including empty configuration, different email and unconfirmed email.
  No backend runtime code changed; it already enforces the verified allowlist.
- `frontend/tests/browser/climoptixAccess.browser.mts` adds five access tests:
  guest/forced entry, denied free account, enabled free account/logout/data
  preservation, outage/wrong namespace/focus retry and late-response logout race.
- `frontend/tests/browser/harness.mjs` now has an explicit opt-in
  `startBrowserHarness({ climoptixEnabled: true })` fixture with mock session and
  capabilities. Fourteen existing CFD/thermal/window test files opt in; ordinary
  tests remain signed out. There is no production bypass.
- The HTTP-worker test in `climoptixRailway.browser.mts` was adjusted to reopen
  Climoptix after changing account state, once the new server check succeeds.

## Validation completed

- `pnpm lint`: passed, 406 source modules, no orphans.
- `pnpm typecheck`: passed.
- Static Webpack production build: passed (`PLANNER_STATIC_EXPORT=true`).
- Generated `frontend/next-env.d.ts` imports restored to `.next/dev/types`;
  the file has no task diff. Do not commit build-generated import drift.
- `pnpm test:unit`: 609 passed.
- `pnpm test:projects`: 19 passed.
- `uv run pytest -q`: 672 passed. Only existing Starlette deprecation and
  unwritable pytest-cache warnings.
- `node --test deployment/auth-proxy.test.mjs deployment/cfd-worker-proxy.test.mjs
  deployment/planner-worker.test.mjs`: 26 passed.
- All five new access browser tests passed. Account authentication (3), password
  reset (3), and current workflows (8) also passed in the initial browser run.
- That initial run had one HTTP-worker fixture failure because account changes
  now intentionally close the workspace. The fixture was fixed. Its rerun passed
  all four Railway tests, including live log samples/cancel/reload. Additional
  CFD workflow and several thermal tests passed before the pause.
- The longer rerun was interrupted with Ctrl+C through tool session `11290` on
  user request (exit 1 due to interruption). **Do not describe that full run as
  passed.** Window-controls/docking and remaining thermal coverage still need
  completion after resume.
- `git diff --check`: passed.
- `.local-logs/climoptix-live-smoke.cjs` is an ignored, isolated Playwright smoke
  script using fake accounts only. It passed at `http://localhost:3000/` for
  guest hidden, denied free hidden, enabled visible and logout hidden. No actual
  password or account was changed. The production smoke is still pending.
- Existing local Next dev server PID 21164 was already running and was preserved.
  Attempts to start another server exited; no additional dev server was left.
- Local and production worker capability proxies both returned 401 anonymously.
  Worker `/health` returned 200 with `executionReady: true`.

## Resume steps

1. Recheck git status and preserve unrelated files. Review the saved diff.
2. Finish relevant browser regressions without rebuilding `frontend/out` while
   a harness serves it. Bundled Playwright:
   `C:/Users/Dell/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright`.
   From frontend, set `PLAYWRIGHT_MODULE` and run:
   `pnpm exec tsx --require ./tests/css-register.cjs --test --test-concurrency=1
   tests/browser/climoptixAccess.browser.mts tests/browser/climoptixRailway.browser.mts
   tests/browser/climoptixWorkflow.browser.mts tests/browser/thermal.browser.mts
   tests/browser/windowControls.browser.mts tests/browser/windowDocking.browser.mts`.
   Consider remaining opted-in CFD fixtures proportionately.
3. Check the local rewrite and access flow again if code changes. The existing
   ignored smoke script can target local or production URL; it mocks accounts
   and blocks engineering/auth calls rather than using real credentials.
4. When the user resumes publishing: commit only these source/docs/tests on cfd,
   push cfd, refresh origin/master and merge safely into master (no force push).
   The branch includes 22 prior commits the user explicitly asked to merge.
   Attach any PR if one is created. Preserve the dirty nested website checkout.
5. Publish the static planner using the existing configuration:
   `pnpm dlx wrangler deploy --config deployment/wrangler.jsonc --keep-vars`.
   Rebuild first only if needed; production uses Webpack. Do not expose secrets.
6. Verify the deployed UI (guest and mocked enabled/denied cases), actual
   unauthenticated/invalid-token rejection and API/worker health. Verify GitHub
   master contains the change and inspect any triggered Railway API rollout.

## Existing deployment references

- Planner: `https://www.freefloorplan3d.com/planner/`.
- Cloudflare Worker: `freefloorplan3d-planner-test`, config
  `deployment/wrangler.jsonc`. Last prior production version:
  `fd058766-4539-421c-a172-1f14891c9a7a` (password reset fix).
- GitHub: `jakobmercanti/refurbishment-planner-repo`.
- Railway project: `45ec36d9-5b66-437c-a1b3-d85bdfb5a97f`.
- Production environment: `e1e7e064-a93e-4c5d-8f96-fa21dcc00e2b`.
- API service: `31789d11-d7e6-471c-81bf-665edfb634c2`, URL
  `https://freefloorplan3d-api-production.up.railway.app`.
  Latest observed deployment `9b54eac7-1e47-496d-9dfd-c044cc262eb0`, SUCCESS,
  created 23 October. Environment config confirms source repo above; branch was
  not exposed by that CLI read, so do not assume auto-deploy completed.
- Worker service: `535fa69d-bd31-4595-bec3-b2a00c1f66b1`, URL
  `https://climoptix-openfoam-production.up.railway.app`.
  No runtime code change requiring its redeploy in this task.
- Railway connector describe-service twice returned authentication/retry messages;
  use the working CLI fallback. Never print raw variables/config (contains keys).
  CLI environment config was filtered to source metadata only. No deployment
  settings were changed. Read `docs/OPENFOAM_WORKER.md` before worker deployment.
- SMTP setup remains separate and unapproved; do not configure a new provider.
