# Account/sign-in fixes — 25 October 2026

## Reproduced causes

- `/plans/` returned HTTP 500 in the running Turbopack development server.
  Its project root was `frontend/`, so it could not resolve the shared release
  template in `deployment/plans-page.mjs`. Webpack production builds alone did
  not catch this development-only resolution fence.
- The local account backend returned HTTP 503 because its privileged account
  database service is not configured. Authentication independently uses the
  hosted provider, so a successful login did not imply a working local plan RPC.

## Changes

- Turbopack's explicit root is the repository containing both frontend and shared
  deployment sources. The running local Plans route now returns HTML/HTTP 200.
- Local **plan-summary reads only** use the existing authoritative hosted account
  API via the same-origin Next proxy. `COMMERCIAL_READ_API_ORIGIN` can select a
  separate trusted HTTPS/loopback account stack. No server secret is copied into
  the browser, no billing/catalogue capability flags or writes are rerouted, and
  production's existing Worker routing is unchanged.
- The planner account entry opens the form immediately in a 720px responsive
  dialog; standalone cards widen from 520px to 640px. There is no intermediate
  account tab or wide two-column form. Plans/billing still open in a separate tab.
- Removed the duplicate Sign in/Create account action. The single pair below
  the email/password fields owns the form, including native Enter submission. Switching
  modes explicitly prevents submission, and an in-flight lock prevents duplicates.
- Password visibility and Forgot your password share an equal-width row. Recovery
  keeps distinct Save/Cancel actions. Successful sign-in returns to the unchanged
  floorplan; explicit checkout selection is still retained.
- Known plan names come from the authenticated service. A failed read is never
  labelled Free; an explanatory tooltip and focus/periodic refresh handle outages.

## Verification

- Actual running local Next development page hydrated with one Sign in action;
  Plans returned 200, and plan-summary reads rejected an intentionally invalid
  token with 401 instead of the unconfigured local backend's 503.
- 616 unit tests and 13 focused account/recovery/UI browser tests passed.
  Desktop/phone, both themes, keyboard submission, mode switching, unchanged
  project geometry and plan-outage recovery were checked with mocked credentials.
- Typecheck, lint/source usage and the production static Webpack build passed.
  No real password, registration, reset email, checkout or subscription mutation
  was used for testing. These follow-up changes are local, not published.
